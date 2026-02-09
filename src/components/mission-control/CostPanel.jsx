import useSWR from 'swr'
import { DollarSign, TrendingUp, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const fetcher = (url) => fetch(url).then(r => r.json())

export default function CostPanel() {
  const { data: costs } = useSWR('/api/costs', fetcher, { refreshInterval: 30000 })
  const { data: forecast } = useSWR('/api/costs/forecast', fetcher, { refreshInterval: 300000 })

  if (!costs) {
    return <div className="text-center py-8 text-neutral-400">Loading cost data...</div>
  }

  const budgetPercent = costs.daily?.budget ? (costs.daily.total / costs.daily.budget) * 100 : 0
  const budgetColor = budgetPercent >= 90 ? 'bg-red-500' : budgetPercent >= 70 ? 'bg-amber-500' : 'bg-green-500'

  return (
    <div className="space-y-4">
      {/* Daily Budget Bar */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-serif font-semibold flex items-center gap-2">
            <DollarSign size={18} /> Daily Budget
          </h3>
          <span className="text-sm font-medium">
            ${costs.daily?.total?.toFixed(2) || '0.00'} / ${costs.daily?.budget?.toFixed(2) || '2.00'}
          </span>
        </div>
        <div className="w-full bg-neutral-100 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${budgetColor}`}
            style={{ width: `${Math.min(100, budgetPercent)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs text-neutral-400">
          <span>{Math.round(budgetPercent)}% used</span>
          <span>{costs.daily?.requests || 0} requests today</span>
        </div>
      </div>

      {/* Model Usage Breakdown */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4">
        <h3 className="text-lg font-serif font-semibold mb-3">Model Usage</h3>
        {costs.models && costs.models.length > 0 ? (
          <div className="space-y-3">
            {costs.models.map((model, i) => {
              const maxCost = Math.max(...costs.models.map(m => m.cost || m.total || 0), 0.01)
              const modelCost = model.cost || model.total || 0
              const barWidth = (modelCost / maxCost) * 100
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-neutral-700">{model.name}</span>
                    <span className="text-neutral-500">${modelCost.toFixed(4)} ({model.requests || 0} req)</span>
                  </div>
                  <div className="w-full bg-neutral-100 rounded-full h-2">
                    <div
                      className="bg-gold h-2 rounded-full transition-all"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-neutral-400 text-sm">No model usage data</p>
        )}
      </div>

      {/* Weekly Trend */}
      {costs.weekly && costs.weekly.length > 0 && (
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <h3 className="text-lg font-serif font-semibold mb-3 flex items-center gap-2">
            <TrendingUp size={18} /> Weekly Trend
          </h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costs.weekly}>
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 10 }} width={35} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v) => [`$${v.toFixed(2)}`, 'Cost']} />
                <Bar dataKey="cost" fill="#d4a843" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Budget Forecast */}
      {forecast && (
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <h3 className="text-sm font-medium text-neutral-600 mb-2">Budget Forecast</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-neutral-400">Daily avg</span>
              <p className="font-medium">${forecast.dailyAverage?.toFixed(2) || '—'}</p>
            </div>
            <div>
              <span className="text-neutral-400">Monthly projected</span>
              <p className="font-medium">${forecast.monthlyProjected?.toFixed(2) || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Elevation Requests */}
      {costs.elevations && costs.elevations.length > 0 && (
        <div className="bg-white rounded-lg border border-amber-200 p-4">
          <h3 className="text-sm font-medium text-amber-700 flex items-center gap-2 mb-2">
            <AlertTriangle size={14} /> Elevation Requests
          </h3>
          <div className="space-y-2">
            {costs.elevations.map((elev, i) => (
              <div key={i} className="text-sm text-neutral-600 py-1 border-b border-neutral-100 last:border-0">
                <span className="font-medium">{elev.task || elev.reason}</span>
                {elev.model && <span className="text-neutral-400 ml-2">({elev.model})</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
