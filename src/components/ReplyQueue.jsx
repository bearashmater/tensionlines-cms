import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  Plus,
  Check,
  Trash2,
  ExternalLink,
  Clock,
  AlertTriangle,
  CheckCircle,
  X,
  Send,
  RefreshCw,
  Copy,
  MessageSquareReply,
  Inbox,
  AtSign,
  Eye,
  EyeOff,
  UserPlus,
  Instagram,
  MessageCircle,
  Hash,
  BookOpen,
  Newspaper
} from 'lucide-react'
import PlatformStatusBadges from './PlatformStatusBadges'

// Bluesky icon (reused from ManualPostingQueue)
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
    case 'threads': return <MessageCircle size={size} className="text-neutral-700" />
    case 'instagram': return <Instagram size={size} className="text-pink-500" />
    case 'reddit': return <Hash size={size} className="text-orange-500" />
    case 'medium': return <BookOpen size={size} className="text-green-700" />
    case 'substack': return <Newspaper size={size} className="text-orange-600" />
    default: return null
  }
}

const PLATFORM_LABELS = {
  bluesky: 'Bluesky',
  twitter: 'Twitter / X',
  threads: 'Threads',
  instagram: 'Instagram',
  reddit: 'Reddit',
  medium: 'Medium',
  substack: 'Substack',
}

