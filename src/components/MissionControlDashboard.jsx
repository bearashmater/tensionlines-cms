import { useState } from 'react'
import useSWR from 'swr'
import { Rocket, Users, Calendar, DollarSign, Bug, Activity, Server, Cpu, Wifi, WifiOff, ListTodo, Clock } from 'lucide-react'
import { useWebSocket } from '../lib/useWebSocket'
import AgentsPanel from './mission-control/AgentsPanel'
import EventsPanel from './mission-control/EventsPanel'
import CostPanel from './mission-control/CostPanel'
import DebugPanel from './mission-control/DebugPanel'
import OverviewPanel from './mission-control/OverviewPanel'

const fetcher = (url) => fetch(url).then(r => r.json())

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'agents', label: 'Agents', icon: Users },
  { id: 'events', label: 'Events', icon: Calendar },
  { id: 'costs', label: 'Costs', icon: DollarSign },
  { id: 'debug', label: 'Debug', icon: Bug },
]

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function MissionControlDashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const wsConnected = useWebSocket()

  const { data: health } = useSWR('/api/health', fetcher, { refreshInterval: 60000 })
  const { data: dashboard } = useSWR('/api/dashboard', fetcher, { refreshInterval: 30000 })
  const { data: costs } = useSWR('/api/costs', fetcher, { refreshInterval: 30000 })

  const agentCount = dashboard?.metrics?.totalAgents || 0
  const activeTaskCount = dashboard?.metrics?.activeTasks || 0
  const budgetUsed = costs?.daily?.total || 0
  const budgetMax = costs?.daily?.budget || 2

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold text-black flex items-center gap-2">
          <Rocket size={28} /> Mission Control
        </h1>
        <p className="text-neutral-600 mt-1">Real-time system dashboard</p>
      </div>

      {/* Status Bar */}
      <div className="bg-white rounded-lg border border-neutral-200 px-4 py-3">
        <div className="grid grid-cols-2 md:flex md:items-center md:gap-6 gap-3 text-sm">
          <StatusItem icon={<Clock size={14} />} label="Uptime" value={health ? formatUptime(health.uptime) : '...'} />
          <StatusItem icon={<Cpu size={14} />} label="Memory" value={health ? `${health.memory.heapUsed}MB` : '...'} />
          <StatusItem
            icon={wsConnected ? <Wifi size={14} className="text-green-500" /> : <WifiOff size={14} className="text-red-500" />}
            label="WS"
            value={wsConnected ? 'Connected' : 'Disconnected'}
            valueClass={wsConnected ? 'text-green-600' : 'text-red-600'}
          />
          <StatusItem icon={<Users size={14} />} label="Agents" value={`${agentCount}`} />
          <StatusItem icon={<ListTodo size={14} />} label="Tasks" value={`${activeTaskCount} active`} />
          <StatusItem
            icon={<DollarSign size={14} />}
            label="Budget"
            value={`$${budgetUsed.toFixed(2)}/$${budgetMax.toFixed(2)}`}
            valueClass={budgetUsed / budgetMax > 0.9 ? 'text-red-600' : budgetUsed / budgetMax > 0.7 ? 'text-amber-600' : 'text-green-600'}
          />
        </div>
      </div>

      {/* Tab Pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-gold text-white'
                  : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
              }`}
            >
              <Icon size={16} />
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Active Panel */}
      <div>
        {activeTab === 'overview' && <OverviewPanel />}
        {activeTab === 'agents' && <AgentsPanel />}
        {activeTab === 'events' && <EventsPanel />}
        {activeTab === 'costs' && <CostPanel />}
        {activeTab === 'debug' && <DebugPanel />}
      </div>
    </div>
  )
}

function StatusItem({ icon, label, value, valueClass = '' }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-neutral-400">{label}:</span>
      <span className={`font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}
