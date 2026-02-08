import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { fetcher } from '../lib/api'
import {
  MessageSquarePlus, Send, Filter, Archive, Mail, MailOpen,
  MessageCircle, AlertTriangle, HelpCircle, RefreshCw, Eye,
  X, ChevronLeft, Users, Inbox
} from 'lucide-react'

const TYPE_CONFIG = {
  alert:    { label: 'Alert',    bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-500' },
  request:  { label: 'Request',  bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-500' },
  update:   { label: 'Update',   bg: 'bg-green-100',  text: 'text-green-700',  border: 'border-green-500' },
  question: { label: 'Question', bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-500' },
  review:   { label: 'Review',   bg: 'bg-amber-100',  text: 'text-amber-700',  border: 'border-amber-500' }
}

const PRIORITY_BORDERS = {
  high:   'border-l-red-500',
  medium: 'border-l-amber-400',
  low:    'border-l-blue-300'
}

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function StatCard({ icon, label, value, color }) {
  const colorClasses = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    amber:  'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600'
  }
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-neutral-500 mb-1">{label}</p>
          <p className="text-3xl font-bold text-black">{value}</p>
        </div>
        <div className={`p-2.5 rounded-lg ${colorClasses[color] || colorClasses.blue}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function TypeBadge({ type }) {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.update
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  )
}

// ── Compose Modal ──────────────────────────────────────────────────────────

function ComposeModal({ agents, onClose }) {
  const [form, setForm] = useState({
    from: '', to: [], type: 'update', subject: '', body: '', priority: 'medium'
  })
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.from || form.to.length === 0 || !form.subject || !form.body) return
    setSubmitting(true)
    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      mutate(k => typeof k === 'string' && k.startsWith('/api/messages'))
      onClose()
    } catch (err) {
      console.error('Send failed:', err)
    }
    setSubmitting(false)
  }

  const toggleRecipient = (id) => {
    setForm(f => ({
      ...f,
      to: f.to.includes(id) ? f.to.filter(r => r !== id) : [...f.to, id]
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Compose Message</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* From */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">From</label>
            <select
              value={form.from}
              onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              required
            >
              <option value="">Select sender...</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
          </div>

          {/* To */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">To</label>
            <div className="flex flex-wrap gap-2">
              {agents.filter(a => a.id !== form.from).map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleRecipient(a.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.to.includes(a.id)
                      ? 'bg-gold border-gold text-black'
                      : 'bg-white border-neutral-300 text-neutral-600 hover:border-neutral-400'
                  }`}
                >
                  {a.name || a.id}
                </button>
              ))}
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Type</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: key }))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.type === key
                      ? `${cfg.bg} ${cfg.text} border-current`
                      : 'bg-white border-neutral-300 text-neutral-600 hover:border-neutral-400'
                  }`}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Priority</label>
            <div className="flex gap-2">
              {['high', 'medium', 'low'].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, priority: p }))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
                    form.priority === p
                      ? p === 'high' ? 'bg-red-100 text-red-700 border-red-300'
                        : p === 'medium' ? 'bg-amber-100 text-amber-700 border-amber-300'
                        : 'bg-blue-100 text-blue-700 border-blue-300'
                      : 'bg-white border-neutral-300 text-neutral-600 hover:border-neutral-400'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Subject</label>
            <input
              type="text"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Message subject..."
              required
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Body</label>
            <textarea
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm min-h-[120px] resize-y"
              placeholder="Write your message..."
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-black">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !form.from || form.to.length === 0 || !form.subject || !form.body}
              className="px-4 py-2 bg-gold text-black rounded-lg text-sm font-medium hover:bg-gold/90 disabled:opacity-50"
            >
              {submitting ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Thread View ────────────────────────────────────────────────────────────

function ThreadView({ threadId, agents, onClose }) {
  const { data } = useSWR(`/api/messages?thread=${threadId}&limit=500`, fetcher, { refreshInterval: 15000 })
  const messages = data?.messages || []

  const [replyForm, setReplyForm] = useState({ from: '', body: '', type: '' })
  const [submitting, setSubmitting] = useState(false)

  const rootMessage = messages[0]

  const handleReply = async (e) => {
    e.preventDefault()
    if (!replyForm.from || !replyForm.body) return
    setSubmitting(true)
    try {
      const lastMessage = messages[messages.length - 1]
      await fetch(`/api/messages/${lastMessage.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: replyForm.from,
          body: replyForm.body,
          ...(replyForm.type ? { type: replyForm.type } : {})
        })
      })
      mutate(k => typeof k === 'string' && k.startsWith('/api/messages'))
      setReplyForm(f => ({ ...f, body: '' }))
    } catch (err) {
      console.error('Reply failed:', err)
    }
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="flex items-center gap-2 text-neutral-600 hover:text-black text-sm">
        <ChevronLeft size={16} /> Back to messages
      </button>

      {rootMessage && (
        <div className="mb-4">
          <h2 className="text-xl font-serif font-bold text-black">{rootMessage.subject}</h2>
          <div className="flex items-center gap-2 mt-1">
            <TypeBadge type={rootMessage.type} />
            <span className="text-xs text-neutral-500">{messages.length} message{messages.length !== 1 ? 's' : ''} in thread</span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {messages.map(msg => {
          const agent = agents.find(a => a.id === msg.from)
          return (
            <div key={msg.id} className={`card p-4 border-l-4 ${PRIORITY_BORDERS[msg.priority] || 'border-l-neutral-300'}`}>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center text-sm font-bold text-gold flex-shrink-0">
                  {(agent?.name || msg.from)[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{agent?.name || msg.from}</span>
                    <span className="text-xs text-neutral-400">→</span>
                    <span className="text-xs text-neutral-500">{msg.to.join(', ')}</span>
                    <span className="text-xs text-neutral-400 ml-auto">{getTimeAgo(msg.createdAt)}</span>
                  </div>
                  <p className="text-sm text-neutral-700 mt-1 whitespace-pre-wrap">{msg.body}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Reply form */}
      <form onSubmit={handleReply} className="card p-4 space-y-3">
        <div className="flex gap-3">
          <select
            value={replyForm.from}
            onChange={e => setReplyForm(f => ({ ...f, from: e.target.value }))}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-48"
            required
          >
            <option value="">Reply as...</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
          <select
            value={replyForm.type}
            onChange={e => setReplyForm(f => ({ ...f, type: e.target.value }))}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-32"
          >
            <option value="">Same type</option>
            {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
        </div>
        <textarea
          value={replyForm.body}
          onChange={e => setReplyForm(f => ({ ...f, body: e.target.value }))}
          className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm min-h-[80px] resize-y"
          placeholder="Write a reply..."
          required
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !replyForm.from || !replyForm.body}
            className="px-4 py-2 bg-gold text-black rounded-lg text-sm font-medium hover:bg-gold/90 disabled:opacity-50 flex items-center gap-2"
          >
            <Send size={14} /> {submitting ? 'Sending...' : 'Reply'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Message Card ───────────────────────────────────────────────────────────

function MessageCard({ message, agents, allMessages, onOpenThread, onMarkRead, onArchive }) {
  const agent = agents.find(a => a.id === message.from)
  const isUnread = message.status === 'unread'
  const typeConfig = TYPE_CONFIG[message.type] || TYPE_CONFIG.update
  const replyCount = allMessages.filter(m => m.threadId === message.threadId && m.id !== message.id).length

  return (
    <div
      className={`card p-4 border-l-4 ${PRIORITY_BORDERS[message.priority] || 'border-l-neutral-300'} cursor-pointer hover:shadow-md transition-shadow ${
        isUnread ? 'ring-2 ring-gold/30' : ''
      }`}
      onClick={() => onOpenThread(message.threadId)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <TypeBadge type={message.type} />
            <span className={`text-sm ${isUnread ? 'font-bold text-black' : 'font-medium text-neutral-700'}`}>
              {message.subject}
            </span>
          </div>
          <p className="text-sm text-neutral-500 line-clamp-2">{message.body}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-neutral-400">
            <span className="font-medium text-neutral-600">{agent?.name || message.from}</span>
            <span>→</span>
            <span>{message.to.map(id => agents.find(a => a.id === id)?.name || id).join(', ')}</span>
            <span className="ml-auto">{getTimeAgo(message.createdAt)}</span>
            {replyCount > 0 && (
              <span className="flex items-center gap-1 text-neutral-500">
                <MessageCircle size={12} /> {replyCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {isUnread && (
            <button
              onClick={() => onMarkRead(message.id)}
              className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"
              title="Mark as read"
            >
              <MailOpen size={14} />
            </button>
          )}
          {message.status !== 'archived' && (
            <button
              onClick={() => onArchive(message.id)}
              className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"
              title="Archive"
            >
              <Archive size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function AgentMessages() {
  const [filterAgent, setFilterAgent] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showCompose, setShowCompose] = useState(false)
  const [selectedThread, setSelectedThread] = useState(null)

  // Build query params
  const params = new URLSearchParams()
  if (filterAgent) params.set('agent', filterAgent)
  if (filterType) params.set('type', filterType)
  if (filterStatus && filterStatus !== 'all') params.set('status', filterStatus)

  const { data, error } = useSWR(`/api/messages?${params.toString()}`, fetcher, { refreshInterval: 30000 })
  const { data: stats } = useSWR('/api/messages/stats', fetcher, { refreshInterval: 30000 })
  const { data: agentsData } = useSWR('/api/agents', fetcher)

  const messages = data?.messages || []
  const agents = agentsData || []

  // Only show root messages (not replies) in the list
  const rootMessages = messages.filter(m => m.parentId === null)

  const mostActiveAgent = stats?.byAgent
    ? Object.entries(stats.byAgent).sort((a, b) => (b[1].sent + b[1].received) - (a[1].sent + a[1].received))[0]
    : null

  const handleMarkRead = async (id) => {
    try {
      await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' })
      })
      mutate(k => typeof k === 'string' && k.startsWith('/api/messages'))
    } catch (err) {
      console.error('Mark read failed:', err)
    }
  }

  const handleArchive = async (id) => {
    try {
      await fetch(`/api/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' })
      })
      mutate(k => typeof k === 'string' && k.startsWith('/api/messages'))
    } catch (err) {
      console.error('Archive failed:', err)
    }
  }

  // Thread view
  if (selectedThread) {
    return (
      <div className="max-w-4xl mx-auto">
        <ThreadView
          threadId={selectedThread}
          agents={agents}
          onClose={() => setSelectedThread(null)}
        />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-gold"><MessageSquarePlus size={28} /></span>
          <h1 className="text-3xl font-serif font-bold text-black">Messages</h1>
        </div>
        <button
          onClick={() => setShowCompose(true)}
          className="px-4 py-2 bg-gold text-black rounded-lg text-sm font-medium hover:bg-gold/90 flex items-center gap-2"
        >
          <MessageSquarePlus size={16} /> Compose
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Mail size={20} />} label="Total Messages" value={stats?.total || 0} color="blue" />
        <StatCard icon={<Inbox size={20} />} label="Unread" value={stats?.unread || 0} color="amber" />
        <StatCard icon={<MessageCircle size={20} />} label="Threads" value={stats?.threads || 0} color="green" />
        <StatCard
          icon={<Users size={20} />}
          label="Most Active"
          value={mostActiveAgent ? (agents.find(a => a.id === mostActiveAgent[0])?.name || mostActiveAgent[0]) : '—'}
          color="purple"
        />
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Filter size={16} className="text-neutral-400" />

          <select
            value={filterAgent}
            onChange={e => setFilterAgent(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All agents</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>

          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="border border-neutral-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">All types</option>
            {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>

          <div className="flex rounded-lg border border-neutral-300 overflow-hidden text-sm">
            {['all', 'unread', 'read', 'archived'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 capitalize ${
                  filterStatus === s
                    ? 'bg-gold text-black font-medium'
                    : 'bg-white text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {(filterAgent || filterType || filterStatus !== 'all') && (
            <button
              onClick={() => { setFilterAgent(''); setFilterType(''); setFilterStatus('all') }}
              className="text-xs text-neutral-500 hover:text-black ml-auto"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Message List */}
      {error ? (
        <div className="card p-8 text-center text-red-600">
          <AlertTriangle size={24} className="mx-auto mb-2" />
          <p>Failed to load messages</p>
        </div>
      ) : rootMessages.length === 0 ? (
        <div className="card p-12 text-center">
          <MessageSquarePlus size={48} className="mx-auto mb-4 text-neutral-300" />
          <h3 className="text-lg font-semibold text-neutral-600 mb-2">No messages yet</h3>
          <p className="text-neutral-400 mb-4">Start a conversation between agents</p>
          <button
            onClick={() => setShowCompose(true)}
            className="px-4 py-2 bg-gold text-black rounded-lg text-sm font-medium hover:bg-gold/90"
          >
            Compose First Message
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rootMessages.map(msg => (
            <MessageCard
              key={msg.id}
              message={msg}
              agents={agents}
              allMessages={messages}
              onOpenThread={setSelectedThread}
              onMarkRead={handleMarkRead}
              onArchive={handleArchive}
            />
          ))}
        </div>
      )}

      {/* Compose Modal */}
      {showCompose && (
        <ComposeModal
          agents={agents}
          onClose={() => setShowCompose(false)}
        />
      )}
    </div>
  )
}
