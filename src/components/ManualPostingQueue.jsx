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
  ShieldCheck,
  Loader2,
  Copy,
  Hash,
  BookOpen
} from 'lucide-react'
import PlatformStatusBadges from './PlatformStatusBadges'

// Bluesky icon as inline SVG since lucide doesn't have one
function BlueskyIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.862 13.862c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69L12 14.492l-1.37 1.37c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69-.964-.964-.964-2.528 0-3.492L9.508 10l-2.37-2.37c-.964-.964-.964-2.528 0-3.492.964-.964 2.528-.964 3.492 0L12 5.508l1.37-1.37c.964-.964 2.528-.964 3.492 0 .964.964.964 2.528 0 3.492L14.492 10l2.37 2.37c.964.964.964 2.528 0 3.492z"/>
    </svg>
  )
}

// Twitter/X icon
function TwitterIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  )
}

function getPlatformIcon(platform, size = 16) {
  switch (platform) {
    case 'instagram': return <Instagram size={size} className="text-pink-600" />
    case 'threads': return <MessageCircle size={size} className="text-black" />
    case 'bluesky': return <BlueskyIcon size={size} className="text-blue-500" />
    case 'twitter': return <TwitterIcon size={size} className="text-neutral-800" />
    case 'reddit': return <Hash size={size} className="text-orange-500" />
    case 'medium': return <BookOpen size={size} className="text-green-700" />
    default: return null
  }
}

