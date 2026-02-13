import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  Plus,
  Check,
  Trash2,
  ExternalLink,
  AlertTriangle,
  X,
  RefreshCw,
  Copy,
  Heart,
  Repeat2,
  UserPlus,
  CheckCircle
} from 'lucide-react'
import PlatformStatusBadges from './PlatformStatusBadges'

function TwitterIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  )
}

function BlueskyIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.862 13.862c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69L12 14.492l-1.37 1.37c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69-.964-.964-.964-2.528 0-3.492L9.508 10l-2.37-2.37c-.964-.964-.964-2.528 0-3.492.964-.964 2.528-.964 3.492 0L12 5.508l1.37-1.37c.964-.964 2.528-.964 3.492 0 .964.964.964 2.528 0 3.492L14.492 10l2.37 2.37c.964.964.964 2.528 0 3.492z"/>
    </svg>
  )
}

const TYPE_CONFIG = {
  repost: { icon: Repeat2, label: 'Repost', color: 'green', bgClass: 'bg-green-100 text-green-700', btnClass: 'bg-green-600 hover:bg-green-700', tileBg: 'bg-green-50', tileBorder: 'border-green-200 hover:border-green-300', tileText: 'text-green-700', tileRing: 'ring-green-500' },
  like: { icon: Heart, label: 'Like', color: 'pink', bgClass: 'bg-pink-100 text-pink-700', btnClass: 'bg-pink-600 hover:bg-pink-700', tileBg: 'bg-pink-50', tileBorder: 'border-pink-200 hover:border-pink-300', tileText: 'text-pink-700', tileRing: 'ring-pink-500' },
  follow: { icon: UserPlus, label: 'Follow', color: 'indigo', bgClass: 'bg-indigo-100 text-indigo-700', btnClass: 'bg-indigo-600 hover:bg-indigo-700', tileBg: 'bg-indigo-50', tileBorder: 'border-indigo-200 hover:border-indigo-300', tileText: 'text-indigo-700', tileRing: 'ring-indigo-500' }
}

