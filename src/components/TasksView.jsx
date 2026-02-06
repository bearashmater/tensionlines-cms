import useSWR, { mutate } from 'swr'
import { getTasks, reopenTask } from '../lib/api'
import { formatDate, formatStatus, getStatusColor, truncate } from '../lib/formatters'
import { ListTodo, RotateCcw } from 'lucide-react'
import { useState } from 'react'

// Infer category from task title
function getTaskCategory(task) {
  const title = task.title.toLowerCase()

  // Social platforms
  if (title.includes('twitter') || title.includes('bluesky') ||
      title.includes('reddit') || title.includes('threads') ||
      title.includes('instagram') || title.includes('social') ||
      title.includes('outreach') || title.includes('follow')) {
    return 'social'
  }

  // Book/Content
  if (title.includes('book') || title.includes('chapter') ||
      title.includes('writing') || title.includes('manuscript')) {
    return 'book'
  }

  // Website/Tech
  if (title.includes('website') || title.includes('cms') ||
      title.includes('gumroad') || title.includes('technical') ||
      title.includes('build') || title.includes('fix') ||
      title.includes('api') || title.includes('server')) {
    return 'project'
  }

  // Human tasks
  if (task.assigneeIds?.includes('human')) {
    return 'human'
  }

  return 'other'
}

const CATEGORIES = {
  social: { label: 'Social', color: 'bg-blue-100 text-blue-700' },
  project: { label: 'Project', color: 'bg-purple-100 text-purple-700' },
  book: { label: 'Book', color: 'bg-amber-100 text-amber-700' },
  human: { label: 'Human', color: 'bg-green-100 text-green-700' },
  other: { label: 'Other', color: 'bg-neutral-100 text-neutral-700' }
}

// Group completed tasks by time period
function getTimePeriod(dateStr) {
  if (!dateStr) return 'unknown'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays < 1) return 'today'
  if (diffDays < 7) return 'last7days'
  if (diffDays < 30) return 'lastMonth'
  if (diffDays < 365) return 'lastYear'
  return 'older'
}

const TIME_PERIODS = {
  today: { label: 'Today', order: 0 },
  last7days: { label: 'Last 7 Days', order: 1 },
  lastMonth: { label: 'Last 30 Days', order: 2 },
  lastYear: { label: 'Last Year', order: 3 },
  older: { label: 'Older', order: 4 },
  unknown: { label: 'Unknown', order: 5 }
}

