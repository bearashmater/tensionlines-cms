import useSWR from 'swr'
import { getIdeas, getDrafts, getIdeaStats } from '../lib/api'
import { formatDate, getStatusColor } from '../lib/formatters'
import { Lightbulb, FileText, TrendingUp, Target, Flame, Calendar, CheckCircle, Clock, AlertTriangle } from 'lucide-react'

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

      {/* Ideas Section */}
      <div>
        <h2 className="text-xl font-serif font-semibold mb-4 flex items-center">
          <Lightbulb size={24} className="mr-2 text-gold" />
          Ideas Bank ({ideas.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ideas.slice(0, 6).map(idea => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      </div>

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
// EXISTING COMPONENTS
// ============================================================================

function IdeaCard({ idea }) {
  const statusColor = getStatusColor(idea.status)

  return (
    <div className="card card-hover">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-neutral-500">#{idea.id}</span>
          {idea.date && (
            <span className="text-xs text-neutral-400">{idea.date}</span>
          )}
        </div>
        <span className={`badge ${statusColor}`}>{idea.status}</span>
      </div>
      <p className="text-sm text-black mb-2">{idea.text}</p>
      {idea.tags && idea.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {idea.tags.map(tag => (
            <span key={tag} className="text-xs px-2 py-1 bg-neutral-100 text-neutral-600 rounded">
              #{tag}
            </span>
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
