import useSWR from 'swr'
import { getDashboard, getActivities } from '../lib/api'
import { formatDate, formatPercent, formatNumber } from '../lib/formatters'
import { Users, ListTodo, Lightbulb, Bell, TrendingUp } from 'lucide-react'

export default function Dashboard() {
  const { data: dashboard, error: dashError } = useSWR('/dashboard', getDashboard, {
    refreshInterval: 120000
  })
  
  const { data: activities, error: actError } = useSWR('/activities', 
    () => getActivities(1, 10),
    { refreshInterval: 120000 }
  )

  if (dashError || actError) {
    return <ErrorState message="Failed to load dashboard data" />
  }

  if (!dashboard) {
    return <LoadingState />
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Dashboard</h1>
        <p className="text-neutral-600 mt-1">Overview of all TensionLines activity</p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          icon={<Users size={24} className="text-gold" />}
          label="Active Agents"
          value={dashboard.agents.active}
          total={dashboard.agents.total}
          bgColor="bg-accent-tertiary"
        />
        <MetricCard
          icon={<ListTodo size={24} className="text-gold" />}
          label="Tasks In Progress"
          value={dashboard.tasks.inProgress}
          total={dashboard.tasks.total}
          bgColor="bg-accent-tertiary"
        />
        <MetricCard
          icon={<Lightbulb size={24} className="text-gold" />}
          label="Ideas Captured"
          value={dashboard.ideas.total}
          subtitle={`${dashboard.ideas.shipped} shipped`}
          bgColor="bg-accent-tertiary"
        />
        <MetricCard
          icon={<Bell size={24} className="text-gold" />}
          label="Unread Notifications"
          value={dashboard.notifications.unread}
          total={dashboard.notifications.total}
          bgColor="bg-accent-tertiary"
        />
      </div>

      {/* Task Completion */}
      <div className="card card-hover">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-semibold">Task Completion</h2>
          <span className="text-2xl font-bold text-gold">
            {formatPercent(dashboard.tasks.completionRate)}
          </span>
        </div>
        <div className="w-full bg-neutral-200 rounded-full h-3">
          <div
            className="bg-gold h-3 rounded-full transition-all duration-500"
            style={{ width: `${dashboard.tasks.completionRate}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-sm text-neutral-600">
          <span>{dashboard.tasks.completed} completed</span>
          <span>{dashboard.tasks.total} total</span>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-semibold">Recent Activity</h2>
          <TrendingUp size={20} className="text-gold" />
        </div>
        
        {activities && activities.activities && activities.activities.length > 0 ? (
          <div className="space-y-3">
            {activities.activities.slice(0, 8).map((activity) => (
              <ActivityItem key={activity.id} activity={activity} />
            ))}
          </div>
        ) : (
          <p className="text-neutral-500 text-center py-8">No recent activity</p>
        )}
      </div>
    </div>
  )
}

// Metric Card Component
function MetricCard({ icon, label, value, total, subtitle, bgColor }) {
  return (
    <div className={`card card-hover ${bgColor}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-neutral-600 mb-1">{label}</p>
          <p className="text-3xl font-bold text-black">
            {formatNumber(value)}
            {total && <span className="text-lg text-neutral-500">/{total}</span>}
          </p>
          {subtitle && <p className="text-xs text-neutral-500 mt-1">{subtitle}</p>}
        </div>
        <div className="p-2 rounded-lg bg-white">
          {icon}
        </div>
      </div>
    </div>
  )
}

// Activity Item Component
function ActivityItem({ activity }) {
  return (
    <div className="flex items-start space-x-3 py-2 border-b border-neutral-100 last:border-0">
      <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-gold" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-black">{activity.description}</p>
        <p className="text-xs text-neutral-500 mt-1">{formatDate(activity.timestamp)}</p>
      </div>
    </div>
  )
}

// Loading State
function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-neutral-600">Loading dashboard...</p>
      </div>
    </div>
  )
}

// Error State
function ErrorState({ message }) {
  return (
    <div className="card bg-red-50 border-red-200">
      <p className="text-red-800">{message}</p>
    </div>
  )
}
