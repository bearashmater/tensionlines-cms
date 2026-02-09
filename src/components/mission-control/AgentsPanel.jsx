import { useState } from 'react'
import useSWR from 'swr'
import { ChevronDown, ChevronRight, Clock, AlertTriangle } from 'lucide-react'

const fetcher = (url) => fetch(url).then(r => r.json())

export default function AgentsPanel() {
  const { data: agentsData } = useSWR('/api/agents', fetcher, { refreshInterval: 60000 })
  const { data: tasksData } = useSWR('/api/tasks', fetcher, { refreshInterval: 30000 })
  const [expandedAgent, setExpandedAgent] = useState(null)

  const agents = agentsData?.agents || agentsData || []
  const tasks = tasksData?.tasks || []

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-serif font-semibold">Agent Status</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map(agent => {
          const agentTasks = tasks.filter(t => t.assigneeIds?.includes(agent.id))
          const activeTasks = agentTasks.filter(t => ['assigned', 'in_progress', 'review'].includes(t.status))
          const currentTask = agentTasks.find(t => t.status === 'in_progress') || agentTasks.find(t => t.status === 'assigned')
          const isExpanded = expandedAgent === agent.id
          const hasActivity = activeTasks.length > 0

          return (
            <div key={agent.id} className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
              <button
                onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                className="w-full p-4 text-left hover:bg-neutral-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    {agent.avatarUrl ? (
                      <img src={agent.avatarUrl} alt={agent.name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-neutral-200 flex items-center justify-center text-sm font-bold text-neutral-500">
                        {agent.name?.[0] || '?'}
                      </div>
                    )}
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${hasActivity ? 'bg-green-500' : 'bg-neutral-300'}`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-neutral-900 truncate">{agent.name}</h4>
                      <div className="flex items-center gap-1 text-xs text-neutral-400">
                        <span className="bg-neutral-100 px-1.5 py-0.5 rounded">{activeTasks.length}/{agentTasks.length}</span>
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                    </div>
                    <p className="text-xs text-neutral-500 truncate">{agent.role || agent.specialty || 'Philosopher'}</p>
                    {currentTask && (
                      <div className="mt-2">
                        <p className="text-xs text-neutral-600 truncate">{currentTask.title}</p>
                        {currentTask.steps && (
                          <div className="mt-1 w-full bg-neutral-100 rounded-full h-1.5">
                            <div
                              className="bg-gold h-1.5 rounded-full transition-all"
                              style={{ width: `${getStepProgress(currentTask)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {!currentTask && (
                      <p className="text-xs text-neutral-400 mt-2 italic">No active task</p>
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded: All tasks */}
              {isExpanded && (
                <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50 space-y-2 max-h-64 overflow-y-auto">
                  {agentTasks.length === 0 ? (
                    <p className="text-xs text-neutral-400">No tasks assigned</p>
                  ) : (
                    agentTasks.map(task => (
                      <div key={task.id} className="flex items-center gap-2 text-xs py-1">
                        <StatusDot status={task.status} alertLevel={task.alertLevel} />
                        <span className={`flex-1 truncate ${task.status === 'completed' || task.status === 'shipped' ? 'text-neutral-400 line-through' : 'text-neutral-700'}`}>
                          {task.title}
                        </span>
                        {task.timeInStatusHuman && task.alertLevel && task.alertLevel !== 'none' && (
                          <span className={`flex items-center gap-1 ${task.alertLevel === 'red' ? 'text-red-500' : 'text-amber-500'}`}>
                            <Clock size={10} />
                            {task.timeInStatusHuman}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusDot({ status, alertLevel }) {
  let color = 'bg-neutral-300'
  if (status === 'in_progress') color = 'bg-blue-500'
  else if (status === 'assigned') color = 'bg-amber-400'
  else if (status === 'review') color = 'bg-purple-500'
  else if (status === 'completed' || status === 'shipped') color = 'bg-green-500'
  else if (status === 'blocked') color = 'bg-red-500'

  if (alertLevel === 'red') color = 'bg-red-500'
  else if (alertLevel === 'yellow') color = 'bg-amber-500'

  return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
}

function getStepProgress(task) {
  if (!task.steps || task.steps.length === 0) return 0
  const completed = task.steps.filter(s => s.status === 'completed' || s.done).length
  return Math.round((completed / task.steps.length) * 100)
}
