import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { DollarSign, TrendingUp, AlertTriangle, CheckCircle, Clock, Zap, Info, GitBranch, ChevronDown } from 'lucide-react'

export default function CostDashboard() {
  const [costs, setCosts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showDecisionTree, setShowDecisionTree] = useState(true)

  useEffect(() => {
    loadCosts()
    const interval = setInterval(loadCosts, 120000)
    return () => clearInterval(interval)
  }, [])

  const loadCosts = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/costs')
      const data = await response.json()
      setCosts(data)
      setLoading(false)
    } catch (error) {
      console.error('Failed to load costs:', error)
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Loading cost data...</p>
      </div>
    )
  }

  if (!costs) {
    return (
      <div className="text-center py-12">
        <AlertTriangle size={48} className="text-neutral-300 mx-auto mb-4" />
        <p className="text-neutral-600">Failed to load cost data</p>
      </div>
    )
  }

  const budgetPercent = (costs.daily.total / costs.daily.budget) * 100
  const budgetStatus = budgetPercent >= 90 ? 'danger' : budgetPercent >= 70 ? 'warning' : 'good'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black mb-2">Cost Management</h1>
          <p className="text-neutral-600">Real-time API usage & intelligent model routing</p>
          <div className="mt-3 flex items-center gap-2 text-sm text-neutral-600">
            <Link to="/book-progress" className="hover:text-black">📚 Book Progress</Link>
            <span>·</span>
            <Link to="/tasks" className="hover:text-black">📋 Mission Control</Link>
            <span>·</span>
            <a href="http://localhost:8888" target="_blank" rel="noopener noreferrer" className="hover:text-black">🎯 Dashboard</a>
          </div>
        </div>
        <BudgetStatusBadge status={budgetStatus} />
      </div>

      {/* Decision Tree Section */}
      <div className="bg-white rounded-lg border border-neutral-200">
        <button
          onClick={() => setShowDecisionTree(!showDecisionTree)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <GitBranch size={20} className="text-gold" />
            <div className="text-left">
              <h2 className="text-xl font-serif font-semibold text-black">Model Selection Decision Tree</h2>
              <p className="text-sm text-neutral-600">Which LLM to use for each task type</p>
            </div>
          </div>
          <ChevronDown 
            className={`w-5 h-5 text-neutral-400 transition-transform ${showDecisionTree ? 'rotate-180' : ''}`}
          />
        </button>
        
        {showDecisionTree && (
          <div className="px-6 pb-6 space-y-6 border-t border-neutral-100">
            {/* Model Inventory */}
            <div className="mt-6">
              <h3 className="font-semibold text-black mb-3">🎯 Model Inventory</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="font-semibold text-green-900 text-sm">Ollama qwen2.5:3b</div>
                  <div className="text-xs text-green-700 mt-1">$0 / $0 per M</div>
                  <div className="text-xs text-green-600 mt-1 font-medium">⚡ Fast · Free</div>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="font-semibold text-blue-900 text-sm">Claude Haiku 3.5</div>
                  <div className="text-xs text-blue-700 mt-1">$0.80 / $4 per M</div>
                  <div className="text-xs text-blue-600 mt-1 font-medium">⚡⚡ Very Fast</div>
                </div>
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="font-semibold text-purple-900 text-sm">Claude Sonnet 4.5</div>
                  <div className="text-xs text-purple-700 mt-1">$3 / $15 per M</div>
                  <div className="text-xs text-purple-600 mt-1 font-medium">⚡ Medium · Main</div>
                </div>
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="font-semibold text-red-900 text-sm">Claude Opus 4</div>
                  <div className="text-xs text-red-700 mt-1">$15 / $75 per M</div>
                  <div className="text-xs text-red-600 mt-1 font-medium">🔒 Ask First</div>
                </div>
              </div>
            </div>

            {/* Decision Flow */}
            <div>
              <h3 className="font-semibold text-black mb-3">🌳 Decision Flow</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-3 p-3 bg-green-50 border-l-4 border-green-500 rounded">
                  <div className="font-mono text-green-700 font-bold min-w-[80px] pt-0.5">Ollama</div>
                  <div className="text-neutral-700">
                    <div className="font-semibold text-black mb-1">Routine & Mechanical</div>
                    <div className="text-xs">File ops, JSON parsing, searches, log formatting, basic data extraction</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-blue-50 border-l-4 border-blue-500 rounded">
                  <div className="font-mono text-blue-700 font-bold min-w-[80px] pt-0.5">Haiku</div>
                  <div className="text-neutral-700">
                    <div className="font-semibold text-black mb-1">Drafts & Iterations</div>
                    <div className="text-xs">First drafts, quick reviews, simple edits, routine social posts, basic summaries</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-purple-50 border-l-4 border-purple-500 rounded">
                  <div className="font-mono text-purple-700 font-bold min-w-[80px] pt-0.5">Sonnet</div>
                  <div className="text-neutral-700">
                    <div className="font-semibold text-black mb-1">Core Brand Work</div>
                    <div className="text-xs">Book writing, strategic content, philosophy, complex analysis, final deliverables</div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-red-50 border-l-4 border-red-500 rounded">
                  <div className="font-mono text-red-700 font-bold min-w-[80px] pt-0.5">Opus</div>
                  <div className="text-neutral-700">
                    <div className="font-semibold text-black mb-1">Exceptional & Critical</div>
                    <div className="text-xs mb-1">Major pivots, complex architecture, critical launches, emergency rescues</div>
                    <div className="text-red-600 font-semibold text-xs">⚠️ ASK SHAWN FIRST</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cost Examples */}
            <div>
              <h3 className="font-semibold text-black mb-3">💰 Cost Impact Examples</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                  <div className="font-semibold text-black mb-2">Daily Twitter Outreach</div>
                  <div className="text-neutral-600 space-y-1 text-xs">
                    <div>• Search + parse: <span className="font-mono">Ollama</span> ($0)</div>
                    <div>• Draft 5 comments: <span className="font-mono">Haiku</span> ($0.02-0.05)</div>
                    <div>• Review: <span className="font-mono">Haiku</span> ($0.01)</div>
                    <div className="font-semibold text-green-600 mt-2">Total: ~$0.03-0.06/day</div>
                  </div>
                </div>
                <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                  <div className="font-semibold text-black mb-2">Book Chapter</div>
                  <div className="text-neutral-600 space-y-1 text-xs">
                    <div>• Outline: <span className="font-mono">Haiku</span> ($0.05)</div>
                    <div>• Write draft: <span className="font-mono">Sonnet</span> ($0.50-1.00)</div>
                    <div>• Final polish: <span className="font-mono">Sonnet</span> ($0.20-0.40)</div>
                    <div className="font-semibold text-purple-600 mt-2">Total: ~$0.75-1.45/chapter</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Reference */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <h3 className="font-semibold text-amber-900 mb-2">⚡ Quick Decision Rule</h3>
              <div className="text-sm text-amber-800 space-y-1">
                <div><strong>Always start lower, upgrade if needed:</strong> Ollama → Haiku → Sonnet → Opus (ask first)</div>
                <div><strong>Don't skip tiers</strong> - Haiku might be good enough, save Sonnet for when it matters.</div>
              </div>
            </div>

            {/* Mission Control Integration */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2">📋 Mission Control Integration</h3>
              <div className="text-sm text-blue-800">
                Every task in Mission Control now has an <span className="font-mono bg-white px-1 py-0.5 rounded">"llm"</span> field specifying which model to use. 
                Check <Link to="/tasks" className="font-semibold underline">Mission Control →</Link> to see task-specific assignments.
              </div>
            </div>

            {/* Documentation Link */}
            <div className="text-center pt-2">
              <a 
                href="file:///Users/admin/clawd/MODEL_SELECTION.md" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gold hover:text-black font-medium transition-colors"
              >
                📄 Read Full Decision Tree Documentation →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Alert Banner */}
      {budgetPercent >= 70 && (
        <div className={`rounded-lg border p-4 ${
          budgetStatus === 'danger' 
            ? 'bg-red-50 border-red-200' 
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className={budgetStatus === 'danger' ? 'text-red-600' : 'text-yellow-600'} />
            <div>
              <h3 className="font-semibold text-black mb-1">
                {budgetStatus === 'danger' ? '🚨 Budget Alert' : '⚠️ Budget Warning'}
              </h3>
              <p className="text-sm text-neutral-700">
                {budgetStatus === 'danger' 
                  ? 'Daily budget exceeded. Consider switching to cheaper models.'
                  : 'Approaching daily budget limit. Monitor usage closely.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Daily Budget Card */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-serif font-semibold flex items-center gap-2">
            <DollarSign size={20} className="text-gold" />
            Daily Budget
          </h2>
          <span className="text-sm text-neutral-500">
            Resets at midnight PST
          </span>
        </div>

        <div className="space-y-4">
          {/* Progress Bar */}
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-neutral-600">Spent Today</span>
              <span className="font-semibold text-black">
                ${costs.daily.total.toFixed(2)} / ${costs.daily.budget.toFixed(2)}
              </span>
            </div>
            <div className="w-full bg-neutral-200 rounded-full h-3 overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${
                  budgetStatus === 'danger' ? 'bg-red-500' :
                  budgetStatus === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(budgetPercent, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-neutral-500 mt-1">
              <span>0%</span>
              <span>{budgetPercent.toFixed(0)}%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-neutral-200">
            <StatBox
              label="Remaining"
              value={`$${Math.max(0, costs.daily.budget - costs.daily.total).toFixed(2)}`}
              icon={<DollarSign size={16} />}
              color="text-green-600"
            />
            <StatBox
              label="Requests"
              value={costs.daily.requests}
              icon={<Zap size={16} />}
              color="text-blue-600"
            />
            <StatBox
              label="Avg/Request"
              value={`$${(costs.daily.total / costs.daily.requests || 0).toFixed(3)}`}
              icon={<TrendingUp size={16} />}
              color="text-neutral-600"
            />
          </div>
        </div>
      </div>

      {/* Model Usage */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-2">
          <Zap size={20} className="text-gold" />
          Model Usage Today
        </h2>

        <div className="space-y-3">
          {costs.models.map((model) => (
            <ModelUsageRow key={model.name} model={model} />
          ))}
        </div>
      </div>

      {/* Model Reference Guide */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-2">
          <Info size={20} className="text-gold" />
          When to Use Each Model
        </h2>

        <div className="space-y-4">
          <ModelGuide
            name="Claude Sonnet 4.5"
            cost="$3/$15 per M tokens"
            use="Strategic thinking, complex decisions, main conversation"
            status="active"
          />
          <ModelGuide
            name="Ollama qwen2.5:3b"
            cost="$0 (local)"
            use="Sub-agents, data processing, routine tasks"
            status="active"
          />
          <ModelGuide
            name="Claude Opus 4"
            cost="$15/$75 per M tokens (5x Sonnet)"
            use="Emergency only - requires permission"
            status="restricted"
          />
          <ModelGuide
            name="Claude Haiku 3.5"
            cost="$0.80/$4 per M tokens (73% cheaper)"
            use="Mid-tier tasks, good quality at lower cost"
            status="recommended"
          />
        </div>
      </div>

      {/* Elevation Requests */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-2">
          <Clock size={20} className="text-gold" />
          Elevation Requests
        </h2>

        {costs.elevations.length === 0 ? (
          <p className="text-neutral-500 text-center py-8">
            No elevation requests. Opus usage requires permission.
          </p>
        ) : (
          <div className="space-y-3">
            {costs.elevations.map((request) => (
              <ElevationRequest key={request.id} request={request} />
            ))}
          </div>
        )}

        <div className="mt-4 p-4 bg-neutral-50 rounded-md">
          <p className="text-sm text-neutral-700">
            <strong>Note:</strong> Claude Opus 4 costs 5x more than Sonnet. All Opus requests require explicit approval with justification.
          </p>
        </div>
      </div>

      {/* Weekly Trend */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-2">
          <TrendingUp size={20} className="text-gold" />
          Weekly Trend
        </h2>

        <div className="grid grid-cols-7 gap-2">
          {costs.weekly.map((day) => (
            <DayBar key={day.date} day={day} budget={costs.daily.budget} />
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-neutral-200">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-600">Weekly Total:</span>
            <span className="font-semibold text-black">
              ${costs.weekly.reduce((sum, d) => sum + d.cost, 0).toFixed(2)} / $14.00
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function BudgetStatusBadge({ status }) {
  const config = {
    good: { color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircle, label: 'Within Budget' },
    warning: { color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: AlertTriangle, label: 'Budget Warning' },
    danger: { color: 'bg-red-100 text-red-700 border-red-200', icon: AlertTriangle, label: 'Budget Exceeded' }
  }[status]

  const Icon = config.icon

  return (
    <div className={`px-4 py-2 rounded-lg border ${config.color} flex items-center gap-2`}>
      <Icon size={16} />
      <span className="font-medium text-sm">{config.label}</span>
    </div>
  )
}

function StatBox({ label, value, icon, color }) {
  return (
    <div className="text-center">
      <div className={`${color} flex justify-center mb-1`}>{icon}</div>
      <div className="text-2xl font-serif font-bold text-black">{value}</div>
      <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
    </div>
  )
}

function ModelUsageRow({ model }) {
  const usagePercent = (model.cost / model.total * 100) || 0

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium text-black">{model.name}</span>
        <span className="text-neutral-600">${model.cost.toFixed(3)}</span>
      </div>
      <div className="w-full bg-neutral-200 rounded-full h-2 overflow-hidden">
        <div 
          className="h-full bg-gold transition-all duration-300"
          style={{ width: `${Math.min(usagePercent, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-neutral-500 mt-1">
        <span>{model.requests} requests</span>
        <span>{model.tokens.toLocaleString()} tokens</span>
      </div>
    </div>
  )
}

function ModelGuide({ name, cost, use, status }) {
  const statusConfig = {
    active: { color: 'text-green-600', label: '✅ Active' },
    restricted: { color: 'text-red-600', label: '🔒 Restricted' },
    recommended: { color: 'text-blue-600', label: '💡 Recommended' }
  }[status]

  return (
    <div className="p-4 border border-neutral-200 rounded-md">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-semibold text-black">{name}</h3>
        <span className={`text-sm font-medium ${statusConfig.color}`}>
          {statusConfig.label}
        </span>
      </div>
      <p className="text-sm text-neutral-600 mb-1">
        <strong>Cost:</strong> {cost}
      </p>
      <p className="text-sm text-neutral-700">
        <strong>Use for:</strong> {use}
      </p>
    </div>
  )
}

function ElevationRequest({ request }) {
  return (
    <div className="p-4 border border-neutral-200 rounded-md">
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="font-semibold text-black">Opus Request</span>
          <span className="text-sm text-neutral-500 ml-2">{request.timestamp}</span>
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
          request.status === 'approved' ? 'bg-green-100 text-green-700' :
          'bg-red-100 text-red-700'
        }`}>
          {request.status}
        </span>
      </div>
      <p className="text-sm text-neutral-700 mb-2">
        <strong>Task:</strong> {request.task}
      </p>
      <p className="text-sm text-neutral-600">
        <strong>Justification:</strong> {request.justification}
      </p>
    </div>
  )
}

function DayBar({ day, budget }) {
  const percent = Math.min((day.cost / budget) * 100, 100)
  const overBudget = day.cost > budget

  return (
    <div className="flex flex-col items-center">
      <div className="w-full bg-neutral-200 rounded-t h-24 flex flex-col justify-end overflow-hidden">
        <div 
          className={`w-full ${overBudget ? 'bg-red-500' : 'bg-gold'} transition-all duration-300`}
          style={{ height: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-neutral-500 mt-1">{day.label}</span>
      <span className="text-xs text-neutral-600 font-medium">${day.cost.toFixed(1)}</span>
    </div>
  )
}
