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
  BookOpen,
  Sparkles,
  Cloud,
  Newspaper,
  Mic,
  Play,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Archive,
  ThumbsUp,
  XCircle,
  Star,
  Film,
  Video
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
    case 'substack': return <Newspaper size={size} className="text-orange-600" />
    case 'podcast': return <Mic size={size} className="text-purple-600" />
    default: return null
  }
}

export default function ManualPostingQueue() {
  const [showAddModal, setShowAddModal] = useState(false)
  const [platformFilter, setPlatformFilter] = useState(null)
  const { data, error, isLoading, mutate } = useSWR('/api/posting-queue', fetcher, {
    refreshInterval: 30000
  })
  const { data: postingModes } = useSWR('/api/settings/posting-modes', fetcher, {
    refreshInterval: 60000
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

      {/* Daily Limits (clickable filters, sorted by most remaining) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { platform: 'instagram', icon: <Instagram size={24} />, defaultMax: 2, canPost: data.canPostInstagram, warmup: data.settings?.warmupMode },
          { platform: 'threads', icon: <MessageCircle size={24} />, defaultMax: 3, canPost: data.canPostThreads, warmup: data.settings?.warmupMode },
          { platform: 'bluesky', icon: <BlueskyIcon size={24} className="text-current" />, defaultMax: 5, canPost: data.canPostBluesky, warmup: data.settings?.warmupMode },
          { platform: 'twitter', icon: <TwitterIcon size={24} className="text-current" />, defaultMax: 5, canPost: data.canPostTwitter, warmup: data.settings?.warmupMode },
          { platform: 'reddit', icon: <Hash size={24} />, defaultMax: 3, canPost: data.canPostReddit, warmup: data.settings?.warmupMode },
          { platform: 'medium', icon: <BookOpen size={24} />, defaultMax: 1, canPost: data.canPostMedium, warmup: data.settings?.warmupMode },
          { platform: 'substack', icon: <Newspaper size={24} />, defaultMax: 1, canPost: data.canPostSubstack, warmup: data.settings?.warmupMode },
          { platform: 'podcast', icon: <Mic size={24} />, defaultMax: 1, canPost: data.canPostPodcast, warmup: false },
        ]
          .map(p => ({
            ...p,
            postsToday: data.postsToday?.[p.platform] || 0,
            maxPosts: data.settings?.platforms?.[p.platform]?.maxPostsPerDay || p.defaultMax,
          }))
          .sort((a, b) => (b.maxPosts - b.postsToday) - (a.maxPosts - a.postsToday))
          .map(p => (
          <PlatformStatus
            key={p.platform}
            platform={p.platform}
            icon={p.icon}
            postsToday={p.postsToday}
            maxPosts={p.maxPosts}
            canPost={p.canPost}
            warmupMode={p.warmup}
            lastPosted={lastPostedByPlatform[p.platform]}
            isActive={platformFilter === p.platform}
            onClick={() => setPlatformFilter(platformFilter === p.platform ? null : p.platform)}
          />
        ))}
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
                  item.platform === 'substack' ? (data.canPostSubstack !== false) :
                  item.platform === 'podcast' ? (data.canPostPodcast !== false) :
                  data.canPostThreads
                }
                postingMode={postingModes?.[item.platform] || 'manual'}
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
  substack: { bg: 'bg-orange-50', border: 'border-orange-200', hover: 'hover:border-orange-300', text: 'text-orange-600', ring: 'ring-orange-500', activeBg: 'bg-orange-100' },
  podcast: { bg: 'bg-purple-50', border: 'border-purple-200', hover: 'hover:border-purple-300', text: 'text-purple-600', ring: 'ring-purple-500', activeBg: 'bg-purple-100' },
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
      className={`p-4 rounded-lg border text-left w-full transition-all flex flex-col ${
        isActive
          ? `ring-2 ring-offset-1 ${ps.ring} ${ps.border} ${ps.activeBg}`
          : `${ps.bg} ${ps.border} ${ps.hover}`
      }`}
    >
      <div>
        <h3 className="font-semibold capitalize">{platform}</h3>
        <p className="text-sm text-neutral-600">
          {postsToday} / {maxPosts} posts today
        </p>
      </div>
      <p className="text-xs text-neutral-500 mt-2">
        {lastPosted ? `Last post: ${timeAgo(lastPosted)}` : 'No posts yet'}
      </p>
      {warmupMode && (
        <p className="text-xs text-amber-600 mt-1">Warmup limits active</p>
      )}
      <div className={`flex items-center gap-2 mt-auto pt-2 ${canPost ? 'text-green-600' : 'text-red-600'}`}>
        <span className="text-2xl font-bold">
          {remaining > 0 ? remaining : 0}
          <span className="text-sm font-normal ml-1">left</span>
        </span>
        <div className={ps.text}>{icon}</div>
      </div>
    </button>
  )
}

const PHILOSOPHER_BY_PLATFORM = {
  twitter: 'nietzsche',
  bluesky: 'heraclitus',
  threads: 'heraclitus',
  reddit: 'diogenes',
  medium: 'plato',
  substack: 'plato',
  instagram: 'heraclitus',
}

const VOICE_COLORS = {
  strong: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  good: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  weak: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  'off-voice': { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' }
}

function QueueItem({ item, canPost, postingMode, onUpdate }) {
  const [hidden, setHidden] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [publishStatus, setPublishStatus] = useState(null) // 'publishing' | 'success' | 'error'
  const [publishError, setPublishError] = useState(null)
  const [voiceCheck, setVoiceCheck] = useState(null)
  const [voiceCheckLoading, setVoiceCheckLoading] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState(null) // null | 'content' | option index
  const [expanded, setExpanded] = useState(false)
  const [improving, setImproving] = useState(false)
  const [scriptExpanded, setScriptExpanded] = useState(false)
  const [reviewsExpanded, setReviewsExpanded] = useState(false)
  const [podcastAction, setPodcastAction] = useState(null) // 'rework' | 'salvage' | null
  const [podcastNotes, setPodcastNotes] = useState('')
  const [trialRating, setTrialRating] = useState({ soundReal: 0, interesting: 0, notes: '' })
  const [reelGenerating, setReelGenerating] = useState(false)
  const [reelRating, setReelRating] = useState({ overall: 0, image: 0, voice: 0, notes: '' })
  const [reelRatingSubmitted, setReelRatingSubmitted] = useState(false)

  const handleGenerateReel = async () => {
    setReelGenerating(true)
    try {
      await fetch(`/api/reels/${item.id}/generate`, { method: 'POST' })
      // Poll for completion
      const poll = setInterval(async () => {
        const res = await fetch(`/api/reels/${item.id}/status`)
        const data = await res.json()
        if (!data.reelGenerating) {
          clearInterval(poll)
          setReelGenerating(false)
          onUpdate()
        }
      }, 5000)
    } catch (err) {
      console.error('Reel generation error:', err)
      setReelGenerating(false)
    }
  }

  const handleRateReel = async () => {
    if (!reelRating.overall) return
    try {
      const res = await fetch(`/api/reels/${item.id}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reelRating)
      })
      if (res.ok) {
        setReelRatingSubmitted(true)
        onUpdate()
      }
    } catch (err) {
      console.error('Reel rating error:', err)
    }
  }

  const runVoiceCheck = async () => {
    const philosopher = item.createdBy || PHILOSOPHER_BY_PLATFORM[item.platform]
    if (!philosopher || philosopher === 'unknown') return
    setVoiceCheckLoading(true)
    try {
      const content = [item.content, item.caption].filter(Boolean).join('\n\n')
      const res = await fetch('/api/voice-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, philosopher, platform: item.platform })
      })
      const data = await res.json()
      if (res.ok) setVoiceCheck(data)
    } catch (err) {
      console.error('Voice check error:', err)
    }
    setVoiceCheckLoading(false)
  }

  // Auto-run voice check on mount
  useEffect(() => {
    const philosopher = item.createdBy || PHILOSOPHER_BY_PLATFORM[item.platform]
    if (philosopher && philosopher !== 'unknown') {
      runVoiceCheck()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleImprove = async () => {
    setImproving(true)
    try {
      const content = [item.content, item.caption].filter(Boolean).join('\n\n')
      const philosopher = item.createdBy || PHILOSOPHER_BY_PLATFORM[item.platform] || 'nietzsche'
      const res = await fetch('/api/voice-improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          philosopher,
          platform: item.platform,
          issues: voiceCheck?.issues,
          suggestions: voiceCheck?.suggestions
        })
      })
      const data = await res.json()
      if (res.ok && data.improved) {
        // Update the queue item with improved content
        await fetch(`/api/posting-queue/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: data.improved })
        })
        setVoiceCheck(null)
        onUpdate()
      }
    } catch (err) {
      console.error('Improve error:', err)
    }
    setImproving(false)
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

  const handleAutoPublish = async () => {
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
        setPublishError(result.error || result.message || 'Unknown error')
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
    substack: 'https://substack.com/home',
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

  // --- Podcast-specific rendering ---
  if (item.platform === 'podcast') {
    const meta = item.metadata || {}
    const script = meta.script || []
    const reviews = meta.reviews || {}
    const isPendingReview = item.status === 'pending-review'

    const handlePodcastApprove = async () => {
      setIsUpdating(true)
      try {
        await fetch(`/api/podcast/${item.id}/approve`, { method: 'POST' })
        onUpdate()
      } catch (err) { console.error('Approve error:', err) }
      setIsUpdating(false)
    }

    const handlePodcastRework = async () => {
      setIsUpdating(true)
      try {
        await fetch(`/api/podcast/${item.id}/rework`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: podcastNotes })
        })
        setPodcastAction(null)
        setPodcastNotes('')
        onUpdate()
      } catch (err) { console.error('Rework error:', err) }
      setIsUpdating(false)
    }

    const handlePodcastSalvage = async () => {
      setIsUpdating(true)
      try {
        await fetch(`/api/podcast/${item.id}/salvage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: podcastNotes })
        })
        setPodcastAction(null)
        setPodcastNotes('')
        onUpdate()
      } catch (err) { console.error('Salvage error:', err) }
      setIsUpdating(false)
    }

    const handlePodcastKill = async () => {
      if (!confirm('Kill this episode? The topic will be blacklisted from future episodes.')) return
      setIsUpdating(true)
      try {
        await fetch(`/api/podcast/${item.id}/kill`, { method: 'POST' })
        onUpdate()
      } catch (err) { console.error('Kill error:', err) }
      setIsUpdating(false)
    }

    const handleSubmitTrialReview = async () => {
      setIsUpdating(true)
      try {
        await fetch('/api/podcast/trial-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            episodeId: item.id,
            format: meta.format,
            soundReal: trialRating.soundReal,
            interesting: trialRating.interesting,
            notes: trialRating.notes
          })
        })
        onUpdate()
      } catch (err) { console.error('Trial review error:', err) }
      setIsUpdating(false)
    }

    const verdictColors = {
      pass: 'bg-green-100 text-green-700',
      'needs-work': 'bg-amber-100 text-amber-700',
      reject: 'bg-red-100 text-red-700'
    }

    return (
      <div className="p-4 bg-purple-50/50 border-l-4 border-purple-400">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <Mic size={18} className="text-purple-600" />
          <span className="text-sm font-semibold text-purple-700">Podcast Episode</span>
          {meta.trialNumber && (
            <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-600 rounded-full font-medium">
              Trial #{meta.trialNumber}
            </span>
          )}
          <span className="px-2 py-0.5 text-xs bg-purple-200 text-purple-700 rounded font-medium">
            {meta.formatName || meta.format}
          </span>
          {isPendingReview && (
            <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded animate-pulse">
              Needs Review
            </span>
          )}
          {item.status === 'ready' && (
            <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
              Approved
            </span>
          )}
        </div>

        {/* Title + Subtitle */}
        <h3 className="text-lg font-bold text-neutral-900">{item.title}</h3>
        {item.subtitle && <p className="text-sm text-neutral-600 italic mt-0.5">{item.subtitle}</p>}

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
          <span>{meta.exchangeCount || script.length} exchanges</span>
          <span>~{meta.estDuration || '?'} min</span>
          <span>{meta.wordCount || '?'} words</span>
          <span>Topic: {meta.topic || 'N/A'}</span>
        </div>

        {/* Agent Reviews */}
        {Object.keys(reviews).length > 0 && reviews.error === undefined && (
          <div className="mt-3">
            <button
              onClick={() => setReviewsExpanded(!reviewsExpanded)}
              className="flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
            >
              {reviewsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Agent Reviews ({Object.keys(reviews).length})
            </button>
            {reviewsExpanded && (
              <div className="mt-2 space-y-2">
                {Object.entries(reviews).map(([agent, review]) => (
                  <div key={agent} className="flex items-start gap-2 text-sm">
                    <span className={`px-1.5 py-0.5 text-xs rounded font-medium ${verdictColors[review.verdict] || 'bg-neutral-100 text-neutral-600'}`}>
                      {review.verdict}
                    </span>
                    <span className="font-medium text-neutral-600 capitalize w-16">{agent}</span>
                    <span className="text-neutral-700">{review.note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Athena Note */}
        {meta.athenaNote && (
          <div className="mt-2 p-2 bg-white rounded border border-purple-200 text-sm text-neutral-700">
            <span className="font-medium text-purple-600">Editor note:</span> {meta.athenaNote}
          </div>
        )}

        {/* Script Viewer */}
        <div className="mt-3">
          <button
            onClick={() => setScriptExpanded(!scriptExpanded)}
            className="flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
          >
            {scriptExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {scriptExpanded ? 'Hide Script' : 'View Script'} ({script.length} lines)
          </button>
          {scriptExpanded && (
            <div className="mt-2 max-h-96 overflow-y-auto bg-white rounded border border-neutral-200 p-3 text-sm space-y-1">
              {script.map((line, i) => {
                const isShawn = line.speaker?.toLowerCase() === 'shawn'
                const displayName = isShawn ? 'Shawn' : 'Anne'
                return (
                  <div key={i} className={isShawn ? 'text-purple-800' : 'text-teal-700'}>
                    <span className="font-semibold">{displayName}:</span>{' '}
                    <span>{line.text}</span>
                    {line.direction && <span className="text-xs text-neutral-400 italic ml-1">[{line.direction}]</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Practice Exercise */}
        {meta.practiceExercise && (
          <div className="mt-2 p-2 bg-amber-50 rounded border border-amber-200 text-sm">
            <span className="font-medium text-amber-700">Practice:</span> {meta.practiceExercise}
          </div>
        )}

        {/* Trial Rating (only for trial episodes awaiting review) */}
        {meta.trialNumber && isPendingReview && (
          <div className="mt-3 p-3 bg-white rounded border border-purple-200">
            <h4 className="text-sm font-semibold text-purple-700 mb-2">Trial Episode Rating</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-neutral-600">Does it sound real? (1-5)</label>
                <div className="flex gap-1 mt-1">
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      onClick={() => setTrialRating(r => ({ ...r, soundReal: n }))}
                      className={`w-8 h-8 rounded text-sm font-medium ${trialRating.soundReal >= n ? 'bg-purple-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-neutral-600">How interesting? (1-5)</label>
                <div className="flex gap-1 mt-1">
                  {[1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      onClick={() => setTrialRating(r => ({ ...r, interesting: n }))}
                      className={`w-8 h-8 rounded text-sm font-medium ${trialRating.interesting >= n ? 'bg-purple-600 text-white' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <textarea
              value={trialRating.notes}
              onChange={e => setTrialRating(r => ({ ...r, notes: e.target.value }))}
              placeholder="Quick notes on this format..."
              rows={2}
              className="w-full mt-2 px-2 py-1.5 text-sm border border-neutral-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-300"
            />
            <button
              onClick={handleSubmitTrialReview}
              disabled={!trialRating.soundReal || !trialRating.interesting || isUpdating}
              className="mt-2 px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 font-medium"
            >
              <Star size={12} className="inline mr-1" />
              Submit Trial Rating
            </button>
          </div>
        )}

        {/* Rework/Salvage notes form */}
        {podcastAction && (
          <div className="mt-3 p-3 bg-white rounded border border-neutral-200">
            <h4 className="text-sm font-semibold text-neutral-700 mb-2">
              {podcastAction === 'rework' ? 'Rework Notes' : 'Salvage Reason'}
            </h4>
            <textarea
              value={podcastNotes}
              onChange={e => setPodcastNotes(e.target.value)}
              placeholder={podcastAction === 'rework' ? 'What should change in the rework...' : 'What was wrong with this episode...'}
              rows={2}
              className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-300"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={podcastAction === 'rework' ? handlePodcastRework : handlePodcastSalvage}
                disabled={isUpdating}
                className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 font-medium"
              >
                {isUpdating ? 'Processing...' : podcastAction === 'rework' ? 'Rework Episode' : 'Salvage & Remove'}
              </button>
              <button
                onClick={() => { setPodcastAction(null); setPodcastNotes('') }}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:text-neutral-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {isPendingReview && !podcastAction && (
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={handlePodcastApprove}
              disabled={isUpdating}
              className="flex items-center gap-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
            >
              <ThumbsUp size={14} />
              Approve
            </button>
            <button
              onClick={() => setPodcastAction('rework')}
              disabled={isUpdating}
              className="flex items-center gap-1 px-3 py-2 text-sm bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium"
            >
              <RotateCcw size={14} />
              Rework
            </button>
            <button
              onClick={() => setPodcastAction('salvage')}
              disabled={isUpdating}
              className="flex items-center gap-1 px-3 py-2 text-sm bg-neutral-100 text-neutral-700 rounded-lg hover:bg-neutral-200 font-medium"
            >
              <Archive size={14} />
              Salvage
            </button>
            <button
              onClick={handlePodcastKill}
              disabled={isUpdating}
              className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg font-medium"
            >
              <XCircle size={14} />
              Kill
            </button>
          </div>
        )}

        {/* Timestamp */}
        <p className="text-xs text-neutral-400 mt-3">
          Generated {new Date(item.createdAt).toLocaleString()} by athena
        </p>
      </div>
    )
  }

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
            <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium uppercase tracking-wide ${
              postingMode === 'auto'
                ? 'bg-blue-100 text-blue-600'
                : 'bg-neutral-100 text-neutral-500'
            }`}>
              {postingMode === 'auto' ? 'Auto' : 'Manual'}
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
          {/* Instagram Reel Preview & Rating */}
          {item.platform === 'instagram' && (
            <div className="mt-3 p-3 bg-neutral-50 rounded-lg border border-neutral-200">
              <div className="flex items-center gap-2 mb-2">
                <Film size={14} className="text-pink-600" />
                <span className="text-xs font-semibold text-neutral-700">Instagram Reel</span>
                {item.reelGenerated && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-green-100 text-green-700 rounded font-medium">Ready</span>
                )}
                {item.reelGenerating && (
                  <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-600 rounded font-medium flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Generating...
                  </span>
                )}
              </div>

              {item.reelGenerated && item.reelFile ? (
                <div>
                  <video
                    controls
                    className="w-full max-w-xs rounded-lg border border-neutral-300"
                    style={{ maxHeight: '400px' }}
                  >
                    <source src={`/api/reels/${item.reelFile}`} type="video/mp4" />
                  </video>
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Generated {new Date(item.reelGeneratedAt).toLocaleString()}
                  </p>

                  {/* Rating */}
                  {item.reelRating && !reelRatingSubmitted ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
                      <Star size={12} className="text-amber-500 fill-amber-500" />
                      Rated {item.reelRating.overall}/5
                      {item.reelRating.notes && <span className="text-neutral-400">— {item.reelRating.notes}</span>}
                    </div>
                  ) : !reelRatingSubmitted ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-600 w-14">Overall</span>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map(n => (
                            <button
                              key={n}
                              onClick={() => setReelRating(r => ({ ...r, overall: n }))}
                              className={`w-7 h-7 rounded text-xs font-medium transition-all ${
                                reelRating.overall >= n
                                  ? 'bg-amber-400 text-white'
                                  : 'bg-neutral-200 text-neutral-500 hover:bg-neutral-300'
                              }`}
                            >{n}</button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-600 w-14">Image</span>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map(n => (
                            <button
                              key={n}
                              onClick={() => setReelRating(r => ({ ...r, image: n }))}
                              className={`w-7 h-7 rounded text-xs font-medium transition-all ${
                                reelRating.image >= n
                                  ? 'bg-pink-400 text-white'
                                  : 'bg-neutral-200 text-neutral-500 hover:bg-neutral-300'
                              }`}
                            >{n}</button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-600 w-14">Voice</span>
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map(n => (
                            <button
                              key={n}
                              onClick={() => setReelRating(r => ({ ...r, voice: n }))}
                              className={`w-7 h-7 rounded text-xs font-medium transition-all ${
                                reelRating.voice >= n
                                  ? 'bg-blue-400 text-white'
                                  : 'bg-neutral-200 text-neutral-500 hover:bg-neutral-300'
                              }`}
                            >{n}</button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="text"
                        placeholder="Notes (optional)..."
                        value={reelRating.notes}
                        onChange={e => setReelRating(r => ({ ...r, notes: e.target.value }))}
                        className="w-full text-xs px-2 py-1.5 border border-neutral-200 rounded"
                      />
                      <button
                        onClick={handleRateReel}
                        disabled={!reelRating.overall}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-40"
                      >
                        <Star size={12} /> Rate Reel
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
                      <Check size={12} /> Rating saved
                    </div>
                  )}

                  {/* Regenerate button */}
                  <button
                    onClick={handleGenerateReel}
                    disabled={reelGenerating}
                    className="flex items-center gap-1 mt-2 px-3 py-1.5 text-xs font-medium bg-neutral-200 text-neutral-700 rounded hover:bg-neutral-300 disabled:opacity-50"
                  >
                    <RotateCcw size={12} /> Regenerate
                  </button>
                </div>
              ) : item.reelError ? (
                <div>
                  <p className="text-xs text-red-600">Error: {item.reelError.substring(0, 120)}</p>
                  <button
                    onClick={handleGenerateReel}
                    disabled={reelGenerating}
                    className="flex items-center gap-1 mt-2 px-3 py-1.5 text-xs font-medium bg-pink-100 text-pink-700 rounded hover:bg-pink-200 disabled:opacity-50"
                  >
                    {reelGenerating ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Retry
                  </button>
                </div>
              ) : !reelGenerating ? (
                <button
                  onClick={handleGenerateReel}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-pink-600 text-white rounded hover:bg-pink-700"
                >
                  <Video size={12} /> Generate Reel
                </button>
              ) : null}
            </div>
          )}

          {isFailed && item.lastError && (
            <p className="text-xs text-red-600 mt-2">Error: {item.lastError}</p>
          )}
          <p className="text-xs text-neutral-400 mt-2">
            Added {new Date(item.createdAt).toLocaleString()}
            {(() => {
              const phil = item.createdBy && item.createdBy !== 'unknown' ? item.createdBy : PHILOSOPHER_BY_PLATFORM[item.platform]
              return phil ? <span className="ml-2 text-neutral-400">by {phil}</span> : null
            })()}
          </p>

          {/* Voice check result inline */}
          {voiceCheck && (
            <div className="mt-2">
              <div className={`flex items-center gap-2 text-xs ${(VOICE_COLORS[voiceCheck.verdict] || VOICE_COLORS.good).text}`}>
                <span className={`w-2 h-2 rounded-full ${(VOICE_COLORS[voiceCheck.verdict] || VOICE_COLORS.good).dot}`} />
                <span className="font-medium">{voiceCheck.score}</span>
                <span>{voiceCheck.verdict}</span>
                {voiceCheck.issues?.length > 0 && (
                  <span className="text-neutral-400">— {voiceCheck.issues[0].description}</span>
                )}
              </div>
              <button
                onClick={handleImprove}
                disabled={improving}
                className="flex items-center gap-1 mt-2 px-3 py-1.5 text-xs font-medium bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
              >
                {improving ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {improving ? 'Improving...' : 'Improve it'}
              </button>
            </div>
          )}

          {/* Publishing status feedback */}
          {publishStatus === 'publishing' && (
            <div className="flex items-center gap-2 mt-2 text-sm text-blue-600">
              <RefreshCw size={14} className="animate-spin" />
              Publishing to {item.platform}...
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
          {/* Auto Post button when platform is set to auto */}
          {isReady && postingMode === 'auto' && publishStatus !== 'success' && (
            <button
              onClick={handleAutoPublish}
              disabled={publishStatus === 'publishing'}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {publishStatus === 'publishing' ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
              {publishStatus === 'publishing' ? 'Posting...' : 'Auto Post'}
            </button>
          )}
          {/* Copy & Open for manual mode or as fallback */}
          {isReady && (
            <button
              onClick={() => handleCopyAndOpen(
                item.platform === 'instagram' ? `Instagram Post:\n\n${item.content}${item.caption ? '\n\n' + item.caption : ''}` :
                item.platform === 'medium' ? `${item.title ? item.title + '\n\n' : ''}${item.content}${item.topics?.length ? '\n\nTopics: ' + item.topics.join(', ') : ''}` :
                item.platform === 'substack' ? `${item.title ? item.title + '\n\n' : ''}${item.content}` :
                item.platform === 'reddit' ? `${item.content}${item.tags?.length ? '\n\nTags: ' + item.tags.join(', ') : ''}` :
                item.content
              )}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded ${
                postingMode === 'auto' ? 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300' : 'bg-neutral-800 text-white hover:bg-neutral-900'
              }`}
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
          {(item.createdBy || PHILOSOPHER_BY_PLATFORM[item.platform]) && (
            <button
              onClick={runVoiceCheck}
              disabled={voiceCheckLoading}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded disabled:opacity-50"
            >
              {voiceCheckLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ShieldCheck size={14} />
              )}
              {voiceCheck ? '' : 'Voice Check'}
              {voiceCheck && (
                <span className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${(VOICE_COLORS[voiceCheck.verdict] || VOICE_COLORS.good).text} ${(VOICE_COLORS[voiceCheck.verdict] || VOICE_COLORS.good).bg}`}>
                  {voiceCheck.score}
                </span>
              )}
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
                { id: 'substack', label: 'Substack', icon: <Newspaper size={18} />, active: 'border-orange-500 bg-orange-50 text-orange-700' },
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
               platform === 'substack' ? 'Subject + Newsletter Content (separate with blank line)' :
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
                platform === 'substack' ? 'Subject line\n\nNewsletter content...' :
                platform === 'twitter' ? 'Your tweet (280 chars max)...' :
                'Your post content...'
              }
              rows={platform === 'reddit' || platform === 'medium' || platform === 'substack' ? 6 : 4}
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
              Manual posting — copy and publish on Bluesky
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

          {platform === 'substack' && (
            <p className="text-sm text-orange-600 flex items-center gap-2">
              <Newspaper size={14} />
              Manual posting — copy and publish on Substack
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
