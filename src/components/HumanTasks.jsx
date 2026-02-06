import { useState } from 'react'
import useSWR from 'swr'
import ReactMarkdown from 'react-markdown'
import { getTasks, fetcher } from '../lib/api'
import { CheckCircle, Clock, ExternalLink, AlertCircle, Copy, Check, Link, MessageSquare, Instagram, MessageCircle, Palette, Send, Plus, Trash2, Vote, MapPin, FileText, Image, Film, Lightbulb } from 'lucide-react'

// Security: Validate URLs to prevent javascript: and other malicious protocols
function isValidHttpUrl(urlString) {
  try {
    const url = new URL(urlString)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default function HumanTasks() {
  const { data: allTasks, error, mutate } = useSWR('/tasks', getTasks, {
    refreshInterval: 30000
  })
  const { data: postingQueue, mutate: mutateQueue } = useSWR('/api/posting-queue', fetcher, {
    refreshInterval: 30000
  })
  const { data: ideaStats } = useSWR('/api/ideas/stats', fetcher, {
    refreshInterval: 60000
  })

  const [completing, setCompleting] = useState(null)

  if (error) return <ErrorState />
  if (!allTasks) return <LoadingState />

  // Filter human tasks, but hide idea batch task if goal is met
  const humanTasks = allTasks.filter(t => {
    if (!t.assigneeIds?.includes('human')) return false
    if (['completed', 'shipped', 'deferred', 'blocked'].includes(t.status)) return false

    // Hide "Provide Weekly Idea Batch" if goal is met
    const isIdeaTask = t.title.toLowerCase().includes('idea') &&
      (t.title.toLowerCase().includes('batch') || t.title.toLowerCase().includes('weekly'))
    if (isIdeaTask && ideaStats && !ideaStats.needsMoreIdeas) {
      return false
    }

    return true
  })

  if (humanTasks.length === 0) {
    return <EmptyState />
  }

  const handleComplete = async (taskId) => {
    setCompleting(taskId)
    
    try {
      // Update task status in database
      const response = await fetch(`/api/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completedBy: 'human' })
      })
      
      if (!response.ok) throw new Error('Failed to complete task')
      
      // Refresh tasks list
      mutate()
    } catch (err) {
      console.error('Error completing task:', err)
      alert('Failed to mark task complete. Please try again.')
    } finally {
      setCompleting(null)
    }
  }

  // Sort: reopened tasks first (most recent), then by priority
  const sortedTasks = [...humanTasks].sort((a, b) => {
    // Reopened tasks go to the top, sorted by most recently reopened
    const aReopened = a.reopenedAt ? new Date(a.reopenedAt) : null
    const bReopened = b.reopenedAt ? new Date(b.reopenedAt) : null

    if (aReopened && !bReopened) return -1
    if (!aReopened && bReopened) return 1
    if (aReopened && bReopened) return bReopened - aReopened

    // Then sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    const aPriority = a.metadata?.priority || 'medium'
    const bPriority = b.metadata?.priority || 'medium'
    return priorityOrder[aPriority] - priorityOrder[bPriority]
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Your Tasks</h1>
          <p className="text-neutral-600 mt-1">
            {humanTasks.length} task{humanTasks.length === 1 ? '' : 's'} need your attention
          </p>
        </div>
        <AlertCircle className="text-gold" size={32} />
      </div>

      {/* Posting Queue Section */}
      {postingQueue && (
        <PostingQueueSection
          queue={postingQueue}
          onUpdate={mutateQueue}
        />
      )}

      <div className="space-y-4">
        {sortedTasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            onComplete={handleComplete}
            completing={completing === task.id}
            ideaStats={ideaStats}
          />
        ))}
      </div>
    </div>
  )
}

function TaskCard({ task, onComplete, completing, ideaStats }) {
  const [copiedIndex, setCopiedIndex] = useState(null)
  const priority = task.metadata?.priority || 'medium'
  const estimatedMinutes = task.metadata?.estimatedMinutes || null
  const directLink = task.metadata?.directLink
  const unblocks = task.metadata?.unblocks
  const actionItems = task.metadata?.actionItems || []

  // Check if this is an idea-related task
  const isIdeaTask = task.title.toLowerCase().includes('idea') &&
    (task.title.toLowerCase().includes('batch') || task.title.toLowerCase().includes('weekly'))

  // Extract links from description if no actionItems provided
  const extractedLinks = extractLinksFromDescription(task.description)

  const priorityColors = {
    high: 'border-l-red-500 bg-red-50',
    medium: 'border-l-yellow-500 bg-yellow-50',
    low: 'border-l-blue-500 bg-blue-50'
  }

  const priorityBadges = {
    high: 'bg-red-100 text-red-700 border-red-200',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    low: 'bg-blue-100 text-blue-700 border-blue-200'
  }

  const handleCopy = async (text, index) => {
    await navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  return (
    <div className={`bg-white rounded-lg border-l-4 ${priorityColors[priority]} p-6 shadow-sm`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-xl font-serif font-semibold text-black">
              {task.title}
            </h3>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${priorityBadges[priority]}`}>
              {priority.toUpperCase()} PRIORITY
            </span>
          </div>

          {estimatedMinutes && (
            <div className="flex items-center gap-2 text-sm text-neutral-600 mb-3">
              <Clock size={14} />
              <span>Estimated time: {estimatedMinutes} minutes</span>
            </div>
          )}

          {/* Idea Progress Indicator */}
          {isIdeaTask && ideaStats && (
            <div className="flex items-center gap-3 mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <Lightbulb size={20} className="text-amber-600" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-amber-800">Weekly Progress</span>
                  <span className="text-lg font-bold text-amber-600">
                    {ideaStats.weeklyProgress}/{ideaStats.weeklyGoal}
                  </span>
                </div>
                <div className="w-full bg-white rounded-full h-2">
                  <div
                    className="bg-amber-500 rounded-full h-2 transition-all"
                    style={{ width: `${Math.min(100, (ideaStats.weeklyProgress / ideaStats.weeklyGoal) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-amber-700 mt-1">
                  {ideaStats.weeklyGoal - ideaStats.weeklyProgress} more idea{ideaStats.weeklyGoal - ideaStats.weeklyProgress === 1 ? '' : 's'} to hit your weekly goal
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="prose prose-sm max-w-none mb-4">
        <div className="text-neutral-700 prose prose-sm max-w-none prose-headings:text-lg prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-li:ml-4 prose-pre:bg-neutral-100 prose-pre:p-3 prose-pre:rounded-md">
          <ReactMarkdown>{task.description}</ReactMarkdown>
        </div>
      </div>

      {/* Quick Action Links */}
      {(actionItems.length > 0 || extractedLinks.length > 0) && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
            <Link size={16} />
            Quick Actions
          </h4>
          <div className="space-y-3">
            {(actionItems.length > 0 ? actionItems : extractedLinks).map((item, index) => (
              <div key={index} className="bg-white p-3 rounded-md border border-blue-100">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm text-neutral-800">
                    {item.label || item.name || `Link ${index + 1}`}
                  </span>
                  <a
                    href={item.url || item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <ExternalLink size={14} />
                    Open
                  </a>
                </div>
                {item.suggestedComment && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
                      <MessageSquare size={12} />
                      Suggested comment:
                    </div>
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-sm bg-neutral-50 p-2 rounded border border-neutral-200 italic">
                        "{item.suggestedComment}"
                      </p>
                      <button
                        onClick={() => handleCopy(item.suggestedComment, index)}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-neutral-200 hover:bg-neutral-300 rounded transition-colors"
                      >
                        {copiedIndex === index ? <Check size={12} /> : <Copy size={12} />}
                        {copiedIndex === index ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {directLink && isValidHttpUrl(directLink) && (
        <div className="mb-4">
          <a
            href={directLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-gold hover:text-black font-medium transition-colors"
          >
            <ExternalLink size={16} />
            Open Link
          </a>
        </div>
      )}

      {unblocks && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
          <p className="text-sm text-green-800">
            <strong>✅ Unlocks:</strong> {Array.isArray(unblocks) ? unblocks.join(', ') : unblocks}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-neutral-200">
        <button
          onClick={() => onComplete(task.id)}
          disabled={completing}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
            completing
              ? 'bg-neutral-300 text-neutral-500 cursor-not-allowed'
              : 'bg-gold text-white hover:bg-black shadow-sm hover:shadow-md'
          }`}
        >
          <CheckCircle size={18} />
          {completing ? 'Marking Complete...' : 'Mark Complete'}
        </button>

        <span className="text-sm text-neutral-500">
          Task #{task.id.replace('task-', '')}
        </span>
      </div>
    </div>
  )
}

function extractLinksFromDescription(description) {
  // Extract profile/post links from description text
  const linkRegex = /https?:\/\/(?:bsky\.app|twitter\.com|x\.com|reddit\.com|patreon\.com)[^\s\)]+/g
  const matches = description.match(linkRegex) || []

  // Try to extract names/labels for links
  const links = matches.map(url => {
    let label = url
    // Try to get a better label from context
    if (url.includes('bsky.app/profile/')) {
      const handle = url.split('/profile/')[1]?.split(/[?\s]/)[0]
      label = `@${handle}`
    } else if (url.includes('twitter.com/') || url.includes('x.com/')) {
      const handle = url.split('/').pop()?.split('?')[0]
      label = `@${handle}`
    } else if (url.includes('reddit.com/r/')) {
      const sub = url.match(/reddit\.com\/r\/([^\/]+)/)?.[1]
      label = `r/${sub}`
    }
    return { url, label, name: label }
  })

  // Remove duplicates
  const seen = new Set()
  return links.filter(link => {
    if (seen.has(link.url)) return false
    seen.add(link.url)
    return true
  })
}

// ============================================================================
// POSTING QUEUE SECTION
// ============================================================================

function PostingQueueSection({ queue, onUpdate }) {
  const [copiedId, setCopiedId] = useState(null)
  const [updatingId, setUpdatingId] = useState(null)

  const handleCopy = async (text, id) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleMarkPosted = async (itemId) => {
    setUpdatingId(itemId)
    try {
      await fetch(`/api/posting-queue/${itemId}/posted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      onUpdate()
    } catch (err) {
      console.error('Error marking as posted:', err)
    }
    setUpdatingId(null)
  }

  const handleCanvaDone = async (itemId) => {
    setUpdatingId(itemId)
    try {
      await fetch(`/api/posting-queue/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvaComplete: true })
      })
      onUpdate()
    } catch (err) {
      console.error('Error updating:', err)
    }
    setUpdatingId(null)
  }

  const items = queue.queue || []
  if (items.length === 0) return null

  return (
    <div className="space-y-4">
      {items.map(item => (
        <PostingQueueCard
          key={item.id}
          item={item}
          copiedId={copiedId}
          updatingId={updatingId}
          canPost={item.platform === 'instagram' ? queue.canPostInstagram : queue.canPostThreads}
          onCopy={handleCopy}
          onCanvaDone={handleCanvaDone}
          onMarkPosted={handleMarkPosted}
        />
      ))}
    </div>
  )
}

function PostingQueueCard({ item, copiedId, updatingId, canPost, onCopy, onCanvaDone, onMarkPosted }) {
  const isThreads = item.platform === 'threads'
  const isInstagram = item.platform === 'instagram'
  const needsCanva = item.canvaRequired && !item.canvaComplete
  const isReady = !item.canvaRequired || item.canvaComplete
  const hasParts = item.parts && item.parts.length > 0

  const priorityColors = isReady
    ? 'border-l-green-500 bg-green-50'
    : 'border-l-amber-500 bg-amber-50'

  return (
    <div className={`bg-white rounded-lg border-l-4 ${priorityColors} p-6 shadow-sm`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        {isInstagram ? (
          <Instagram className="text-pink-600" size={24} />
        ) : (
          <MessageCircle className="text-black" size={24} />
        )}
        <h3 className="text-xl font-serif font-semibold text-black">
          {isInstagram ? 'Instagram Post' : 'Threads Thread'} Ready
        </h3>
        {hasParts && (
          <span className="px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700">
            {item.parts.length} parts
          </span>
        )}
        {isReady ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
            READY TO POST
          </span>
        ) : (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
            NEEDS CANVA
          </span>
        )}
        <span className="text-sm text-neutral-500 ml-auto">
          by {item.createdBy}
        </span>
      </div>

      {/* Threaded Posts (multiple parts) */}
      {hasParts && (
        <div className="space-y-3 mb-4">
          {item.parts.map((part, idx) => (
            <div key={idx} className="border border-neutral-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-neutral-100 border-b border-neutral-200">
                <span className="font-semibold text-neutral-700">{part.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">{part.content.length} chars</span>
                  <button
                    onClick={() => onCopy(part.content, `${item.id}-part-${idx}`)}
                    className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    {copiedId === `${item.id}-part-${idx}` ? <Check size={14} /> : <Copy size={14} />}
                    {copiedId === `${item.id}-part-${idx}` ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="p-4 whitespace-pre-wrap text-neutral-800 bg-white">
                {part.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Single Content (non-threaded) */}
      {!hasParts && item.content && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-neutral-600">
              {isInstagram ? 'Quote for Image:' : 'Post Content:'}
            </span>
            <button
              onClick={() => onCopy(item.content, `${item.id}-content`)}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {copiedId === `${item.id}-content` ? <Check size={14} /> : <Copy size={14} />}
              {copiedId === `${item.id}-content` ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="bg-white border border-neutral-200 rounded-lg p-4 whitespace-pre-wrap text-neutral-800">
            {item.content}
          </div>
        </div>
      )}

      {/* Caption for Instagram */}
      {isInstagram && item.caption && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-neutral-600">Caption:</span>
            <button
              onClick={() => onCopy(item.caption, `${item.id}-caption`)}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {copiedId === `${item.id}-caption` ? <Check size={14} /> : <Copy size={14} />}
              {copiedId === `${item.id}-caption` ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="bg-white border border-neutral-200 rounded-lg p-4 whitespace-pre-wrap text-neutral-800 text-sm">
            {item.caption}
          </div>
        </div>
      )}

      {/* Rich Features Section */}
      {(item.poll || item.location || item.textAttachment || item.image || item.gif) && (
        <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
          <div className="flex items-center gap-2 text-purple-800 font-medium mb-3">
            <Vote size={16} />
            Add These Features
          </div>
          <div className="space-y-3">
            {/* Poll */}
            {item.poll && (
              <div className="flex items-start gap-3 bg-white p-3 rounded-lg border border-purple-100">
                <Vote className="text-purple-600 mt-0.5" size={18} />
                <div className="flex-1">
                  <span className="font-medium text-sm text-purple-900">Add Poll</span>
                  {item.poll.type === 'yesno' ? (
                    <div className="mt-2 flex gap-2">
                      <span className="px-3 py-1 bg-green-100 text-green-800 rounded text-sm">
                        Yes: {item.poll.yesLabel}
                      </span>
                      <span className="px-3 py-1 bg-red-100 text-red-800 rounded text-sm">
                        No: {item.poll.noLabel}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.poll.options?.map((opt, i) => (
                        <span key={i} className="px-3 py-1 bg-purple-100 text-purple-800 rounded text-sm">
                          {opt}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Location */}
            {item.location && (
              <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-purple-100">
                <MapPin className="text-purple-600" size={18} />
                <div>
                  <span className="font-medium text-sm text-purple-900">Add Location: </span>
                  <span className="text-purple-700">{item.location}</span>
                </div>
              </div>
            )}

            {/* Text Attachment */}
            {item.textAttachment && (
              <div className="bg-white p-3 rounded-lg border border-purple-100">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="text-purple-600" size={18} />
                  <span className="font-medium text-sm text-purple-900">Add Text Attachment</span>
                  <button
                    onClick={() => onCopy(
                      item.textAttachment.title + '\n\n' + item.textAttachment.body,
                      `${item.id}-attachment`
                    )}
                    className="ml-auto flex items-center gap-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                  >
                    {copiedId === `${item.id}-attachment` ? <Check size={12} /> : <Copy size={12} />}
                    Copy
                  </button>
                </div>
                <div className="bg-neutral-50 p-3 rounded border border-neutral-200">
                  <div className="font-semibold text-neutral-800 mb-1">{item.textAttachment.title}</div>
                  <div className="text-sm text-neutral-700 whitespace-pre-wrap">{item.textAttachment.body}</div>
                </div>
              </div>
            )}

            {/* Image */}
            {item.image && (
              <div className="bg-white p-3 rounded-lg border border-purple-100">
                <div className="flex items-center gap-2 mb-2">
                  <Image className="text-purple-600" size={18} />
                  <span className="font-medium text-sm text-purple-900">Add Image</span>
                </div>
                <p className="text-sm text-neutral-700">{item.image.description}</p>
                {item.image.canvaInstructions && (
                  <p className="text-xs text-amber-700 mt-2 italic">{item.image.canvaInstructions}</p>
                )}
              </div>
            )}

            {/* GIF */}
            {item.gif && (
              <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-purple-100">
                <Film className="text-purple-600" size={18} />
                <div>
                  <span className="font-medium text-sm text-purple-900">Add GIF: </span>
                  <span className="text-purple-700">Search "{item.gif.searchTerm}"</span>
                  {item.gif.description && (
                    <span className="text-neutral-500 text-sm ml-2">({item.gif.description})</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Canva Instructions */}
      {needsCanva && item.canvaInstructions && (
        <div className="mb-4 p-4 bg-amber-100 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 text-amber-800 font-medium mb-2">
            <Palette size={16} />
            Canva Instructions
          </div>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{item.canvaInstructions}</p>
          <a
            href="https://www.canva.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
          >
            <ExternalLink size={14} />
            Open Canva
          </a>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-4 border-t border-neutral-200">
        {needsCanva ? (
          <button
            onClick={() => onCanvaDone(item.id)}
            disabled={updatingId === item.id}
            className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-50"
          >
            <Palette size={18} />
            {updatingId === item.id ? 'Updating...' : 'Canva Design Complete'}
          </button>
        ) : (
          <>
            <a
              href={item.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
            >
              <ExternalLink size={18} />
              Open {isInstagram ? 'Instagram' : 'Threads'}
            </a>
            {canPost ? (
              <button
                onClick={() => onMarkPosted(item.id)}
                disabled={updatingId === item.id}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle size={18} />
                {updatingId === item.id ? 'Marking...' : 'Mark as Posted'}
              </button>
            ) : (
              <span className="text-red-500 text-sm">Daily limit reached</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// LOADING & ERROR STATES
// ============================================================================

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorState() {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-red-900 mb-2">Error Loading Tasks</h2>
      <p className="text-red-700">Failed to load your tasks. Please refresh the page.</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-12 text-center">
      <CheckCircle size={48} className="text-green-600 mx-auto mb-4" />
      <h2 className="text-2xl font-serif font-bold text-black mb-2">All Clear!</h2>
      <p className="text-neutral-700">
        No tasks need your attention right now. The philosopher squad is handling everything.
      </p>
    </div>
  )
}
