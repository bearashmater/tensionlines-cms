import { useState } from 'react'
import useSWR from 'swr'
import { X, TrendingUp, TrendingDown, Clock, CheckCircle, AlertTriangle, ListTodo, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import { fetcher } from '../../lib/api'

export default function AgentDetailPanel({ agentId, onClose }) {
  const [activeTab, setActiveTab] = useState('overview')
  const { data: detail, error, isLoading } = useSWR(
    agentId ? `/api/squad-lead/agent/${agentId}` : null,
    fetcher,
    { refreshInterval: 30000 }
  )

  if (!agentId) return null

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-neutral-200 rounded w-1/2" />
          <div className="h-20 bg-neutral-100 rounded" />
          <div className="h-32 bg-neutral-100 rounded" />
        </div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-6">
        <div className="text-red-600">Failed to load agent details</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {detail.agent.avatarUrl ? (
            <img
              src={detail.agent.avatarUrl}
              alt={detail.agent.name}
              className="w-12 h-12 rounded-full object-cover border-2 border-amber-200"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-lg">
              {detail.agent.name?.charAt(0) || '?'}
            </div>
          )}
          <div>
            <h2 className="font-semibold text-neutral-900 text-lg">{detail.agent.name}</h2>
            <p className="text-sm text-neutral-500">{detail.agent.role}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"
        >
          <X size={20} />
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-neutral-200">
        <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>
          Overview
        </TabButton>
        <TabButton active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')}>
          Tasks ({detail.metrics.activeTasks + detail.queuedTasks.length})
        </TabButton>
        <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
          History
        </TabButton>
      </div>

      {/* Tab Content */}
      <div className="max-h-[500px] overflow-y-auto">
        {activeTab === 'overview' && (
          <OverviewTab detail={detail} />
        )}
        {activeTab === 'tasks' && (
          <TasksTab detail={detail} />
        )}
        {activeTab === 'history' && (
          <HistoryTab detail={detail} />
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-amber-500 text-amber-700'
          : 'border-transparent text-neutral-500 hover:text-neutral-700'
      }`}
    >
      {children}
    </button>
  )
}

function OverviewTab({ detail }) {
  return (
    <div className="p-4 space-y-4">
      {/* Metrics */}
      <div>
        <h3 className="text-sm font-medium text-neutral-500 mb-3">Performance (Last 7 Days)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="Completed"
            value={detail.metrics.tasksCompletedLast7Days}
            trend={detail.metrics.tasksTrend}
            icon={<CheckCircle size={16} className="text-green-500" />}
          />
          <MetricCard
            label="Active"
            value={detail.metrics.activeTasks}
            icon={<ListTodo size={16} className="text-blue-500" />}
          />
          <MetricCard
            label="Avg Time"
            value={formatDuration(detail.metrics.avgCompletionTimeMinutes)}
            icon={<Clock size={16} className="text-purple-500" />}
          />
          <MetricCard
            label="Success Rate"
            value={`${detail.metrics.completionRate}%`}
            icon={<TrendingUp size={16} className="text-amber-500" />}
          />
        </div>
      </div>

      {/* Workload Summary */}
      <div>
        <h3 className="text-sm font-medium text-neutral-500 mb-2">Workload</h3>
        <div className="bg-neutral-50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-neutral-600">Current Load</span>
            <span className={`font-bold ${
              detail.metrics.workloadScore >= 80 ? 'text-red-600' :
              detail.metrics.workloadScore >= 60 ? 'text-orange-600' :
              detail.metrics.workloadScore >= 40 ? 'text-yellow-600' :
              'text-green-600'
            }`}>
              {detail.metrics.workloadScore}%
            </span>
          </div>
          <div className="h-3 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                detail.metrics.workloadScore >= 80 ? 'bg-red-500' :
                detail.metrics.workloadScore >= 60 ? 'bg-orange-500' :
                detail.metrics.workloadScore >= 40 ? 'bg-yellow-500' :
                'bg-green-500'
              }`}
              style={{ width: `${detail.metrics.workloadScore}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-neutral-500 mt-1">
            <span>{detail.metrics.activeTasks} active tasks</span>
            <span>{detail.queuedTasks.length} queued</span>
          </div>
        </div>
      </div>

      {/* Current Task */}
      {detail.currentTask && (
        <div>
          <h3 className="text-sm font-medium text-neutral-500 mb-2">Currently Working On</h3>
          <div className={`p-3 rounded-lg border ${
            detail.currentTask.alertLevel === 'red' ? 'bg-red-50 border-red-200' :
            detail.currentTask.alertLevel === 'yellow' ? 'bg-yellow-50 border-yellow-200' :
            'bg-green-50 border-green-200'
          }`}>
            <h4 className="font-medium text-neutral-900">{detail.currentTask.title}</h4>
            {detail.currentTask.description && (
              <p className="text-sm text-neutral-600 mt-1 line-clamp-2">{detail.currentTask.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-sm">
              <span className="flex items-center gap-1 text-neutral-600">
                <Clock size={14} />
                {detail.currentTask.timeInStatus} in progress
              </span>
              {detail.currentTask.alertLevel !== 'none' && (
                <span className={`flex items-center gap-1 ${
                  detail.currentTask.alertLevel === 'red' ? 'text-red-600' : 'text-yellow-600'
                }`}>
                  <AlertTriangle size={14} />
                  {detail.currentTask.alertLevel === 'red' ? 'Needs attention' : 'Running long'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {detail.recentActivities?.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-neutral-500 mb-2">Recent Activity</h3>
          <div className="space-y-2">
            {detail.recentActivities.slice(0, 3).map((activity) => (
              <div key={activity.id} className="flex items-start gap-2 text-sm">
                <Activity size={14} className="text-neutral-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-neutral-700">{activity.description}</span>
                  <span className="text-neutral-400 ml-2 text-xs">
                    {formatTimeAgo(activity.timestamp)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TasksTab({ detail }) {
  const [showCompleted, setShowCompleted] = useState(false)

  return (
    <div className="p-4 space-y-4">
      {/* Current Task */}
      {detail.currentTask && (
        <div>
          <h3 className="text-sm font-medium text-amber-700 mb-2 flex items-center gap-2">
            <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            In Progress
          </h3>
          <TaskCard task={detail.currentTask} highlight />
        </div>
      )}

      {/* Queued Tasks */}
      <div>
        <h3 className="text-sm font-medium text-neutral-500 mb-2">
          Up Next ({detail.queuedTasks.length})
        </h3>
        {detail.queuedTasks.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-4 bg-neutral-50 rounded">
            No tasks in queue
          </p>
        ) : (
          <div className="space-y-2">
            {detail.queuedTasks.map((task, idx) => (
              <TaskCard key={task.id} task={task} position={idx + 1} />
            ))}
          </div>
        )}
      </div>

      {/* Completed Tasks */}
      <div>
        <button
          onClick={() => setShowCompleted(!showCompleted)}
          className="flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-700"
        >
          {showCompleted ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Recently Completed ({detail.completedTasks?.length || 0})
        </button>
        {showCompleted && detail.completedTasks?.length > 0 && (
          <div className="mt-2 space-y-2">
            {detail.completedTasks.map((task) => (
              <div
                key={task.id}
                className="p-2 rounded border border-green-100 bg-green-50 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-green-500" />
                  <span className="text-sm text-neutral-700">{task.title}</span>
                </div>
                <span className="text-xs text-neutral-500">
                  {task.completedAt ? formatTimeAgo(task.completedAt) : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryTab({ detail }) {
  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-neutral-500 mb-3">Activity Timeline</h3>
      {detail.recentActivities?.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-8">No recent activity</p>
      ) : (
        <div className="space-y-3">
          {detail.recentActivities?.map((activity, idx) => (
            <div key={activity.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-2 h-2 rounded-full ${
                  activity.type === 'task_completed' ? 'bg-green-500' :
                  activity.type === 'task_started' ? 'bg-blue-500' :
                  activity.type === 'task_reassigned' ? 'bg-orange-500' :
                  'bg-neutral-400'
                }`} />
                {idx < detail.recentActivities.length - 1 && (
                  <div className="w-0.5 h-full bg-neutral-200 mt-1" />
                )}
              </div>
              <div className="flex-1 pb-3">
                <p className="text-sm text-neutral-700">{activity.description}</p>
                <p className="text-xs text-neutral-400 mt-1">
                  {new Date(activity.timestamp).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, highlight, position }) {
  return (
    <div className={`p-3 rounded-lg border ${
      highlight ? 'border-amber-200 bg-amber-50' : 'border-neutral-200 bg-white'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {position && (
            <span className="text-xs text-neutral-400 font-medium">#{position}</span>
          )}
          <h4 className="font-medium text-neutral-900 truncate">{task.title}</h4>
          {task.description && (
            <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{task.description}</p>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
          task.priority === 'high' || task.priority === 'critical'
            ? 'bg-red-100 text-red-700'
            : task.priority === 'medium'
            ? 'bg-yellow-100 text-yellow-700'
            : 'bg-neutral-100 text-neutral-600'
        }`}>
          {task.priority || 'normal'}
        </span>
      </div>
      {task.dueDate && (
        <div className="text-xs text-neutral-500 mt-2 flex items-center gap-1">
          <Clock size={12} />
          Due: {new Date(task.dueDate).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, trend, icon }) {
  return (
    <div className="bg-neutral-50 rounded-lg p-3 text-center">
      <div className="flex items-center justify-center gap-1 mb-1">
        {icon}
      </div>
      <div className="text-xl font-bold text-neutral-900">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
      {trend !== undefined && trend !== 0 && (
        <div className={`text-xs mt-1 flex items-center justify-center gap-1 ${
          trend > 0 ? 'text-green-600' : 'text-red-600'
        }`}>
          {trend > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {trend > 0 ? '+' : ''}{trend}%
        </div>
      )}
    </div>
  )
}

function formatDuration(minutes) {
  if (!minutes || minutes === 0) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function formatTimeAgo(timestamp) {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now - then
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString()
}
