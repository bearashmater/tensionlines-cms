import useSWR, { mutate } from 'swr'
import { getTasks, reopenTask, dispatchTask, reassignTask } from '../lib/api'
import { formatDate, formatStatus, getStatusColor, getAlertLevelColor, truncate, formatDuration } from '../lib/formatters'
import { ListTodo, RotateCcw, Clock, Search, X, Play, ChevronDown, CheckCircle2, Loader2, Circle, XCircle, AlertTriangle, UserPlus } from 'lucide-react'
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
  const [searchQuery, setSearchQuery] = useState('')
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

  // Search filter
  if (searchQuery.trim().length >= 2) {
    const q = searchQuery.toLowerCase()
    filteredTasks = filteredTasks.filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      t.id?.toLowerCase().includes(q) ||
      t.assigneeIds?.some(a => a.toLowerCase().includes(q))
    )
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
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-bold text-black">Tasks</h1>
            <p className="text-neutral-600 mt-1">
              {searchQuery.trim().length >= 2
                ? `${filteredTasks.length} result${filteredTasks.length !== 1 ? 's' : ''} of ${tasks.length} tasks`
                : `${tasks.length} total tasks`}
            </p>
          </div>

          {/* Search Bar */}
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-9 pr-9 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                <X size={16} />
              </button>
            )}
          </div>
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
                        .sort((a, b) => {
                          const dateA = a.completedAt ? new Date(a.completedAt) : new Date(0)
                          const dateB = b.completedAt ? new Date(b.completedAt) : new Date(0)
                          return dateB - dateA  // Most recent first
                        })
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
                  .sort((a, b) => {
                    const dateA = a.completedAt ? new Date(a.completedAt) : new Date(0)
                    const dateB = b.completedAt ? new Date(b.completedAt) : new Date(0)
                    return dateB - dateA  // Most recent first
                  })
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

// Step status icon helper
function StepStatusIcon({ status, size = 14 }) {
  switch (status) {
    case 'completed': return <CheckCircle2 size={size} className="text-green-500" />
    case 'in_progress': return <Loader2 size={size} className="text-yellow-500 animate-spin" />
    case 'failed': return <XCircle size={size} className="text-red-500" />
    case 'blocked': return <XCircle size={size} className="text-orange-500" />
    default: return <Circle size={size} className="text-neutral-300" />
  }
}

// Client-side breakdown detection (mirrors backend logic, avoids extra API call)
function detectBreakdowns(task) {
  if (!task.steps || task.steps.length === 0) return []

  const now = Date.now()
  const breakdowns = []
  const estimateMs = task.metadata?.estimatedMinutes
    ? task.metadata.estimatedMinutes * 60 * 1000 : null

  // Dispatch with no progress
  if (task.dispatchedAt && task.steps.length === 1
      && task.steps[0].description === 'Dispatched'
      && task.status === 'in_progress') {
    const since = now - new Date(task.dispatchedAt).getTime()
    const threshold = Math.min((task.metadata?.estimatedMinutes || 30) * 60000 * 0.15, 5 * 60000)
    if (since > threshold) {
      breakdowns.push({
        type: 'dispatch_no_progress',
        message: 'No agent activity since dispatch',
        suggestions: ['Check if agent session is running', 'Re-dispatch or reassign']
      })
    }
  }

  const defaultThreshold = 2 * 60 * 60 * 1000
  const gapThreshold = 30 * 60 * 1000

  // Step too long
  task.steps.forEach(step => {
    if (step.status !== 'in_progress' || !step.startedAt) return
    const elapsed = now - new Date(step.startedAt).getTime()
    const desc = (step.description || '').toLowerCase()
    let threshold = defaultThreshold
    if (desc.includes('draft') || desc.includes('writing')) threshold = 3 * 60 * 60 * 1000
    if (desc.includes('review') || desc.includes('final')) threshold = 1 * 60 * 60 * 1000
    if (elapsed > threshold) {
      breakdowns.push({
        type: 'step_too_long',
        message: `"${step.description}" running too long (${formatDuration(elapsed)})`,
        suggestions: ['Break into smaller steps', 'Check if blocked']
      })
    }
  })

  // Gaps between steps
  for (let i = 1; i < task.steps.length; i++) {
    const prev = task.steps[i - 1]
    const curr = task.steps[i]
    if (prev.completedAt && curr.startedAt) {
      const gap = new Date(curr.startedAt).getTime() - new Date(prev.completedAt).getTime()
      if (gap > gapThreshold) {
        breakdowns.push({
          type: 'gap_between_steps',
          message: `${formatDuration(gap)} gap after "${prev.description}"`,
          suggestions: ['Nudge agent']
        })
      }
    }
  }

  // No recent steps on active task - dynamic threshold
  if (task.status === 'in_progress') {
    const lastStep = task.steps[task.steps.length - 1]
    const lastActivity = lastStep.completedAt || lastStep.startedAt
    const silenceThreshold = estimateMs
      ? Math.max(10 * 60 * 1000, estimateMs * 0.5)
      : 4 * 60 * 60 * 1000
    if (lastActivity && (now - new Date(lastActivity).getTime()) > silenceThreshold) {
      breakdowns.push({
        type: 'no_recent_steps',
        message: 'No activity for extended period',
        suggestions: ['Escalate to Tension', 'Reassign task']
      })
    }
  }

  return breakdowns
}

