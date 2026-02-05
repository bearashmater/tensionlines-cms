import { Users, CheckCircle, Clock, AlertTriangle } from 'lucide-react'

export default function WorkloadPanel({ agents, isLoading, selectedAgentId, onSelectAgent }) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-neutral-200 rounded w-1/3" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-neutral-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Sort agents by workload (highest first)
  const sortedAgents = [...agents].sort((a, b) => b.workloadScore - a.workloadScore)

  return (
    <div className="bg-white rounded-lg border border-neutral-200">
      <div className="px-4 py-3 border-b border-neutral-200 flex items-center gap-2">
        <Users className="w-5 h-5 text-blue-500" />
        <h2 className="font-semibold text-neutral-900">Team Workload</h2>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sortedAgents.map((agent) => (
          <AgentWorkloadCard
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onClick={() => onSelectAgent(agent.id === selectedAgentId ? null : agent.id)}
          />
        ))}
      </div>
    </div>
  )
}

function AgentWorkloadCard({ agent, isSelected, onClick }) {
  const getWorkloadColor = (score) => {
    if (score >= 80) return 'bg-red-500'
    if (score >= 60) return 'bg-orange-500'
    if (score >= 40) return 'bg-yellow-500'
    if (score >= 20) return 'bg-green-500'
    return 'bg-neutral-300'
  }

  const getStatusIcon = () => {
    if (agent.stuckTasks > 0) {
      return <AlertTriangle size={14} className="text-red-500" />
    }
    if (agent.activeTasks === 0) {
      return <Clock size={14} className="text-neutral-400" />
    }
    return <CheckCircle size={14} className="text-green-500" />
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isSelected
          ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-200'
          : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {agent.avatarUrl ? (
            <img
              src={agent.avatarUrl}
              alt={agent.name}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center text-sm font-medium">
              {agent.name?.charAt(0) || '?'}
            </div>
          )}
          <span className="font-medium text-neutral-900 truncate">{agent.name}</span>
        </div>
        {getStatusIcon()}
      </div>

      {/* Workload Bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs text-neutral-500 mb-1">
          <span>Workload</span>
          <span>{agent.workloadScore}%</span>
        </div>
        <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${getWorkloadColor(agent.workloadScore)} transition-all`}
            style={{ width: `${agent.workloadScore}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-neutral-600">
        <span>{agent.activeTasks} active</span>
        <span>{agent.queuedTasks} queued</span>
        {agent.stuckTasks > 0 && (
          <span className="text-red-600 font-medium">{agent.stuckTasks} stuck</span>
        )}
      </div>

      {/* Current Task */}
      {agent.currentTask && (
        <div className="mt-2 pt-2 border-t border-neutral-100">
          <div className="text-xs text-neutral-500">Current:</div>
          <div className="text-sm text-neutral-800 truncate">{agent.currentTask.title}</div>
        </div>
      )}
    </button>
  )
}
