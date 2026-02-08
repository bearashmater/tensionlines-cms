import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  Instagram,
  MessageCircle,
  Plus,
  Check,
  Palette,
  Trash2,
  ExternalLink,
  Clock,
  AlertTriangle,
  CheckCircle,
  X,
  Send,
  RefreshCw,
  CloudOff,
  Cloud,
  ShieldCheck,
  Loader2
} from 'lucide-react'

// Bluesky icon as inline SVG since lucide doesn't have one
function BlueskyIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.862 13.862c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69L12 14.492l-1.37 1.37c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69-.964-.964-.964-2.528 0-3.492L9.508 10l-2.37-2.37c-.964-.964-.964-2.528 0-3.492.964-.964 2.528-.964 3.492 0L12 5.508l1.37-1.37c.964-.964 2.528-.964 3.492 0 .964.964.964 2.528 0 3.492L14.492 10l2.37 2.37c.964.964.964 2.528 0 3.492z"/>
    </svg>
  )
}

function getPlatformIcon(platform, size = 16) {
  switch (platform) {
    case 'instagram': return <Instagram size={size} className="text-pink-600" />
    case 'threads': return <MessageCircle size={size} className="text-black" />
    case 'bluesky': return <BlueskyIcon size={size} className="text-blue-500" />
    default: return null
  }
}

