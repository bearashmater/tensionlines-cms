import { useMemo } from 'react'
import useSWR from 'swr'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const fetcher = (url) => fetch(url).then(r => r.json())

const TYPE_ICONS = {
  message_sent: '\u2709\uFE0F',
  task_created: '\u2795',
  task_completed: '\u2705',
  task_shipped: '\uD83D\uDE80',
  status_changed: '\uD83D\uDD04',
  task_assigned: '\uD83D\uDCCB',
  task_progress: '\u26A1',
  alert: '\u26A0\uFE0F',
  repost_conversion: '\u267B\uFE0F',
  fact_check_completed: '\uD83D\uDD0D',
  weekly_review: '\uD83D\uDCCA',
}

export default function OverviewPanel() {
  const { data: activities } = useSWR('/api/activities?limit=100', fetcher, { refreshInterval: 60000 })
  const { data: events } = useSWR('/api/system/events', fetcher, { refreshInterval: 15000 })
  const { data: dashboard } = useSWR('/api/dashboard', fetcher, { refreshInterval: 30000 })

  const { chartData, totals } = useMemo(() => {
    const buckets = {}
    const now = Date.now()
    const dayAgo = now - 24 * 60 * 60 * 1000
    const sums = { tasks: 0, system: 0, alerts: 0 }

    // Initialize 24 one-hour buckets (less granular = more visible bars)
    for (let i = 0; i < 24; i++) {
      const t = dayAgo + i * 60 * 60 * 1000
      const d = new Date(t)
      const key = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      buckets[key] = { time: key, tasks: 0, system: 0, alerts: 0 }
    }

    const getBucketKey = (ts) => {
      const d = new Date(ts)
      d.setMinutes(0, 0, 0)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    if (activities?.activities) {
      activities.activities.forEach(a => {
        if (new Date(a.timestamp).getTime() < dayAgo) return
        const key = getBucketKey(a.timestamp)
        if (buckets[key]) buckets[key].tasks++
        sums.tasks++
      })
    }

    if (events?.events) {
      events.events.forEach(e => {
        if (new Date(e.timestamp).getTime() < dayAgo) return
        const key = getBucketKey(e.timestamp)
        if (buckets[key]) {
          if (e.type === 'error') { buckets[key].alerts++; sums.alerts++ }
          else { buckets[key].system++; sums.system++ }
        }
      })
    }

    return { chartData: Object.values(buckets), totals: sums }
  }, [activities, events])

  const recentActivities = activities?.activities?.slice(0, 20) || []

  // Count unique active agents in recent activities
  const activeAgents = useMemo(() => {
    const agents = new Set()
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    ;(activities?.activities || []).forEach(a => {
      if (new Date(a.timestamp).getTime() >= dayAgo && a.agentId) {
        agents.add(a.agentId)
      }
    })
    return agents.size
  }, [activities])

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Agent Actions" value={totals.tasks} sub="last 24h" color="text-amber-700" bg="bg-amber-50" />
        <StatCard label="System Events" value={totals.system} sub="last 24h" color="text-blue-700" bg="bg-blue-50" />
        <StatCard label="Active Agents" value={activeAgents} sub="sent messages or tasks" color="text-green-700" bg="bg-green-50" />
        <StatCard
          label="Queue Status"
          value={dashboard?.tasks?.inProgress || 0}
          sub={`${dashboard?.tasks?.stuck || 0} stuck`}
          color={dashboard?.tasks?.stuck > 0 ? 'text-red-700' : 'text-neutral-700'}
          bg={dashboard?.tasks?.stuck > 0 ? 'bg-red-50' : 'bg-neutral-50'}
        />
      </div>

      {/* Activity Chart */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-serif font-semibold">24-Hour Activity</h3>
          <span className="text-xs text-neutral-400">{totals.tasks + totals.system + totals.alerts} total events</span>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barCategoryGap="15%">
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={3} />
              <YAxis tick={{ fontSize: 10 }} width={25} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                labelStyle={{ fontWeight: 600 }}
              />
              <Bar dataKey="tasks" stackId="1" fill="#d4a843" name="Agent Actions" radius={[2, 2, 0, 0]} />
              <Bar dataKey="system" stackId="1" fill="#3b82f6" name="System Events" radius={[2, 2, 0, 0]} />
              <Bar dataKey="alerts" stackId="1" fill="#ef4444" name="Alerts" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4">
        <h3 className="text-lg font-serif font-semibold mb-3">Recent Activity</h3>
        {recentActivities.length === 0 ? (
          <p className="text-neutral-400 text-sm">No recent activity</p>
        ) : (
          <div className="space-y-0 max-h-[480px] overflow-y-auto">
            {recentActivities.map((a, i) => (
              <div key={a.id || i} className="flex items-start gap-3 text-sm py-2.5 border-b border-neutral-100 last:border-0">
                <span className="text-neutral-400 text-xs whitespace-nowrap mt-0.5 w-14 text-right">
                  {timeAgo(a.timestamp)}
                </span>
                <span className="text-sm mt-px">{TYPE_ICONS[a.type] || '\u25CF'}</span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-neutral-800">{a.agentId || 'system'}</span>
                  {a.description && (
                    <span className="text-neutral-500 ml-1.5">
                      {formatDescription(a.type, a.description)}
                    </span>
                  )}
                  {a.taskId && (
                    <span className="text-neutral-400 ml-1 text-xs">({a.taskId})</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color, bg }) {
  return (
    <div className={`rounded-lg border border-neutral-200 p-3 ${bg}`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs font-medium text-neutral-600 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function formatDescription(type, desc) {
  // Shorten verbose descriptions for the feed
  if (type === 'message_sent') {
    return desc.replace(/^Sent /, '').replace(/^(review|update|alert|request) to /, '\u2192 ')
  }
  if (type === 'task_created') {
    return desc.replace(/^Created task: /, 'created ')
  }
  if (type === 'status_changed') {
    return desc.replace(/^Changed status of task .+ from /, '').replace(/ to /, ' \u2192 ')
  }
  return desc
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