export default function ReplyQueue() {
  const [activeTab, setActiveTab] = useState('queue')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showFollowInput, setShowFollowInput] = useState(false)
  const [followHandle, setFollowHandle] = useState('')
  const [followPlatform, setFollowPlatform] = useState('twitter')
  const [followSaving, setFollowSaving] = useState(false)
  const [followSaved, setFollowSaved] = useState(false)
  const [platformFilter, setPlatformFilter] = useState(null)
  const { data, error, isLoading, mutate } = useSWR('/api/reply-queue', fetcher, {
    refreshInterval: 30000
  })
  const { data: engagementData, mutate: mutateEngagement } = useSWR(
    '/api/engagement', fetcher, { refreshInterval: 30000 }
  )

  const unreadCount = engagementData?.stats
    ? Object.values(engagementData.stats).reduce((sum, s) => sum + (s?.new || 0), 0)
    : 0

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-red-800">Failed to load reply queue</h3>
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

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Reply Queue</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-neutral-600">Reply across all platforms</p>
            <PlatformStatusBadges />
          </div>
        </div>
        {activeTab === 'queue' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowFollowInput(!showFollowInput)
                setFollowSaved(false)
                setFollowHandle('')
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                showFollowInput
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              <UserPlus size={20} />
              Log Follow
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gold text-white rounded-lg hover:bg-amber-600"
            >
              <Plus size={20} />
              Add Reply
            </button>
          </div>
        )}
      </div>

      {/* Log Follow Input */}
      {showFollowInput && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (!followHandle.trim()) return
              setFollowSaving(true)
              try {
                const res = await fetch('/api/follows', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    handle: followHandle.replace(/^@/, ''),
                    platform: followPlatform,
                    source: 'manual',
                    context: 'Manually followed outside the system'
                  })
                })
                const result = await res.json()
                if (result.duplicate) {
                  setFollowSaved('duplicate')
                } else {
                  setFollowSaved(true)
                }
                setTimeout(() => {
                  setFollowHandle('')
                  setFollowSaved(false)
                }, 2000)
              } catch (err) {
                console.error('Failed to log follow:', err)
              }
              setFollowSaving(false)
            }}
            className="flex items-center gap-3"
          >
            <UserPlus size={18} className="text-indigo-600 flex-shrink-0" />
            <input
              type="text"
              value={followHandle}
              onChange={(e) => setFollowHandle(e.target.value)}
              placeholder="@handle"
              className="flex-1 px-3 py-2 border border-indigo-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 text-sm"
              autoFocus
            />
            <select
              value={followPlatform}
              onChange={(e) => setFollowPlatform(e.target.value)}
              className="px-3 py-2 border border-indigo-200 rounded-lg bg-white text-sm"
            >
              {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={followSaving || !followHandle.trim()}
              className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${
                followSaved === true ? 'bg-green-600' :
                followSaved === 'duplicate' ? 'bg-amber-600' :
                'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {followSaved === true ? 'Logged!' :
               followSaved === 'duplicate' ? 'Already tracked' :
               followSaving ? 'Saving...' : 'Log Follow'}
            </button>
          </form>
        </div>
      )}

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
            <MessageSquareReply size={16} />
            Reply Queue
            {data.queue?.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-neutral-100 text-neutral-600 rounded-full">
                {data.queue.length}
              </span>
            )}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('inbox')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'inbox'
              ? 'border-gold text-gold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <Inbox size={16} />
            Engagement Inbox
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full min-w-[20px] text-center">
                {unreadCount}
              </span>
            )}
          </span>
        </button>
      </div>

      {activeTab === 'queue' ? (
        <>
          {/* Rate Limit Cards (clickable filters) */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {(() => {
              // Compute last replied per platform
              const lastRepliedByPlatform = {}
              for (const p of data.posted || []) {
                if (p.postedAt && !lastRepliedByPlatform[p.platform]) {
                  lastRepliedByPlatform[p.platform] = p.postedAt
                }
              }
              const timeAgo = (iso) => {
                if (!iso) return null
                const diff = Date.now() - new Date(iso).getTime()
                const mins = Math.floor(diff / 60000)
                if (mins < 60) return `${mins}m ago`
                const hrs = Math.floor(mins / 60)
                if (hrs < 24) return `${hrs}h ago`
                return `${Math.floor(hrs / 24)}d ago`
              }
              return [
                { key: 'bluesky', icon: <BlueskyIcon size={20} className="text-current" /> },
                { key: 'twitter', icon: <TwitterIcon size={20} className="text-current" /> },
                { key: 'threads', icon: <MessageCircle size={20} className="text-current" /> },
                { key: 'instagram', icon: <Instagram size={20} className="text-current" /> },
                { key: 'reddit', icon: <Hash size={20} className="text-current" /> },
                { key: 'medium', icon: <BookOpen size={20} className="text-current" /> },
                { key: 'substack', icon: <Newspaper size={20} className="text-current" /> },
              ].map(({ key, icon }) => (
                <RateLimitCard
                  key={key}
                  platform={key}
                  icon={icon}
                  repliesToday={data.repliesToday?.[key] || 0}
                  maxReplies={data.settings?.platforms?.[key]?.maxRepliesPerDay || 5}
                  canReply={(data.repliesToday?.[key] || 0) < (data.settings?.platforms?.[key]?.maxRepliesPerDay || 5)}
                  lastReplied={timeAgo(lastRepliedByPlatform[key])}
                  isActive={platformFilter === key}
                  onClick={() => setPlatformFilter(platformFilter === key ? null : key)}
                />
              ))
            })()}
          </div>

          {/* Queue */}
          {(() => {
            const filtered = platformFilter
              ? (data.queue || []).filter(i => i.platform === platformFilter)
              : (data.queue || [])
            return (
          <div className="bg-white rounded-lg border border-neutral-200">
            <div className="px-4 py-3 border-b border-neutral-200">
              <h2 className="font-semibold text-neutral-900">
                Ready to Reply ({filtered.length})
              </h2>
            </div>
            <div className="divide-y divide-neutral-100">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-neutral-500">
                  <MessageSquareReply className="w-12 h-12 mx-auto mb-3 text-neutral-300" />
                  <p>{platformFilter ? `No ${platformFilter} replies in queue` : 'No replies in queue'}</p>
                  <p className="text-sm mt-1">{platformFilter ? 'Click the card again to show all' : 'Add reply drafts to Bluesky or Twitter posts'}</p>
                </div>
              ) : (
                filtered.map(item => (
                  <ReplyItem
                    key={item.id}
                    item={item}
                    canReply={
                      (data.repliesToday?.[item.platform] || 0) < (data.settings?.platforms?.[item.platform]?.maxRepliesPerDay || 5)
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
                  Recently Replied ({data.posted?.length || 0})
                </h2>
              </div>
              <div className="divide-y divide-neutral-100 max-h-64 overflow-y-auto">
                {data.posted.slice(0, 10).map(item => (
                  <PostedReplyItem key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <EngagementInbox
          data={engagementData}
          onRefresh={mutateEngagement}
          onDraftReply={() => {
            mutate()
            mutateEngagement()
            setActiveTab('queue')
          }}
        />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddReplyModal
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

// ---- Engagement Inbox Tab ----

function EngagementInbox({ data, onRefresh, onDraftReply }) {
  const [scanningAll, setScanningAll] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [showDismissed, setShowDismissed] = useState(false)

  const handleScanAll = async () => {
    setScanningAll(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/engagement/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      const result = await res.json()
      setScanResult(result)
      onRefresh()
    } catch (err) {
      setScanResult({ success: false, error: err.message })
    }
    setScanningAll(false)
  }

  const handleDraftReply = async (itemId) => {
    try {
      const res = await fetch(`/api/engagement/${encodeURIComponent(itemId)}/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        onDraftReply()
        onRefresh()
      }
    } catch (err) {
      console.error('Error creating draft reply:', err)
    }
  }

  const handleDelete = async (itemId) => {
    try {
      await fetch(`/api/engagement/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      onRefresh()
    } catch (err) {
      console.error('Error deleting engagement item:', err)
    }
  }

  const handleComplete = async (itemId) => {
    try {
      await fetch(`/api/engagement/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      })
      onRefresh()
    } catch (err) {
      console.error('Error completing engagement item:', err)
    }
  }

  const handleDismiss = async (itemId) => {
    try {
      await fetch(`/api/engagement/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' })
      })
      onRefresh()
    } catch (err) {
      console.error('Error dismissing item:', err)
    }
  }

  const handleMarkSeen = async (itemId) => {
    try {
      await fetch(`/api/engagement/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'seen' })
      })
      onRefresh()
    } catch (err) {
      console.error('Error marking as seen:', err)
    }
  }

  const items = data?.items || []
  const visibleItems = showDismissed ? items : items.filter(i => i.status !== 'dismissed' && i.status !== 'completed')
  const dismissedCount = items.filter(i => i.status === 'dismissed' || i.status === 'completed').length

  return (
    <div className="space-y-4">
      {/* Scan Controls */}
      <div className="bg-white border border-neutral-200 rounded-lg p-3 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { key: 'bluesky', icon: <BlueskyIcon size={14} className="text-blue-500" /> },
            { key: 'twitter', icon: <TwitterIcon size={14} className="text-neutral-700" /> },
            { key: 'threads', icon: <MessageCircle size={14} className="text-neutral-600" /> },
            { key: 'instagram', icon: <Instagram size={14} className="text-pink-500" /> },
            { key: 'reddit', icon: <Hash size={14} className="text-orange-500" /> },
            { key: 'medium', icon: <BookOpen size={14} className="text-green-700" /> },
            { key: 'substack', icon: <Newspaper size={14} className="text-orange-600" /> },
          ].map(({ key, icon }) => {
            const lastScan = data?.stats?.[key]?.lastScannedAt
            const hasItems = (data?.stats?.[key]?.total || 0) > 0
            return (
              <div key={key} className="flex items-center gap-1" title={`${PLATFORM_LABELS[key]}: ${lastScan ? new Date(lastScan).toLocaleString() : 'Never scanned'}`}>
                {icon}
                <span className={`text-xs ${hasItems ? 'text-neutral-700 font-medium' : 'text-neutral-400'}`}>
                  {data?.stats?.[key]?.new > 0 && (
                    <span className="text-red-500 font-bold mr-0.5">{data.stats[key].new}</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
        <button
          onClick={handleScanAll}
          disabled={scanningAll}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-neutral-800 text-white rounded-lg hover:bg-neutral-900 disabled:opacity-50 flex-shrink-0"
        >
          <RefreshCw size={14} className={scanningAll ? 'animate-spin' : ''} />
          {scanningAll ? 'Scanning...' : 'Scan All'}
        </button>
      </div>

      {/* Scan Result Feedback */}
      {scanResult && (
        <div className={`p-3 rounded-lg text-sm ${
          scanResult.success !== false ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {scanResult.success !== false ? (
            <span className="flex items-center gap-2 flex-wrap">
              <CheckCircle size={14} />
              Scan complete.
              {scanResult.results && Object.entries(scanResult.results).map(([p, r]) => (
                r.newCount > 0 ? <span key={p} className="font-medium"> {p}: {r.newCount} new</span> : null
              ))}
              {scanResult.results && Object.values(scanResult.results).every(r => (r.newCount || 0) === 0) && (
                <span> No new items found.</span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <AlertTriangle size={14} />
              {scanResult.error || 'Scan failed'}
            </span>
          )}
        </div>
      )}

      {/* Item List */}
      <div className="bg-white rounded-lg border border-neutral-200">
        <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900">
            Incoming ({visibleItems.length})
          </h2>
          {dismissedCount > 0 && (
            <button
              onClick={() => setShowDismissed(!showDismissed)}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700"
            >
              {showDismissed ? <EyeOff size={12} /> : <Eye size={12} />}
              {showDismissed ? 'Hide' : 'Show'} {dismissedCount} dismissed
            </button>
          )}
        </div>
        <div className="divide-y divide-neutral-100">
          {visibleItems.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              <Inbox className="w-12 h-12 mx-auto mb-3 text-neutral-300" />
              <p>No engagement yet</p>
              <p className="text-sm mt-1">Scan Bluesky or Twitter to check for replies and mentions</p>
            </div>
          ) : (
            visibleItems.map(item => (
              <EngagementItem
                key={item.id}
                item={item}
                onDraftReply={handleDraftReply}
                onDismiss={handleDismiss}
                onMarkSeen={handleMarkSeen}
                onDelete={handleDelete}
                onComplete={handleComplete}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function EngagementItem({ item, onDraftReply, onDismiss, onMarkSeen, onDelete, onComplete }) {
  const isNew = item.status === 'new'
  const isDismissed = item.status === 'dismissed'
  const isReplied = item.status === 'replied'
  const isCompleted = item.status === 'completed'
  const [drafting, setDrafting] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleDraft = async (id) => {
    setDrafting(true)
    await onDraftReply(id)
    setDrafting(false)
  }

  const handleCopyAndOpen = (text, url) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    if (url) window.open(url, '_blank')
  }

  return (
    <div className={`p-4 ${isNew ? 'bg-amber-50/50' : ''} ${isDismissed || isCompleted ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Platform + type badges */}
          <div className="flex items-center gap-2 mb-2">
            {getPlatformIcon(item.platform)}
            <span className="text-sm font-medium">
              @{item.authorHandle}
            </span>
            {item.authorDisplayName && item.authorDisplayName !== item.authorHandle && (
              <span className="text-xs text-neutral-500">({item.authorDisplayName})</span>
            )}
            <span className={`px-2 py-0.5 text-xs rounded ${
              item.type === 'reply'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700'
            }`}>
              {item.type === 'reply' ? 'Reply' : 'Mention'}
            </span>
            {isNew && (
              <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded font-medium">
                New
              </span>
            )}
            {isReplied && (
              <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                Replied
              </span>
            )}
            {isCompleted && (
              <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                Done
              </span>
            )}
            {isDismissed && (
              <span className="px-2 py-0.5 text-xs bg-neutral-100 text-neutral-500 rounded">
                Dismissed
              </span>
            )}
          </div>

          {/* Their post */}
          <p className="text-neutral-800 whitespace-pre-wrap text-sm">{item.postText}</p>

          {/* Draft reply (shown after drafting) */}
          {item.draftReply && (
            <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded">
              <p className="text-xs font-medium text-green-700 mb-1">Your reply:</p>
              <p className="text-sm text-neutral-800 whitespace-pre-wrap">{item.draftReply}</p>
              <button
                onClick={() => handleCopyAndOpen(item.draftReply, item.postUrl)}
                className="mt-2 flex items-center gap-1 px-3 py-1.5 text-sm bg-neutral-800 text-white rounded hover:bg-neutral-900"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy & Open'}
              </button>
            </div>
          )}

          {/* Links */}
          <div className="flex items-center gap-3 mt-2">
            <a
              href={item.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink size={10} />
              View post
            </a>
            {item.ourPostUrl && (
              <a
                href={item.ourPostUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-neutral-500 hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink size={10} />
                Our post
              </a>
            )}
          </div>

          <p className="text-xs text-neutral-400 mt-2">
            {new Date(item.indexedAt).toLocaleString()}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {!isReplied && !isDismissed && !isCompleted && (
            <button
              onClick={() => handleDraft(item.id)}
              disabled={drafting}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gold text-white rounded hover:bg-amber-600 disabled:opacity-50"
            >
              {drafting ? <RefreshCw size={14} className="animate-spin" /> : <MessageSquareReply size={14} />}
              {drafting ? 'Drafting...' : 'Draft Reply'}
            </button>
          )}
          {isReplied && !isCompleted && (
            <button
              onClick={() => onComplete(item.id)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
            >
              <CheckCircle size={14} />
              Done
            </button>
          )}
          {isNew && (
            <button
              onClick={() => onMarkSeen(item.id)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 rounded"
            >
              <Eye size={14} />
              Mark Seen
            </button>
          )}
          {!isDismissed && !isReplied && !isCompleted && (
            <button
              onClick={() => onDismiss(item.id)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 rounded"
            >
              <X size={14} />
              Dismiss
            </button>
          )}
          <button
            onClick={() => onDelete(item.id)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Original Reply Queue Components ----

const PLATFORM_STYLE = {
  bluesky: { bg: 'bg-blue-50', border: 'border-blue-200', hover: 'hover:border-blue-300', text: 'text-blue-600', ring: 'ring-blue-500', activeBg: 'bg-blue-100' },
  twitter: { bg: 'bg-neutral-50', border: 'border-neutral-300', hover: 'hover:border-neutral-400', text: 'text-neutral-800', ring: 'ring-neutral-800', activeBg: 'bg-neutral-100' },
  threads: { bg: 'bg-neutral-50', border: 'border-neutral-300', hover: 'hover:border-neutral-400', text: 'text-neutral-700', ring: 'ring-neutral-700', activeBg: 'bg-neutral-100' },
  instagram: { bg: 'bg-pink-50', border: 'border-pink-200', hover: 'hover:border-pink-300', text: 'text-pink-600', ring: 'ring-pink-500', activeBg: 'bg-pink-100' },
  reddit: { bg: 'bg-orange-50', border: 'border-orange-200', hover: 'hover:border-orange-300', text: 'text-orange-600', ring: 'ring-orange-500', activeBg: 'bg-orange-100' },
  medium: { bg: 'bg-green-50', border: 'border-green-200', hover: 'hover:border-green-300', text: 'text-green-700', ring: 'ring-green-600', activeBg: 'bg-green-100' },
  substack: { bg: 'bg-orange-50', border: 'border-orange-200', hover: 'hover:border-orange-300', text: 'text-orange-600', ring: 'ring-orange-500', activeBg: 'bg-orange-100' },
}

function RateLimitCard({ platform, icon, repliesToday, maxReplies, canReply, lastReplied, isActive, onClick }) {
  const remaining = maxReplies - repliesToday
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
        <h3 className="font-semibold capitalize">{PLATFORM_LABELS[platform] || platform}</h3>
        <p className="text-sm text-neutral-600">
          {repliesToday} / {maxReplies} replies today
        </p>
      </div>
      <p className="text-xs text-neutral-500 mt-2">
        {lastReplied ? `Last reply: ${lastReplied}` : 'No replies yet'}
      </p>
      <div className={`flex items-center gap-2 mt-auto pt-2 ${canReply ? 'text-green-600' : 'text-red-600'}`}>
        <span className="text-2xl font-bold">
          {remaining > 0 ? remaining : 0}
          <span className="text-sm font-normal ml-1">left</span>
        </span>
        <div className={ps.text}>{icon}</div>
      </div>
    </button>
  )
}

function ReplyItem({ item, canReply, onUpdate }) {
  const [publishStatus, setPublishStatus] = useState(null)
  const [publishError, setPublishError] = useState(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [followTracked, setFollowTracked] = useState(false)

  const handlePublishBluesky = async () => {
    setPublishStatus('publishing')
    setPublishError(null)
    try {
      const res = await fetch(`/api/reply-queue/${item.id}/publish`, {
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
      await navigator.clipboard.writeText(item.replyText)
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
      await fetch(`/api/reply-queue/${item.id}/posted`, {
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
    if (!confirm('Delete this reply from the queue?')) return
    setIsUpdating(true)
    try {
      await fetch(`/api/reply-queue/${item.id}`, { method: 'DELETE' })
      onUpdate()
    } catch (err) {
      console.error('Error deleting:', err)
    }
    setIsUpdating(false)
  }

  const isFailed = item.status === 'failed'

  return (
    <div className={`p-4 ${isFailed ? 'bg-red-50' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Platform + author + badges */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {getPlatformIcon(item.platform)}
            {item.targetAuthor && (
              <span className="text-sm font-medium">
                @{item.targetAuthor}
              </span>
            )}
            {item.targetAuthorDisplayName && item.targetAuthorDisplayName !== item.targetAuthor && (
              <span className="text-xs text-neutral-500">({item.targetAuthorDisplayName})</span>
            )}
            {!item.targetAuthor && (
              <span className="text-sm font-medium">
                {PLATFORM_LABELS[item.platform] || item.platform}
              </span>
            )}
            {item.engagementType && (
              <span className={`px-2 py-0.5 text-xs rounded ${
                item.engagementType === 'reply'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700'
              }`}>
                {item.engagementType === 'reply' ? 'Reply' : 'Mention'}
              </span>
            )}
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
            {item.followTarget && (
              <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded inline-flex items-center gap-1">
                <UserPlus size={10} />
                Follow Outreach
              </span>
            )}
            {item.philosopher && (
              <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded capitalize">
                {item.philosopher}
              </span>
            )}
            {item.taskId && (
              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                {item.taskId}
              </span>
            )}
          </div>

          {/* Their original post */}
          {item.targetText && (
            <p className="text-neutral-600 whitespace-pre-wrap text-sm mb-2">{item.targetText}</p>
          )}

          {/* Our reply */}
          <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded">
            <p className="text-xs font-medium text-green-700 mb-1">Your reply:</p>
            <p className="text-neutral-800 whitespace-pre-wrap text-sm">{item.replyText}</p>
          </div>

          {/* Links */}
          <div className="flex items-center gap-3 mt-2">
            <a
              href={item.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink size={10} />
              View post
            </a>
            {item.ourPostUrl && (
              <a
                href={item.ourPostUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-neutral-500 hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink size={10} />
                Our post
              </a>
            )}
          </div>

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
              Publishing reply...
            </div>
          )}
          {publishStatus === 'success' && (
            <div className="flex items-center gap-2 mt-2 text-sm text-green-600">
              <CheckCircle size={14} />
              Reply published!
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
          {item.platform === 'bluesky' && canReply && (
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
              {isFailed ? 'Retry' : 'Publish Reply'}
            </button>
          )}
          {item.platform !== 'bluesky' && (
            <>
              <button
                onClick={handleCopyAndOpen}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-neutral-800 text-white rounded hover:bg-neutral-900"
              >
                {copyFeedback ? <Check size={14} /> : <Copy size={14} />}
                {copyFeedback ? 'Copied!' : 'Copy & Open'}
              </button>
              {item.followTarget && item.followUrl && (
                <button
                  onClick={async () => {
                    try {
                      await fetch('/api/follows', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          handle: item.targetAuthor,
                          platform: item.platform,
                          source: 'outreach',
                          context: item.targetText || '',
                          replyQueueItemId: item.id
                        })
                      })
                      setFollowTracked(true)
                    } catch (err) {
                      console.error('Failed to track follow:', err)
                    }
                    window.open(item.followUrl, '_blank')
                  }}
                  className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded ${
                    followTracked
                      ? 'bg-green-600 text-white'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {followTracked ? <Check size={14} /> : <UserPlus size={14} />}
                  {followTracked ? 'Followed!' : `Follow @${item.targetAuthor}`}
                </button>
              )}
              <button
                onClick={handleMarkPosted}
                disabled={isUpdating}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                <Check size={14} />
                Mark Done
              </button>
            </>
          )}
          {!canReply && (
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

function PostedReplyItem({ item }) {
  return (
    <div className="p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle size={16} className="text-green-500" />
        {getPlatformIcon(item.platform, 14)}
        <span className="text-sm text-neutral-700 truncate max-w-md">
          {item.replyText?.substring(0, 60)}{item.replyText?.length > 60 ? '...' : ''}
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

function AddReplyModal({ onClose, onAdd }) {
  const [platform, setPlatform] = useState('bluesky')
  const [targetUrl, setTargetUrl] = useState('')
  const [targetText, setTargetText] = useState('')
  const [replyText, setReplyText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!targetUrl.trim() || !replyText.trim()) return

    setIsSubmitting(true)
    try {
      await fetch('/api/reply-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, targetUrl, targetText, replyText })
      })
      onAdd()
    } catch (err) {
      console.error('Error adding reply:', err)
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
          <h2 className="text-lg font-semibold">Add Reply to Queue</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Platform Selection */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">Platform</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { key: 'bluesky', icon: <BlueskyIcon size={18} />, active: 'border-blue-500 bg-blue-50 text-blue-700' },
                { key: 'twitter', icon: <TwitterIcon size={18} />, active: 'border-neutral-800 bg-neutral-100 text-black' },
                { key: 'threads', icon: <MessageCircle size={18} />, active: 'border-neutral-700 bg-neutral-100 text-neutral-800' },
                { key: 'instagram', icon: <Instagram size={18} />, active: 'border-pink-500 bg-pink-50 text-pink-700' },
                { key: 'reddit', icon: <Hash size={18} />, active: 'border-orange-500 bg-orange-50 text-orange-700' },
                { key: 'medium', icon: <BookOpen size={18} />, active: 'border-green-600 bg-green-50 text-green-700' },
                { key: 'substack', icon: <Newspaper size={18} />, active: 'border-orange-500 bg-orange-50 text-orange-700' },
              ].map(({ key, icon, active }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPlatform(key)}
                  className={`p-2 rounded-lg border flex items-center justify-center gap-1.5 text-sm ${
                    platform === key ? active : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  {icon}
                  {PLATFORM_LABELS[key]}
                </button>
              ))}
            </div>
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

          {/* Target Text (optional context) */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Original Post Text <span className="text-neutral-400 font-normal">(optional context)</span>
            </label>
            <textarea
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="Paste the original post text for context..."
              rows={2}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
          </div>

          {/* Reply Text */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Reply Text
            </label>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Your reply..."
              rows={3}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
              required
            />
            {platform === 'bluesky' && (
              <p className={`text-xs mt-1 ${replyText.length > 300 ? 'text-red-600' : 'text-neutral-400'}`}>
                {replyText.length} / 300 characters
              </p>
            )}
          </div>

          {platform === 'bluesky' ? (
            <p className="text-sm text-blue-600 flex items-center gap-2">
              <Send size={14} />
              Bluesky replies are published automatically via API
            </p>
          ) : (
            <p className="text-sm text-neutral-600 flex items-center gap-2">
              <Copy size={14} />
              {PLATFORM_LABELS[platform]} replies use Copy & Open (manual posting)
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
              disabled={isSubmitting || !targetUrl.trim() || !replyText.trim()}
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