export default function ManualPostingQueue() {
  const [showAddModal, setShowAddModal] = useState(false)
  const [bskyStatus, setBskyStatus] = useState(null)
  const { data, error, isLoading, mutate } = useSWR('/api/posting-queue', fetcher, {
    refreshInterval: 30000
  })

  useEffect(() => {
    fetch('/api/bluesky/status')
      .then(r => r.json())
      .then(setBskyStatus)
      .catch(() => setBskyStatus({ connected: false }))
  }, [])

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-red-800">Failed to load posting queue</h3>
      </div>
    )
  }

  if (isLoading || !data) {
    return <LoadingState />
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Posting Queue</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-neutral-600">Instagram, Threads & Bluesky</p>
            {bskyStatus && (
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                bskyStatus.connected
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-red-50 text-red-600'
              }`}>
                {bskyStatus.connected ? <Cloud size={12} /> : <CloudOff size={12} />}
                Bluesky {bskyStatus.connected ? 'connected' : 'disconnected'}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gold text-white rounded-lg hover:bg-amber-600"
        >
          <Plus size={20} />
          Add to Queue
        </button>
      </div>

      {/* Daily Limits */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PlatformStatus
          platform="instagram"
          icon={<Instagram size={24} />}
          postsToday={data.postsToday?.instagram || 0}
          maxPosts={data.settings?.platforms?.instagram?.maxPostsPerDay || 2}
          canPost={data.canPostInstagram}
          warmupMode={data.settings?.warmupMode}
        />
        <PlatformStatus
          platform="threads"
          icon={<MessageCircle size={24} />}
          postsToday={data.postsToday?.threads || 0}
          maxPosts={data.settings?.platforms?.threads?.maxPostsPerDay || 3}
          canPost={data.canPostThreads}
          warmupMode={data.settings?.warmupMode}
        />
        <PlatformStatus
          platform="bluesky"
          icon={<BlueskyIcon size={24} className="text-current" />}
          postsToday={data.postsToday?.bluesky || 0}
          maxPosts={data.settings?.platforms?.bluesky?.maxPostsPerDay || 5}
          canPost={data.canPostBluesky}
          warmupMode={data.settings?.warmupMode}
        />
      </div>

      {/* Warmup Warning */}
      {data.settings?.warmupMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="font-medium text-amber-800">Warmup Mode Active</h3>
            <p className="text-sm text-amber-700 mt-1">
              New accounts should post conservatively for 2 weeks. Current limits are reduced to prevent bans.
            </p>
          </div>
        </div>
      )}

      {/* Queue */}
      <div className="bg-white rounded-lg border border-neutral-200">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="font-semibold text-neutral-900">
            Ready to Post ({data.queue?.length || 0})
          </h2>
        </div>
        <div className="divide-y divide-neutral-100">
          {data.queue?.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              <Clock className="w-12 h-12 mx-auto mb-3 text-neutral-300" />
              <p>No items in queue</p>
              <p className="text-sm mt-1">Add content to post to Instagram, Threads or Bluesky</p>
            </div>
          ) : (
            data.queue.map(item => (
              <QueueItem
                key={item.id}
                item={item}
                canPost={
                  item.platform === 'instagram' ? data.canPostInstagram :
                  item.platform === 'bluesky' ? data.canPostBluesky :
                  data.canPostThreads
                }
                onUpdate={mutate}
              />
            ))
          )}
        </div>
      </div>

      {/* Recently Posted */}
      {data.posted?.length > 0 && (
        <div className="bg-white rounded-lg border border-neutral-200">
          <div className="px-4 py-3 border-b border-neutral-200">
            <h2 className="font-semibold text-neutral-900">
              Recently Posted ({data.posted?.length || 0})
            </h2>
          </div>
          <div className="divide-y divide-neutral-100 max-h-64 overflow-y-auto">
            {data.posted.slice(0, 10).map(item => (
              <PostedItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddToQueueModal
          onClose={() => setShowAddModal(false)}
          onAdd={() => {
            setShowAddModal(false)
            mutate()
          }}
        />
      )}
    </div>
  )
}

function PlatformStatus({ platform, icon, postsToday, maxPosts, canPost, warmupMode }) {
  const remaining = maxPosts - postsToday

  return (
    <div className={`p-4 rounded-lg border ${canPost ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={canPost ? 'text-green-600' : 'text-red-600'}>
            {icon}
          </div>
          <div>
            <h3 className="font-semibold capitalize">{platform}</h3>
            <p className="text-sm text-neutral-600">
              {postsToday} / {maxPosts} posts today
            </p>
          </div>
        </div>
        <div className={`text-2xl font-bold ${canPost ? 'text-green-600' : 'text-red-600'}`}>
          {remaining > 0 ? remaining : 0}
          <span className="text-sm font-normal ml-1">left</span>
        </div>
      </div>
      {warmupMode && (
        <p className="text-xs text-amber-600 mt-2">Warmup limits active</p>
      )}
    </div>
  )
}

const VOICE_COLORS = {
  strong: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  good: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  weak: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  'off-voice': { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' }
}

function QueueItem({ item, canPost, onUpdate }) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [publishStatus, setPublishStatus] = useState(null) // 'publishing' | 'success' | 'error'
  const [publishError, setPublishError] = useState(null)
  const [voiceCheck, setVoiceCheck] = useState(null)
  const [voiceCheckLoading, setVoiceCheckLoading] = useState(false)

  const handleVoiceCheck = async () => {
    setVoiceCheckLoading(true)
    try {
      const content = [item.content, item.caption].filter(Boolean).join('\n\n')
      const res = await fetch('/api/voice-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, philosopher: item.createdBy, platform: item.platform })
      })
      const data = await res.json()
      if (res.ok) setVoiceCheck(data)
    } catch (err) {
      console.error('Voice check error:', err)
    }
    setVoiceCheckLoading(false)
  }

  const handleMarkPosted = async () => {
    setIsUpdating(true)
    try {
      await fetch(`/api/posting-queue/${item.id}/posted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      onUpdate()
    } catch (err) {
      console.error('Error marking as posted:', err)
    }
    setIsUpdating(false)
  }

  const handlePublishBluesky = async () => {
    setPublishStatus('publishing')
    setPublishError(null)
    try {
      const res = await fetch(`/api/posting-queue/${item.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const result = await res.json()
      if (res.ok) {
        setPublishStatus('success')
        setTimeout(() => onUpdate(), 1500)
      } else {
        setPublishStatus('error')
        setPublishError(result.message || 'Unknown error')
      }
    } catch (err) {
      setPublishStatus('error')
      setPublishError(err.message)
    }
  }

  const handleCanvaComplete = async () => {
    setIsUpdating(true)
    try {
      await fetch(`/api/posting-queue/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvaComplete: true })
      })
      onUpdate()
    } catch (err) {
      console.error('Error updating:', err)
    }
    setIsUpdating(false)
  }

  const handleDelete = async () => {
    if (!confirm('Delete this item from the queue?')) return
    setIsUpdating(true)
    try {
      await fetch(`/api/posting-queue/${item.id}`, { method: 'DELETE' })
      onUpdate()
    } catch (err) {
      console.error('Error deleting:', err)
    }
    setIsUpdating(false)
  }

  const isReady = !item.canvaRequired || item.canvaComplete
  const isFailed = item.status === 'failed'

  return (
    <div className={`p-4 ${isFailed ? 'bg-red-50' : isReady ? '' : 'bg-amber-50'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {getPlatformIcon(item.platform)}
            <span className="text-sm font-medium capitalize">{item.platform}</span>
            {item.canvaRequired && !item.canvaComplete && (
              <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">
                Needs Canva
              </span>
            )}
            {isFailed && (
              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded" title={item.lastError}>
                Failed
              </span>
            )}
            {isReady && !isFailed && (
              <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                Ready
              </span>
            )}
          </div>
          <p className="text-neutral-800 whitespace-pre-wrap line-clamp-3">{item.content}</p>
          {item.caption && (
            <p className="text-sm text-neutral-500 mt-2 line-clamp-2">
              Caption: {item.caption}
            </p>
          )}
          {isFailed && item.lastError && (
            <p className="text-xs text-red-600 mt-2">Error: {item.lastError}</p>
          )}
          <p className="text-xs text-neutral-400 mt-2">
            Added {new Date(item.createdAt).toLocaleString()}
            {item.createdBy && item.createdBy !== 'unknown' && (
              <span className="ml-2 text-neutral-400">by {item.createdBy}</span>
            )}
          </p>

          {/* Voice check result inline */}
          {voiceCheck && (
            <div className={`flex items-center gap-2 mt-2 text-xs ${(VOICE_COLORS[voiceCheck.verdict] || VOICE_COLORS.good).text}`}>
              <span className={`w-2 h-2 rounded-full ${(VOICE_COLORS[voiceCheck.verdict] || VOICE_COLORS.good).dot}`} />
              <span className="font-medium">{voiceCheck.score}</span>
              <span>{voiceCheck.verdict}</span>
              {voiceCheck.issues?.length > 0 && (
                <span className="text-neutral-400">— {voiceCheck.issues[0].description}</span>
              )}
            </div>
          )}

          {/* Publishing status feedback */}
          {publishStatus === 'publishing' && (
            <div className="flex items-center gap-2 mt-2 text-sm text-blue-600">
              <RefreshCw size={14} className="animate-spin" />
              Publishing to Bluesky...
            </div>
          )}
          {publishStatus === 'success' && (
            <div className="flex items-center gap-2 mt-2 text-sm text-green-600">
              <CheckCircle size={14} />
              Published successfully!
            </div>
          )}
          {publishStatus === 'error' && (
            <div className="flex items-center gap-2 mt-2 text-sm text-red-600">
              <AlertTriangle size={14} />
              {publishError}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {item.canvaRequired && !item.canvaComplete && (
            <button
              onClick={handleCanvaComplete}
              disabled={isUpdating}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50"
            >
              <Palette size={14} />
              Canva Done
            </button>
          )}
          {/* Bluesky gets a real Publish button */}
          {item.platform === 'bluesky' && isReady && canPost && (
            <button
              onClick={handlePublishBluesky}
              disabled={publishStatus === 'publishing'}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {publishStatus === 'publishing' ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {isFailed ? 'Retry' : 'Publish to Bluesky'}
            </button>
          )}
          {/* Non-bluesky platforms get manual Mark Posted */}
          {item.platform !== 'bluesky' && isReady && canPost && (
            <button
              onClick={handleMarkPosted}
              disabled={isUpdating}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              <Check size={14} />
              Mark Posted
            </button>
          )}
          {!canPost && isReady && (
            <span className="text-xs text-red-600">Daily limit reached</span>
          )}
          {item.createdBy && item.createdBy !== 'unknown' && (
            <button
              onClick={handleVoiceCheck}
              disabled={voiceCheckLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded disabled:opacity-50"
            >
              {voiceCheckLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ShieldCheck size={14} />
              )}
              Voice Check
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={isUpdating}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function PostedItem({ item }) {
  const contentText = item.content || (item.parts?.[0]?.content) || ''

  return (
    <div className="p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle size={16} className="text-green-500" />
        {getPlatformIcon(item.platform, 14)}
        <span className="text-sm text-neutral-700 truncate max-w-md">
          {contentText.substring(0, 60)}{contentText.length > 60 ? '...' : ''}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span>{new Date(item.postedAt).toLocaleDateString()}</span>
        {item.postUrl && /^https?:\/\//.test(item.postUrl) && (
          <a
            href={item.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  )
}

function AddToQueueModal({ onClose, onAdd }) {
  const [platform, setPlatform] = useState('instagram')
  const [content, setContent] = useState('')
  const [caption, setCaption] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!content.trim()) return

    setIsSubmitting(true)
    try {
      await fetch('/api/posting-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, content, caption })
      })
      onAdd()
    } catch (err) {
      console.error('Error adding to queue:', err)
    }
    setIsSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add to Posting Queue</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Platform Selection */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">Platform</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPlatform('instagram')}
                className={`flex-1 p-3 rounded-lg border flex items-center justify-center gap-2 ${
                  platform === 'instagram'
                    ? 'border-pink-500 bg-pink-50 text-pink-700'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <Instagram size={20} />
                Instagram
              </button>
              <button
                type="button"
                onClick={() => setPlatform('threads')}
                className={`flex-1 p-3 rounded-lg border flex items-center justify-center gap-2 ${
                  platform === 'threads'
                    ? 'border-black bg-neutral-100 text-black'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <MessageCircle size={20} />
                Threads
              </button>
              <button
                type="button"
                onClick={() => setPlatform('bluesky')}
                className={`flex-1 p-3 rounded-lg border flex items-center justify-center gap-2 ${
                  platform === 'bluesky'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <BlueskyIcon size={20} />
                Bluesky
              </button>
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              {platform === 'instagram' ? 'Quote/Text for Canva Design' : 'Post Content'}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                platform === 'instagram' ? 'The quote or text that will go on the image...' :
                platform === 'bluesky' ? 'Your Bluesky post content (300 chars max)...' :
                'Your Threads post content...'
              }
              rows={4}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
              required
            />
            {platform === 'bluesky' && (
              <p className={`text-xs mt-1 ${content.length > 300 ? 'text-red-600' : 'text-neutral-400'}`}>
                {content.length} / 300 characters
              </p>
            )}
          </div>

          {/* Caption (for Instagram) */}
          {platform === 'instagram' && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Instagram Caption
              </label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="The caption that goes with the post..."
                rows={3}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
            </div>
          )}

          {platform === 'instagram' && (
            <p className="text-sm text-amber-600 flex items-center gap-2">
              <Palette size={14} />
              You'll need to create this in Canva before posting
            </p>
          )}

          {platform === 'bluesky' && (
            <p className="text-sm text-blue-600 flex items-center gap-2">
              <Send size={14} />
              Bluesky posts are published automatically via API
            </p>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-neutral-600 hover:text-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !content.trim()}
              className="px-4 py-2 bg-gold text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add to Queue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