export default function ManualPostingQueue() {
  const [showAddModal, setShowAddModal] = useState(false)
  const [platformFilter, setPlatformFilter] = useState(null)
  const { data, error, isLoading, mutate } = useSWR('/api/posting-queue', fetcher, {
    refreshInterval: 30000
  })

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

  // Compute last post time per platform from posted array
  const lastPostedByPlatform = {}
  for (const item of (data.posted || [])) {
    if (!lastPostedByPlatform[item.platform] && item.postedAt) {
      lastPostedByPlatform[item.platform] = item.postedAt
    }
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Posting Queue</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-neutral-600">All platforms</p>
            <PlatformStatusBadges />
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

      {/* Daily Limits (clickable filters) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <PlatformStatus
          platform="instagram"
          icon={<Instagram size={24} />}
          postsToday={data.postsToday?.instagram || 0}
          maxPosts={data.settings?.platforms?.instagram?.maxPostsPerDay || 2}
          canPost={data.canPostInstagram}
          warmupMode={data.settings?.warmupMode}
          lastPosted={lastPostedByPlatform.instagram}
          isActive={platformFilter === 'instagram'}
          onClick={() => setPlatformFilter(platformFilter === 'instagram' ? null : 'instagram')}
        />
        <PlatformStatus
          platform="threads"
          icon={<MessageCircle size={24} />}
          postsToday={data.postsToday?.threads || 0}
          maxPosts={data.settings?.platforms?.threads?.maxPostsPerDay || 3}
          canPost={data.canPostThreads}
          warmupMode={data.settings?.warmupMode}
          lastPosted={lastPostedByPlatform.threads}
          isActive={platformFilter === 'threads'}
          onClick={() => setPlatformFilter(platformFilter === 'threads' ? null : 'threads')}
        />
        <PlatformStatus
          platform="bluesky"
          icon={<BlueskyIcon size={24} className="text-current" />}
          postsToday={data.postsToday?.bluesky || 0}
          maxPosts={data.settings?.platforms?.bluesky?.maxPostsPerDay || 5}
          canPost={data.canPostBluesky}
          warmupMode={data.settings?.warmupMode}
          lastPosted={lastPostedByPlatform.bluesky}
          isActive={platformFilter === 'bluesky'}
          onClick={() => setPlatformFilter(platformFilter === 'bluesky' ? null : 'bluesky')}
        />
        <PlatformStatus
          platform="twitter"
          icon={<TwitterIcon size={24} className="text-current" />}
          postsToday={data.postsToday?.twitter || 0}
          maxPosts={data.settings?.platforms?.twitter?.maxPostsPerDay || 5}
          canPost={data.canPostTwitter}
          warmupMode={data.settings?.warmupMode}
          lastPosted={lastPostedByPlatform.twitter}
          isActive={platformFilter === 'twitter'}
          onClick={() => setPlatformFilter(platformFilter === 'twitter' ? null : 'twitter')}
        />
        <PlatformStatus
          platform="reddit"
          icon={<Hash size={24} />}
          postsToday={data.postsToday?.reddit || 0}
          maxPosts={data.settings?.platforms?.reddit?.maxPostsPerDay || 3}
          canPost={data.canPostReddit}
          warmupMode={data.settings?.warmupMode}
          lastPosted={lastPostedByPlatform.reddit}
          isActive={platformFilter === 'reddit'}
          onClick={() => setPlatformFilter(platformFilter === 'reddit' ? null : 'reddit')}
        />
        <PlatformStatus
          platform="medium"
          icon={<BookOpen size={24} />}
          postsToday={data.postsToday?.medium || 0}
          maxPosts={data.settings?.platforms?.medium?.maxPostsPerDay || 1}
          canPost={data.canPostMedium}
          warmupMode={data.settings?.warmupMode}
          lastPosted={lastPostedByPlatform.medium}
          isActive={platformFilter === 'medium'}
          onClick={() => setPlatformFilter(platformFilter === 'medium' ? null : 'medium')}
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
      {(() => {
        const filtered = platformFilter
          ? (data.queue || []).filter(i => i.platform === platformFilter)
          : (data.queue || [])
        return (
      <div className="bg-white rounded-lg border border-neutral-200">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="font-semibold text-neutral-900">
            Ready to Post ({filtered.length})
          </h2>
        </div>
        <div className="divide-y divide-neutral-100">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              <Clock className="w-12 h-12 mx-auto mb-3 text-neutral-300" />
              <p>{platformFilter ? `No ${platformFilter} items in queue` : 'No items in queue'}</p>
              <p className="text-sm mt-1">{platformFilter ? 'Click the card again to show all' : 'Add content to the queue or use the auto-pipeline'}</p>
            </div>
          ) : (
            filtered.map(item => (
              <QueueItem
                key={item.id}
                item={item}
                canPost={
                  item.platform === 'instagram' ? data.canPostInstagram :
                  item.platform === 'bluesky' ? data.canPostBluesky :
                  item.platform === 'twitter' ? data.canPostTwitter :
                  item.platform === 'reddit' ? data.canPostReddit :
                  item.platform === 'medium' ? data.canPostMedium :
                  data.canPostThreads
                }
                onUpdate={mutate}
              />
            ))
          )}
        </div>
      </div>
        )
      })()}

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

const PLATFORM_STYLE = {
  bluesky: { bg: 'bg-blue-50', border: 'border-blue-200', hover: 'hover:border-blue-300', text: 'text-blue-600', ring: 'ring-blue-500', activeBg: 'bg-blue-100' },
  twitter: { bg: 'bg-neutral-50', border: 'border-neutral-300', hover: 'hover:border-neutral-400', text: 'text-neutral-800', ring: 'ring-neutral-800', activeBg: 'bg-neutral-100' },
  instagram: { bg: 'bg-pink-50', border: 'border-pink-200', hover: 'hover:border-pink-300', text: 'text-pink-600', ring: 'ring-pink-500', activeBg: 'bg-pink-100' },
  threads: { bg: 'bg-neutral-50', border: 'border-neutral-300', hover: 'hover:border-neutral-400', text: 'text-neutral-800', ring: 'ring-neutral-800', activeBg: 'bg-neutral-100' },
  reddit: { bg: 'bg-orange-50', border: 'border-orange-200', hover: 'hover:border-orange-300', text: 'text-orange-600', ring: 'ring-orange-500', activeBg: 'bg-orange-100' },
  medium: { bg: 'bg-green-50', border: 'border-green-200', hover: 'hover:border-green-300', text: 'text-green-700', ring: 'ring-green-600', activeBg: 'bg-green-100' },
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function PlatformStatus({ platform, icon, postsToday, maxPosts, canPost, warmupMode, lastPosted, isActive, onClick }) {
  const remaining = maxPosts - postsToday
  const ps = PLATFORM_STYLE[platform] || PLATFORM_STYLE.twitter

  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg border text-left w-full transition-all ${
        isActive
          ? `ring-2 ring-offset-1 ${ps.ring} ${ps.border} ${ps.activeBg}`
          : `${ps.bg} ${ps.border} ${ps.hover}`
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={ps.text}>
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
      <p className="text-xs text-neutral-500 mt-2">
        {lastPosted ? `Last post: ${timeAgo(lastPosted)}` : 'No posts yet'}
      </p>
      {warmupMode && (
        <p className="text-xs text-amber-600 mt-1">Warmup limits active</p>
      )}
    </button>
  )
}

const VOICE_COLORS = {
  strong: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  good: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  weak: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  'off-voice': { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' }
}

function QueueItem({ item, canPost, onUpdate }) {
  const [hidden, setHidden] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [publishStatus, setPublishStatus] = useState(null) // 'publishing' | 'success' | 'error'
  const [publishError, setPublishError] = useState(null)
  const [voiceCheck, setVoiceCheck] = useState(null)
  const [voiceCheckLoading, setVoiceCheckLoading] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState(null) // null | 'content' | option index
  const [expanded, setExpanded] = useState(false)

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
    setHidden(true)
    try {
      await fetch(`/api/posting-queue/${item.id}/posted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      onUpdate()
    } catch (err) {
      console.error('Error marking as posted:', err)
      setHidden(false)
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

  const platformComposeUrls = {
    twitter: 'https://x.com/compose/post',
    bluesky: 'https://bsky.app/',
    instagram: 'https://www.canva.com/',
    reddit: 'https://www.reddit.com/r/thetensionlines/submit',
    medium: 'https://medium.com/new-story',
    threads: 'https://www.threads.net/',
  }

  const getComposeUrl = () => {
    if (item.postUrl) return item.postUrl
    if (item.platform === 'reddit' && item.subreddit) {
      return `https://www.reddit.com/r/${item.subreddit}/submit`
    }
    return platformComposeUrls[item.platform]
  }

  const handleCopyAndOpen = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyFeedback('content')
      setTimeout(() => setCopyFeedback(null), 2000)
      const url = getComposeUrl()
      if (url) window.open(url, '_blank')
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleSelectOption = async (opt, idx) => {
    const text = typeof opt === 'string' ? opt : opt.text
    try {
      // Update the item's content to the selected option
      await fetch(`/api/posting-queue/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, selectedOption: idx })
      })
      // Copy and open
      await navigator.clipboard.writeText(text)
      setCopyFeedback(idx)
      setTimeout(() => setCopyFeedback(null), 2000)
      const url = getComposeUrl()
      if (url) window.open(url, '_blank')
      onUpdate()
    } catch (err) {
      console.error('Failed to select option:', err)
    }
  }

  if (hidden) return null

  const isReady = !item.canvaRequired || item.canvaComplete
  const isFailed = item.status === 'failed'
  const rawOptions = item.metadata?.options || []
  // Normalize options: support both string[] and {text, philosopher}[]
  const options = rawOptions.map(opt =>
    typeof opt === 'string' ? { text: opt, philosopher: null } : opt
  )

  return (
    <div className={`p-4 ${isFailed ? 'bg-red-50' : isReady ? '' : 'bg-amber-50'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {getPlatformIcon(item.platform)}
            <span className="text-sm font-medium capitalize">
              {item.platform === 'twitter' ? 'Twitter / X' : item.platform}
            </span>
            {item.platform === 'reddit' && (
              <span className="text-xs text-orange-600 font-medium">
                r/{item.subreddit || 'thetensionlines'}
              </span>
            )}
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
            {item.taskId && (
              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                {item.taskId}
              </span>
            )}
          </div>

          {/* Show options if present (e.g. pick A/B/C tweet from different philosophers) */}
          {options.length > 1 ? (
            <div className="space-y-3 mb-2">
              <p className="text-xs text-neutral-500 font-medium">Pick a voice and post:</p>
              {options.map((opt, idx) => {
                const isSelected = item.selectedOption === idx
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'border-gold bg-amber-50 ring-1 ring-gold'
                        : 'border-neutral-200 bg-white hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {opt.philosopher && (
                        <img
                          src={`/avatars/${opt.philosopher}.jpg`}
                          alt={opt.philosopher}
                          className="w-6 h-6 rounded-full object-cover"
                          onError={(e) => {
                            // Try .svg fallback
                            if (e.target.src.includes('.jpg')) {
                              e.target.src = `/avatars/${opt.philosopher}.svg`
                            } else {
                              e.target.style.display = 'none'
                            }
                          }}
                        />
                      )}
                      <span className="text-xs font-semibold text-neutral-600 capitalize">
                        {opt.philosopher || `Option ${String.fromCharCode(65 + idx)}`}
                      </span>
                      {isSelected && (
                        <span className="px-2 py-0.5 text-xs bg-gold text-white rounded-full font-medium">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-neutral-800 mb-2">{opt.text}</p>
                    <button
                      onClick={() => handleSelectOption(opt, idx)}
                      className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded font-medium whitespace-nowrap ${
                        isSelected
                          ? 'bg-gold text-white hover:bg-amber-600'
                          : 'bg-neutral-800 text-white hover:bg-neutral-900'
                      }`}
                    >
                      {copyFeedback === idx ? <Check size={12} /> : <Copy size={12} />}
                      {copyFeedback === idx ? 'Copied!' : isSelected ? 'Copy & Open Again' : 'Select · Copy & Open'}
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div>
              <p className={`text-neutral-800 whitespace-pre-wrap ${expanded ? '' : 'line-clamp-3'}`}>{item.content}</p>
              {item.content?.length > 150 && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-xs text-gold hover:text-amber-700 font-medium mt-1"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}

          {item.title && (
            <p className="text-sm font-semibold text-neutral-700 mt-1">
              Title: {item.title}
            </p>
          )}

          {item.topics?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.topics.map(topic => (
                <span key={topic} className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded-full">{topic}</span>
              ))}
            </div>
          )}

          {item.platform === 'reddit' && item.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {item.tags.map(tag => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">{tag}</span>
              ))}
            </div>
          )}

          {item.caption && (
            <p className={`text-sm text-neutral-500 mt-2 ${expanded ? '' : 'line-clamp-2'}`}>
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
          {/* All platforms get Copy & Open */}
          {isReady && (
            <button
              onClick={() => handleCopyAndOpen(
                item.platform === 'instagram' ? `Instagram Post:\n\n${item.content}${item.caption ? '\n\n' + item.caption : ''}` :
                item.platform === 'medium' ? `${item.title ? item.title + '\n\n' : ''}${item.content}${item.topics?.length ? '\n\nTopics: ' + item.topics.join(', ') : ''}` :
                item.platform === 'reddit' ? `${item.content}${item.tags?.length ? '\n\nTags: ' + item.tags.join(', ') : ''}` :
                item.content
              )}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-neutral-800 text-white rounded hover:bg-neutral-900"
            >
              {copyFeedback === 'content' ? <Check size={14} /> : <Copy size={14} />}
              {copyFeedback === 'content' ? 'Copied!' : 'Copy & Open'}
            </button>
          )}
          {/* Mark Posted */}
          {isReady && (
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
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'instagram', label: 'Instagram', icon: <Instagram size={18} />, active: 'border-pink-500 bg-pink-50 text-pink-700' },
                { id: 'threads', label: 'Threads', icon: <MessageCircle size={18} />, active: 'border-black bg-neutral-100 text-black' },
                { id: 'bluesky', label: 'Bluesky', icon: <BlueskyIcon size={18} />, active: 'border-blue-500 bg-blue-50 text-blue-700' },
                { id: 'twitter', label: 'Twitter', icon: <TwitterIcon size={18} />, active: 'border-neutral-800 bg-neutral-100 text-neutral-800' },
                { id: 'reddit', label: 'Reddit', icon: <Hash size={18} />, active: 'border-orange-500 bg-orange-50 text-orange-700' },
                { id: 'medium', label: 'Medium', icon: <BookOpen size={18} />, active: 'border-green-600 bg-green-50 text-green-700' },
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={`p-2.5 rounded-lg border flex items-center justify-center gap-2 text-sm ${
                    platform === p.id ? p.active : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              {platform === 'instagram' ? 'Quote/Text for Canva Design' :
               platform === 'reddit' ? 'Title + Body (separate with blank line)' :
               platform === 'medium' ? 'Essay Content' :
               'Post Content'}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                platform === 'instagram' ? 'The quote or text that will go on the image...' :
                platform === 'bluesky' ? 'Your Bluesky post content (300 chars max)...' :
                platform === 'reddit' ? 'Discussion title\n\nBody text goes here...' :
                platform === 'medium' ? 'Your essay paragraph or section...' :
                platform === 'twitter' ? 'Your tweet (280 chars max)...' :
                'Your post content...'
              }
              rows={platform === 'reddit' || platform === 'medium' ? 6 : 4}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
              required
            />
            {platform === 'bluesky' && (
              <p className={`text-xs mt-1 ${content.length > 300 ? 'text-red-600' : 'text-neutral-400'}`}>
                {content.length} / 300 characters
              </p>
            )}
            {platform === 'twitter' && (
              <p className={`text-xs mt-1 ${content.length > 280 ? 'text-red-600' : 'text-neutral-400'}`}>
                {content.length} / 280 characters
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

          {platform === 'reddit' && (
            <p className="text-sm text-orange-600 flex items-center gap-2">
              <Hash size={14} />
              Manual posting to <span className="font-semibold">r/thetensionlines</span> — community is pre-filled
            </p>
          )}

          {platform === 'medium' && (
            <p className="text-sm text-green-700 flex items-center gap-2">
              <BookOpen size={14} />
              Manual posting — copy and publish on Medium
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
