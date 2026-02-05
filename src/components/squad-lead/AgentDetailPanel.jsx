import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { X, TrendingUp, TrendingDown, Clock, CheckCircle, AlertTriangle, Target } from 'lucide-react'
import { fetcher } from '../../lib/api'

export default function AgentDetailPanel({ agentId, onClose }) {
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
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-medium">
              {detail.agent.name?.charAt(0) || '?'}
            </div>
          )}
          <div>
            <h2 className="font-semibold text-neutral-900">{detail.agent.name}</h2>
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

      {/* Metrics */}
      <div className="p-4 border-b border-neutral-100">
        <h3 className="text-sm font-medium text-neutral-500 mb-3">Performance (Last 7 Days)</h3>
        <div className="grid grid-cols-3 gap-4">
          <MetricCard
            label="Tasks Completed"
            value={detail.metrics.tasksCompletedLast7Days}
            trend={detail.metrics.tasksTrend}
          />
          <MetricCard
            label="Avg Time"
            value={formatDuration(detail.metrics.avgCompletionTimeMinutes)}
            unit=""
          />
          <MetricCard
            label="Completion Rate"
            value={detail.metrics.completionRate}
            unit="%"
          />
        </div>
      </div>

      {/* Current Task */}
      {detail.currentTask && (
        <div className="p-4 border-b border-neutral-100">
          <h3 className="text-sm font-medium text-neutral-500 mb-2">Current Task</h3>
          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-medium text-neutral-900">{detail.currentTask.title}</h4>
                <div className="flex items-center gap-3 mt-2 text-sm text-neutral-600">
                  <span className="flex items-center gap-1">
                    <Clock size={14} />
                    {detail.currentTask.timeInStatus}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    detail.currentTask.alertLevel === 'red'
                      ? 'bg-red-100 text-red-700'
                      : detail.currentTask.alertLevel === 'yellow'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {detail.currentTask.status}
                  </span>
                </div>
              </div>
              {detail.currentTask.alertLevel === 'red' && (
                <AlertTriangle className="text-red-500" size={20} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Queued Tasks */}
      <div className="p-4">
        <h3 className="text-sm font-medium text-neutral-500 mb-2">
          Queued Tasks ({detail.queuedTasks?.length || 0})
        </h3>
        {detail.queuedTasks?.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-4">No queued tasks</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {detail.queuedTasks?.map((task) => (
              <div
                key={task.id}
                className="p-2 rounded border border-neutral-100 hover:bg-neutral-50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-800 truncate">
                    {task.title}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    task.priority === 'high'
                      ? 'bg-red-100 text-red-700'
                      : task.priority === 'medium'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-neutral-100 text-neutral-600'
                  }`}>
                    {task.priority || 'normal'}
                  </span>
                </div>
                {task.dueDate && (
                  <div className="text-xs text-neutral-500 mt-1">
                    Due: {new Date(task.dueDate).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({ label, value, unit = '', trend }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-neutral-900">
        {value}{unit}
      </div>
      <div className="text-xs text-neutral-500">{label}</div>
      {trend !== undefined && (
        <div className={`text-xs mt-1 flex items-center justify-center gap-1 ${
          trend > 0 ? 'text-green-600' : trend < 0 ? 'text-red-600' : 'text-neutral-500'
        }`}>
          {trend > 0 ? <TrendingUp size={12} /> : trend < 0 ? <TrendingDown size={12} /> : null}
          {trend > 0 ? '+' : ''}{trend}% vs last week
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