export default function TasksView() {
  const [viewMode, setViewMode] = useState('by-assignee') // 'by-assignee', 'by-status', 'by-category', or 'completed'
  const [filter, setFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [timePeriodFilter, setTimePeriodFilter] = useState('all')
  const { data: tasks, error } = useSWR('/tasks', getTasks, {
    refreshInterval: 120000
  })

  if (error) return <div className="card bg-red-50">Error loading tasks</div>
  if (!tasks) return <LoadingState />

  // Apply filters
  let filteredTasks = tasks

  // In completed view, only show completed/shipped tasks
  if (viewMode === 'completed') {
    filteredTasks = filteredTasks.filter(t => ['completed', 'shipped'].includes(t.status))
    if (timePeriodFilter !== 'all') {
      filteredTasks = filteredTasks.filter(t => getTimePeriod(t.completedAt) === timePeriodFilter)
    }
  } else {
    if (filter !== 'all') {
      filteredTasks = filteredTasks.filter(t => t.status === filter)
    }
  }

  if (categoryFilter !== 'all') {
    filteredTasks = filteredTasks.filter(t => getTaskCategory(t) === categoryFilter)
  }

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

  // Group tasks by category
  const tasksByCategory = {}
  sortedTasks.forEach(task => {
    const category = getTaskCategory(task)
    if (!tasksByCategory[category]) {
      tasksByCategory[category] = []
    }
    tasksByCategory[category].push(task)
  })

  // Sort categories by task count
  const sortedCategories = Object.entries(tasksByCategory).sort((a, b) => {
    const order = ['social', 'project', 'book', 'human', 'other']
    return order.indexOf(a[0]) - order.indexOf(b[0])
  })

  // Group completed tasks by time period (for completed view)
  const completedTasks = tasks.filter(t => ['completed', 'shipped'].includes(t.status))
  const tasksByTimePeriod = {}
  completedTasks.forEach(task => {
    const period = getTimePeriod(task.completedAt)
    if (!tasksByTimePeriod[period]) {
      tasksByTimePeriod[period] = []
    }
    tasksByTimePeriod[period].push(task)
  })

  // Sort time periods by recency
  const sortedTimePeriods = Object.entries(tasksByTimePeriod).sort((a, b) => {
    return (TIME_PERIODS[a[0]]?.order || 99) - (TIME_PERIODS[b[0]]?.order || 99)
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
          <button
            onClick={() => setViewMode('by-category')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              viewMode === 'by-category'
                ? 'bg-gold text-white'
                : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            By Category
          </button>
          <button
            onClick={() => setViewMode('completed')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              viewMode === 'completed'
                ? 'bg-gold text-white'
                : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            Completed
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

      {/* Category Filters (only in by-category view) */}
      {viewMode === 'by-category' && (
        <div className="flex space-x-2 overflow-x-auto">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              categoryFilter === 'all'
                ? 'bg-gold text-white'
                : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            All
          </button>
          {Object.entries(CATEGORIES).map(([key, { label }]) => (
            <button
              key={key}
              onClick={() => setCategoryFilter(key)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                categoryFilter === key
                  ? 'bg-gold text-white'
                  : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Time Period Filters (only in completed view) */}
      {viewMode === 'completed' && (
        <div className="flex space-x-2 overflow-x-auto">
          <button
            onClick={() => setTimePeriodFilter('all')}
            className={`px-4 py-2 rounded-md font-medium transition-colors ${
              timePeriodFilter === 'all'
                ? 'bg-gold text-white'
                : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            All Time
          </button>
          {Object.entries(TIME_PERIODS).filter(([k]) => k !== 'unknown').map(([key, { label }]) => (
            <button
              key={key}
              onClick={() => setTimePeriodFilter(key)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                timePeriodFilter === key
                  ? 'bg-gold text-white'
                  : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {label}
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
        ) : viewMode === 'by-category' ? (
          <div className="space-y-6">
            {sortedCategories.map(([category, categoryTasks]) => (
              <div key={category} className="bg-white rounded-lg border border-neutral-200 p-6">
                <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm ${CATEGORIES[category]?.color || 'bg-neutral-100'}`}>
                    {CATEGORIES[category]?.label || category}
                  </span>
                  <span className="text-neutral-500 font-normal text-sm">
                    ({categoryTasks.length} {categoryTasks.length === 1 ? 'task' : 'tasks'})
                  </span>
                </h2>
                <div className="space-y-3">
                  {categoryTasks.map(task => (
                    <TaskCard key={task.id} task={task} hideCategory />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : viewMode === 'completed' ? (
          <div className="space-y-6">
            {timePeriodFilter === 'all' ? (
              // Show grouped by time period
              sortedTimePeriods.length > 0 ? (
                sortedTimePeriods.map(([period, periodTasks]) => (
                  <div key={period} className="bg-white rounded-lg border border-neutral-200 p-6">
                    <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-3">
                      <span className="text-green-600">
                        {TIME_PERIODS[period]?.label || period}
                      </span>
                      <span className="text-neutral-500 font-normal text-sm">
                        ({periodTasks.length} {periodTasks.length === 1 ? 'task' : 'tasks'})
                      </span>
                    </h2>
                    <div className="space-y-3">
                      {periodTasks
                        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
                        .map(task => (
                          <TaskCard key={task.id} task={task} showCompletedDate />
                        ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="card text-center py-12">
                  <ListTodo size={48} className="text-neutral-300 mx-auto mb-4" />
                  <p className="text-neutral-500">No completed tasks yet</p>
                </div>
              )
            ) : (
              // Show filtered list
              <div className="space-y-3">
                {filteredTasks
                  .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
                  .map(task => (
                    <TaskCard key={task.id} task={task} showCompletedDate />
                  ))}
              </div>
            )}
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

function TaskCard({ task, hideCategory = false, showCompletedDate = false }) {
  const [reopening, setReopening] = useState(false)
  const statusColor = getStatusColor(task.status)
  const category = getTaskCategory(task)
  const isCompleted = ['completed', 'shipped'].includes(task.status)

  const handleReopen = async () => {
    if (!confirm('Reopen this task? It will be marked as "assigned" and returned to the assignee.')) {
      return
    }
    setReopening(true)
    try {
      await reopenTask(task.id, 'Marked as undone by user')
      mutate('/tasks')
    } catch (err) {
      console.error('Error reopening task:', err)
      alert('Failed to reopen task. Please try again.')
    }
    setReopening(false)
  }
  
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
            {!hideCategory && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${CATEGORIES[category]?.color || 'bg-neutral-100'}`}>
                {CATEGORIES[category]?.label || category}
              </span>
            )}
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
      
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div className="flex items-center space-x-4">
          {task.assigneeIds && task.assigneeIds.length > 0 && (
            <span>👤 {task.assigneeIds.map(a => a === 'human' ? 'Shawn' : a).join(', ')}</span>
          )}
          {showCompletedDate && task.completedAt ? (
            <span className="text-green-600 font-medium">✓ Completed {formatDate(task.completedAt)}</span>
          ) : task.createdAt && (
            <span>Created {formatDate(task.createdAt)}</span>
          )}
        </div>

        {/* Reopen button for completed tasks */}
        {isCompleted && (
          <button
            onClick={handleReopen}
            disabled={reopening}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-md hover:bg-amber-200 transition-colors disabled:opacity-50"
            title="Reopen this task and return it to the assignee"
          >
            <RotateCcw size={14} className={reopening ? 'animate-spin' : ''} />
            {reopening ? 'Reopening...' : 'Undo Complete'}
          </button>
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