function detectPostingIssue(task) {
  const text = ((task.title || '') + ' ' + (task.description || '') + ' ' + (task.metadata?.category || '')).toLowerCase()
  const postingKeywords = ['post', 'tweet', 'reply', 'publish', 'bluesky', 'threads', 'twitter', 'outreach', 'comment', 'social']
  const blockKeywords = ['error 226', 'blocked', 'auth', 'manual', 'browser', "can't post", 'cannot post', 'write blocked']
  const isPostingTask = postingKeywords.some(k => text.includes(k))
  const hasBlockSignal = blockKeywords.some(k => text.includes(k))
  const hasBreakdowns = detectBreakdowns(task).length > 0
  return isPostingTask && (hasBlockSignal || hasBreakdowns)
}

// Expected phases for ghost steps
const EXPECTED_PHASES = ['Research/Planning', 'Drafting', 'Review', 'Final Polish']

// Look up average duration for a step description from _stepAverages
function getStepAvg(stepAverages, description) {
  if (!stepAverages || !description) return null
  const key = description.trim().toLowerCase()
  return stepAverages[key] || null
}

function StepTimeline({ task }) {
  const [expanded, setExpanded] = useState(false)
  const steps = task.steps || []
  if (steps.length === 0) return null

  const now = Date.now()
  const breakdowns = detectBreakdowns(task)
  const stepAverages = task._stepAverages || {}
  const currentStep = steps.find(s => s.status === 'in_progress')
  const completedSteps = steps.filter(s => s.status === 'completed')
  const completedDescriptions = steps.map(s => s.description.toLowerCase())

  // Ghost steps: expected phases not yet covered
  const ghostSteps = EXPECTED_PHASES.filter(phase =>
    !completedDescriptions.some(d => d.includes(phase.toLowerCase().split('/')[0]))
  )

  // Total phases = real steps (excluding "Dispatched") + remaining ghost steps
  const realSteps = steps.filter(s => s.description !== 'Dispatched')
  const totalPhases = realSteps.length + ghostSteps.length
  const completedPhases = realSteps.filter(s => s.status === 'completed').length
  const stepPercent = totalPhases > 0 ? Math.round((completedPhases / totalPhases) * 100) : 0

  // Elapsed time since dispatch
  const dispatchedAt = task.dispatchedAt || steps[0]?.startedAt
  const elapsedMs = dispatchedAt ? now - new Date(dispatchedAt).getTime() : 0

  // Current step elapsed
  const currentStepElapsed = currentStep?.startedAt
    ? now - new Date(currentStep.startedAt).getTime()
    : 0

  // Current step average (if history exists)
  const currentStepAvg = currentStep ? getStepAvg(stepAverages, currentStep.description) : null

  // Next expected phase
  const nextPhase = currentStep
    ? null
    : ghostSteps[0] || null

  return (
    <div className="mt-3 border-t border-neutral-200 pt-3">
      {/* Always-visible progress summary */}
      <div className="space-y-2">
        {/* Step progress bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-neutral-600">
                Steps: {completedPhases}/{totalPhases} phases
              </span>
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                {elapsedMs > 0 && (
                  <span>Total: {formatDuration(elapsedMs)}</span>
                )}
              </div>
            </div>
            <div className="w-full bg-neutral-200 rounded-full h-2">
              <div
                className="bg-emerald-500 rounded-full h-2 transition-all duration-500"
                style={{ width: `${stepPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Current activity line */}
        <div className="flex items-center justify-between text-xs">
          {currentStep ? (
            <div className={`flex items-center gap-2 px-2 py-1 rounded-md ${
              currentStepAvg && currentStepElapsed > currentStepAvg.avg
                ? 'text-amber-800 bg-amber-50'
                : 'text-yellow-700 bg-yellow-50'
            }`}>
              <Loader2 size={12} className="animate-spin" />
              <span className="font-medium">{currentStep.description}</span>
              {currentStepElapsed > 0 && (
                <span className={currentStepAvg && currentStepElapsed > currentStepAvg.avg ? 'text-amber-600' : 'text-yellow-500'}>
                  {formatDuration(currentStepElapsed)}
                  {currentStepAvg ? ` / ~${formatDuration(currentStepAvg.avg)}` : ''}
                </span>
              )}
              {currentStepAvg && currentStepElapsed > currentStepAvg.avg && (
                <span className="text-amber-600 font-medium">over avg</span>
              )}
            </div>
          ) : nextPhase ? (
            <div className="flex items-center gap-2 text-neutral-400 px-2 py-1">
              <Circle size={12} />
              <span className="italic">Next: {nextPhase}</span>
            </div>
          ) : completedPhases === totalPhases && totalPhases > 0 ? (
            <div className="flex items-center gap-2 text-emerald-600 px-2 py-1">
              <CheckCircle2 size={12} />
              <span className="font-medium">All steps complete</span>
            </div>
          ) : null}

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-neutral-400 hover:text-neutral-600 transition-colors px-2 py-1"
          >
            <span>{expanded ? 'Hide' : 'Details'}</span>
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Diagnostics panel */}
        {breakdowns.length > 0 && (
          <div className="mt-2 p-2 rounded-md bg-red-50 border border-red-200">
            {breakdowns.map((b, i) => (
              <div key={i} className="mb-1 last:mb-0">
                <div className="flex items-center gap-1 text-xs font-medium text-red-700">
                  <AlertTriangle size={12} />
                  {b.message}
                </div>
                {b.suggestions?.map((s, j) => (
                  <div key={j} className="text-xs text-red-600 ml-4 mt-0.5">• {s}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Expanded step-by-step timeline */}
      {expanded && (
        <div className="mt-3 ml-2 space-y-0">
          {steps.map((step, i) => {
            const duration = step.completedAt && step.startedAt
              ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
              : step.startedAt && step.status === 'in_progress'
                ? now - new Date(step.startedAt).getTime()
                : null

            const stepAvg = getStepAvg(stepAverages, step.description)

            // Check if step is overdue (use average if available, else 2h fallback)
            const isOverdue = step.status === 'in_progress' && duration && duration > 2 * 60 * 60 * 1000
            const isOverAvg = step.status === 'in_progress' && duration && stepAvg && duration > stepAvg.avg

            // Check gap to next step
            let gapMs = 0
            if (i < steps.length - 1 && step.completedAt && steps[i + 1].startedAt) {
              gapMs = new Date(steps[i + 1].startedAt).getTime() - new Date(step.completedAt).getTime()
            }

            return (
              <div key={step.id}>
                <div className={`flex items-start gap-3 py-2 px-2 rounded ${isOverdue ? 'bg-red-50' : isOverAvg ? 'bg-amber-50' : ''}`}>
                  {/* Timeline line + icon */}
                  <div className="flex flex-col items-center">
                    <StepStatusIcon status={step.status} />
                    {(i < steps.length - 1 || ghostSteps.length > 0) && (
                      <div className="w-px h-4 bg-neutral-200 mt-1" />
                    )}
                  </div>

                  {/* Step content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isOverdue ? 'text-red-700' : isOverAvg ? 'text-amber-700' : 'text-neutral-800'}`}>
                        {step.description}
                      </span>
                      {step.agentId && step.agentId !== 'human' && step.agentId !== 'unknown' && (
                        <span className="text-xs text-neutral-400">{step.agentId}</span>
                      )}
                    </div>
                    {duration !== null && (
                      <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : isOverAvg ? 'text-amber-600 font-medium' : 'text-neutral-400'}`}>
                        {formatDuration(duration)}
                        {stepAvg ? ` / ~${formatDuration(stepAvg.avg)} avg` : ''}
                        {isOverdue ? ' (overdue)' : isOverAvg ? ' (over avg)' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Gap warning */}
                {gapMs > 30 * 60 * 1000 && (
                  <div className="flex items-center gap-3 py-1 px-2">
                    <div className="flex flex-col items-center">
                      <div className="w-px h-2 bg-amber-300" />
                    </div>
                    <span className="text-xs text-amber-600 font-medium">
                      {formatDuration(gapMs)} gap
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {/* Ghost steps */}
          {ghostSteps.map((phase, i) => {
            const phaseAvg = getStepAvg(stepAverages, phase)
            return (
              <div key={`ghost-${i}`} className="flex items-start gap-3 py-2 px-2 opacity-40">
                <div className="flex flex-col items-center">
                  <Circle size={14} className="text-neutral-300" />
                  {i < ghostSteps.length - 1 && (
                    <div className="w-px h-4 bg-neutral-200 mt-1" />
                  )}
                </div>
                <div>
                  <span className="text-sm text-neutral-400 italic">{phase}</span>
                  {phaseAvg && (
                    <span className="text-xs text-neutral-400 ml-2">~{formatDuration(phaseAvg.avg)} avg</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, hideCategory = false, showCompletedDate = false }) {
  const [reopening, setReopening] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [sendingToHuman, setSendingToHuman] = useState(false)
  const statusColor = getStatusColor(task.status)
  const category = getTaskCategory(task)
  const isCompleted = ['completed', 'shipped'].includes(task.status)
  const isHumanTask = task.assigneeIds?.includes('human')
  const breakdownCount = detectBreakdowns(task).length
  const isPostingIssue = detectPostingIssue(task)

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

  const handleDispatch = async () => {
    setDispatching(true)
    try {
      await dispatchTask(task.id)
      mutate('/tasks')
    } catch (err) {
      console.error('Error dispatching task:', err)
      alert('Failed to dispatch task. Please try again.')
    }
    setDispatching(false)
  }

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await dispatchTask(task.id)
      mutate('/tasks')
    } catch (err) {
      console.error('Error retrying task:', err)
      alert('Failed to retry task. Please try again.')
    }
    setRetrying(false)
  }

  const handleSendToHuman = async () => {
    if (!confirm('Reassign this task to Shawn (Human) for manual action?')) return
    setSendingToHuman(true)
    try {
      await reassignTask(task.id, 'human', 'Posting issue — reassigned to human for manual action')
      mutate('/tasks')
    } catch (err) {
      console.error('Error reassigning task:', err)
      alert('Failed to reassign task. Please try again.')
    }
    setSendingToHuman(false)
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
  const alertLevel = task.timeTracking?.alertLevel || 'none'

  const borderClass = alertLevel === 'red'
    ? 'border-red-300 border-l-4 border-l-red-500'
    : alertLevel === 'yellow'
      ? 'border-yellow-300 border-l-4 border-l-yellow-500'
      : 'border-neutral-200'

  return (
    <div className={`bg-neutral-50 rounded-lg border ${borderClass} p-4 hover:shadow-md transition-shadow`}>
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
            {!isCompleted && alertLevel !== 'none' && task.timeTracking?.timeInStatusHuman && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getAlertLevelColor(alertLevel)}`}>
                <Clock size={11} /> {task.timeTracking.timeInStatusHuman}
              </span>
            )}
            {breakdownCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                {breakdownCount} breakdown{breakdownCount !== 1 ? 's' : ''}
              </span>
            )}
            {isPostingIssue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                posting issue
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

      {/* Step Timeline */}
      <StepTimeline task={task} />

      <div className="flex items-center justify-between text-xs text-neutral-500 mt-3">
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

        <div className="flex items-center gap-2">
          {/* Dispatch button for assigned tasks */}
          {task.status === 'assigned' && (
            <button
              onClick={handleDispatch}
              disabled={dispatching}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-md hover:bg-amber-200 transition-colors disabled:opacity-50 font-medium"
              title="Dispatch this task — start execution"
            >
              <Play size={14} className={dispatching ? 'animate-pulse' : ''} />
              {dispatching ? 'Dispatching...' : 'Dispatch'}
            </button>
          )}

          {/* Retry button for stuck in_progress tasks */}
          {task.status === 'in_progress' && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-amber-400 to-yellow-500 text-white rounded-md hover:from-amber-500 hover:to-yellow-600 transition-all disabled:opacity-50 font-medium shadow-sm"
              title="Retry — re-dispatch this task to the agent"
            >
              <RotateCcw size={14} className={retrying ? 'animate-spin' : ''} />
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          )}

          {/* Send to Human button for posting issues or stuck in_progress tasks */}
          {(isPostingIssue || task.status === 'in_progress') && !isHumanTask && (
            <button
              onClick={handleSendToHuman}
              disabled={sendingToHuman}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium shadow-sm"
              title="Reassign to Shawn for manual action"
            >
              <UserPlus size={14} />
              {sendingToHuman ? 'Sending...' : 'Send to Human'}
            </button>
          )}

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