export default function EngagementActions() {
  const [showAddModal, setShowAddModal] = useState(false)
  const [activeTab, setActiveTab] = useState('queue')
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [typeFilter, setTypeFilter] = useState(null)
  const { data, error, isLoading, mutate } = useSWR('/api/engagement-actions', fetcher, {
    refreshInterval: 30000
  })

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-red-800">Failed to load engagement actions</h3>
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

  const queueByType = { repost: [], like: [], follow: [] }
  for (const item of data.queue || []) {
    if (queueByType[item.type]) queueByType[item.type].push(item)
  }

  // Compute today's totals and last completed per type
  const todayBsky = data.todayCounts?.bluesky || {}
  const todayTw = data.todayCounts?.twitter || {}
  const todayByType = {
    repost: (todayBsky.repost || 0) + (todayTw.repost || 0),
    like: (todayBsky.like || 0) + (todayTw.like || 0),
    follow: (todayBsky.follow || 0) + (todayTw.follow || 0)
  }
  const maxPerDay = (data.settings?.platforms?.bluesky?.maxActionsPerDay || 25)
  const lastByType = {}
  for (const c of data.completed || []) {
    if (!lastByType[c.type] && c.completedAt) lastByType[c.type] = c.completedAt
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

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Engagement</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-neutral-600">Reposts, likes & follows</p>
            <PlatformStatusBadges />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setScanning(true)
              setScanResult(null)
              try {
                const res = await fetch('/api/engagement-actions/scan', { method: 'POST' })
                const result = await res.json()
                setScanResult(result)
                mutate()
              } catch (err) {
                setScanResult({ success: false, error: err.message })
              }
              setScanning(false)
            }}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 bg-neutral-800 text-white rounded-lg hover:bg-neutral-900 disabled:opacity-50"
          >
            <RefreshCw size={20} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gold text-white rounded-lg hover:bg-amber-600"
          >
            <Plus size={20} />
            Add Action
          </button>
        </div>
      </div>

      {/* Summary Cards (clickable filters) */}
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
          const Icon = cfg.icon
          const queued = queueByType[type]?.length || 0
          const doneToday = todayByType[type] || 0
          const remaining = queued
          const lastDone = lastByType[type]
          const isActive = typeFilter === type
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(isActive ? null : type)}
              className={`text-left rounded-lg border p-4 transition-all flex flex-col ${
                isActive
                  ? `border-2 ring-2 ring-offset-1 ${cfg.tileRing} ${cfg.tileBg} ${cfg.tileBorder}`
                  : `${cfg.tileBg} ${cfg.tileBorder}`
              }`}
            >
              <div>
                <h3 className={`font-semibold ${cfg.tileText}`}>{cfg.label}s</h3>
                <p className="text-sm text-neutral-600">
                  {doneToday} / {maxPerDay} today
                </p>
              </div>
              <p className="text-xs text-neutral-500 mt-2">
                {lastDone ? `Last: ${timeAgo(lastDone)}` : 'None yet'}
              </p>
              <div className={`flex items-center gap-2 mt-auto pt-2 ${cfg.tileText}`}>
                <span className="text-2xl font-bold">
                  {remaining}
                  <span className="text-sm font-normal ml-1">queued</span>
                </span>
                <div className={cfg.bgClass + ' p-1 rounded'}>
                  <Icon size={18} />
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Scan Result */}
      {scanResult && (
        <div className={`p-3 rounded-lg text-sm ${
          scanResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {scanResult.success ? (
            <span className="flex items-center gap-2">
              <CheckCircle size={14} />
              Scan complete — evaluated {scanResult.evaluated || 0} posts, added {scanResult.added || 0} actions to queue
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <AlertTriangle size={14} />
              {scanResult.error || 'Scan failed'}
            </span>
          )}
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
          Queue ({data.queue?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'completed'
              ? 'border-gold text-gold'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          Completed ({data.completed?.length || 0})
        </button>
      </div>

      {activeTab === 'queue' ? (() => {
        const filtered = typeFilter
          ? (data.queue || []).filter(i => i.type === typeFilter)
          : (data.queue || [])
        return (
        <div className="bg-white rounded-lg border border-neutral-200">
          <div className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">
                <RefreshCw className="w-12 h-12 mx-auto mb-3 text-neutral-300" />
                <p>{typeFilter ? `No ${typeFilter}s queued` : 'No actions queued'}</p>
                <p className="text-sm mt-1">{typeFilter ? 'Click the card again to show all' : 'Add reposts, likes, or follows to get started'}</p>
              </div>
            ) : (
              filtered.map(item => (
                <ActionItem key={item.id} item={item} onUpdate={mutate} />
              ))
            )}
          </div>
        </div>
        )
      })() : (() => {
        const filtered = typeFilter
          ? (data.completed || []).filter(i => i.type === typeFilter)
          : (data.completed || [])
        return (
        <div className="bg-white rounded-lg border border-neutral-200">
          <div className="divide-y divide-neutral-100 max-h-96 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-neutral-500">
                <p>{typeFilter ? `No completed ${typeFilter}s` : 'No completed actions yet'}</p>
              </div>
            ) : (
              filtered.slice(0, 50).map(item => (
                <CompletedItem key={item.id} item={item} />
              ))
            )}
          </div>
        </div>
        )
      })()}

      {showAddModal && (
        <AddActionModal
          onClose={() => setShowAddModal(false)}
          onAdd={() => { setShowAddModal(false); mutate() }}
        />
      )}
    </div>
  )
}

function ActionItem({ item, onUpdate }) {
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.like
  const Icon = cfg.icon

  const handleCopyAndOpen = async () => {
    if (item.targetText) {
      await navigator.clipboard.writeText(item.targetText)
    }
    setCopyFeedback(true)
    setTimeout(() => setCopyFeedback(false), 2000)
    window.open(item.targetUrl, '_blank')
  }

  const handleDone = async () => {
    setIsUpdating(true)
    try {
      await fetch(`/api/engagement-actions/${item.id}/done`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      onUpdate()
    } catch (err) {
      console.error('Error completing action:', err)
    }
    setIsUpdating(false)
  }

  const handleDelete = async () => {
    if (!confirm('Remove this action from the queue?')) return
    setIsUpdating(true)
    try {
      await fetch(`/api/engagement-actions/${item.id}`, { method: 'DELETE' })
      onUpdate()
    } catch (err) {
      console.error('Error deleting:', err)
    }
    setIsUpdating(false)
  }

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Badges */}
          <div className="flex items-center gap-2 mb-2">
            {item.platform === 'twitter'
              ? <TwitterIcon size={16} className="text-neutral-800" />
              : <BlueskyIcon size={16} className="text-blue-500" />
            }
            <span className={`px-2 py-0.5 text-xs rounded inline-flex items-center gap-1 ${cfg.bgClass}`}>
              <Icon size={12} />
              {cfg.label}
            </span>
            {item.targetAuthor && (
              <span className="text-sm font-medium">@{item.targetAuthor}</span>
            )}
            {item.source && item.source !== 'manual' && (
              <span className="px-2 py-0.5 text-xs bg-neutral-100 text-neutral-500 rounded">
                {item.source}
              </span>
            )}
          </div>

          {/* Target text */}
          {item.targetText && (
            <p className="text-neutral-700 text-sm whitespace-pre-wrap line-clamp-3 mb-2">
              {item.targetText}
            </p>
          )}

          {/* Context */}
          {item.context && !item.targetText && (
            <p className="text-neutral-500 text-sm italic mb-2">{item.context}</p>
          )}

          {/* URL */}
          <a
            href={item.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink size={10} />
            {item.targetUrl?.length > 60 ? item.targetUrl.substring(0, 60) + '...' : item.targetUrl}
          </a>

          <p className="text-xs text-neutral-400 mt-1">
            Added {new Date(item.createdAt).toLocaleString()}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleCopyAndOpen}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-neutral-800 text-white rounded hover:bg-neutral-900"
          >
            {copyFeedback ? <Check size={14} /> : <ExternalLink size={14} />}
            {copyFeedback ? 'Opened!' : 'Open'}
          </button>
          <button
            onClick={handleDone}
            disabled={isUpdating}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 ${cfg.btnClass}`}
          >
            <Check size={14} />
            Done
          </button>
          <button
            onClick={handleDelete}
            disabled={isUpdating}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function CompletedItem({ item }) {
  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.like
  const Icon = cfg.icon

  return (
    <div className="p-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle size={16} className="text-green-500" />
        <span className={`p-1 rounded ${cfg.bgClass}`}>
          <Icon size={12} />
        </span>
        {item.platform === 'twitter'
          ? <TwitterIcon size={14} className="text-neutral-600" />
          : <BlueskyIcon size={14} className="text-blue-400" />
        }
        <span className="text-sm text-neutral-700">
          @{item.targetAuthor}
        </span>
        {item.targetText && (
          <span className="text-sm text-neutral-400 truncate max-w-xs">
            {item.targetText.substring(0, 50)}{item.targetText.length > 50 ? '...' : ''}
          </span>
        )}
      </div>
      <span className="text-xs text-neutral-400">
        {item.completedAt && new Date(item.completedAt).toLocaleString()}
      </span>
    </div>
  )
}

function AddActionModal({ onClose, onAdd }) {
  const [type, setType] = useState('repost')
  const [platform, setPlatform] = useState('twitter')
  const [targetUrl, setTargetUrl] = useState('')
  const [targetAuthor, setTargetAuthor] = useState('')
  const [targetText, setTargetText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (type === 'follow' && !targetAuthor.trim()) return
    if (type !== 'follow' && !targetUrl.trim()) return

    setIsSubmitting(true)
    try {
      await fetch('/api/engagement-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          platform,
          targetUrl: targetUrl.trim() || undefined,
          targetAuthor: targetAuthor.trim() || undefined,
          targetText: targetText.trim() || undefined,
          source: 'manual'
        })
      })
      onAdd()
    } catch (err) {
      console.error('Error adding action:', err)
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
          <h2 className="text-lg font-semibold">Add Engagement Action</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Action Type */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">Action</label>
            <div className="flex gap-2">
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setType(key)}
                    className={`flex-1 p-3 rounded-lg border flex items-center justify-center gap-2 text-sm ${
                      type === key ? `${cfg.bgClass} border-current` : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    <Icon size={18} />
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Platform */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">Platform</label>
            <div className="flex gap-3">
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

          {/* Handle */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              @handle {type !== 'follow' && <span className="text-neutral-400 font-normal">(optional)</span>}
            </label>
            <input
              type="text"
              value={targetAuthor}
              onChange={(e) => setTargetAuthor(e.target.value)}
              placeholder="@username"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
              required={type === 'follow'}
            />
          </div>

          {/* URL */}
          {type !== 'follow' && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                Post URL
              </label>
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder={platform === 'twitter' ? 'https://x.com/user/status/...' : 'https://bsky.app/profile/.../post/...'}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
                required
              />
            </div>
          )}

          {/* Post text (optional context) */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Post text <span className="text-neutral-400 font-normal">(optional context)</span>
            </label>
            <textarea
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              placeholder="Paste their post text for reference..."
              rows={2}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
          </div>

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
              disabled={isSubmitting}
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
