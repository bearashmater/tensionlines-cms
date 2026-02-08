import { useState, useMemo } from 'react'
import useSWR from 'swr'
import {
  TrendingUp, TrendingDown, Users, DollarSign, FileText, Pencil, Plus,
  Target, CheckCircle2, X, BarChart3, Trophy, ArrowUpRight, ArrowDownRight, Minus, Activity
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

const fetcher = (url) => fetch(url).then(r => r.json())

const PLATFORM_CONFIG = {
  substack: { label: 'Substack', color: '#FF6719', primaryKey: 'subscribers', metrics: ['subscribers', 'freeSubscribers', 'paidSubscribers', 'openRate', 'posts'] },
  twitter: { label: 'Twitter / X', color: '#1DA1F2', primaryKey: 'followers', metrics: ['followers', 'following', 'tweets', 'impressions', 'engagement'] },
  instagram: { label: 'Instagram', color: '#E4405F', primaryKey: 'followers', metrics: ['followers', 'following', 'posts', 'reels'] },
  threads: { label: 'Threads', color: '#000000', primaryKey: 'followers', metrics: ['followers', 'posts', 'likes'] },
  bluesky: { label: 'Bluesky', color: '#0085FF', primaryKey: 'followers', metrics: ['followers', 'following', 'posts'] },
  medium: { label: 'Medium', color: '#00AB6C', primaryKey: 'followers', metrics: ['followers', 'articles', 'views'] },
  reddit: { label: 'Reddit', color: '#FF4500', primaryKey: 'karma', metrics: ['karma', 'posts', 'members'] },
  patreon: { label: 'Patreon', color: '#F96854', primaryKey: 'patrons', metrics: ['patrons', 'monthlyRevenue', 'posts'] },
  website: { label: 'Website', color: '#D4A574', primaryKey: 'monthlyVisitors', metrics: ['monthlyVisitors', 'pageViews', 'avgSessionDuration'] }
}

function formatNumber(n) {
  if (n === null || n === undefined) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toLocaleString()
}

function formatPercent(n) {
  if (n === null || n === undefined) return '0%'
  return Number(n).toFixed(1) + '%'
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function formatMetricLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
}

function ChangeIndicator({ value, suffix = '' }) {
  if (value === 0 || value === undefined || value === null) {
    return <span className="text-neutral-400 text-sm flex items-center gap-0.5"><Minus size={14} /> No change</span>
  }
  if (value > 0) {
    return <span className="text-green-600 text-sm flex items-center gap-0.5"><ArrowUpRight size={14} />+{formatNumber(value)}{suffix}</span>
  }
  return <span className="text-red-500 text-sm flex items-center gap-0.5"><ArrowDownRight size={14} />{formatNumber(value)}{suffix}</span>
}

// ─── Edit Platform Modal ─────────────────────────────────────────────────────

function EditPlatformModal({ platform, currentMetrics, onClose, onSave }) {
  const config = PLATFORM_CONFIG[platform]
  const [values, setValues] = useState(() => {
    const init = {}
    config.metrics.forEach(k => { init[k] = currentMetrics[k] || 0 })
    return init
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/analytics/platforms/${platform}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
      if (res.ok) {
        onSave()
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-serif font-bold">Edit {config.label}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {config.metrics.map(key => (
            <div key={key}>
              <label className="block text-sm font-medium text-neutral-700 mb-1">{formatMetricLabel(key)}</label>
              <input
                type="number"
                step="any"
                value={values[key]}
                onChange={e => setValues({ ...values, [key]: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="btn flex-1">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Edit Revenue Modal ──────────────────────────────────────────────────────

function EditRevenueModal({ onClose, onSave, existingEntries }) {
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(defaultMonth)
  const [values, setValues] = useState(() => {
    const existing = (existingEntries || []).find(e => e.month === defaultMonth)
    return {
      substack: existing?.substack || 0,
      gumroad: existing?.gumroad || 0,
      patreon: existing?.patreon || 0,
      amazon: existing?.amazon || 0,
      other: existing?.other || 0
    }
  })
  const [saving, setSaving] = useState(false)

  function handleMonthChange(m) {
    setMonth(m)
    const existing = (existingEntries || []).find(e => e.month === m)
    if (existing) {
      setValues({
        substack: existing.substack || 0,
        gumroad: existing.gumroad || 0,
        patreon: existing.patreon || 0,
        amazon: existing.amazon || 0,
        other: existing.other || 0
      })
    } else {
      setValues({ substack: 0, gumroad: 0, patreon: 0, amazon: 0, other: 0 })
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/analytics/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, ...values })
      })
      if (res.ok) {
        onSave()
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  const sources = ['substack', 'gumroad', 'patreon', 'amazon', 'other']

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-serif font-bold">Revenue Entry</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Month</label>
            <input
              type="month"
              value={month}
              onChange={e => handleMonthChange(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gold/50"
            />
          </div>
          {sources.map(src => (
            <div key={src}>
              <label className="block text-sm font-medium text-neutral-700 mb-1 capitalize">{src}</label>
              <input
                type="number"
                step="0.01"
                value={values[src]}
                onChange={e => setValues({ ...values, [src]: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={onClose} className="btn flex-1">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Add Goal Modal ──────────────────────────────────────────────────────────

function AddGoalModal({ onClose, onSave }) {
  const [type, setType] = useState('progress')
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState(0)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const body = { type, title: title.trim() }
      if (type === 'progress') body.target = target
      if (type === 'status') body.value = value
      const res = await fetch('/api/analytics/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (res.ok) {
        onSave()
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-serif font-bold">Add Goal</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gold/50"
            >
              <option value="progress">Progress (target number)</option>
              <option value="status">Status (text value)</option>
              <option value="milestone">Milestone (achieved/not)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. 1,000 Substack Subscribers"
              className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gold/50"
            />
          </div>
          {type === 'progress' && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Target</label>
              <input
                type="number"
                value={target}
                onChange={e => setTarget(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>
          )}
          {type === 'status' && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Current Status</label>
              <input
                type="text"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="e.g. Outlining"
                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving || !title.trim()} className="btn btn-primary flex-1">
              {saving ? 'Adding...' : 'Add Goal'}
            </button>
            <button type="button" onClick={onClose} className="btn flex-1">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Analytics Component ────────────────────────────────────────────────

export default function Analytics() {
  const { data: analytics, mutate: mutateAnalytics } = useSWR('/api/analytics', fetcher, { refreshInterval: 60000 })
  const { data: engagement } = useSWR('/api/content/engagement?range=month', fetcher, { refreshInterval: 60000 })
  const { data: engagementTrends } = useSWR('/api/engagement-trends', fetcher, { refreshInterval: 60000 })

  const [timeRange, setTimeRange] = useState('30d')
  const [engagementRange, setEngagementRange] = useState('month')
  const [editingPlatform, setEditingPlatform] = useState(null)
  const [showRevenueModal, setShowRevenueModal] = useState(false)
  const [showGoalModal, setShowGoalModal] = useState(false)
  const [contentSort, setContentSort] = useState({ key: 'publishedAt', dir: 'desc' })

  const summary = analytics?.summary || {}
  const platforms = analytics?.platforms || {}
  const revenue = analytics?.revenue || { monthlyTarget: 500, yearlyTarget: 6000, entries: [] }
  const goals = analytics?.goals || []

  // ─── Growth Chart Data ───────────────────────────────────────────────────

  const growthData = useMemo(() => {
    if (!platforms || Object.keys(platforms).length === 0) return []

    const now = new Date()
    let daysBack = 30
    if (timeRange === '7d') daysBack = 7
    else if (timeRange === '90d') daysBack = 90
    else if (timeRange === 'all') daysBack = 365

    const cutoff = new Date(now - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Gather all dates across all platforms
    const dateMap = {}
    for (const [platform, info] of Object.entries(platforms)) {
      const config = PLATFORM_CONFIG[platform]
      if (!config || !info.history) continue
      for (const snap of info.history) {
        if (snap.date < cutoff) continue
        if (!dateMap[snap.date]) dateMap[snap.date] = { date: snap.date }
        dateMap[snap.date][platform] = snap[config.primaryKey] || 0
      }
    }

    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date))
  }, [platforms, timeRange])

  // ─── Revenue Chart Data ──────────────────────────────────────────────────

  const revenueChartData = useMemo(() => {
    return (revenue.entries || []).map(e => ({
      month: e.month,
      Substack: e.substack || 0,
      Gumroad: e.gumroad || 0,
      Patreon: e.patreon || 0,
      Amazon: e.amazon || 0,
      Other: e.other || 0,
      total: (e.substack || 0) + (e.gumroad || 0) + (e.patreon || 0) + (e.amazon || 0) + (e.other || 0)
    }))
  }, [revenue.entries])

  const cumulativeData = useMemo(() => {
    let running = 0
    return revenueChartData.map(e => {
      running += e.total
      return { month: e.month, cumulative: running }
    })
  }, [revenueChartData])

  // ─── Content Performance Data ────────────────────────────────────────────

  const contentData = useMemo(() => {
    const posts = engagement?.posts || []
    const sorted = [...posts].sort((a, b) => {
      const key = contentSort.key
      let aVal = a[key] || 0
      let bVal = b[key] || 0
      if (key === 'publishedAt') {
        aVal = new Date(aVal).getTime()
        bVal = new Date(bVal).getTime()
      }
      if (key === 'engagementRate') {
        const aImps = a.impressions || 1
        const bImps = b.impressions || 1
        aVal = ((a.likes || 0) + (a.comments || 0) + (a.shares || 0)) / aImps
        bVal = ((b.likes || 0) + (b.comments || 0) + (b.shares || 0)) / bImps
      }
      return contentSort.dir === 'desc' ? bVal - aVal : aVal - bVal
    })
    return sorted
  }, [engagement?.posts, contentSort])

  // ─── Engagement Trends Data ─────────────────────────────────────────────

  const engagementChartData = useMemo(() => {
    if (!engagementTrends) return { data: [], chartType: 'bar' }

    const now = new Date()
    const useWeekly = engagementRange === 'quarter' || engagementRange === 'all'

    if (useWeekly) {
      let data = engagementTrends.weekly || []
      if (engagementRange === 'quarter') {
        const cutoff = new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        data = data.filter(d => d.weekStart >= cutoff)
      }
      return { data, chartType: 'line' }
    }

    let data = engagementTrends.daily || []
    if (engagementRange === 'week') {
      const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      data = data.filter(d => d.date >= cutoff)
    } else if (engagementRange === 'month') {
      const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      data = data.filter(d => d.date >= cutoff)
    }
    return { data, chartType: 'bar' }
  }, [engagementTrends, engagementRange])

  // Sort handler
  function handleContentSort(key) {
    setContentSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc'
    }))
  }

  // Goal actions
  async function toggleGoalAchieved(goal) {
    await fetch(`/api/analytics/goals/${goal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ achieved: !goal.achieved })
    })
    mutateAnalytics()
  }

  async function deleteGoal(id) {
    await fetch(`/api/analytics/goals/${id}`, { method: 'DELETE' })
    mutateAnalytics()
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Analytics</h1>
        <p className="text-neutral-600 mt-1">Platform metrics, revenue, and growth</p>
      </div>

      {/* ── Section 1: Summary KPIs ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Total Audience', value: formatNumber(summary.totalAudience), change: summary.totalAudienceChange, icon: Users, color: 'text-blue-600' },
          { label: 'Substack Subs', value: formatNumber(summary.substackSubscribers), change: null, icon: FileText, color: 'text-orange-600' },
          { label: 'Weekly Growth', value: formatPercent(summary.weeklyGrowth), change: summary.weeklyGrowthChange, icon: TrendingUp, color: 'text-green-600' },
          { label: 'Monthly Revenue', value: formatCurrency(summary.monthlyRevenue), change: summary.monthlyRevenueChange, icon: DollarSign, color: 'text-gold' },
          { label: 'Content This Week', value: summary.contentThisWeek || 0, change: summary.contentThisWeekChange, icon: BarChart3, color: 'text-purple-600' }
        ].map(kpi => (
          <div key={kpi.label} className="card !p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-neutral-500 uppercase tracking-wider">{kpi.label}</span>
              <kpi.icon size={16} className={kpi.color} />
            </div>
            <div className="text-2xl font-bold text-black">{kpi.value}</div>
            {kpi.change !== null && kpi.change !== undefined && <ChangeIndicator value={kpi.change} />}
          </div>
        ))}
      </div>

      {/* ── Section 2: Platform Metrics Grid ────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-serif font-bold text-black mb-4">Platform Metrics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(PLATFORM_CONFIG).map(([key, config]) => {
            const info = platforms[key] || { current: {} }
            const current = info.current || {}
            const primaryValue = current[config.primaryKey] || 0
            const secondaryMetrics = config.metrics.filter(m => m !== config.primaryKey)

            return (
              <div key={key} className="card !p-4" style={{ borderLeft: `4px solid ${config.color}` }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-black">{config.label}</h3>
                  <button
                    onClick={() => setEditingPlatform(key)}
                    className="text-neutral-400 hover:text-neutral-600 p-1"
                    title={`Edit ${config.label}`}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
                <div className="text-2xl font-bold" style={{ color: config.color }}>
                  {formatNumber(primaryValue)}
                </div>
                <div className="text-xs text-neutral-500 mb-2">{formatMetricLabel(config.primaryKey)}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {secondaryMetrics.slice(0, 4).map(m => (
                    <div key={m} className="text-xs text-neutral-600">
                      <span className="text-neutral-400">{formatMetricLabel(m)}:</span> {formatNumber(current[m])}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 3: Revenue Tracker ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-bold text-black">Revenue</h2>
          <button onClick={() => setShowRevenueModal(true)} className="btn btn-primary !py-1.5 !px-3 text-sm">
            <Plus size={14} className="mr-1 inline" /> Add Entry
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Stacked bar chart */}
          <div className="card">
            <h3 className="text-sm font-medium text-neutral-700 mb-3">Monthly Revenue by Source</h3>
            {revenueChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E3DC" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '$' + v} />
                  <Tooltip formatter={v => '$' + v} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Substack" stackId="a" fill="#FF6719" />
                  <Bar dataKey="Gumroad" stackId="a" fill="#36B37E" />
                  <Bar dataKey="Patreon" stackId="a" fill="#F96854" />
                  <Bar dataKey="Amazon" stackId="a" fill="#FF9900" />
                  <Bar dataKey="Other" stackId="a" fill="#D4A574" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-neutral-400 text-center py-12 text-sm">No revenue entries yet. Click "Add Entry" to start tracking.</p>
            )}
          </div>

          {/* Right column: cumulative + progress */}
          <div className="space-y-4">
            <div className="card">
              <h3 className="text-sm font-medium text-neutral-700 mb-3">Cumulative YTD</h3>
              {cumulativeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={140}>
                  <AreaChart data={cumulativeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E3DC" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '$' + v} />
                    <Tooltip formatter={v => '$' + v} />
                    <Area type="monotone" dataKey="cumulative" stroke="#D4A574" fill="#D4A574" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-neutral-400 text-center py-8 text-sm">No data yet</p>
              )}
            </div>
            <div className="card !p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-neutral-700">Monthly Target</h3>
                <span className="text-sm font-bold text-black">{formatCurrency(summary.monthlyRevenue)} / {formatCurrency(revenue.monthlyTarget)}</span>
              </div>
              <div className="w-full bg-neutral-200 rounded-full h-3">
                <div
                  className="bg-gold rounded-full h-3 transition-all duration-500"
                  style={{ width: `${Math.min(100, revenue.monthlyTarget > 0 ? (summary.monthlyRevenue || 0) / revenue.monthlyTarget * 100 : 0)}%` }}
                />
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                {revenue.monthlyTarget > 0
                  ? `${Math.round((summary.monthlyRevenue || 0) / revenue.monthlyTarget * 100)}% of target`
                  : 'No target set'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 4: Content Performance ──────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-serif font-bold text-black mb-4">Content Performance</h2>
        <div className="card overflow-x-auto">
          {contentData.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500 border-b border-neutral-200">
                  {[
                    { key: 'publishedAt', label: 'Date' },
                    { key: 'title', label: 'Title' },
                    { key: 'platform', label: 'Platform' },
                    { key: 'type', label: 'Type' },
                    { key: 'impressions', label: 'Reach' },
                    { key: 'likes', label: 'Engagement' },
                    { key: 'engagementRate', label: 'Rate' }
                  ].map(col => (
                    <th
                      key={col.key}
                      className="pb-2 pr-4 cursor-pointer hover:text-neutral-800 select-none"
                      onClick={() => handleContentSort(col.key)}
                    >
                      {col.label}
                      {contentSort.key === col.key && (contentSort.dir === 'desc' ? ' \u2193' : ' \u2191')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contentData.map((post, i) => {
                  const eng = (post.likes || 0) + (post.comments || 0) + (post.shares || 0)
                  const rate = post.impressions > 0 ? (eng / post.impressions * 100) : 0
                  const isTop = i < 3
                  return (
                    <tr
                      key={post.id || i}
                      className={`border-b border-neutral-100 hover:bg-neutral-50 ${isTop ? 'border-l-4 border-l-gold' : ''}`}
                    >
                      <td className="py-2 pr-4 text-neutral-500">{formatDate(post.publishedAt)}</td>
                      <td className="py-2 pr-4 font-medium text-black max-w-[200px] truncate">{post.title || post.preview || '—'}</td>
                      <td className="py-2 pr-4 capitalize">{post.platform || '—'}</td>
                      <td className="py-2 pr-4 capitalize text-neutral-600">{post.type || '—'}</td>
                      <td className="py-2 pr-4">{formatNumber(post.impressions)}</td>
                      <td className="py-2 pr-4">{formatNumber(eng)}</td>
                      <td className="py-2 pr-4">{formatPercent(rate)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-neutral-400 text-center py-8 text-sm">No content engagement data yet. Post tracking data will appear here.</p>
          )}
        </div>
      </div>

      {/* ── Section 4.5: Engagement Trends ────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-bold text-black">Engagement Trends</h2>
          <div className="flex gap-1">
            {[
              { key: 'week', label: 'Week' },
              { key: 'month', label: 'Month' },
              { key: 'quarter', label: 'Quarter' },
              { key: 'all', label: 'All' }
            ].map(r => (
              <button
                key={r.key}
                onClick={() => setEngagementRange(r.key)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  engagementRange === r.key ? 'bg-gold text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          {engagementChartData.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              {engagementChartData.chartType === 'bar' ? (
                <BarChart data={engagementChartData.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E3DC" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => formatDate(d)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip labelFormatter={d => formatDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="bluesky_out" name="Bluesky" stackId="out" fill="#0085FF" />
                  <Bar dataKey="twitter_out" name="Twitter" stackId="out" fill="#1DA1F2" />
                  <Bar dataKey="instagram_out" name="Instagram" stackId="out" fill="#E4405F" />
                  <Bar dataKey="threads_out" name="Threads" stackId="out" fill="#000000" />
                  <Line type="monotone" dataKey="bluesky_in" name="Incoming (Bluesky)" stroke="#0085FF" strokeDasharray="5 5" dot={false} />
                  <Line type="monotone" dataKey="twitter_in" name="Incoming (Twitter)" stroke="#1DA1F2" strokeDasharray="5 5" dot={false} />
                </BarChart>
              ) : (
                <LineChart data={engagementChartData.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E3DC" />
                  <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} tickFormatter={d => formatDate(d)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip labelFormatter={d => formatDate(d)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="bluesky_out" name="Bluesky" stroke="#0085FF" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="twitter_out" name="Twitter" stroke="#1DA1F2" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="instagram_out" name="Instagram" stroke="#E4405F" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="threads_out" name="Threads" stroke="#000000" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              )}
            </ResponsiveContainer>
          ) : (
            <p className="text-neutral-400 text-center py-12 text-sm">
              Engagement trends will appear as you publish content and receive engagement.
            </p>
          )}
        </div>

        {/* Mini stat badges */}
        {engagementTrends?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div className="card !p-3 text-center">
              <div className="text-xs text-neutral-500 uppercase tracking-wider">Total Activity</div>
              <div className="text-xl font-bold text-black">{engagementTrends.summary.totalActivity}</div>
            </div>
            <div className="card !p-3 text-center">
              <div className="text-xs text-neutral-500 uppercase tracking-wider">Top Platform</div>
              <div className="text-xl font-bold capitalize" style={{ color: PLATFORM_CONFIG[Object.entries(engagementTrends.summary.byPlatform || {}).sort((a, b) => b[1] - a[1])[0]?.[0]]?.color || '#000' }}>
                {Object.entries(engagementTrends.summary.byPlatform || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'}
              </div>
            </div>
            <div className="card !p-3 text-center">
              <div className="text-xs text-neutral-500 uppercase tracking-wider">Posts / Replies</div>
              <div className="text-xl font-bold text-black">
                {engagementTrends.summary.byType?.post || 0} / {engagementTrends.summary.byType?.reply || 0}
              </div>
            </div>
            <div className="card !p-3 text-center">
              <div className="text-xs text-neutral-500 uppercase tracking-wider">Active Days</div>
              <div className="text-xl font-bold text-black">{engagementTrends.summary.activeDays}</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 5: Growth Chart ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-bold text-black">Growth</h2>
          <div className="flex gap-1">
            {['7d', '30d', '90d', 'all'].map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  timeRange === range ? 'bg-gold text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {range === 'all' ? 'All' : range}
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          {growthData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={growthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E3DC" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => formatDate(d)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={d => formatDate(d)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {Object.entries(PLATFORM_CONFIG).map(([key, config]) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={config.label}
                    stroke={config.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-neutral-400 text-center py-12 text-sm">
              Growth chart will populate as platform metrics are updated over time.
            </p>
          )}
        </div>
      </div>

      {/* ── Section 6: Goals & Milestones ───────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-bold text-black">Goals & Milestones</h2>
          <button onClick={() => setShowGoalModal(true)} className="btn btn-primary !py-1.5 !px-3 text-sm">
            <Plus size={14} className="mr-1 inline" /> Add Goal
          </button>
        </div>
        <div className="space-y-3">
          {goals.length > 0 ? goals.map(goal => (
            <div key={goal.id} className={`card !p-4 ${goal.achieved ? 'bg-gold/5 border-gold/30' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {goal.type === 'milestone' ? (
                    <button
                      onClick={() => toggleGoalAchieved(goal)}
                      className={`flex-shrink-0 ${goal.achieved ? 'text-gold' : 'text-neutral-300 hover:text-neutral-400'}`}
                    >
                      <CheckCircle2 size={20} />
                    </button>
                  ) : goal.type === 'progress' ? (
                    <Target size={20} className="text-blue-500 flex-shrink-0" />
                  ) : (
                    <Trophy size={20} className="text-purple-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className={`font-medium ${goal.achieved ? 'line-through text-neutral-400' : 'text-black'}`}>
                      {goal.title}
                    </h4>
                    {goal.type === 'progress' && (
                      <div className="mt-1">
                        <div className="flex items-center justify-between text-xs text-neutral-500 mb-1">
                          <span>{formatNumber(goal.current || 0)} / {formatNumber(goal.target)}</span>
                          <span>{goal.target > 0 ? Math.round((goal.current || 0) / goal.target * 100) : 0}%</span>
                        </div>
                        <div className="w-full bg-neutral-200 rounded-full h-2">
                          <div
                            className="bg-blue-500 rounded-full h-2 transition-all duration-500"
                            style={{ width: `${Math.min(100, goal.target > 0 ? (goal.current || 0) / goal.target * 100 : 0)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {goal.type === 'status' && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                        {goal.value || 'Not set'}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteGoal(goal.id)}
                  className="text-neutral-300 hover:text-red-500 ml-2 flex-shrink-0"
                  title="Delete goal"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )) : (
            <div className="card">
              <p className="text-neutral-400 text-center py-8 text-sm">No goals yet. Click "Add Goal" to set your first target.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {editingPlatform && (
        <EditPlatformModal
          platform={editingPlatform}
          currentMetrics={platforms[editingPlatform]?.current || {}}
          onClose={() => setEditingPlatform(null)}
          onSave={() => mutateAnalytics()}
        />
      )}
      {showRevenueModal && (
        <EditRevenueModal
          existingEntries={revenue.entries}
          onClose={() => setShowRevenueModal(false)}
          onSave={() => mutateAnalytics()}
        />
      )}
      {showGoalModal && (
        <AddGoalModal
          onClose={() => setShowGoalModal(false)}
          onSave={() => mutateAnalytics()}
        />
      )}
    </div>
  )
}
