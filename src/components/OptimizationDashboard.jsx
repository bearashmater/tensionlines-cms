import { useState } from 'react'
import useSWR from 'swr'
import { Zap, AlertTriangle, CheckCircle, Clock, TrendingUp, RefreshCw, Filter, Calendar, ChevronDown, ChevronUp, User, DollarSign, Lightbulb, Bell, ListTodo } from 'lucide-react'

const fetcher = (url) => fetch(url).then(r => r.json())

export default function OptimizationDashboard() {
  const [range, setRange] = useState('week')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [expandedId, setExpandedId] = useState(null)
  const [runningOptimization, setRunningOptimization] = useState(false)

  const { data: stats, mutate: mutateStats } = useSWR('/api/optimizations/stats', fetcher, { refreshInterval: 60000 })
  const { data: runs } = useSWR(`/api/optimizations?range=${range}`, fetcher, { refreshInterval: 60000 })
  const { data: findings, mutate: mutateFindings } = useSWR(
    `/api/optimizations/findings?range=${range}${severityFilter !== 'all' ? `&severity=${severityFilter}` : ''}${statusFilter !== 'all' ? `&status=${statusFilter}` : ''}`,
    fetcher,
    { refreshInterval: 30000 }
  )

  const runOptimization = async () => {
    setRunningOptimization(true)
    try {
      await fetch('/api/optimizations/run', { method: 'POST' })
      mutateStats()
      mutateFindings()
    } catch (err) {
      console.error('Failed to run optimization:', err)
    }
    setRunningOptimization(false)
  }

  const resolveFinding = async (findingId, resolution) => {
    try {
      await fetch(`/api/optimizations/findings/${findingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', resolution })
      })
      mutateFindings()
      mutateStats()
    } catch (err) {
      console.error('Failed to resolve finding:', err)
    }
  }

  const dismissFinding = async (findingId) => {
    try {
      await fetch(`/api/optimizations/findings/${findingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' })
      })
      mutateFindings()
      mutateStats()
    } catch (err) {
      console.error('Failed to dismiss finding:', err)
    }
  }

  if (!stats) {
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
            <Zap className="text-gold" size={32} />
            Optimization Center
          </h1>
          <p className="text-neutral-600 mt-1">
            Nightly project review by Tension • Last run: {stats.lastRunDate ? formatTimeAgo(new Date(stats.lastRunDate)) : 'Never'}
          </p>
        </div>
        <button
          onClick={runOptimization}
          disabled={runningOptimization}
          className="flex items-center gap-2 px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold/90 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={18} className={runningOptimization ? 'animate-spin' : ''} />
          {runningOptimization ? 'Running...' : 'Run Now'}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<TrendingUp size={20} />}
          label="Total Runs"
          value={stats.totalRuns}
          color="blue"
        />
        <StatCard
          icon={<AlertTriangle size={20} />}
          label="Issues Found"
          value={stats.issuesFound}
          color="amber"
        />
        <StatCard
          icon={<CheckCircle size={20} />}
          label="Issues Resolved"
          value={stats.issuesResolved}
          color="green"
        />
        <StatCard
          icon={<Clock size={20} />}
          label="Pending Issues"
          value={stats.pendingIssues}
          subtitle={`${stats.pendingByPriority?.high || 0} high priority`}
          color="red"
        />
      </div>

      {/* Pending Issues by Priority */}
      {stats.pendingIssues > 0 && (
        <div className="card border-l-4 border-l-amber-500 bg-amber-50">
          <h3 className="font-semibold text-amber-800 mb-2">Pending Issues Breakdown</h3>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              <span className="text-sm">{stats.pendingByPriority?.high || 0} High</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              <span className="text-sm">{stats.pendingByPriority?.medium || 0} Medium</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500"></span>
              <span className="text-sm">{stats.pendingByPriority?.low || 0} Low</span>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-neutral-50 rounded-lg">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-neutral-500" />
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm"
          >
            <option value="day">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="year">Last Year</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Filter size={16} className="text-neutral-500" />
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm"
          >
            <option value="all">All Severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <CheckCircle size={16} className="text-neutral-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="monitoring">Monitoring</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
      </div>

      {/* Findings List */}
      <div className="space-y-3">
        <h2 className="text-xl font-serif font-semibold">Findings ({findings?.length || 0})</h2>

        {!findings || findings.length === 0 ? (
          <div className="text-center py-12 text-neutral-500">
            <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
            <p>No findings match your filters</p>
          </div>
        ) : (
          findings.map(finding => (
            <FindingCard
              key={finding.id}
              finding={finding}
              expanded={expandedId === finding.id}
              onToggle={() => setExpandedId(expandedId === finding.id ? null : finding.id)}
              onResolve={(resolution) => resolveFinding(finding.id, resolution)}
              onDismiss={() => dismissFinding(finding.id)}
            />
          ))
        )}
      </div>

      {/* Recent Runs */}
      {runs?.runs && runs.runs.length > 0 && (
        <div className="card">
          <h2 className="text-xl font-serif font-semibold mb-4">Recent Optimization Runs</h2>
          <div className="space-y-2">
            {runs.runs.slice(0, 10).map(run => (
              <div key={run.id} className="flex items-center justify-between py-2 border-b border-neutral-100 last:border-0">
                <div className="flex items-center gap-3">
                  <Zap size={16} className="text-gold" />
                  <span className="text-sm">{new Date(run.date).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-red-600">{run.bySeverity.high} high</span>
                  <span className="text-amber-600">{run.bySeverity.medium} med</span>
                  <span className="text-blue-600">{run.bySeverity.low} low</span>
                  <span className="text-neutral-500">{run.durationMs}ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, subtitle, color }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    amber: 'bg-amber-100 text-amber-600',
    green: 'bg-green-100 text-green-600',
    red: 'bg-red-100 text-red-600'
  }

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-black">{value}</p>
          <p className="text-xs text-neutral-500">{label}</p>
          {subtitle && <p className="text-xs text-red-600">{subtitle}</p>}
        </div>
      </div>
    </div>
  )
}

function FindingCard({ finding, expanded, onToggle, onResolve, onDismiss }) {
  const severityColors = {
    high: 'border-l-red-500 bg-red-50',
    medium: 'border-l-amber-500 bg-amber-50',
    low: 'border-l-blue-500 bg-blue-50'
  }

  const severityBadge = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-blue-100 text-blue-700'
  }

  const typeIcons = {
    stuck_task: <Clock size={18} />,
    slow_task: <Clock size={18} />,
    agent_overload: <User size={18} />,
    agent_idle: <User size={18} />,
    ideas_backlog: <Lightbulb size={18} />,
    cost_overrun: <DollarSign size={18} />,
    blocked_task: <AlertTriangle size={18} />,
    duplicate_task: <ListTodo size={18} />,
    notification_backlog: <Bell size={18} />
  }

  const statusBadge = {
    pending: 'bg-amber-100 text-amber-700',
    monitoring: 'bg-blue-100 text-blue-700',
    resolved: 'bg-green-100 text-green-700',
    dismissed: 'bg-neutral-100 text-neutral-700'
  }

  return (
    <div className={`card border-l-4 ${severityColors[finding.severity]} ${finding.status === 'resolved' || finding.status === 'dismissed' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <div className="p-2 bg-white rounded-lg shadow-sm">
            {typeIcons[finding.type] || <AlertTriangle size={18} />}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-black">{finding.title}</h3>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityBadge[finding.severity]}`}>
                {finding.severity}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge[finding.status]}`}>
                {finding.status}
              </span>
              {finding.forHuman && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                  Needs Human
                </span>
              )}
            </div>
            <p className="text-sm text-neutral-600 mt-1">{finding.description}</p>
            <p className="text-xs text-neutral-400 mt-2">
              {formatTimeAgo(new Date(finding.createdAt))}
              {finding.assignee && ` • Assignee: ${finding.assignee}`}
            </p>
          </div>
        </div>

        <button onClick={onToggle} className="p-1 hover:bg-white rounded">
          {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-neutral-200">
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-neutral-500">Recommendation:</span>
              <p className="text-sm text-neutral-700">{finding.recommendation}</p>
            </div>

            {finding.taskId && (
              <div>
                <span className="text-sm font-medium text-neutral-500">Related Task: </span>
                <span className="text-sm text-neutral-700 font-mono">{finding.taskId}</span>
              </div>
            )}

            {finding.resolution && (
              <div>
                <span className="text-sm font-medium text-neutral-500">Resolution:</span>
                <p className="text-sm text-neutral-700">{finding.resolution}</p>
              </div>
            )}

            {finding.status === 'pending' && (
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => onResolve('Manually resolved')}
                  className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  Mark Resolved
                </button>
                <button
                  onClick={onDismiss}
                  className="px-3 py-1.5 bg-neutral-200 text-neutral-700 text-sm rounded hover:bg-neutral-300"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString()
}
