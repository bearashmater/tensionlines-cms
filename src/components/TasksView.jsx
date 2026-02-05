import useSWR from 'swr'
import { getTasks } from '../lib/api'
import { formatDate, formatStatus, getStatusColor, truncate } from '../lib/formatters'
import { ListTodo } from 'lucide-react'
import { useState } from 'react'

export default function TasksView() {
  const [viewMode, setViewMode] = useState('by-assignee') // 'by-assignee' or 'by-status'
  const [filter, setFilter] = useState('all')
  const { data: tasks, error } = useSWR('/tasks', getTasks, {
    refreshInterval: 120000
  })

  if (error) return <div className="card bg-red-50">Error loading tasks</div>
  if (!tasks) return <LoadingState />

  const filteredTasks = filter === 'all' 
    ? tasks 
    : tasks.filter(t => t.status === filter)

  const statuses = ['all', 'assigned', 'in_progress', 'review', 'completed', 'shipped']

  // Helper function to get task progress (defined here so we can use it for sorting)
  const getProgress = (task) => {
    if (task.metadata?.progress) {
      const match = task.metadata.progress.match(/(\d+)%/)
      if (match) return parseInt(match[1])
    }
    const statusProgress = {
      'inbox': 0,
      'assigned': 10,
      'in_progress': 50,
      'review': 85,
      'completed': 100,
      'shipped': 100
    }
    return statusProgress[task.status] || 0
  }

  // Sort tasks by progress (least completed first)
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    return getProgress(a) - getProgress(b)
  })

  // Group tasks by assignee (already sorted by progress)
  const tasksByAssignee = {}
  sortedTasks.forEach(task => {
    task.assigneeIds.forEach(assigneeId => {
      if (!tasksByAssignee[assigneeId]) {
        tasksByAssignee[assigneeId] = []
      }
      tasksByAssignee[assigneeId].push(task)
    })
  })
  
  // Sort assignees by total incomplete work (sum of incomplete percentages)
  const sortedAssignees = Object.entries(tasksByAssignee).sort((a, b) => {
    const aIncomplete = a[1].reduce((sum, task) => sum + (100 - getProgress(task)), 0)
    const bIncomplete = b[1].reduce((sum, task) => sum + (100 - getProgress(task)), 0)
    return bIncomplete - aIncomplete // Most incomplete work first
  })

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Tasks</h1>
          <p className="text-neutral-600 mt-1">{tasks.length} total tasks</p>
        </div>
        
        {/* View Mode Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('by-assignee')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              viewMode === 'by-assignee'
                ? 'bg-gold text-white'
                : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            By Assignee
          </button>
          <button
            onClick={() => setViewMode('by-status')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              viewMode === 'by-status'
                ? 'bg-gold text-white'
                : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            By Status
          </button>
        </div>
      </div>

      {/* Status Filters (only in by-status view) */}
      {viewMode === 'by-status' && (
        <div className="flex space-x-2 overflow-x-auto">
          {statuses.map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                filter === status
                  ? 'bg-gold text-white'
                  : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {status === 'all' ? 'All' : formatStatus(status)}
            </button>
          ))}
        </div>
      )}

      {/* Tasks Display */}
      {sortedTasks.length > 0 ? (
        viewMode === 'by-assignee' ? (
          <div className="space-y-6">
            {sortedAssignees.map(([assignee, assigneeTasks]) => (
              <div key={assignee} className="bg-white rounded-lg border border-neutral-200 p-6">
                <h2 className="text-xl font-serif font-semibold mb-4 capitalize">
                  {assignee === 'human' ? 'Shawn (Human)' : assignee}
                  <span className="text-neutral-500 font-normal text-sm ml-2">
                    ({assigneeTasks.length} {assigneeTasks.length === 1 ? 'task' : 'tasks'})
                  </span>
                </h2>
                <div className="space-y-3">
                  {assigneeTasks.map(task => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedTasks.map(task => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )
      ) : (
        <div className="card text-center py-12">
          <ListTodo size={48} className="text-neutral-300 mx-auto mb-4" />
          <p className="text-neutral-500">No tasks found</p>
        </div>
      )}
    </div>
  )
}

function TaskCard({ task }) {
  const statusColor = getStatusColor(task.status)
  
  // Calculate progress
  const getProgress = (task) => {
    if (task.metadata?.progress) {
      const match = task.metadata.progress.match(/(\d+)%/)
      if (match) return parseInt(match[1])
    }
    const statusProgress = {
      'inbox': 0,
      'assigned': 10,
      'in_progress': 50,
      'review': 85,
      'completed': 100,
      'shipped': 100
    }
    return statusProgress[task.status] || 0
  }
  
  const progress = getProgress(task)

  return (
    <div className="bg-neutral-50 rounded-lg border border-neutral-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <span className={`badge ${statusColor}`}>
              {formatStatus(task.status)}
            </span>
            <span className="text-xs text-neutral-500">{task.id}</span>
          </div>
          <h3 className="font-semibold text-lg text-black mb-2">{task.title}</h3>
          <p className="text-sm text-neutral-600 mb-3">{truncate(task.description, 200)}</p>
          
          {/* LLM Assignment */}
          {task.llm && (
            <div className={`mb-3 p-3 rounded-md border-l-3 ${
              task.llm === 'ollama' ? 'bg-green-50 border-l-green-500' :
              task.llm === 'haiku' ? 'bg-blue-50 border-l-blue-500' :
              task.llm === 'sonnet' ? 'bg-purple-50 border-l-purple-500' :
              task.llm === 'opus' ? 'bg-red-50 border-l-red-500' : 'bg-neutral-50 border-l-neutral-400'
            }`} style={{ borderLeftWidth: '3px' }}>
              <div className="text-sm">
                <strong className="text-black">🤖 Predicted LLM:</strong>{' '}
                <span className={`font-mono font-semibold ${
                  task.llm === 'ollama' ? 'text-green-700' :
                  task.llm === 'haiku' ? 'text-blue-700' :
                  task.llm === 'sonnet' ? 'text-purple-700' :
                  task.llm === 'opus' ? 'text-red-700' : 'text-neutral-700'
                }`}>{task.llm}</span>
              </div>
              {task.rationale && (
                <div className="text-xs text-neutral-600 mt-1">
                  💡 {task.rationale}
                </div>
              )}
              {task.metadata?.actualLLM && (
                <div className="text-sm mt-2 pt-2 border-t border-neutral-200">
                  <strong className="text-black">✅ Actual LLM:</strong>{' '}
                  <span className="font-mono">{task.metadata.actualLLM}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-neutral-600">Progress</span>
          <span className="text-xs font-semibold text-gold">{progress}%</span>
        </div>
        <div className="w-full bg-neutral-200 rounded-full h-2">
          <div 
            className="bg-gold rounded-full h-2 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      
      <div className="flex items-center space-x-4 text-xs text-neutral-500">
        {task.assigneeIds && task.assigneeIds.length > 0 && (
          <span>👤 {task.assigneeIds.map(a => a === 'human' ? 'Shawn' : a).join(', ')}</span>
        )}
        {task.createdAt && (
          <span>Created {formatDate(task.createdAt)}</span>
        )}
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
