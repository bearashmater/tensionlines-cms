import { useState } from 'react'
import useSWR from 'swr'
import { getAgents, getTasks } from '../lib/api'
import { getInitials, getAgentColor, getStatusColor } from '../lib/formatters'
import { User, CheckCircle, Circle, AlertTriangle } from 'lucide-react'
import AgentProfileModal from './AgentProfileModal'

export default function AgentsView() {
  const [selectedAgent, setSelectedAgent] = useState(null)

  const { data: agents, error } = useSWR('/agents', getAgents, {
    refreshInterval: 120000
  })
  const { data: tasks } = useSWR('/tasks', getTasks, {
    refreshInterval: 120000
  })

  if (error) return <div className="card bg-red-50">Error loading agents</div>
  if (!agents) return <LoadingState />

  // Build map of agent → stuck task count
  const agentStuckCounts = {}
  if (tasks) {
    tasks.forEach(task => {
      if (task.timeTracking?.alertLevel && task.timeTracking.alertLevel !== 'none') {
        (task.assigneeIds || []).forEach(id => {
          agentStuckCounts[id] = (agentStuckCounts[id] || 0) + 1
        })
      }
    })
  }

  const activeAgents = agents.filter(a => a.status === 'active')
  const idleAgents = agents.filter(a => a.status === 'idle')

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Team</h1>
        <p className="text-neutral-600 mt-1">All philosopher agents - click to see their soul</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total" value={agents.length} icon={<User size={20} />} />
        <StatCard label="Active" value={activeAgents.length} icon={<CheckCircle size={20} className="text-green-600" />} />
        <StatCard label="Idle" value={idleAgents.length} icon={<Circle size={20} className="text-gray-400" />} />
      </div>

      {/* Active Agents */}
      {activeAgents.length > 0 && (
        <div>
          <h2 className="text-xl font-serif font-semibold mb-4">Active Agents</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeAgents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                stuckCount={agentStuckCounts[agent.id] || 0}
                onClick={() => setSelectedAgent(agent)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Idle Agents */}
      {idleAgents.length > 0 && (
        <div>
          <h2 className="text-xl font-serif font-semibold mb-4">Idle Agents</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {idleAgents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                stuckCount={agentStuckCounts[agent.id] || 0}
                onClick={() => setSelectedAgent(agent)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Agent Profile Modal */}
      {selectedAgent && (
        <AgentProfileModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}

function AgentCard({ agent, stuckCount = 0, onClick }) {
  const colorClass = getAgentColor(agent.id)
  const statusColor = getStatusColor(agent.status)

  return (
    <button
      onClick={onClick}
      className="card card-hover w-full text-left cursor-pointer transition-all hover:shadow-lg hover:border-gold"
    >
      <div className="flex items-start space-x-3">
        {agent.avatarUrl ? (
          <img
            src={agent.avatarUrl}
            alt={agent.name}
            className="flex-shrink-0 w-12 h-12 rounded-full object-cover"
          />
        ) : (
          <div className={`flex-shrink-0 w-12 h-12 rounded-full ${colorClass} flex items-center justify-center text-white font-bold`}>
            {getInitials(agent.name)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-black truncate">{agent.name}</h3>
          <p className="text-sm text-neutral-600 truncate">{agent.role}</p>
          <div className="mt-2">
            <span className={`badge ${statusColor}`}>
              {agent.status}
            </span>
          </div>
          {stuckCount > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-600">
              <AlertTriangle size={12} /> {stuckCount} stuck task{stuckCount !== 1 ? 's' : ''}
            </div>
          )}
          {agent.currentTaskId && (
            <p className="text-xs text-neutral-500 mt-2">
              Working on: {agent.currentTaskId}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

function StatCard({ label, value, icon }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-600">{label}</p>
          <p className="text-2xl font-bold text-black">{value}</p>
        </div>
        {icon}
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
