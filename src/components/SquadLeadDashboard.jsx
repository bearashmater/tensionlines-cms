import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { RefreshCw, Clock, AlertTriangle, Users, Target } from 'lucide-react'
import { fetcher } from '../lib/api'
import AlertsPanel from './squad-lead/AlertsPanel'
import WorkloadPanel from './squad-lead/WorkloadPanel'
import TimelinePanel from './squad-lead/TimelinePanel'
import AgentDetailPanel from './squad-lead/AgentDetailPanel'

export default function SquadLeadDashboard() {
  const [selectedAgentId, setSelectedAgentId] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // Fetch squad overview data with 30-second refresh
  const { data: overview, error, isLoading, mutate } = useSWR(
    '/api/squad-lead/overview',
    fetcher,
    { refreshInterval: 30000 }
  )

  // Manual refresh handler
  const handleRefresh = () => {
    mutate()
    setLastRefresh(new Date())
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-red-800">Failed to load dashboard</h3>
        <p className="text-red-600 mt-1">{error.message}</p>
        <button
          onClick={handleRefresh}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="w-8 h-8 text-amber-600" />
          <div>
            <h1 className="text-2xl font-serif font-bold text-neutral-900">Squad Lead Dashboard</h1>
            <p className="text-sm text-neutral-500">Team coordination and task oversight</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-neutral-500 flex items-center gap-2">
            <Clock size={16} />
            Last updated: {lastRefresh.toLocaleTimeString()}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Active Agents"
            value={overview.activeAgents}
            total={overview.totalAgents}
            icon={<Users size={20} />}
            color="blue"
          />
          <StatCard
            label="Tasks in Progress"
            value={overview.tasksInProgress}
            icon={<Target size={20} />}
            color="green"
          />
          <StatCard
            label="Stuck Tasks"
            value={overview.stuckTasks}
            icon={<AlertTriangle size={20} />}
            color={overview.stuckTasks > 0 ? 'yellow' : 'neutral'}
          />
          <StatCard
            label="Critical Alerts"
            value={overview.criticalTasks}
            icon={<AlertTriangle size={20} />}
            color={overview.criticalTasks > 0 ? 'red' : 'neutral'}
          />
        </div>
      )}

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          <AlertsPanel
            alerts={overview?.alerts || []}
            isLoading={isLoading}
            onRefresh={handleRefresh}
          />
          <TimelinePanel
            tasks={overview?.upcomingTasks || []}
            isLoading={isLoading}
          />
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {selectedAgentId && (
            <AgentDetailPanel
              agentId={selectedAgentId}
              onClose={() => setSelectedAgentId(null)}
            />
          )}
          <WorkloadPanel
            agents={overview?.agentWorkloads || []}
            isLoading={isLoading}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, total, icon, color }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    neutral: 'bg-neutral-50 text-neutral-600 border-neutral-200'
  }

  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
      <div className="flex items-center justify-between mb-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-3xl font-bold">
        {value}
        {total !== undefined && (
          <span className="text-lg font-normal opacity-60">/{total}</span>
        )}
      </div>
    </div>
  )
}
