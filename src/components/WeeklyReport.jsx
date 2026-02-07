import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  Calendar, FileText, Heart, Users, TrendingUp, DollarSign,
  ChevronLeft, ChevronRight, RefreshCw, ArrowUp, ArrowDown, Minus,
  ExternalLink, Target, MessageCircle
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'

function ChangeIndicator({ value, suffix = '', invert = false }) {
  if (value === undefined || value === null) return null
  const positive = invert ? value < 0 : value > 0
  const negative = invert ? value > 0 : value < 0
  const color = positive ? 'text-green-600' : negative ? 'text-red-500' : 'text-neutral-400'
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus
  return (
    <span className={`inline-flex items-center text-xs font-medium ${color}`}>
      <Icon size={12} className="mr-0.5" />
      {value > 0 ? '+' : ''}{value}{suffix}
    </span>
  )
}

function KPICard({ icon, label, value, color, change, invertChange }) {
  const colorClasses = {
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    gold: 'bg-amber-50 text-amber-600'
  }
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-neutral-500 mb-1">{label}</p>
          <p className="text-3xl font-bold text-black">{value}</p>
          {change !== undefined && change !== null && (
            <div className="mt-1">
              <ChangeIndicator value={change} invert={invertChange} />
              <span className="text-xs text-neutral-400 ml-1">vs last week</span>
            </div>
          )}
        </div>
        <div className={`p-2.5 rounded-lg ${colorClasses[color] || colorClasses.gold}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-black mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-neutral-600">
          {p.name}: <span className="font-medium text-black">{typeof p.value === 'number' ? (p.value % 1 === 0 ? p.value : `$${p.value.toFixed(2)}`) : p.value}</span>
        </p>
      ))}
    </div>
  )
}

function formatWeekLabel(weekStart, weekEnd) {
  if (!weekStart || !weekEnd) return ''
  const start = new Date(weekStart + 'T12:00:00Z')
  const end = new Date(weekEnd + 'T12:00:00Z')
  const opts = { month: 'short', day: 'numeric' }
  const startStr = start.toLocaleDateString('en-US', opts)
  const endStr = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })
  return `${startStr} – ${endStr}`
}

export default function WeeklyReport() {
  const [weekId, setWeekId] = useState(null) // null = current
  const [regenerating, setRegenerating] = useState(false)

  const weekParam = weekId ? `?week=${weekId}` : ''
  const { data: report, error, isLoading, mutate } = useSWR(
    `/api/weekly-report${weekParam}`,
    fetcher
  )
  const { data: weekList } = useSWR('/api/weekly-report/list', fetcher)

  const handleRegenerate = async () => {
    setRegenerating(true)
    try {
      await fetch('/api/weekly-report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week: weekId || undefined })
      })
      await mutate()
    } catch (e) {
      console.error('Regenerate failed:', e)
    }
    setRegenerating(false)
  }

  const navigateWeek = (direction) => {
    const current = report?.weekId
    if (!current) return
    // Compute prev/next by parsing the weekId
    const [yearStr, weekStr] = current.split('-W')
    const year = parseInt(yearStr)
    const week = parseInt(weekStr)
    let newYear = year, newWeek = week + direction
    if (newWeek < 1) { newYear--; newWeek = 52 }
    if (newWeek > 52) { newYear++; newWeek = 1 }
    setWeekId(`${newYear}-W${String(newWeek).padStart(2, '0')}`)
  }

  if (isLoading || !report) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-red-500 text-lg">Failed to load weekly report</p>
        <button
          onClick={() => mutate()}
          className="mt-4 px-4 py-2 bg-gold text-black rounded-lg hover:bg-gold/80"
        >
          Retry
        </button>
      </div>
    )
  }

  const comp = report.comparison
  const totalEngagement = (report.engagement?.totalLikes || 0) +
    (report.engagement?.totalComments || 0) +
    (report.engagement?.totalShares || 0)

  return (
    <div className="space-y-6">
      {/* Header + Week Navigator */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <span className="text-gold"><Calendar size={28} /></span>
          <h1 className="text-3xl font-serif font-bold text-black">Weekly Report</h1>
          {report.partial && (
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
              In Progress
            </span>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigateWeek(-1)}
            className="p-2 rounded-lg hover:bg-neutral-100 border border-neutral-200"
            title="Previous week"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium text-neutral-700 min-w-[200px] text-center">
            {formatWeekLabel(report.weekStart, report.weekEnd)}
          </span>
          <button
            onClick={() => navigateWeek(1)}
            className="p-2 rounded-lg hover:bg-neutral-100 border border-neutral-200"
            title="Next week"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="flex items-center space-x-1.5 px-3 py-2 bg-gold text-black text-sm font-medium rounded-lg hover:bg-gold/80 disabled:opacity-50"
          >
            <RefreshCw size={14} className={regenerating ? 'animate-spin' : ''} />
            <span>Regenerate</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          icon={<FileText size={20} />}
          label="Posts Published"
          value={report.content?.postsPublished || 0}
          color="purple"
          change={comp?.postsPublished}
        />
        <KPICard
          icon={<Heart size={20} />}
          label="Total Engagement"
          value={totalEngagement}
          color="red"
          change={comp?.totalEngagement}
        />
        <KPICard
          icon={<Users size={20} />}
          label="Follower Growth"
          value={report.followers?.totalDelta >= 0 ? `+${report.followers.totalDelta}` : report.followers?.totalDelta}
          color="blue"
          change={comp?.followerDelta}
        />
        <KPICard
          icon={<TrendingUp size={20} />}
          label="Tasks Completed"
          value={report.agents?.totalCompleted || 0}
          color="green"
          change={comp?.tasksCompleted}
        />
        <KPICard
          icon={<DollarSign size={20} />}
          label="Weekly Cost"
          value={`$${(report.costs?.totalSpent || 0).toFixed(2)}`}
          color="gold"
          change={comp?.totalCost !== undefined ? Math.round(comp.totalCost * 100) / 100 : undefined}
          invertChange={true}
        />
      </div>

      {/* Content Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Posts by Platform */}
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-black mb-4">Posts by Platform</h2>
          {Object.keys(report.content?.byPlatform || {}).length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={Object.entries(report.content.byPlatform).map(([name, d]) => ({ name, posts: d.posts }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="posts" fill="#D4A853" radius={[4, 4, 0, 0]} name="Posts" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-neutral-400 text-sm text-center py-8">No posts this week</p>
          )}
        </div>

        {/* Top Posts */}
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-black mb-4">Top Posts</h2>
          {(report.content?.topPosts || []).length > 0 ? (
            <div className="space-y-3 max-h-[220px] overflow-y-auto">
              {report.content.topPosts.map((post, i) => (
                <div key={i} className="flex items-start space-x-3 p-2 rounded-lg hover:bg-neutral-50">
                  <span className="px-2 py-0.5 text-xs font-medium bg-neutral-100 text-neutral-600 rounded capitalize flex-shrink-0">
                    {post.platform}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-neutral-700 line-clamp-2">{post.content || '(no content)'}</p>
                    <div className="flex items-center space-x-3 mt-1">
                      <span className="text-xs text-neutral-400">
                        <Heart size={10} className="inline mr-0.5" />{post.engagement}
                      </span>
                      {post.url && (
                        <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center">
                          View <ExternalLink size={10} className="ml-0.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-neutral-400 text-sm text-center py-8">No posts this week</p>
          )}
        </div>
      </div>

      {/* Follower Growth */}
      {Object.keys(report.followers?.platforms || {}).length > 0 && (
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-black mb-4">Follower Growth</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className="text-left py-2 text-neutral-500 font-medium">Platform</th>
                  <th className="text-right py-2 text-neutral-500 font-medium">Start</th>
                  <th className="text-right py-2 text-neutral-500 font-medium">End</th>
                  <th className="text-right py-2 text-neutral-500 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.followers.platforms).map(([platform, data]) => (
                  <tr key={platform} className="border-b border-neutral-100">
                    <td className="py-2 capitalize font-medium text-black">{platform}</td>
                    <td className="py-2 text-right text-neutral-600">{data.start}</td>
                    <td className="py-2 text-right text-neutral-600">{data.end}</td>
                    <td className="py-2 text-right">
                      <span className={`font-medium ${data.delta > 0 ? 'text-green-600' : data.delta < 0 ? 'text-red-500' : 'text-neutral-400'}`}>
                        {data.delta > 0 ? '+' : ''}{data.delta}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Agent Productivity */}
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-black mb-4">Agent Productivity</h2>
        <div className="flex items-center space-x-6 mb-4 text-sm">
          <div>
            <span className="text-neutral-500">Created:</span>{' '}
            <span className="font-semibold text-black">{report.agents?.totalCreated || 0}</span>
          </div>
          <div>
            <span className="text-neutral-500">Completed:</span>{' '}
            <span className="font-semibold text-black">{report.agents?.totalCompleted || 0}</span>
          </div>
          {report.agents?.avgCompletionMs > 0 && (
            <div>
              <span className="text-neutral-500">Avg completion:</span>{' '}
              <span className="font-semibold text-black">
                {Math.round(report.agents.avgCompletionMs / 3600000)}h
              </span>
            </div>
          )}
        </div>
        {(report.agents?.byAgent || []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className="text-left py-2 text-neutral-500 font-medium">Agent</th>
                  <th className="text-right py-2 text-neutral-500 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {report.agents.byAgent.map(agent => (
                  <tr key={agent.id} className="border-b border-neutral-100">
                    <td className="py-2 font-medium text-black">{agent.name}</td>
                    <td className="py-2 text-right text-neutral-700">{agent.completed}</td>
                  </tr>
                ))}
                <tr className="border-t border-neutral-300 font-semibold">
                  <td className="py-2 text-black">Total</td>
                  <td className="py-2 text-right text-black">{report.agents.totalCompleted}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-neutral-400 text-sm text-center py-4">No tasks completed this week</p>
        )}
      </div>

      {/* Cost Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Cost Chart */}
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-black mb-4">Daily Costs</h2>
          {(report.costs?.byDay || []).length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={report.costs.byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={report.costs.dailyBudget} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Budget', fill: '#ef4444', fontSize: 10 }} />
                <Bar dataKey="cost" fill="#D4A853" radius={[4, 4, 0, 0]} name="Cost" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-neutral-400 text-sm text-center py-8">No cost data</p>
          )}
        </div>

        {/* Model Breakdown */}
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-black mb-4">Cost by Model</h2>
          {(report.costs?.byModel || []).length > 0 ? (
            <div className="space-y-2">
              {report.costs.byModel.map((m, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-neutral-100 last:border-0">
                  <span className="text-sm text-neutral-700">{m.name}</span>
                  <span className="text-sm font-medium text-black">${(m.cost || 0).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t border-neutral-300 font-semibold">
                <span className="text-black">Total</span>
                <span className="text-black">${(report.costs.totalSpent || 0).toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <p className="text-neutral-400 text-sm text-center py-8">No cost data</p>
          )}
          {comp?.totalCost !== undefined && (
            <div className="mt-3 text-sm text-neutral-500">
              vs last week: <ChangeIndicator value={Math.round(comp.totalCost * 100) / 100} suffix="" invert={true} />
            </div>
          )}
        </div>
      </div>

      {/* Outreach Summary */}
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-black mb-4">Outreach</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-neutral-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <Target size={18} className="text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-black">{report.outreach?.targetsContacted || 0}</p>
            <p className="text-xs text-neutral-500 mt-1">Targets Contacted</p>
          </div>
          <div className="text-center p-4 bg-neutral-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <Users size={18} className="text-green-500" />
            </div>
            <p className="text-2xl font-bold text-black">{report.outreach?.followBackRate || 0}%</p>
            <p className="text-xs text-neutral-500 mt-1">Follow-Back Rate</p>
          </div>
          <div className="text-center p-4 bg-neutral-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <MessageCircle size={18} className="text-amber-500" />
            </div>
            <p className="text-2xl font-bold text-black">{report.outreach?.replyRate || 0}%</p>
            <p className="text-xs text-neutral-500 mt-1">Reply Rate</p>
          </div>
        </div>
      </div>

      {/* Inbox Activity */}
      {(report.engagement?.inboxActivity?.blueskyReplies > 0 || report.engagement?.inboxActivity?.twitterReplies > 0) && (
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-black mb-4">Inbox Activity</h2>
          <div className="flex items-center space-x-6 text-sm">
            <div>
              <span className="text-neutral-500">Bluesky replies:</span>{' '}
              <span className="font-semibold text-black">{report.engagement.inboxActivity.blueskyReplies}</span>
            </div>
            <div>
              <span className="text-neutral-500">Twitter replies:</span>{' '}
              <span className="font-semibold text-black">{report.engagement.inboxActivity.twitterReplies}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
