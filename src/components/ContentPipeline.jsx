import useSWR from 'swr'
import { useState, useMemo } from 'react'
import { getIdeas, getDrafts, getIdeaStats } from '../lib/api'
import { formatDate, getStatusColor } from '../lib/formatters'
import { Lightbulb, FileText, TrendingUp, Target, Flame, Calendar, CheckCircle, Clock, AlertTriangle, Search, Filter, Grid, List, ChevronDown, ChevronUp, Tag, X } from 'lucide-react'

export default function ContentPipeline() {
  const { data: ideas } = useSWR('/ideas', getIdeas, { refreshInterval: 120000 })
  const { data: drafts } = useSWR('/drafts', getDrafts, { refreshInterval: 120000 })
  const { data: stats } = useSWR('/api/ideas/stats',
    () => fetch('/api/ideas/stats').then(r => r.json()),
    { refreshInterval: 60000 }
  )

  if (!ideas || !drafts) return <LoadingState />

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Content Pipeline</h1>
        <p className="text-neutral-600 mt-1">Ideas → Drafts → Published</p>
      </div>

      {/* Idea Stats Dashboard */}
      {stats && <IdeaStatsDashboard stats={stats} />}

      {/* Ideas Section - Full Featured */}
      <IdeasBrowser ideas={ideas} />

      {/* Drafts Section */}
      <div>
        <h2 className="text-xl font-serif font-semibold mb-4 flex items-center">
          <FileText size={24} className="mr-2 text-gold" />
          Drafts ({drafts.length})
        </h2>
        <div className="space-y-3">
          {drafts.slice(0, 8).map(draft => (
            <DraftCard key={draft.filename} draft={draft} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// IDEA STATS DASHBOARD
// ============================================================================

function IdeaStatsDashboard({ stats }) {
  const progressPercent = Math.min(100, (stats.weeklyProgress / stats.weeklyGoal) * 100)
  const isOnTrack = stats.weeklyProgress >= stats.weeklyGoal
  const remaining = Math.max(0, stats.weeklyGoal - stats.weeklyProgress)

  return (
    <div className="space-y-4">
      {/* Weekly Goal Card */}
      <div className={`card border-2 ${isOnTrack ? 'border-green-500 bg-green-50' : 'border-amber-500 bg-amber-50'}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-full ${isOnTrack ? 'bg-green-500' : 'bg-amber-500'}`}>
              {isOnTrack ? <CheckCircle size={24} className="text-white" /> : <Target size={24} className="text-white" />}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-black">Weekly Idea Goal</h3>
              <p className={`text-sm ${isOnTrack ? 'text-green-700' : 'text-amber-700'}`}>
                {isOnTrack
                  ? `Great job! You've hit your goal this week!`
                  : `${remaining} more idea${remaining === 1 ? '' : 's'} needed this week`}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-4xl font-bold ${isOnTrack ? 'text-green-600' : 'text-amber-600'}`}>
              {stats.weeklyProgress}/{stats.weeklyGoal}
            </div>
            <div className="text-sm text-neutral-500">ideas this week</div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-white rounded-full h-4 overflow-hidden">
          <div
            className={`h-4 rounded-full transition-all duration-500 ${isOnTrack ? 'bg-green-500' : 'bg-amber-500'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Streak */}
        {stats.streak > 0 && (
          <div className="flex items-center gap-2 mt-3 text-sm">
            <Flame size={16} className="text-orange-500" />
            <span className="font-medium text-orange-600">{stats.streak} week streak!</span>
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Calendar size={20} />}
          label="Today"
          value={stats.today}
          color="blue"
        />
        <StatCard
          icon={<TrendingUp size={20} />}
          label="This Month"
          value={stats.thisMonth}
          color="purple"
        />
        <StatCard
          icon={<Lightbulb size={20} />}
          label="This Year"
          value={stats.thisYear}
          color="amber"
        />
        <StatCard
          icon={<CheckCircle size={20} />}
          label="Total Ideas"
          value={stats.total}
          color="green"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily Chart (Last 14 days) */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar size={18} className="text-blue-600" />
            Last 14 Days
          </h3>
          <DailyChart dailyCounts={stats.dailyCounts} />
        </div>

        {/* Status Breakdown */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-purple-600" />
            Idea Status
          </h3>
          <StatusBreakdown byStatus={stats.byStatus} total={stats.total} />
        </div>
      </div>

      {/* Weekly Performance */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Target size={18} className="text-gold" />
          Weekly Performance
        </h3>
        <WeeklyChart weeklyCounts={stats.weeklyCounts} goal={stats.weeklyGoal} />
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
    amber: 'bg-amber-100 text-amber-600',
    green: 'bg-green-100 text-green-600'
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
        </div>
      </div>
    </div>
  )
}

function DailyChart({ dailyCounts }) {
  // Get last 14 days
  const days = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    days.push({
      date: dateStr,
      count: dailyCounts[dateStr] || 0,
      label: d.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0),
      dayNum: d.getDate()
    })
  }

  const maxCount = Math.max(1, ...days.map(d => d.count))

  return (
    <div className="flex items-end justify-between gap-1 h-32">
      {days.map((day, i) => (
        <div key={i} className="flex flex-col items-center flex-1">
          <div
            className={`w-full rounded-t transition-all ${day.count > 0 ? 'bg-blue-500' : 'bg-neutral-200'}`}
            style={{ height: `${Math.max(4, (day.count / maxCount) * 100)}%` }}
            title={`${day.date}: ${day.count} ideas`}
          />
          <span className="text-xs text-neutral-500 mt-1">{day.label}</span>
          {i === days.length - 1 && (
            <span className="text-xs text-neutral-400">{day.dayNum}</span>
          )}
        </div>
      ))}
    </div>
  )
}

function WeeklyChart({ weeklyCounts, goal }) {
  // Get last 8 weeks
  const weeks = Object.entries(weeklyCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)

  if (weeks.length === 0) {
    return <p className="text-neutral-500 text-center py-4">No weekly data yet</p>
  }

  const maxCount = Math.max(goal, ...weeks.map(w => w[1]))

  return (
    <div className="space-y-2">
      {weeks.map(([week, count]) => {
        const percent = (count / maxCount) * 100
        const metGoal = count >= goal
        return (
          <div key={week} className="flex items-center gap-3">
            <span className="text-xs text-neutral-500 w-16 font-mono">{week}</span>
            <div className="flex-1 bg-neutral-100 rounded-full h-6 overflow-hidden relative">
              <div
                className={`h-6 rounded-full transition-all ${metGoal ? 'bg-green-500' : 'bg-amber-500'}`}
                style={{ width: `${percent}%` }}
              />
              {/* Goal line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-neutral-400"
                style={{ left: `${(goal / maxCount) * 100}%` }}
              />
            </div>
            <span className={`text-sm font-semibold w-8 ${metGoal ? 'text-green-600' : 'text-amber-600'}`}>
              {count}
            </span>
            {metGoal && <CheckCircle size={16} className="text-green-500" />}
          </div>
        )
      })}
      <p className="text-xs text-neutral-500 mt-2">Goal: {goal} ideas per week (marked by line)</p>
    </div>
  )
}

function StatusBreakdown({ byStatus, total }) {
  const statuses = [
    { key: 'captured', label: 'Captured', color: 'bg-blue-500', emoji: '🔵' },
    { key: 'assigned', label: 'Organizing', color: 'bg-yellow-500', emoji: '🟡' },
    { key: 'drafted', label: 'In Creation', color: 'bg-orange-500', emoji: '🟠' },
    { key: 'shipped', label: 'Published', color: 'bg-green-500', emoji: '🟢' }
  ]

  return (
    <div className="space-y-3">
      {statuses.map(status => {
        const count = byStatus[status.key] || 0
        const percent = total > 0 ? (count / total) * 100 : 0
        return (
          <div key={status.key} className="flex items-center gap-3">
            <span className="text-sm">{status.emoji}</span>
            <span className="text-sm text-neutral-700 w-24">{status.label}</span>
            <div className="flex-1 bg-neutral-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full ${status.color}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-sm font-semibold w-8 text-right">{count}</span>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// IDEAS BROWSER - Full Featured Ideas Management
// ============================================================================

function IdeasBrowser({ ideas }) {
  const [viewMode, setViewMode] = useState('table') // 'table' | 'grid' | 'compact'
  const [statusFilter, setStatusFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState(null)
  const [dateFilter, setDateFilter] = useState('all') // 'all' | 'today' | 'week' | 'month' | 'year'
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('date') // 'date' | 'id' | 'status'
  const [sortDir, setSortDir] = useState('desc')
  const [expandedId, setExpandedId] = useState(null)
  const [selectedIdea, setSelectedIdea] = useState(null) // For detail modal
  const [page, setPage] = useState(1)
  const perPage = 20

  // Get all unique tags
  const allTags = useMemo(() => {
    const tags = new Set()
    ideas.forEach(idea => {
      idea.tags?.forEach(tag => tags.add(tag))
    })
    return Array.from(tags).sort()
  }, [ideas])

  // Get date range boundaries
  const dateRanges = useMemo(() => {
    const now = new Date()
    const today = now.toISOString().split('T')[0]

    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const yearStart = new Date(now.getFullYear(), 0, 1)

    return {
      today,
      week: weekStart.toISOString().split('T')[0],
      month: monthStart.toISOString().split('T')[0],
      year: yearStart.toISOString().split('T')[0]
    }
  }, [])

  // Filter and sort ideas
  const filteredIdeas = useMemo(() => {
    let result = [...ideas]

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(i => i.status === statusFilter)
    }

    // Tag filter
    if (tagFilter) {
      result = result.filter(i => i.tags?.includes(tagFilter))
    }

    // Date filter
    if (dateFilter !== 'all' && dateRanges[dateFilter]) {
      result = result.filter(i => i.date && i.date >= dateRanges[dateFilter])
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(i =>
        i.text?.toLowerCase().includes(q) ||
        i.quote?.toLowerCase().includes(q) ||
        i.tags?.some(t => t.toLowerCase().includes(q)) ||
        i.id?.includes(q)
      )
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'date') {
        cmp = (a.date || '').localeCompare(b.date || '')
      } else if (sortBy === 'id') {
        cmp = parseInt(a.id) - parseInt(b.id)
      } else if (sortBy === 'status') {
        const statusOrder = { captured: 0, assigned: 1, drafted: 2, shipped: 3 }
        cmp = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0)
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return result
  }, [ideas, statusFilter, tagFilter, dateFilter, searchQuery, sortBy, sortDir, dateRanges])

  // Pagination
  const totalPages = Math.ceil(filteredIdeas.length / perPage)
  const paginatedIdeas = filteredIdeas.slice((page - 1) * perPage, page * perPage)

  // Status counts
  const statusCounts = useMemo(() => ({
    all: ideas.length,
    captured: ideas.filter(i => i.status === 'captured').length,
    assigned: ideas.filter(i => i.status === 'assigned').length,
    drafted: ideas.filter(i => i.status === 'drafted').length,
    shipped: ideas.filter(i => i.status === 'shipped').length
  }), [ideas])

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  const clearFilters = () => {
    setStatusFilter('all')
    setTagFilter(null)
    setDateFilter('all')
    setSearchQuery('')
    setPage(1)
  }

  const hasActiveFilters = statusFilter !== 'all' || tagFilter || dateFilter !== 'all' || searchQuery

  return (
    <div className="card">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Lightbulb size={24} className="text-gold" />
          <h2 className="text-xl font-serif font-semibold">Ideas Bank</h2>
          <span className="text-neutral-500">({filteredIdeas.length} of {ideas.length})</span>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 rounded ${viewMode === 'table' ? 'bg-gold text-white' : 'bg-neutral-100 hover:bg-neutral-200'}`}
            title="Table view"
          >
            <List size={18} />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded ${viewMode === 'grid' ? 'bg-gold text-white' : 'bg-neutral-100 hover:bg-neutral-200'}`}
            title="Grid view"
          >
            <Grid size={18} />
          </button>
          <button
            onClick={() => setViewMode('compact')}
            className={`p-2 rounded ${viewMode === 'compact' ? 'bg-gold text-white' : 'bg-neutral-100 hover:bg-neutral-200'}`}
            title="Compact view"
          >
            <Filter size={18} />
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-4 bg-neutral-50 rounded-lg">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
            placeholder="Search ideas..."
            className="w-full pl-9 pr-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="all">All Status ({statusCounts.all})</option>
          <option value="captured">🔵 Captured ({statusCounts.captured})</option>
          <option value="assigned">🟡 Organizing ({statusCounts.assigned})</option>
          <option value="drafted">🟠 Drafting ({statusCounts.drafted})</option>
          <option value="shipped">🟢 Shipped ({statusCounts.shipped})</option>
        </select>

        {/* Date Filter */}
        <select
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
        </select>

        {/* Tag Filter */}
        <select
          value={tagFilter || ''}
          onChange={(e) => { setTagFilter(e.target.value || null); setPage(1) }}
          className="px-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="">All Tags</option>
          {allTags.map(tag => (
            <option key={tag} value={tag}>#{tag}</option>
          ))}
        </select>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
          >
            <X size={14} />
            Clear
          </button>
        )}
      </div>

      {/* Active Filters Pills */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 mb-4">
          {statusFilter !== 'all' && (
            <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm flex items-center gap-1">
              Status: {statusFilter}
              <button onClick={() => setStatusFilter('all')} className="hover:text-blue-900"><X size={12} /></button>
            </span>
          )}
          {tagFilter && (
            <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm flex items-center gap-1">
              Tag: #{tagFilter}
              <button onClick={() => setTagFilter(null)} className="hover:text-purple-900"><X size={12} /></button>
            </span>
          )}
          {dateFilter !== 'all' && (
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm flex items-center gap-1">
              Date: {dateFilter}
              <button onClick={() => setDateFilter('all')} className="hover:text-green-900"><X size={12} /></button>
            </span>
          )}
          {searchQuery && (
            <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm flex items-center gap-1">
              Search: "{searchQuery}"
              <button onClick={() => setSearchQuery('')} className="hover:text-amber-900"><X size={12} /></button>
            </span>
          )}
        </div>
      )}

      {/* Ideas Display */}
      {filteredIdeas.length === 0 ? (
        <div className="text-center py-12 text-neutral-500">
          <Lightbulb size={48} className="mx-auto mb-4 opacity-30" />
          <p>No ideas match your filters</p>
        </div>
      ) : viewMode === 'table' ? (
        <IdeasTable
          ideas={paginatedIdeas}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={toggleSort}
          expandedId={expandedId}
          onExpand={setExpandedId}
          onTagClick={(tag) => { setTagFilter(tag); setPage(1) }}
          onViewDetails={setSelectedIdea}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedIdeas.map(idea => (
            <IdeaCard key={idea.id} idea={idea} onTagClick={(tag) => { setTagFilter(tag); setPage(1) }} />
          ))}
        </div>
      ) : (
        <IdeasCompact ideas={paginatedIdeas} onTagClick={(tag) => { setTagFilter(tag); setPage(1) }} />
      )}

      {/* Idea Detail Modal */}
      {selectedIdea && (
        <IdeaDetailModal
          idea={selectedIdea}
          onClose={() => setSelectedIdea(null)}
          onTagClick={(tag) => { setTagFilter(tag); setPage(1); setSelectedIdea(null) }}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-neutral-200">
          <span className="text-sm text-neutral-500">
            Showing {((page - 1) * perPage) + 1}-{Math.min(page * perPage, filteredIdeas.length)} of {filteredIdeas.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-neutral-100 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 bg-neutral-100 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function IdeasTable({ ideas, sortBy, sortDir, onSort, expandedId, onExpand, onTagClick, onViewDetails }) {
  const SortHeader = ({ field, children }) => (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortBy === field && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
      </div>
    </th>
  )

  const statusEmoji = { captured: '🔵', assigned: '🟡', drafted: '🟠', shipped: '🟢' }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-neutral-50 border-b border-neutral-200">
          <tr>
            <SortHeader field="id">ID</SortHeader>
            <SortHeader field="date">Date</SortHeader>
            <SortHeader field="status">Status</SortHeader>
            <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">Content</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-600 uppercase tracking-wider">Tags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {ideas.map(idea => (
            <>
              <tr
                key={idea.id}
                className="hover:bg-neutral-50 cursor-pointer"
                onClick={() => onExpand(expandedId === idea.id ? null : idea.id)}
              >
                <td className="px-4 py-3 text-sm font-mono text-neutral-600">#{idea.id}</td>
                <td className="px-4 py-3 text-sm text-neutral-600">{idea.date || '-'}</td>
                <td className="px-4 py-3">
                  <span className="text-sm">{statusEmoji[idea.status] || '⚪'} {idea.status}</span>
                </td>
                <td className="px-4 py-3 text-sm text-neutral-800 max-w-md">
                  <p className="truncate">{idea.text || idea.quote}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {idea.tags?.slice(0, 3).map(tag => (
                      <button
                        key={tag}
                        onClick={(e) => { e.stopPropagation(); onTagClick(tag) }}
                        className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded hover:bg-neutral-200"
                      >
                        #{tag}
                      </button>
                    ))}
                    {idea.tags?.length > 3 && (
                      <span className="text-xs text-neutral-400">+{idea.tags.length - 3}</span>
                    )}
                  </div>
                </td>
              </tr>
              {expandedId === idea.id && (
                <tr key={`${idea.id}-expanded`}>
                  <td colSpan={5} className="px-4 py-4 bg-blue-50 border-l-4 border-l-blue-500">
                    <div className="space-y-3">
                      <p className="text-sm text-neutral-800 whitespace-pre-wrap">{idea.text || idea.quote}</p>
                      {idea.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-2">
                          {idea.tags.map(tag => (
                            <button
                              key={tag}
                              onClick={() => onTagClick(tag)}
                              className="text-xs px-2 py-1 bg-white text-neutral-600 rounded border hover:bg-neutral-50"
                            >
                              #{tag}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* View Full Analysis Button */}
                      {(idea.notes || idea.tension || idea.paradox || idea.connections || idea.chapter ||
                        (Array.isArray(idea.potentialContent) ? idea.potentialContent.length > 0 : idea.potentialContent)) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onViewDetails(idea) }}
                          className="mt-2 px-4 py-2 bg-gold text-white rounded-lg text-sm font-medium hover:bg-gold/90 transition-colors flex items-center gap-2"
                        >
                          <Lightbulb size={16} />
                          View Full Analysis
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IdeasCompact({ ideas, onTagClick }) {
  const statusEmoji = { captured: '🔵', assigned: '🟡', drafted: '🟠', shipped: '🟢' }

  return (
    <div className="space-y-1">
      {ideas.map(idea => (
        <div key={idea.id} className="flex items-center gap-3 py-2 px-3 hover:bg-neutral-50 rounded">
          <span className="text-sm font-mono text-neutral-500 w-12">#{idea.id}</span>
          <span className="text-sm w-24">{statusEmoji[idea.status]} {idea.status}</span>
          <span className="text-sm text-neutral-400 w-24">{idea.date || '-'}</span>
          <span className="text-sm text-neutral-800 flex-1 truncate">{idea.text || idea.quote}</span>
          <div className="flex gap-1">
            {idea.tags?.slice(0, 2).map(tag => (
              <button
                key={tag}
                onClick={() => onTagClick(tag)}
                className="text-xs px-2 py-0.5 bg-neutral-100 rounded hover:bg-neutral-200"
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// EXISTING COMPONENTS
// ============================================================================

function IdeaCard({ idea, onTagClick }) {
  const statusColor = getStatusColor(idea.status)
  const statusEmoji = { captured: '🔵', assigned: '🟡', drafted: '🟠', shipped: '🟢' }

  return (
    <div className="card card-hover">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-neutral-500">#{idea.id}</span>
          {idea.date && (
            <span className="text-xs text-neutral-400">{idea.date}</span>
          )}
        </div>
        <span className={`badge ${statusColor}`}>
          {statusEmoji[idea.status]} {idea.status}
        </span>
      </div>
      <p className="text-sm text-black mb-2 line-clamp-3">{idea.text || idea.quote}</p>
      {idea.tags && idea.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {idea.tags.map(tag => (
            <button
              key={tag}
              onClick={() => onTagClick?.(tag)}
              className="text-xs px-2 py-1 bg-neutral-100 text-neutral-600 rounded hover:bg-neutral-200 transition-colors"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DraftCard({ draft }) {
  return (
    <div className="card card-hover">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <span className="badge badge-status">{draft.platform}</span>
            <span className="text-xs text-neutral-500">{draft.philosopher}</span>
          </div>
          <h3 className="font-medium text-black mb-1">{draft.filename}</h3>
          <p className="text-sm text-neutral-600 line-clamp-2">{draft.content.substring(0, 150)}...</p>
          <p className="text-xs text-neutral-500 mt-2">
            Modified {formatDate(draft.modified)}
          </p>
        </div>
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

// ============================================================================
// IDEA DETAIL MODAL - Full Processed Content View
// ============================================================================

function IdeaDetailModal({ idea, onClose, onTagClick }) {
  const statusEmoji = { captured: '🔵', assigned: '🟡', drafted: '🟠', shipped: '🟢' }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Lightbulb size={24} className="text-gold" />
            <div>
              <h2 className="text-xl font-serif font-semibold">Idea #{idea.id}</h2>
              <div className="flex items-center gap-3 text-sm text-neutral-500">
                <span>{statusEmoji[idea.status]} {idea.status}</span>
                {idea.date && <span>• {idea.date}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Original Idea */}
          <Section title="Original Idea" icon={<Lightbulb size={18} />}>
            <p className="text-neutral-800 whitespace-pre-wrap">{idea.text || idea.quote}</p>
          </Section>

          {/* Tags */}
          {idea.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {idea.tags.map(tag => (
                <button
                  key={tag}
                  onClick={() => onTagClick(tag)}
                  className="px-3 py-1 bg-neutral-100 text-neutral-700 rounded-full text-sm hover:bg-neutral-200 transition-colors flex items-center gap-1"
                >
                  <Tag size={12} />
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Notes */}
          {idea.notes && (
            <Section title="Notes" icon={<FileText size={18} />} color="blue">
              <p className="text-neutral-800 whitespace-pre-wrap">{idea.notes}</p>
            </Section>
          )}

          {/* The Tension */}
          {idea.tension && (
            <Section title="The Tension" icon={<AlertTriangle size={18} />} color="amber">
              <p className="text-neutral-800 whitespace-pre-wrap">{idea.tension}</p>
            </Section>
          )}

          {/* The Paradox */}
          {idea.paradox && (
            <Section title="The Paradox" icon={<TrendingUp size={18} />} color="purple">
              <p className="text-neutral-800 whitespace-pre-wrap">{idea.paradox}</p>
            </Section>
          )}

          {/* Connections */}
          {idea.connections && (
            <Section title="Connections" icon={<Grid size={18} />} color="green">
              <p className="text-neutral-800 whitespace-pre-wrap">{idea.connections}</p>
            </Section>
          )}

          {/* Potential Content */}
          {idea.potentialContent && (Array.isArray(idea.potentialContent) ? idea.potentialContent.length > 0 : idea.potentialContent) && (
            <Section title="Potential Content" icon={<Target size={18} />} color="gold">
              {Array.isArray(idea.potentialContent) ? (
                <ul className="space-y-2">
                  {idea.potentialContent.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-yellow-600 mt-1">•</span>
                      <span className="text-neutral-800">{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-neutral-800 whitespace-pre-wrap">{idea.potentialContent}</p>
              )}
            </Section>
          )}

          {/* Chapter Mapping */}
          {idea.chapter && (
            <Section title="Chapter Mapping" icon={<FileText size={18} />} color="indigo">
              <p className="text-neutral-800 whitespace-pre-wrap">{idea.chapter}</p>
            </Section>
          )}

          {/* Status Detail */}
          {idea.statusDetail && (
            <Section title="Status Notes" icon={<Clock size={18} />} color="neutral">
              <p className="text-neutral-800 whitespace-pre-wrap">{idea.statusDetail}</p>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-neutral-50 border-t border-neutral-200 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-neutral-200 text-neutral-700 rounded-lg hover:bg-neutral-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, icon, color = 'neutral', children }) {
  const colors = {
    neutral: 'bg-neutral-50 border-neutral-200',
    blue: 'bg-blue-50 border-blue-200',
    amber: 'bg-amber-50 border-amber-200',
    purple: 'bg-purple-50 border-purple-200',
    green: 'bg-green-50 border-green-200',
    gold: 'bg-yellow-50 border-yellow-300',
    indigo: 'bg-indigo-50 border-indigo-200'
  }

  const iconColors = {
    neutral: 'text-neutral-600',
    blue: 'text-blue-600',
    amber: 'text-amber-600',
    purple: 'text-purple-600',
    green: 'text-green-600',
    gold: 'text-yellow-600',
    indigo: 'text-indigo-600'
  }

  return (
    <div className={`p-4 rounded-lg border ${colors[color]}`}>
      <h3 className={`font-semibold mb-2 flex items-center gap-2 ${iconColors[color]}`}>
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}
