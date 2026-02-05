import { AlertTriangle, Clock, User, ArrowRight, CheckCircle } from 'lucide-react'
import { useState } from 'react'
import ReassignModal from './ReassignModal'

export default function AlertsPanel({ alerts, isLoading, onRefresh }) {
  const [reassignTask, setReassignTask] = useState(null)

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-neutral-200 rounded w-1/3" />
          <div className="h-20 bg-neutral-100 rounded" />
          <div className="h-20 bg-neutral-100 rounded" />
        </div>
      </div>
    )
  }

  const sortedAlerts = [...alerts].sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3)
  })

  return (
    <div className="bg-white rounded-lg border border-neutral-200">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h2 className="font-semibold text-neutral-900">Alerts</h2>
          {alerts.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              {alerts.length}
            </span>
          )}
        </div>
      </div>

      <div className="divide-y divide-neutral-100 max-h-80 overflow-y-auto">
        {sortedAlerts.length === 0 ? (
          <div className="p-6 text-center text-neutral-500">
            <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500" />
            <p>No active alerts</p>
            <p className="text-sm mt-1">All tasks are progressing normally</p>
          </div>
        ) : (
          sortedAlerts.map((alert) => (
            <AlertItem
              key={alert.id}
              alert={alert}
              onReassign={() => setReassignTask(alert.task)}
            />
          ))
        )}
      </div>

      {reassignTask && (
        <ReassignModal
          task={reassignTask}
          onClose={() => setReassignTask(null)}
          onReassign={() => {
            setReassignTask(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

function AlertItem({ alert, onReassign }) {
  const priorityColors = {
    critical: 'border-l-red-500 bg-red-50',
    high: 'border-l-orange-500 bg-orange-50',
    medium: 'border-l-yellow-500 bg-yellow-50',
    low: 'border-l-blue-500 bg-blue-50'
  }

  const priorityBadgeColors = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-blue-100 text-blue-700'
  }

  return (
    <div className={`p-4 border-l-4 ${priorityColors[alert.priority] || 'border-l-neutral-300'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${priorityBadgeColors[alert.priority]}`}>
              {alert.type === 'overdue' ? 'OVERDUE' :
               alert.type === 'stuck' ? 'STUCK' :
               alert.type === 'blocked' ? 'BLOCKED' : 'ALERT'}
            </span>
            {alert.timeInStatus && (
              <span className="text-xs text-neutral-500 flex items-center gap-1">
                <Clock size={12} />
                {alert.timeInStatus}
              </span>
            )}
          </div>
          <h3 className="font-medium text-neutral-900 truncate">{alert.task?.title || 'Unknown Task'}</h3>
          <div className="flex items-center gap-2 mt-1 text-sm text-neutral-600">
            <User size={14} />
            <span>{alert.task?.assigneeIds?.join(', ') || 'Unassigned'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReassign}
            className="px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-100 rounded hover:bg-amber-200 flex items-center gap-1"
          >
            Reassign
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
