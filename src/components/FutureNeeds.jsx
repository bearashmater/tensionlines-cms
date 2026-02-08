import { useState } from 'react'
import useSWR from 'swr'
import { Compass, ChevronDown, ChevronUp, ThumbsUp, MessageSquare, Plus, X, FileText, TrendingUp, BarChart3, Zap, DollarSign, Shield, Clock, ArrowLeft, ArrowRight, Pause, CheckCircle2, Trophy } from 'lucide-react'

const fetcher = (url) => fetch(url).then(r => r.json())

const CATEGORY_CONFIG = {
  content: { label: 'Content & Publishing', color: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500', icon: FileText },
  growth: { label: 'Growth & Outreach', color: 'bg-green-100 text-green-800', dot: 'bg-green-500', icon: TrendingUp },
  analytics: { label: 'Analytics & Insights', color: 'bg-purple-100 text-purple-800', dot: 'bg-purple-500', icon: BarChart3 },
  infrastructure: { label: 'Automation & Infrastructure', color: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500', icon: Zap },
  monetization: { label: 'Monetization', color: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-500', icon: DollarSign },
  governance: { label: 'Quality & Governance', color: 'bg-red-100 text-red-800', dot: 'bg-red-500', icon: Shield }
}

const PRIORITY_CONFIG = {
  high: { label: 'HIGH', color: 'bg-red-100 text-red-700 border-red-200' },
  medium: { label: 'MED', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  low: { label: 'LOW', color: 'bg-neutral-100 text-neutral-600 border-neutral-200' }
}

const EFFORT_CONFIG = {
  small: { label: '< 1 day', color: 'bg-green-100 text-green-700' },
  medium: { label: '1-3 days', color: 'bg-blue-100 text-blue-700' },
  large: { label: '1+ week', color: 'bg-purple-100 text-purple-700' }
}

const STATUS_CONFIG = {
  proposed: { label: 'Proposed', color: 'bg-neutral-100 text-neutral-700' },
  planned: { label: 'Planned', color: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'In Progress', color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-700' },
  deferred: { label: 'Deferred', color: 'bg-neutral-100 text-neutral-500' }
}

export default function FutureNeeds() {
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('proposed')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [effortFilter, setEffortFilter] = useState('all')
  const [sortBy, setSortBy] = useState('priority')
  const [expandedId, setExpandedId] = useState(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentingId, setCommentingId] = useState(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const queryParts = []
  if (categoryFilter !== 'all') queryParts.push(`category=${categoryFilter}`)
  if (statusFilter !== 'all' && statusFilter !== 'completed') queryParts.push(`status=${statusFilter}`)
  if (priorityFilter !== 'all') queryParts.push(`priority=${priorityFilter}`)
  if (effortFilter !== 'all') queryParts.push(`effort=${effortFilter}`)
  queryParts.push(`sort=${sortBy}`)
  const queryString = queryParts.join('&')

  const { data, mutate } = useSWR(`/api/future-needs?${queryString}`, fetcher, { refreshInterval: 30000 })
  const { data: stats, mutate: mutateStats } = useSWR('/api/future-needs/stats', fetcher, { refreshInterval: 30000 })

  // Split active vs completed needs
  const activeNeeds = (data?.needs || []).filter(n => n.status !== 'completed')
  const completedNeeds = (data?.needs || []).filter(n => n.status === 'completed')
  // If user clicked the "Completed" status filter, show only completed
  const showingCompletedFilter = statusFilter === 'completed'

  const updateStatus = async (id, newStatus) => {
    try {
      await fetch(`/api/future-needs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      mutate()
      mutateStats()
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  const toggleVote = async (id) => {
    try {
      await fetch(`/api/future-needs/${id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voter: 'shawn' })
      })
      mutate()
    } catch (err) {
      console.error('Failed to vote:', err)
    }
  }

  const addComment = async (id) => {
    if (!commentText.trim()) return
    try {
      await fetch(`/api/future-needs/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText, author: 'shawn' })
      })
      setCommentText('')
      setCommentingId(null)
      mutate()
    } catch (err) {
      console.error('Failed to add comment:', err)
    }
  }

  const deleteNeed = async (id) => {
    if (!confirm('Remove this need?')) return
    try {
      await fetch(`/api/future-needs/${id}`, { method: 'DELETE' })
      mutate()
      mutateStats()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  if (!data || !stats) {
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
          <h1 className="text-3xl font-serif font-bold text-black flex items-center gap-3">
            <Compass className="text-gold" size={32} />
            Future Needs Roadmap
          </h1>
          <p className="text-neutral-600 mt-1">
            Track capabilities the platform needs next
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-black text-white rounded-lg hover:bg-neutral-800 transition-colors flex items-center gap-2"
        >
          <Plus size={18} /> Add Need
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
            className={`p-3 rounded-lg border transition-all ${statusFilter === key ? 'ring-2 ring-black border-black' : 'border-neutral-200 hover:border-neutral-300'} bg-white`}
          >
            <div className="text-2xl font-bold">{stats.byStatus?.[key] || 0}</div>
            <div className="text-xs text-neutral-500">{cfg.label}</div>
          </button>
        ))}
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategoryFilter('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${categoryFilter === 'all' ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
        >
          All ({stats.total})
        </button>
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon
          const count = stats.byCategory?.[key] || 0
          return (
            <button
              key={key}
              onClick={() => setCategoryFilter(categoryFilter === key ? 'all' : key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${categoryFilter === key ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
            >
              <Icon size={14} /> {cfg.label.split(' ')[0]} ({count})
            </button>
          )
        })}
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-3 py-1.5 border border-neutral-200 rounded-lg text-sm bg-white"
        >
          <option value="all">All Priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select
          value={effortFilter}
          onChange={(e) => setEffortFilter(e.target.value)}
          className="px-3 py-1.5 border border-neutral-200 rounded-lg text-sm bg-white"
        >
          <option value="all">All Efforts</option>
          <option value="small">&lt; 1 day</option>
          <option value="medium">1-3 days</option>
          <option value="large">1+ week</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-1.5 border border-neutral-200 rounded-lg text-sm bg-white"
        >
          <option value="priority">Sort: Priority</option>
          <option value="votes">Sort: Most Voted</option>
          <option value="effort">Sort: Effort</option>
          <option value="newest">Sort: Newest</option>
        </select>

        <span className="text-sm text-neutral-500 ml-auto">
          {data.total} need{data.total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Active Needs List */}
      {!showingCompletedFilter && (
        <div className="space-y-3">
          {activeNeeds.map(need => (
            <NeedCard
              key={need.id}
              need={need}
              expanded={expandedId === need.id}
              onToggle={() => setExpandedId(expandedId === need.id ? null : need.id)}
              onStatusChange={updateStatus}
              onVote={toggleVote}
              onDelete={deleteNeed}
              commentingId={commentingId}
              setCommentingId={setCommentingId}
              commentText={commentText}
              setCommentText={setCommentText}
              onAddComment={addComment}
            />
          ))}
          {activeNeeds.length === 0 && (
            <div className="text-center py-12 text-neutral-500">
              No active needs match the current filters.
            </div>
          )}
        </div>
      )}

      {/* Completed Roadmap */}
      {(completedNeeds.length > 0 || showingCompletedFilter) && (
        <div>
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex items-center gap-2 w-full text-left group"
          >
            <div className="flex items-center gap-2 flex-1">
              <Trophy size={18} className="text-gold" />
              <h2 className="text-lg font-serif font-bold text-black">
                Completed ({completedNeeds.length})
              </h2>
              <div className="flex-1 border-t border-neutral-200 ml-2" />
            </div>
            {showCompleted || showingCompletedFilter
              ? <ChevronUp size={18} className="text-neutral-400" />
              : <ChevronDown size={18} className="text-neutral-400" />
            }
          </button>

          {(showCompleted || showingCompletedFilter) && (
            <div className="mt-3 space-y-2">
              {completedNeeds.map(need => (
                <div key={need.id} className="bg-white rounded-lg border border-green-200 bg-green-50/30 p-4 flex items-center gap-3">
                  <CheckCircle2 size={20} className="text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-black">{need.title}</h3>
                    <p className="text-sm text-neutral-500 truncate">{need.description}</p>
                    {need.completedAt && (
                      <span className="text-xs text-neutral-400">
                        Completed {new Date(need.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${CATEGORY_CONFIG[need.category]?.color || 'bg-neutral-100 text-neutral-700'}`}>
                    {need.category}
                  </span>
                </div>
              ))}
              {completedNeeds.length === 0 && showingCompletedFilter && (
                <div className="text-center py-8 text-neutral-500">
                  No completed needs yet.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreateForm && (
        <CreateNeedModal
          onClose={() => setShowCreateForm(false)}
          onCreated={() => { mutate(); mutateStats(); setShowCreateForm(false) }}
        />
      )}
    </div>
  )
}

function NeedCard({ need, expanded, onToggle, onStatusChange, onVote, onDelete, commentingId, setCommentingId, commentText, setCommentText, onAddComment }) {
  const cat = CATEGORY_CONFIG[need.category] || CATEGORY_CONFIG.infrastructure
  const pri = PRIORITY_CONFIG[need.priority] || PRIORITY_CONFIG.medium
  const eff = EFFORT_CONFIG[need.effort] || EFFORT_CONFIG.medium
  const sta = STATUS_CONFIG[need.status] || STATUS_CONFIG.proposed
  const CatIcon = cat.icon

  // Flow order: proposed(0) → planned(1) → in_progress(2) → completed(3), deferred is a sidestep
  const flowIndex = { proposed: 0, planned: 1, in_progress: 2, completed: 3 }
  const currentIndex = flowIndex[need.status] ?? -1
  const allStatuses = [
    { key: 'proposed', label: 'Proposed' },
    { key: 'planned', label: 'Planned' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'completed', label: 'Completed' },
    { key: 'deferred', label: 'Deferred' }
  ]
  const actions = allStatuses.filter(s => s.key !== need.status).map(s => {
    const targetIndex = flowIndex[s.key] ?? -1
    let direction = 'forward' // default
    if (s.key === 'deferred') direction = 'sidestep'
    else if (targetIndex < currentIndex) direction = 'backward'
    return { ...s, direction }
  })

  return (
    <div className={`bg-white rounded-lg border transition-all ${expanded ? 'border-neutral-300 shadow-md' : 'border-neutral-200 hover:border-neutral-300'}`}>
      {/* Compact Row */}
      <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={onToggle}>
        <div className="flex flex-col items-center gap-1 min-w-[40px]">
          <button
            onClick={(e) => { e.stopPropagation(); onVote(need.id) }}
            className={`p-1 rounded hover:bg-neutral-100 transition-colors ${need.voters?.includes('shawn') ? 'text-gold' : 'text-neutral-400'}`}
            title="Vote"
          >
            <ThumbsUp size={16} />
          </button>
          <span className="text-xs font-medium text-neutral-500">{need.votes}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 rounded text-xs font-bold border ${pri.color}`}>{pri.label}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${eff.color}`}>{eff.label}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${cat.color} flex items-center gap-1`}>
              <CatIcon size={12} /> {need.category}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${sta.color}`}>{sta.label}</span>
          </div>
          <h3 className="font-semibold text-black truncate">{need.title}</h3>
          <p className="text-sm text-neutral-500 truncate">{need.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {need.comments.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-neutral-400">
              <MessageSquare size={14} /> {need.comments.length}
            </span>
          )}
          {expanded ? <ChevronUp size={20} className="text-neutral-400" /> : <ChevronDown size={20} className="text-neutral-400" />}
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-neutral-100 pt-4 space-y-4">
          {/* Use Case */}
          {need.useCase && (
            <div>
              <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Use Case</h4>
              <p className="text-sm text-neutral-700">{need.useCase}</p>
            </div>
          )}

          {/* Acceptance Criteria */}
          {need.acceptanceCriteria?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Acceptance Criteria</h4>
              <ul className="space-y-1">
                {need.acceptanceCriteria.map((ac, i) => (
                  <li key={i} className="text-sm text-neutral-700 flex items-start gap-2">
                    <span className="text-neutral-400 mt-0.5">-</span> {ac}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Meta Row */}
          <div className="flex flex-wrap gap-4 text-xs text-neutral-500">
            {need.agents?.length > 0 && (
              <span>Agents: {need.agents.join(', ')}</span>
            )}
            {need.targetQuarter && (
              <span>Target: {need.targetQuarter}</span>
            )}
            {need.dependencies?.length > 0 && (
              <span>Depends on: {need.dependencies.join(', ')}</span>
            )}
            <span>Proposed by {need.proposedBy}</span>
          </div>

          {/* Status Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-neutral-500 uppercase">Move to:</span>
            {actions.map(a => {
              const Icon = a.direction === 'backward' ? ArrowLeft : a.direction === 'sidestep' ? Pause : ArrowRight
              return (
                <button
                  key={a.key}
                  onClick={() => onStatusChange(need.id, a.key)}
                  className="px-3 py-1 text-sm border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors flex items-center gap-1"
                >
                  <Icon size={14} /> {a.label}
                </button>
              )
            })}
            <button
              onClick={() => onDelete(need.id)}
              className="px-3 py-1 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors ml-auto"
            >
              Remove
            </button>
          </div>

          {/* Comments */}
          {need.comments.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-2">Comments</h4>
              <div className="space-y-2">
                {need.comments.map(c => (
                  <div key={c.id} className="bg-neutral-50 rounded p-2 text-sm">
                    <span className="font-medium">{c.author}</span>
                    <span className="text-neutral-400 ml-2 text-xs">{new Date(c.createdAt).toLocaleDateString()}</span>
                    <p className="text-neutral-700 mt-1">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Comment */}
          {commentingId === need.id ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAddComment(need.id)}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-400"
                autoFocus
              />
              <button
                onClick={() => onAddComment(need.id)}
                className="px-3 py-1.5 bg-black text-white rounded-lg text-sm hover:bg-neutral-800"
              >
                Post
              </button>
              <button
                onClick={() => { setCommentingId(null); setCommentText('') }}
                className="px-3 py-1.5 border border-neutral-200 rounded-lg text-sm hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCommentingId(need.id)}
              className="text-sm text-neutral-500 hover:text-neutral-700 flex items-center gap-1"
            >
              <MessageSquare size={14} /> Add comment
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CreateNeedModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    useCase: '',
    category: 'infrastructure',
    priority: 'medium',
    effort: 'medium',
    targetQuarter: '',
    acceptanceCriteria: ''
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.description.trim()) return
    setSaving(true)
    try {
      await fetch('/api/future-needs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          acceptanceCriteria: form.acceptanceCriteria
            ? form.acceptanceCriteria.split('\n').filter(l => l.trim())
            : [],
          proposedBy: 'shawn'
        })
      })
      onCreated()
    } catch (err) {
      console.error('Failed to create need:', err)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <h2 className="text-lg font-semibold">Add Future Need</h2>
          <button onClick={onClose} className="p-1 hover:bg-neutral-100 rounded"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-400"
              placeholder="e.g. Automated Bluesky Posting"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Description *</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-400"
              rows={2}
              placeholder="What needs to be built?"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Use Case</label>
            <textarea
              value={form.useCase}
              onChange={(e) => setForm({ ...form, useCase: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-400"
              rows={2}
              placeholder="Why is this needed? What problem does it solve?"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm bg-white"
              >
                {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm bg-white"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Effort</label>
              <select
                value={form.effort}
                onChange={(e) => setForm({ ...form, effort: e.target.value })}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm bg-white"
              >
                <option value="small">&lt; 1 day</option>
                <option value="medium">1-3 days</option>
                <option value="large">1+ week</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Target Quarter</label>
            <input
              type="text"
              value={form.targetQuarter}
              onChange={(e) => setForm({ ...form, targetQuarter: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-400"
              placeholder="e.g. Q1-2026"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Acceptance Criteria (one per line)</label>
            <textarea
              value={form.acceptanceCriteria}
              onChange={(e) => setForm({ ...form, acceptanceCriteria: e.target.value })}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-neutral-400"
              rows={3}
              placeholder={"API endpoint returns 200 on success\nData persists after restart"}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-neutral-200 rounded-lg text-sm hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.title.trim() || !form.description.trim()}
              className="px-4 py-2 bg-black text-white rounded-lg text-sm hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Need'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
