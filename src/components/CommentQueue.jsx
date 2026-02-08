import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  Plus,
  Check,
  Trash2,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  X,
  Send,
  RefreshCw,
  CloudOff,
  Cloud,
  Copy,
  MessageSquarePlus,
  Search,
  Sparkles,
  Edit3
} from 'lucide-react'

// Bluesky icon
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
    case 'bluesky': return <BlueskyIcon size={size} className="text-blue-500" />
    case 'twitter': return <TwitterIcon size={size} className="text-neutral-800" />
    default: return null
  }
}

const PHILOSOPHERS = [
  { id: 'nietzsche', label: 'Nietzsche' },
  { id: 'marcus', label: 'Marcus Aurelius' },
  { id: 'socrates', label: 'Socrates' },
  { id: 'heraclitus', label: 'Heraclitus' },
  { id: 'diogenes', label: 'Diogenes' },
  { id: 'hypatia', label: 'Hypatia' },
  { id: 'plato', label: 'Plato' },
  { id: 'aristotle', label: 'Aristotle' },
  { id: 'leonardo', label: 'Leonardo' },
  { id: 'tension', label: 'TensionLines' }
]

export default function CommentQueue() {
  const [activeTab, setActiveTab] = useState('queue')
  const [showAddModal, setShowAddModal] = useState(false)
  const [platformFilter, setPlatformFilter] = useState(null)
  const [bskyStatus, setBskyStatus] = useState(null)
  const { data, error, isLoading, mutate } = useSWR('/api/comment-queue', fetcher, {
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
        <h3 className="text-lg font-medium text-red-800">Failed to load comment queue</h3>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const queueItems = data.queue || []
  const readyItems = queueItems.filter(i => i.status === 'ready')
  const draftItems = queueItems.filter(i => i.status === 'draft')
  const failedItems = queueItems.filter(i => i.status === 'failed')

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Comment Queue</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-neutral-600">Proactively comment on relevant posts</p>
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
          Add Comment
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-200">
        <button
          onClick={() => setActiveTab('queue')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'queue'
              ? 'border-gold text-gold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <MessageSquarePlus size={16} />
            Comment Queue
            {(readyItems.length + failedItems.length) > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-neutral-100 text-neutral-600 rounded-full">
                {readyItems.length + failedItems.length}
              </span>
            )}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('discovered')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'discovered'
              ? 'border-gold text-gold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <Search size={16} />
            Discovered Posts
            {draftItems.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">
                {draftItems.length}
              </span>
            )}
          </span>
        </button>
      </div>

      {activeTab === 'queue' ? (
        <>
          {/* Rate Limit Cards (clickable filters) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RateLimitCard
              platform="bluesky"
              icon={<BlueskyIcon size={24} className="text-current" />}
              commentsToday={data.commentsToday?.bluesky || 0}
              maxComments={data.settings?.platforms?.bluesky?.maxCommentsPerDay || 5}
              canComment={data.canCommentBluesky}
              isActive={platformFilter === 'bluesky'}
              onClick={() => setPlatformFilter(platformFilter === 'bluesky' ? null : 'bluesky')}
            />
            <RateLimitCard
              platform="twitter"
              icon={<TwitterIcon size={24} className="text-current" />}
              commentsToday={data.commentsToday?.twitter || 0}
              maxComments={data.settings?.platforms?.twitter?.maxCommentsPerDay || 5}
              canComment={data.canCommentTwitter}
              isActive={platformFilter === 'twitter'}
              onClick={() => setPlatformFilter(platformFilter === 'twitter' ? null : 'twitter')}
            />
          </div>

          {/* Ready to Publish */}
          {(() => {
            const filteredReady = platformFilter
              ? readyItems.filter(i => i.platform === platformFilter)
              : readyItems
            const filteredFailed = platformFilter
              ? failedItems.filter(i => i.platform === platformFilter)
              : failedItems
            return (
          <div className="bg-white rounded-lg border border-neutral-200">
            <div className="px-4 py-3 border-b border-neutral-200">
              <h2 className="font-semibold text-neutral-900">
                Ready to Publish ({filteredReady.length})
              </h2>
            </div>
            <div className="divide-y divide-neutral-100">
              {filteredReady.length === 0 && filteredFailed.length === 0 ? (
                <div className="p-8 text-center text-neutral-500">
                  <MessageSquarePlus className="w-12 h-12 mx-auto mb-3 text-neutral-300" />
                  <p>{platformFilter ? `No ${platformFilter} comments ready` : 'No comments ready to publish'}</p>
                  <p className="text-sm mt-1">{platformFilter ? 'Click the card again to show all' : 'Add comments manually or generate from discovered posts'}</p>
                </div>
              ) : (
                [...filteredFailed, ...filteredReady].map(item => (
                  <CommentItem
                    key={item.id}
                    item={item}
                    canComment={
                      item.platform === 'bluesky' ? data.canCommentBluesky : data.canCommentTwitter
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
                  Recently Posted ({data.posted.length})
                </h2>
              </div>
              <div className="divide-y divide-neutral-100 max-h-64 overflow-y-auto">
                {data.posted.slice(0, 10).map(item => (
                  <PostedCommentItem key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <DiscoveredPosts
          items={draftItems}
          onUpdate={mutate}
          settings={data.settings}
        />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddCommentModal
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

// ---- Discovered Posts Tab ----

function DiscoveredPosts({ items, onUpdate, settings }) {
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)

  const handleScan = async () => {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/comment-queue/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const result = await res.json()
      setScanResult(result)
      onUpdate()
    } catch (err) {
      setScanResult({ success: false, error: err.message })
    }
    setScanning(false)
  }

  const handleDismiss = async (id) => {
    try {
      await fetch(`/api/comment-queue/${id}`, { method: 'DELETE' })
      onUpdate()
    } catch (err) {
      console.error('Error dismissing:', err)
    }
  }

  const handleGenerate = async (id) => {
    try {
      const res = await fetch(`/api/comment-queue/${id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        onUpdate()
      } else {
        const result = await res.json()
        alert(result.error || 'Failed to generate comment')
      }
    } catch (err) {
      console.error('Error generating:', err)
    }
  }

  return (
    <div className="space-y-4">
      {/* Scan Controls */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-blue-900">Bluesky Post Scanner</h3>
          <p className="text-sm text-blue-700 mt-0.5">
            Searches for philosophy-related posts worth commenting on.
            {settings?.scanEnabled !== false && ' Auto-scans 3x daily (10 AM, 2 PM, 6 PM).'}
          </p>
          {settings?.scanKeywords && (
            <p className="text-xs text-blue-600 mt-1">
              Keywords: {settings.scanKeywords.join(', ')}
            </p>
          )}
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex-shrink-0"
        >
          <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning...' : 'Scan Now'}
        </button>
      </div>

      {/* Scan Result Feedback */}
      {scanResult && (
        <div className={`p-3 rounded-lg text-sm ${
          scanResult.success !== false ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {scanResult.success !== false ? (
            <span className="flex items-center gap-2">
              <CheckCircle size={14} />
              {scanResult.message || `Found ${scanResult.added || 0} new posts`}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <AlertTriangle size={14} />
              {scanResult.error || 'Scan failed'}
            </span>
          )}
        </div>
      )}

      {/* Discovered Items */}
      <div className="bg-white rounded-lg border border-neutral-200">
        <div className="px-4 py-3 border-b border-neutral-200">
          <h2 className="font-semibold text-neutral-900">
            Discovered Posts ({items.length})
          </h2>
        </div>
        <div className="divide-y divide-neutral-100">
          {items.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              <Search className="w-12 h-12 mx-auto mb-3 text-neutral-300" />
              <p>No discovered posts</p>
              <p className="text-sm mt-1">Click "Scan Now" to search Bluesky for relevant conversations</p>
            </div>
          ) : (
            items.map(item => (
              <DiscoveredItem
                key={item.id}
                item={item}
                onGenerate={() => handleGenerate(item.id)}
                onDismiss={() => handleDismiss(item.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function DiscoveredItem({ item, onGenerate, onDismiss }) {
  const [generating, setGenerating] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    await onGenerate()
    setGenerating(false)
  }

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Platform + author */}
          <div className="flex items-center gap-2 mb-2">
            {getPlatformIcon(item.platform)}
            <span className="text-sm font-medium">
              @{item.targetAuthor}
            </span>
            {item.source === 'scan' && (
              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                Discovered
              </span>
            )}
            {item.philosopher && (
              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded capitalize">
                {item.philosopher}
              </span>
            )}
            {item.engagement && (
              <span className="text-xs text-neutral-500">
                {item.engagement.likes || 0} likes, {item.engagement.replies || 0} replies
              </span>
            )}
          </div>

          {/* Post text */}
          <p className="text-neutral-800 whitespace-pre-wrap text-sm">{item.targetText}</p>

          {/* Link */}
          <a
            href={item.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline mt-1 inline-flex items-center gap-1"
          >
            <ExternalLink size={10} />
            View post
          </a>

          <p className="text-xs text-neutral-400 mt-2">
            Found {new Date(item.createdAt).toLocaleString()}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gold text-white rounded hover:bg-amber-600 disabled:opacity-50"
          >
            {generating ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {generating ? 'Generating...' : 'Draft Comment'}
          </button>
          <button
            onClick={onDismiss}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 rounded"
          >
            <X size={14} />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Comment Queue Tab Components ----

function RateLimitCard({ platform, icon, commentsToday, maxComments, canComment, isActive, onClick }) {
  const remaining = maxComments - commentsToday

  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg border text-left w-full transition-all ${
        isActive
          ? 'ring-2 ring-offset-1 ring-gold border-gold bg-amber-50'
          : canComment ? 'bg-green-50 border-green-200 hover:border-green-300' : 'bg-red-50 border-red-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={isActive ? 'text-gold' : canComment ? 'text-green-600' : 'text-red-600'}>
            {icon}
          </div>
          <div>
            <h3 className="font-semibold capitalize">{platform === 'twitter' ? 'Twitter / X' : 'Bluesky'}</h3>
            <p className="text-sm text-neutral-600">
              {commentsToday} / {maxComments} comments today
            </p>
          </div>
        </div>
        <div className={`text-2xl font-bold ${isActive ? 'text-gold' : canComment ? 'text-green-600' : 'text-red-600'}`}>
          {remaining > 0 ? remaining : 0}
          <span className="text-sm font-normal ml-1">left</span>
        </div>
      </div>
    </button>
  )
}

function CommentItem({ item, canComment, onUpdate }) {
  const [publishStatus, setPublishStatus] = useState(null)
  const [publishError, setPublishError] = useState(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(item.commentText || '')
  const [editPhilosopher, setEditPhilosopher] = useState(item.philosopher || 'nietzsche')
  const [generating, setGenerating] = useState(false)

  const handlePublishBluesky = async () => {
    setPublishStatus('publishing')
    setPublishError(null)
    try {
      const res = await fetch(`/api/comment-queue/${item.id}/publish`, {
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

  const handleCopyAndOpen = async () => {
    try {
      await navigator.clipboard.writeText(item.commentText)
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
      window.open(item.targetUrl, '_blank')
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleMarkPosted = async () => {
    setIsUpdating(true)
    try {
      await fetch(`/api/comment-queue/${item.id}/posted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      onUpdate()
    } catch (err) {
      console.error('Error marking as posted:', err)
    }
    setIsUpdating(false)
  }

  const handleDelete = async () => {
    if (!confirm('Delete this comment from the queue?')) return
    setIsUpdating(true)
    try {
      await fetch(`/api/comment-queue/${item.id}`, { method: 'DELETE' })
      onUpdate()
    } catch (err) {
      console.error('Error deleting:', err)
    }
    setIsUpdating(false)
  }

  const handleSaveEdit = async () => {
    setIsUpdating(true)
    try {
      await fetch(`/api/comment-queue/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentText: editText, philosopher: editPhilosopher })
      })
      setIsEditing(false)
      onUpdate()
    } catch (err) {
      console.error('Error saving:', err)
    }
    setIsUpdating(false)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await fetch(`/api/comment-queue/${item.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        onUpdate()
      } else {
        const result = await res.json()
        alert(result.error || 'Failed to generate')
      }
    } catch (err) {
      console.error('Error generating:', err)
    }
    setGenerating(false)
  }

  const isFailed = item.status === 'failed'

  return (
    <div className={`p-4 ${isFailed ? 'bg-red-50' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Platform + status badges */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {getPlatformIcon(item.platform)}
            <span className="text-sm font-medium capitalize">
              {item.platform === 'twitter' ? 'Twitter / X' : 'Bluesky'}
            </span>
            {isFailed && (
              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded" title={item.lastError}>
                Failed
              </span>
            )}
            {!isFailed && (
              <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                Ready
              </span>
            )}
            {item.philosopher && (
              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded capitalize">
                {item.philosopher}
              </span>
            )}
            {item.source && (
              <span className="px-2 py-0.5 text-xs bg-neutral-100 text-neutral-500 rounded capitalize">
                {item.source}
              </span>
            )}
          </div>

          {/* Target context */}
          {(item.targetAuthor || item.targetText) && (
            <div className="mb-2 pl-3 border-l-2 border-neutral-200">
              {item.targetAuthor && (
                <p className="text-xs text-neutral-500 mb-0.5">@{item.targetAuthor}</p>
              )}
              {item.targetText && (
                <p className="text-sm text-neutral-500 line-clamp-3">{item.targetText}</p>
              )}
            </div>
          )}

          {/* Comment text (editable) */}
          {isEditing ? (
            <div className="space-y-2 mt-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200 text-sm"
              />
              {item.platform === 'bluesky' && (
                <p className={`text-xs ${editText.length > 300 ? 'text-red-600' : 'text-neutral-400'}`}>
                  {editText.length} / 300 characters
                </p>
              )}
              <div className="flex items-center gap-2">
                <select
                  value={editPhilosopher}
                  onChange={(e) => setEditPhilosopher(e.target.value)}
                  className="text-sm border border-neutral-200 rounded px-2 py-1"
                >
                  {PHILOSOPHERS.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleSaveEdit}
                  disabled={isUpdating}
                  className="px-3 py-1 text-sm bg-gold text-white rounded hover:bg-amber-600 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => { setIsEditing(false); setEditText(item.commentText || '') }}
                  className="px-3 py-1 text-sm text-neutral-500 hover:text-neutral-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-neutral-800 whitespace-pre-wrap">{item.commentText || '(no comment text)'}</p>
          )}

          {/* Target URL */}
          <a
            href={item.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline mt-1 inline-flex items-center gap-1"
          >
            <ExternalLink size={10} />
            {item.targetUrl.length > 60 ? item.targetUrl.substring(0, 60) + '...' : item.targetUrl}
          </a>

          {isFailed && item.lastError && (
            <p className="text-xs text-red-600 mt-2">Error: {item.lastError}</p>
          )}

          <p className="text-xs text-neutral-400 mt-2">
            Added {new Date(item.createdAt).toLocaleString()}
          </p>

          {/* Publishing feedback */}
          {publishStatus === 'publishing' && (
            <div className="flex items-center gap-2 mt-2 text-sm text-blue-600">
              <RefreshCw size={14} className="animate-spin" />
              Publishing comment...
            </div>
          )}
          {publishStatus === 'success' && (
            <div className="flex items-center gap-2 mt-2 text-sm text-green-600">
              <CheckCircle size={14} />
              Comment published!
            </div>
          )}
          {publishStatus === 'error' && (
            <div className="flex items-center gap-2 mt-2 text-sm text-red-600">
              <AlertTriangle size={14} />
              {publishError}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded"
            >
              <Edit3 size={14} />
              Edit
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-purple-600 hover:bg-purple-50 rounded disabled:opacity-50"
          >
            {generating ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {generating ? 'Generating...' : 'Regenerate'}
          </button>
          {item.platform === 'bluesky' && canComment && (
            <button
              onClick={handlePublishBluesky}
              disabled={publishStatus === 'publishing' || !item.commentText}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {publishStatus === 'publishing' ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {isFailed ? 'Retry' : 'Publish'}
            </button>
          )}
          {item.platform === 'twitter' && (
            <>
              <button
                onClick={handleCopyAndOpen}
                disabled={!item.commentText}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-neutral-800 text-white rounded hover:bg-neutral-900 disabled:opacity-50"
              >
                {copyFeedback ? <Check size={14} /> : <Copy size={14} />}
                {copyFeedback ? 'Copied!' : 'Copy & Open'}
              </button>
              <button
                onClick={handleMarkPosted}
                disabled={isUpdating}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                <Check size={14} />
                Mark Posted
              </button>
            </>
          )}
          {!canComment && item.platform === 'bluesky' && (
            <span className="text-xs text-red-600">Daily limit reached</span>
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

function PostedCommentItem({ item }) {
  return (
    <div className="p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle size={16} className="text-green-500" />
        {getPlatformIcon(item.platform, 14)}
        {item.philosopher && (
          <span className="text-xs text-purple-600 capitalize">{item.philosopher}</span>
        )}
        <span className="text-sm text-neutral-700 truncate max-w-md">
          {item.commentText?.substring(0, 60)}{item.commentText?.length > 60 ? '...' : ''}
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

function AddCommentModal({ onClose, onAdd }) {
  const [platform, setPlatform] = useState('bluesky')
  const [targetUrl, setTargetUrl] = useState('')
  const [targetText, setTargetText] = useState('')
  const [commentText, setCommentText] = useState('')
  const [philosopher, setPhilosopher] = useState('nietzsche')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!targetUrl.trim()) return

    setIsSubmitting(true)
    try {
      await fetch('/api/comment-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, targetUrl, targetText, commentText, philosopher })
      })
      onAdd()
    } catch (err) {
      console.error('Error adding comment:', err)
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
          <h2 className="text-lg font-semibold">Add Comment to Queue</h2>
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
              <button
                type="button"
                onClick={() => setPlatform('twitter')}
                className={`flex-1 p-3 rounded-lg border flex items-center justify-center gap-2 ${
                  platform === 'twitter'
                    ? 'border-neutral-800 bg-neutral-100 text-black'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <TwitterIcon size={20} />
                Twitter / X
              </button>
            </div>
          </div>

          {/* Philosopher */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">Philosopher Voice</label>
            <select
              value={philosopher}
              onChange={(e) => setPhilosopher(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
            >
              {PHILOSOPHERS.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Target URL */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Target Post URL
            </label>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={
                platform === 'bluesky'
                  ? 'https://bsky.app/profile/handle/post/...'
                  : 'https://x.com/username/status/...'
              }
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
              required
            />
          </div>

          {/* Target Text */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Original Post Text <span className="text-neutral-400 font-normal">(optional — auto-fetched for Bluesky)</span>
            </label>
            <textarea
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="Paste the original post text for context..."
              rows={2}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
          </div>

          {/* Comment Text */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Comment Text <span className="text-neutral-400 font-normal">(optional — can generate with AI later)</span>
            </label>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Your comment... (leave blank to generate with AI)"
              rows={3}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
            {platform === 'bluesky' && commentText && (
              <p className={`text-xs mt-1 ${commentText.length > 300 ? 'text-red-600' : 'text-neutral-400'}`}>
                {commentText.length} / 300 characters
              </p>
            )}
          </div>

          {platform === 'bluesky' && (
            <p className="text-sm text-blue-600 flex items-center gap-2">
              <Send size={14} />
              Bluesky comments are published automatically via API
            </p>
          )}

          {platform === 'twitter' && (
            <p className="text-sm text-neutral-600 flex items-center gap-2">
              <Copy size={14} />
              Twitter comments use Copy & Open (manual posting)
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
              disabled={isSubmitting || !targetUrl.trim()}
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
