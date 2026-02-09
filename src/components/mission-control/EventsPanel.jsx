import useSWR from 'swr'
import { Clock, CheckCircle, XCircle, RefreshCw } from 'lucide-react'

const fetcher = (url) => fetch(url).then(r => r.json())

const TYPE_COLORS = {
  cron: 'bg-green-100 text-green-700',
  interval: 'bg-blue-100 text-blue-700',
  error: 'bg-red-100 text-red-700',
  debug: 'bg-purple-100 text-purple-700',
  backup: 'bg-teal-100 text-teal-700',
  pipeline: 'bg-amber-100 text-amber-700',
}

export default function EventsPanel() {
  const { data: cronsData } = useSWR('/api/system/crons', fetcher, { refreshInterval: 60000 })
  const { data: eventsData } = useSWR('/api/system/events', fetcher, { refreshInterval: 15000 })

  const crons = cronsData?.crons || []
  const events = eventsData?.events || []

  return (
    <div className="space-y-6">
      {/* Cron Status Grid */}
      <div>
        <h3 className="text-lg font-serif font-semibold mb-3">Scheduled Jobs</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {crons.map(cron => (
            <div key={cron.id} className="bg-white rounded-lg border border-neutral-200 p-3">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-medium text-neutral-800 truncate">{cron.id}</h4>
                <ResultBadge result={cron.lastResult} />
              </div>
              <p className="text-xs text-neutral-400 mb-2 truncate" title={cron.description}>
                {cron.description}
              </p>
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span className="font-mono">{cron.schedule}</span>
                <span>{cron.runCount} runs</span>
              </div>
              {cron.lastRun && (
                <div className="flex items-center gap-1 mt-1 text-xs text-neutral-400">
                  <Clock size={10} />
                  <span>{timeAgo(cron.lastRun)}</span>
                </div>
              )}
              {!cron.lastRun && (
                <div className="flex items-center gap-1 mt-1 text-xs text-neutral-300">
                  <Clock size={10} />
                  <span>Never run</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Live Event Log */}
      <div>
        <h3 className="text-lg font-serif font-semibold mb-3">System Event Log</h3>
        <div className="bg-white rounded-lg border border-neutral-200">
          {events.length === 0 ? (
            <div className="p-6 text-center text-neutral-400 text-sm">
              No system events yet. Events appear when cron jobs run.
            </div>
          ) : (
            <div className="divide-y divide-neutral-100 max-h-96 overflow-y-auto">
              {events.map(event => (
                <div key={event.id} className="px-4 py-3 flex items-start gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap mt-0.5 ${TYPE_COLORS[event.type] || 'bg-neutral-100 text-neutral-600'}`}>
                    {event.type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-neutral-700">{event.message}</p>
                  </div>
                  <span className="text-xs text-neutral-400 whitespace-nowrap flex-shrink-0">
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultBadge({ result }) {
  if (!result) return <span className="text-xs text-neutral-300">-</span>
  if (result === 'error') return <XCircle size={14} className="text-red-500" />
  if (result === 'skipped' || result === 'disabled') return <RefreshCw size={14} className="text-neutral-400" />
  return <CheckCircle size={14} className="text-green-500" />
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
