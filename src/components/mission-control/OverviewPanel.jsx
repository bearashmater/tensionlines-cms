import { useMemo } from 'react'
import useSWR from 'swr'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const fetcher = (url) => fetch(url).then(r => r.json())

export default function OverviewPanel() {
  const { data: activities } = useSWR('/api/activities', fetcher, { refreshInterval: 60000 })
  const { data: events } = useSWR('/api/system/events', fetcher, { refreshInterval: 15000 })

  const chartData = useMemo(() => {
    const buckets = {}
    const now = Date.now()
    const dayAgo = now - 24 * 60 * 60 * 1000

    // Initialize 48 half-hour buckets
    for (let i = 0; i < 48; i++) {
      const t = dayAgo + i * 30 * 60 * 1000
      const key = new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      buckets[key] = { time: key, tasks: 0, system: 0, alerts: 0 }
    }

    const getBucketKey = (ts) => {
      const d = new Date(ts)
      d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    // Count activities
    if (activities?.activities) {
      activities.activities.forEach(a => {
        if (new Date(a.timestamp).getTime() < dayAgo) return
        const key = getBucketKey(a.timestamp)
        if (buckets[key]) buckets[key].tasks++
      })
    }

    // Count system events
    if (events?.events) {
      events.events.forEach(e => {
        if (new Date(e.timestamp).getTime() < dayAgo) return
        const key = getBucketKey(e.timestamp)
        if (buckets[key]) {
          if (e.type === 'error') buckets[key].alerts++
          else buckets[key].system++
        }
      })
    }

    return Object.values(buckets)
  }, [activities, events])

  const recentActivities = activities?.activities?.slice(0, 15) || []

  return (
    <div className="space-y-4">
      {/* Activity Chart */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4">
        <h3 className="text-lg font-serif font-semibold mb-3">24-Hour Activity</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval={7} />
              <YAxis tick={{ fontSize: 10 }} width={30} />
              <Tooltip />
              <Area type="monotone" dataKey="tasks" stackId="1" stroke="#d4a843" fill="#d4a843" fillOpacity={0.6} name="Tasks" />
              <Area type="monotone" dataKey="system" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} name="System" />
              <Area type="monotone" dataKey="alerts" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.5} name="Alerts" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4">
        <h3 className="text-lg font-serif font-semibold mb-3">Recent Activity</h3>
        {recentActivities.length === 0 ? (
          <p className="text-neutral-400 text-sm">No recent activity</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recentActivities.map((a, i) => (
              <div key={i} className="flex items-start gap-3 text-sm py-2 border-b border-neutral-100 last:border-0">
                <span className="text-neutral-400 text-xs whitespace-nowrap mt-0.5">
                  {timeAgo(a.timestamp)}
                </span>
                <div className="min-w-0">
                  <span className="font-medium text-neutral-700">{a.agentName || a.agentId || 'System'}</span>
                  <span className="text-neutral-500 ml-1">{a.action}</span>
                  {a.taskTitle && (
                    <span className="text-neutral-600 ml-1">— {a.taskTitle}</span>
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
