import { useState, useEffect, useCallback } from 'react'
import useSWR, { mutate } from 'swr'
import { fetcher } from '../lib/api'
import { PageHeader } from './Navigation'
import {
  Zap,
  Play,
  Power,
  PowerOff,
  Clock,
  CheckCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Settings,
  Lightbulb,
  ChevronDown
} from 'lucide-react'

const PHILOSOPHERS = [
  { id: 'nietzsche', label: 'Nietzsche' },
  { id: 'heraclitus', label: 'Heraclitus' },
  { id: 'hypatia', label: 'Hypatia' },
  { id: 'socrates', label: 'Socrates' },
  { id: 'plato', label: 'Plato' },
  { id: 'aristotle', label: 'Aristotle' },
  { id: 'diogenes', label: 'Diogenes' },
  { id: 'marcus', label: 'Marcus Aurelius' }
]

const ALL_PLATFORMS = ['twitter', 'bluesky', 'instagram', 'reddit', 'medium']

export default function AutoPipeline() {
  const { data: status, error, isLoading } = useSWR('/api/auto-pipeline/status', fetcher, { refreshInterval: 30000 })
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const [saving, setSaving] = useState(false)

  const config = status?.config || {}

  const handleRunNow = useCallback(async () => {
    setRunning(true)
    setRunResult(null)
    try {
      const res = await fetch('/api/auto-pipeline/run', { method: 'POST' })
      const data = await res.json()
      setRunResult(data)
      mutate('/api/auto-pipeline/status')
    } catch (err) {
      setRunResult({ error: err.message })
    } finally {
      setRunning(false)
    }
  }, [])

  const handleToggle = useCallback(async () => {
    setSaving(true)
    try {
      await fetch('/api/auto-pipeline/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !config.enabled })
      })
      mutate('/api/auto-pipeline/status')
    } catch (err) {
      console.error('Toggle error:', err)
    } finally {
      setSaving(false)
    }
  }, [config.enabled])

  const handleConfigSave = useCallback(async (updates) => {
    setSaving(true)
    try {
      await fetch('/api/auto-pipeline/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      mutate('/api/auto-pipeline/status')
    } catch (err) {
      console.error('Config save error:', err)
    } finally {
      setSaving(false)
    }
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-neutral-400" size={32} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 text-red-500" size={24} />
        <p className="text-red-700">Failed to load pipeline status</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Auto-Pipeline"
        subtitle="Automatically draft content from captured ideas"
        icon={<Zap size={28} />}
        actions={
          <div className="flex items-center space-x-3">
            <button
              onClick={handleRunNow}
              disabled={running}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 transition-colors"
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              <span>{running ? 'Running...' : 'Run Now'}</span>
            </button>
          </div>
        }
      />

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-neutral-500">Status</span>
            <button
              onClick={handleToggle}
              disabled={saving}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                config.enabled
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
              }`}
            >
              {config.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="flex items-center space-x-2">
            {config.enabled ? (
              <Power size={20} className="text-green-600" />
            ) : (
              <PowerOff size={20} className="text-neutral-400" />
            )}
            <span className="text-lg font-semibold">
              {config.enabled ? 'Active' : 'Paused'}
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">Daily at 6 AM PST</p>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <span className="text-sm text-neutral-500">Eligible Ideas</span>
          <div className="flex items-center space-x-2 mt-2">
            <Lightbulb size={20} className="text-amber-500" />
            <span className="text-2xl font-bold">{status.eligibleIdeas}</span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">Captured, not yet processed</p>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <span className="text-sm text-neutral-500">Processed Total</span>
          <div className="flex items-center space-x-2 mt-2">
            <CheckCircle size={20} className="text-green-500" />
            <span className="text-2xl font-bold">{status.processedCount}</span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">Ideas auto-drafted to date</p>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <span className="text-sm text-neutral-500">Last Run</span>
          <div className="flex items-center space-x-2 mt-2">
            <Clock size={20} className="text-blue-500" />
            <span className="text-sm font-medium">
              {status.lastRun
                ? new Date(status.lastRun.timestamp).toLocaleString()
                : 'Never'
              }
            </span>
          </div>
          {status.lastRun && (
            <p className="text-xs text-neutral-400 mt-1">
              {status.lastRun.ideasProcessed} ideas, {status.lastRun.draftsQueued} drafts
            </p>
          )}
        </div>
      </div>

      {/* Run Result Banner */}
      {runResult && (
        <div className={`rounded-lg border p-4 mb-6 ${
          runResult.error
            ? 'bg-red-50 border-red-200'
            : runResult.status === 'empty'
              ? 'bg-neutral-50 border-neutral-200'
              : 'bg-green-50 border-green-200'
        }`}>
          {runResult.error ? (
            <div className="flex items-center space-x-2 text-red-700">
              <AlertTriangle size={16} />
              <span>Run failed: {runResult.error}</span>
            </div>
          ) : runResult.status === 'empty' ? (
            <div className="flex items-center space-x-2 text-neutral-600">
              <CheckCircle size={16} />
              <span>No new captured ideas to process.</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-green-700">
              <CheckCircle size={16} />
              <span>
                Processed {runResult.ideasProcessed} idea{runResult.ideasProcessed !== 1 ? 's' : ''} into {runResult.draftsQueued} drafts (queued as pending-review).
                {runResult.errors?.length > 0 && ` ${runResult.errors.length} error(s).`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Config Section */}
      <div className="bg-white rounded-lg border border-neutral-200 mb-6">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full flex items-center justify-between p-4 hover:bg-neutral-50 transition-colors"
        >
          <div className="flex items-center space-x-2">
            <Settings size={18} className="text-neutral-500" />
            <span className="font-medium">Configuration</span>
          </div>
          <ChevronDown size={18} className={`text-neutral-400 transition-transform ${showConfig ? 'rotate-180' : ''}`} />
        </button>

        {showConfig && (
          <ConfigPanel config={config} onSave={handleConfigSave} saving={saving} />
        )}
      </div>

      {/* Recent Runs */}
      <div className="bg-white rounded-lg border border-neutral-200">
        <div className="flex items-center justify-between p-4 border-b border-neutral-100">
          <h3 className="font-medium">Recent Runs</h3>
          <button
            onClick={() => mutate('/api/auto-pipeline/status')}
            className="p-1 hover:bg-neutral-100 rounded"
            title="Refresh"
          >
            <RefreshCw size={14} className="text-neutral-400" />
          </button>
        </div>

        {(!status.recentRuns || status.recentRuns.length === 0) ? (
          <div className="p-8 text-center text-neutral-400">
            No runs yet. Click "Run Now" to start.
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {status.recentRuns.map((run, idx) => (
              <div key={idx} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {run.status === 'success' ? (
                    <CheckCircle size={16} className="text-green-500" />
                  ) : run.status === 'empty' ? (
                    <Clock size={16} className="text-neutral-400" />
                  ) : (
                    <AlertTriangle size={16} className="text-amber-500" />
                  )}
                  <div>
                    <span className="text-sm font-medium">
                      {run.ideasProcessed} idea{run.ideasProcessed !== 1 ? 's' : ''} processed
                    </span>
                    {run.ideaIds?.length > 0 && (
                      <span className="text-xs text-neutral-400 ml-2">
                        ({run.ideaIds.map(id => `#${id}`).join(', ')})
                      </span>
                    )}
                    <span className="text-sm text-neutral-500 ml-2">
                      — {run.draftsQueued} draft{run.draftsQueued !== 1 ? 's' : ''} queued
                    </span>
                  </div>
                </div>
                <span className="text-xs text-neutral-400">
                  {new Date(run.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ConfigPanel({ config, onSave, saving }) {
  const [philosopher, setPhilosopher] = useState(config.philosopher || 'nietzsche')
  const [platforms, setPlatforms] = useState(config.platforms || ALL_PLATFORMS)
  const [maxIdeas, setMaxIdeas] = useState(config.maxIdeasPerRun || 3)

  const togglePlatform = (p) => {
    setPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
  }

  const handleSave = () => {
    onSave({ philosopher, platforms, maxIdeasPerRun: maxIdeas })
  }

  return (
    <div className="p-4 pt-0 space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Philosopher Voice</label>
        <select
          value={philosopher}
          onChange={e => setPhilosopher(e.target.value)}
          className="w-full md:w-64 px-3 py-2 border border-neutral-300 rounded-lg text-sm"
        >
          {PHILOSOPHERS.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-2">Platforms</label>
        <div className="flex flex-wrap gap-2">
          {ALL_PLATFORMS.map(p => (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                platforms.includes(p)
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-neutral-500 border-neutral-300 hover:border-neutral-400'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Max Ideas Per Run</label>
        <select
          value={maxIdeas}
          onChange={e => setMaxIdeas(Number(e.target.value))}
          className="w-32 px-3 py-2 border border-neutral-300 rounded-lg text-sm"
        >
          {[1, 2, 3, 4, 5].map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      <button
        onClick={handleSave}
        disabled={saving || platforms.length === 0}
        className="inline-flex items-center space-x-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 text-sm transition-colors"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : null}
        <span>Save Config</span>
      </button>
    </div>
  )
}
