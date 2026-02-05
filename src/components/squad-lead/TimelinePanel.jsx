import { Calendar, Clock, AlertTriangle } from 'lucide-react'
import { useState } from 'react'

export default function TimelinePanel({ tasks, isLoading }) {
  const [selectedTask, setSelectedTask] = useState(null)

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-neutral-200 rounded w-1/3" />
          <div className="flex gap-2 overflow-hidden">
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className="flex-shrink-0 w-28 h-32 bg-neutral-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Group tasks by due date (next 7 days)
  const today = new Date()
  const days = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(today)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]
    const dayTasks = tasks.filter(t => {
      if (!t.dueDate) return false
      return t.dueDate.startsWith(dateStr)
    })
    days.push({
      date,
      dateStr,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : date.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNum: date.getDate(),
      tasks: dayTasks
    })
  }

  // Tasks without due dates or overdue
  const overdueTasks = tasks.filter(t => {
    if (!t.dueDate) return false
    return new Date(t.dueDate) < today
  })

  return (
    <div className="bg-white rounded-lg border border-neutral-200">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-purple-500" />
        <h2 className="font-semibold text-neutral-900">Due Date Timeline</h2>
      </div>

      {/* Overdue Section */}
      {overdueTasks.length > 0 && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-100">
          <div className="flex items-center gap-2 text-red-700 mb-2">
            <AlertTriangle size={16} />
            <span className="font-medium">Overdue ({overdueTasks.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {overdueTasks.slice(0, 3).map(task => (
              <button
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200 truncate max-w-[150px]"
              >
                {task.title}
              </button>
            ))}
            {overdueTasks.length > 3 && (
              <span className="px-2 py-1 text-xs text-red-600">
                +{overdueTasks.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="p-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {days.map((day) => (
            <DayColumn
              key={day.dateStr}
              day={day}
              onSelectTask={setSelectedTask}
            />
          ))}
        </div>
      </div>

      {/* Selected Task Detail */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}

function DayColumn({ day, onSelectTask }) {
  const isToday = day.label === 'Today'

  return (
    <div className={`flex-shrink-0 w-28 ${isToday ? 'bg-amber-50' : 'bg-neutral-50'} rounded-lg p-2`}>
      <div className="text-center mb-2">
        <div className={`text-xs font-medium ${isToday ? 'text-amber-700' : 'text-neutral-500'}`}>
          {day.label}
        </div>
        <div className={`text-lg font-bold ${isToday ? 'text-amber-900' : 'text-neutral-700'}`}>
          {day.dayNum}
        </div>
      </div>

      <div className="space-y-1 min-h-[80px]">
        {day.tasks.length === 0 ? (
          <div className="text-xs text-neutral-400 text-center py-4">No tasks</div>
        ) : (
          day.tasks.slice(0, 4).map(task => (
            <button
              key={task.id}
              onClick={() => onSelectTask(task)}
              className={`w-full px-2 py-1 text-xs rounded text-left truncate ${
                task.priority === 'high'
                  ? 'bg-red-100 text-red-800 hover:bg-red-200'
                  : task.priority === 'medium'
                  ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              {task.title}
            </button>
          ))
        )}
        {day.tasks.length > 4 && (
          <div className="text-xs text-neutral-500 text-center">
            +{day.tasks.length - 4} more
          </div>
        )}
      </div>
    </div>
  )
}

function TaskDetailPopup({ task, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h3 className="font-semibold text-lg text-neutral-900">{task.title}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            &times;
          </button>
        </div>

        <div className="space-y-3 text-sm">
          {task.description && (
            <p className="text-neutral-600">{task.description}</p>
          )}

          <div className="flex items-center gap-2">
            <Clock size={14} className="text-neutral-400" />
            <span className="text-neutral-600">
              Due: {task.dueDate ? new Date(task.dueDate).toLocaleString() : 'Not set'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-neutral-500">Assigned to:</span>
            <span className="font-medium">{task.assigneeIds?.join(', ') || 'Unassigned'}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-neutral-500">Priority:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              task.priority === 'high'
                ? 'bg-red-100 text-red-700'
                : task.priority === 'medium'
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-neutral-100 text-neutral-600'
            }`}>
              {task.priority || 'normal'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-neutral-500">Status:</span>
            <span className="font-medium">{task.status}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
