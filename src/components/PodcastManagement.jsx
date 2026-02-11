import { useState, useCallback } from 'react'
import useSWR, { mutate } from 'swr'
import { fetcher } from '../lib/api'
import { PageHeader } from './Navigation'
import {
  Mic, Play, Loader2, ChevronDown, ChevronUp, Check, X, RotateCcw,
  Scissors, TrendingUp, TrendingDown, Minus, Clock, BarChart3, Filter,
  Lock, Archive, Trash2, RefreshCw, Star
} from 'lucide-react'

const RATING_DIMENSIONS = [
  { key: 'naturalness', label: 'Naturalness', desc: 'Does it sound like real speech?' },
  { key: 'anneVoice', label: 'Anne\'s Voice', desc: 'Does Anne sound like her own person?' },
  { key: 'coupleChemistry', label: 'Couple Chemistry', desc: 'Do they sound married?' },
  { key: 'hookStrength', label: 'Hook Strength', desc: 'Would the first 30 seconds stop you from skipping?' },
  { key: 'tensionQuality', label: 'Tension Quality', desc: 'Is the core tension compelling?' },
  { key: 'pacing', label: 'Pacing', desc: 'Does energy stay up? Any dead stretches?' }
]

const DECISION_COLORS = {
  approved: 'bg-green-100 text-green-800',
  salvaged: 'bg-amber-100 text-amber-800',
  killed: 'bg-red-100 text-red-800',
  reworked: 'bg-blue-100 text-blue-800'
}

function RatingSlider({ dimension, value, onChange }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-neutral-700">{dimension.label}</label>
        <span className="text-sm font-bold text-neutral-900">{value}/5</span>
      </div>
      <p className="text-xs text-neutral-500">{dimension.desc}</p>
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-gold"
      />
      <div className="flex justify-between text-xs text-neutral-400">
        <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
      </div>
    </div>
  )
}

function RatingBars({ ratings, compact = false }) {
  if (!ratings) return <span className="text-xs text-neutral-400">No ratings</span>
  return (
    <div className={compact ? 'flex gap-2 flex-wrap' : 'space-y-1'}>
      {RATING_DIMENSIONS.map(d => {
        const val = ratings[d.key]
        if (val == null) return null
        const pct = (val / 5) * 100
        const color = val >= 4 ? 'bg-green-500' : val >= 3 ? 'bg-amber-500' : 'bg-red-500'
        if (compact) {
          return (
            <div key={d.key} className="flex items-center gap-1 text-xs" title={d.label}>
              <span className="text-neutral-500 w-14 truncate">{d.label.split(' ')[0]}</span>
              <div className="w-12 h-1.5 bg-neutral-200 rounded-full">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-neutral-600 w-4">{val}</span>
            </div>
          )
        }
        return (
          <div key={d.key} className="flex items-center gap-2">
            <span className="text-xs text-neutral-600 w-28 truncate">{d.label}</span>
            <div className="flex-1 h-2 bg-neutral-200 rounded-full">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-medium w-6 text-right">{val}</span>
          </div>
        )
      })}
      {ratings.wouldShare != null && (
        <div className={compact ? 'text-xs' : 'text-sm'}>
          <span className="text-neutral-500">Would share:</span>{' '}
          <span className={ratings.wouldShare ? 'text-green-600 font-medium' : 'text-neutral-400'}>
            {ratings.wouldShare ? 'Yes' : 'No'}
          </span>
        </div>
      )}
    </div>
  )
}

function ScriptViewer({ script }) {
  const [expanded, setExpanded] = useState(false)
  if (!script?.length) return null

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Hide Script' : 'View Script'} ({script.length} lines)
      </button>
      {expanded && (
        <div className="mt-2 max-h-96 overflow-y-auto bg-white rounded border border-neutral-200 p-3 text-sm space-y-1">
          {script.map((line, i) => (
            <div key={i} className={line.speaker?.toLowerCase() === 'shawn' ? 'text-purple-800' : 'text-teal-700'}>
              <span className="font-semibold capitalize">{line.speaker}:</span>{' '}
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TrialStepper({ schedule, currentTrial, trialPhase }) {
  if (!schedule?.length) return null
  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4 mb-6">
      <h3 className="text-sm font-semibold text-neutral-700 mb-3">Trial Progress</h3>
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {schedule.map((step, i) => {
          const isCompleted = step.status === 'completed'
          const isCurrent = trialPhase && (i + 1) === currentTrial
          const formatLabel = step.format === 'best-of' ? 'Best' : step.format === 'runner-up' ? '2nd' : step.format === 'final' ? 'Final' : step.format?.replace('-', ' ')
          return (
            <div key={i} className="flex items-center">
              <div className={`flex flex-col items-center min-w-[60px] ${isCurrent ? 'scale-110' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                  ${isCompleted ? 'bg-green-500 border-green-500 text-white' : isCurrent ? 'bg-gold border-gold text-black' : 'bg-white border-neutral-300 text-neutral-400'}`}>
                  {isCompleted ? <Check size={14} /> : i + 1}
                </div>
                <span className={`text-[10px] mt-1 text-center leading-tight ${isCurrent ? 'font-bold text-black' : 'text-neutral-500'}`}>
                  {formatLabel}
                </span>
              </div>
              {i < schedule.length - 1 && (
                <div className={`w-6 h-0.5 ${isCompleted ? 'bg-green-500' : 'bg-neutral-300'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RatingForm({ onSubmit, submitting }) {
  const [ratings, setRatings] = useState({
    naturalness: 3, anneVoice: 3, coupleChemistry: 3,
    hookStrength: 3, tensionQuality: 3, pacing: 3, wouldShare: false
  })
  const [whatWorked, setWhatWorked] = useState('')
  const [whatDidnt, setWhatDidnt] = useState('')
  const [notes, setNotes] = useState('')
  const [decisionReason, setDecisionReason] = useState('')

  const handleSubmit = (action) => {
    if (!decisionReason.trim()) {
      alert('Decision reason is required')
      return
    }
    onSubmit({ action, ratings, whatWorked, whatDidnt, notes, decisionReason })
  }

  return (
    <div className="space-y-4">
      <h4 className="font-semibold text-neutral-800">Rate This Episode</h4>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <p className="text-xs font-semibold text-neutral-500 uppercase">Authenticity</p>
          {RATING_DIMENSIONS.slice(0, 3).map(d => (
            <RatingSlider
              key={d.key}
              dimension={d}
              value={ratings[d.key]}
              onChange={(v) => setRatings(prev => ({ ...prev, [d.key]: v }))}
            />
          ))}
        </div>
        <div className="space-y-4">
          <p className="text-xs font-semibold text-neutral-500 uppercase">Content</p>
          {RATING_DIMENSIONS.slice(3).map(d => (
            <RatingSlider
              key={d.key}
              dimension={d}
              value={ratings[d.key]}
              onChange={(v) => setRatings(prev => ({ ...prev, [d.key]: v }))}
            />
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={ratings.wouldShare}
          onChange={(e) => setRatings(prev => ({ ...prev, wouldShare: e.target.checked }))}
          className="rounded border-neutral-300"
        />
        <span className="text-sm font-medium text-neutral-700">Would you send this to someone?</span>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-neutral-600">What worked</label>
          <textarea
            value={whatWorked}
            onChange={(e) => setWhatWorked(e.target.value)}
            className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded text-sm"
            rows={2}
            placeholder="Best moments, strongest lines..."
          />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-600">What didn't</label>
          <textarea
            value={whatDidnt}
            onChange={(e) => setWhatDidnt(e.target.value)}
            className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded text-sm"
            rows={2}
            placeholder="Dead spots, forced dialogue..."
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-neutral-600">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded text-sm"
          rows={2}
          placeholder="Any other observations..."
        />
      </div>

      <div>
        <label className="text-xs font-medium text-red-600">Decision reason (required)</label>
        <textarea
          value={decisionReason}
          onChange={(e) => setDecisionReason(e.target.value)}
          className="w-full mt-1 px-3 py-2 border border-neutral-200 rounded text-sm"
          rows={2}
          placeholder="Why are you making this decision?"
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          onClick={() => handleSubmit('approve')}
          disabled={submitting}
          className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Approve
        </button>
        <button
          onClick={() => handleSubmit('rework')}
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Rework
        </button>
        <button
          onClick={() => handleSubmit('salvage')}
          disabled={submitting}
          className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
          Salvage
        </button>
        <button
          onClick={() => handleSubmit('kill')}
          disabled={submitting}
          className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          Kill
        </button>
      </div>
    </div>
  )
}

function PendingReview({ episode, onAction }) {
  const [submitting, setSubmitting] = useState(false)
  const [reviewsExpanded, setReviewsExpanded] = useState(false)
  const meta = episode.metadata || {}

  const handleAction = useCallback(async ({ action, ratings, whatWorked, whatDidnt, notes, decisionReason }) => {
    setSubmitting(true)
    try {
      // Submit trial review with ratings
      if (meta.trialNumber) {
        await fetch('/api/podcast/trial-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            episodeId: episode.id,
            format: meta.format,
            ratings,
            whatWorked,
            whatDidnt,
            notes,
            decisionReason
          })
        })
      }

      // Execute the decision
      const endpoint = `/api/podcast/${episode.id}/${action}`
      const body = {
        reason: decisionReason,
        ratings,
        notes: action === 'rework' ? decisionReason : undefined
      }
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      mutate('/api/podcast/overview')
      mutate('/api/podcast/history')
      mutate('/api/podcast/quality-trends')
      if (onAction) onAction()
    } catch (err) {
      console.error('Action failed:', err)
      alert('Action failed: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }, [episode.id, meta.format, meta.trialNumber, onAction])

  const reviews = meta.reviews || {}
  const reviewAgents = Object.entries(reviews).filter(([k]) => k !== 'error')

  return (
    <div className="bg-white rounded-lg border-2 border-gold p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded">Pending Review</span>
            {meta.trialNumber && (
              <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 rounded">
                Trial #{meta.trialNumber}
              </span>
            )}
            <span className="px-2 py-0.5 text-xs font-medium bg-neutral-100 text-neutral-700 rounded">
              {meta.formatName || meta.format}
            </span>
          </div>
          <h3 className="text-lg font-serif font-bold text-black">{episode.title}</h3>
          {episode.subtitle && <p className="text-sm text-neutral-600 mt-0.5">{episode.subtitle}</p>}
        </div>
        <div className="text-right text-xs text-neutral-500">
          <div>{meta.exchangeCount} exchanges</div>
          <div>~{meta.estDuration} min</div>
          <div>{meta.wordCount?.toLocaleString()} words</div>
        </div>
      </div>

      {meta.topic && (
        <p className="text-sm text-neutral-700 mb-3">
          <span className="font-medium">Topic:</span> {meta.topic}
        </p>
      )}

      <ScriptViewer script={meta.script} />

      {/* Agent Reviews */}
      {reviewAgents.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setReviewsExpanded(!reviewsExpanded)}
            className="flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900"
          >
            {reviewsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Agent Reviews ({reviewAgents.length})
          </button>
          {reviewsExpanded && (
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              {reviewAgents.map(([agent, review]) => (
                <div key={agent} className="p-2 bg-neutral-50 rounded border border-neutral-200 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium capitalize">{agent}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded ${
                      review.verdict === 'pass' ? 'bg-green-100 text-green-700' :
                      review.verdict === 'reject' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>{review.verdict}</span>
                  </div>
                  <p className="text-neutral-600 text-xs">{review.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Athena Note */}
      {meta.athenaNote && (
        <div className="mt-3 p-2 bg-purple-50 rounded border border-purple-200 text-sm">
          <span className="font-medium text-purple-800">Production Note:</span>{' '}
          <span className="text-purple-700">{meta.athenaNote}</span>
        </div>
      )}

      <hr className="my-4 border-neutral-200" />

      <RatingForm onSubmit={handleAction} submitting={submitting} />
    </div>
  )
}

function EpisodeCard({ episode }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {episode.decision && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${DECISION_COLORS[episode.decision] || 'bg-neutral-100 text-neutral-600'}`}>
                {episode.decision}
              </span>
            )}
            <span className="px-2 py-0.5 text-xs bg-neutral-100 text-neutral-600 rounded">
              {episode.format}
            </span>
            {episode.trialNumber && (
              <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                Trial #{episode.trialNumber}
              </span>
            )}
          </div>
          <h4 className="font-medium text-neutral-900">{episode.title || 'Untitled'}</h4>
          {episode.topic && <p className="text-sm text-neutral-600 mt-0.5">{episode.topic}</p>}
        </div>
        <div className="text-right text-xs text-neutral-500 ml-3">
          <div>{episode.duration || ''}</div>
          <div>{episode.publishedAt ? new Date(episode.publishedAt).toLocaleDateString() : ''}</div>
        </div>
      </div>

      {episode.decisionReason && (
        <p className="text-sm text-neutral-600 mt-2 bg-neutral-50 rounded p-2 italic">
          "{episode.decisionReason}"
        </p>
      )}

      {episode.ratings && (
        <div className="mt-2">
          <RatingBars ratings={episode.ratings} compact />
        </div>
      )}

      {(episode.tensions?.length > 0 || episode.practiceGiven) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-neutral-500 hover:text-neutral-700 flex items-center gap-1"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Less' : 'More details'}
        </button>
      )}

      {expanded && (
        <div className="mt-2 text-sm space-y-1">
          {episode.tensions?.length > 0 && (
            <div><span className="font-medium">Tensions:</span> {episode.tensions.join(', ')}</div>
          )}
          {episode.practiceGiven && (
            <div><span className="font-medium">Practice:</span> {episode.practiceGiven}</div>
          )}
          {episode.unresolvedThreads?.length > 0 && (
            <div><span className="font-medium">Unresolved:</span> {episode.unresolvedThreads.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  )
}

function FormatAnalytics({ trends, overview }) {
  if (!trends || trends.totalReviews === 0) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-4 text-center text-neutral-500 text-sm">
        No reviews yet. Rate episodes to see format analytics.
      </div>
    )
  }

  const formats = Object.entries(trends.byFormat).filter(([, v]) => v.count > 0)
  if (formats.length === 0) return null

  // Find the winning format
  const best = formats.reduce((a, b) => {
    const aAvg = Object.values(a[1].averages).filter(v => v != null).reduce((s, v) => s + v, 0) / Object.values(a[1].averages).filter(v => v != null).length || 0
    const bAvg = Object.values(b[1].averages).filter(v => v != null).reduce((s, v) => s + v, 0) / Object.values(b[1].averages).filter(v => v != null).length || 0
    return bAvg > aAvg ? b : a
  })

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-neutral-700">Format Comparison</h3>
        {overview?.trialPhase && (
          <LockFormatButton bestFormat={best[0]} formats={overview.formats} />
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200">
              <th className="pb-2 pr-3">Format</th>
              <th className="pb-2 pr-3 text-center">Episodes</th>
              {RATING_DIMENSIONS.map(d => (
                <th key={d.key} className="pb-2 pr-2 text-center" title={d.label}>
                  {d.label.split(' ')[0]}
                </th>
              ))}
              <th className="pb-2 text-center">Share %</th>
            </tr>
          </thead>
          <tbody>
            {formats.map(([fmt, data]) => {
              const isBest = fmt === best[0]
              return (
                <tr key={fmt} className={`border-b border-neutral-100 ${isBest ? 'bg-green-50' : ''}`}>
                  <td className="py-2 pr-3 font-medium flex items-center gap-1">
                    {isBest && <Star size={12} className="text-green-600" />}
                    {fmt.replace('-', ' ')}
                  </td>
                  <td className="py-2 pr-3 text-center">{data.count}</td>
                  {RATING_DIMENSIONS.map(d => (
                    <td key={d.key} className="py-2 pr-2 text-center">
                      {data.averages[d.key] != null ? (
                        <span className={data.averages[d.key] >= 4 ? 'text-green-600 font-medium' : data.averages[d.key] < 3 ? 'text-red-600' : ''}>
                          {data.averages[d.key]}
                        </span>
                      ) : '-'}
                    </td>
                  ))}
                  <td className="py-2 text-center">{data.shareRate != null ? `${data.shareRate}%` : '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LockFormatButton({ bestFormat, formats }) {
  const [locking, setLocking] = useState(false)

  const handleLock = useCallback(async () => {
    if (!confirm(`Lock in "${formats[bestFormat]?.name || bestFormat}" as the standard format? This ends the trial phase.`)) return
    setLocking(true)
    try {
      await fetch('/api/podcast/standardize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: bestFormat })
      })
      mutate('/api/podcast/overview')
    } catch (err) {
      console.error('Lock format error:', err)
    } finally {
      setLocking(false)
    }
  }, [bestFormat, formats])

  return (
    <button
      onClick={handleLock}
      disabled={locking}
      className="px-3 py-1 text-xs font-medium bg-gold text-black rounded hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1"
    >
      {locking ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
      Lock in format
    </button>
  )
}

function ContentBank({ bank }) {
  const [tab, setTab] = useState('salvaged')
  const [toggling, setToggling] = useState(null)

  const handleToggleReuse = useCallback(async (id, current) => {
    setToggling(id)
    try {
      await fetch(`/api/podcast/bank/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markedForReuse: !current })
      })
      mutate('/api/podcast/bank')
    } catch (err) {
      console.error('Toggle reuse error:', err)
    } finally {
      setToggling(null)
    }
  }, [])

  if (!bank) return null
  const salvaged = bank.salvaged || []
  const killed = bank.killed || []

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setTab('salvaged')}
          className={`px-3 py-1 text-sm rounded-md ${tab === 'salvaged' ? 'bg-amber-100 text-amber-800 font-medium' : 'text-neutral-600 hover:bg-neutral-100'}`}
        >
          Salvaged ({salvaged.length})
        </button>
        <button
          onClick={() => setTab('killed')}
          className={`px-3 py-1 text-sm rounded-md ${tab === 'killed' ? 'bg-red-100 text-red-800 font-medium' : 'text-neutral-600 hover:bg-neutral-100'}`}
        >
          Killed Topics ({killed.length})
        </button>
      </div>

      {tab === 'salvaged' && (
        <div className="space-y-2">
          {salvaged.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-4">No salvaged content yet</p>
          ) : salvaged.map(item => (
            <div key={item.id} className="p-3 bg-amber-50 rounded border border-amber-200 text-sm">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-medium text-amber-800">{item.topic}</span>
                  {item.reusedIn && <span className="ml-2 text-xs text-green-600">Reused in {item.reusedIn}</span>}
                </div>
                <button
                  onClick={() => handleToggleReuse(item.id, item.markedForReuse)}
                  disabled={toggling === item.id}
                  className={`text-xs px-2 py-0.5 rounded ${item.markedForReuse ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-600'} hover:opacity-80`}
                >
                  {toggling === item.id ? '...' : item.markedForReuse ? 'Marked for reuse' : 'Mark for reuse'}
                </button>
              </div>
              {item.reason && <p className="text-xs text-neutral-600 mt-1">Reason: {item.reason}</p>}
              {item.usableParts?.goodLines?.length > 0 && (
                <div className="mt-1">
                  <span className="text-xs text-neutral-500">Good lines:</span>
                  <ul className="text-xs text-neutral-600 ml-3 list-disc">
                    {item.usableParts.goodLines.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'killed' && (
        <div className="space-y-1">
          {killed.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-4">No killed topics yet</p>
          ) : killed.map((topic, i) => (
            <div key={i} className="flex items-center gap-2 p-2 bg-red-50 rounded text-sm">
              <Trash2 size={12} className="text-red-400" />
              <span className="text-red-800">{topic}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function GenerationControls({ overview }) {
  const [generating, setGenerating] = useState(false)
  const [format, setFormat] = useState('')
  const [result, setResult] = useState(null)

  const formats = overview?.formats || {}

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setResult(null)
    try {
      const body = format ? { format } : {}
      const res = await fetch('/api/podcast/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      setResult(data)
      mutate('/api/podcast/overview')
    } catch (err) {
      setResult({ error: err.message })
    } finally {
      setGenerating(false)
    }
  }, [format])

  const nextDate = overview?.nextScheduled ? new Date(overview.nextScheduled) : null
  const now = new Date()
  const hoursUntil = nextDate ? Math.max(0, Math.round((nextDate - now) / 3600000)) : null

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4">
      <h3 className="text-sm font-semibold text-neutral-700 mb-3">Generation Controls</h3>

      <div className="flex items-center gap-3 mb-3">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="px-3 py-2 border border-neutral-200 rounded text-sm"
        >
          <option value="">Auto-select format</option>
          {Object.entries(formats).map(([key, fmt]) => (
            <option key={key} value={key}>{fmt.name} ({fmt.duration})</option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-4 py-2 bg-gold text-black rounded-md text-sm font-medium hover:bg-amber-400 disabled:opacity-50 flex items-center gap-1"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Generate Now
        </button>
      </div>

      {nextDate && (
        <p className="text-xs text-neutral-500 flex items-center gap-1">
          <Clock size={12} />
          Next scheduled: {nextDate.toLocaleString()} ({hoursUntil}h from now)
        </p>
      )}

      {result && (
        <div className={`mt-3 p-2 rounded text-sm ${result.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {result.error ? `Error: ${result.error}` : `Generated "${result.title}" (${result.formatName}, ${result.exchanges} exchanges)`}
        </div>
      )}
    </div>
  )
}

export default function PodcastManagement() {
  const { data: overview, isLoading } = useSWR('/api/podcast/overview', fetcher, { refreshInterval: 30000 })
  const { data: history } = useSWR('/api/podcast/history', fetcher, { refreshInterval: 60000 })
  const { data: trends } = useSWR('/api/podcast/quality-trends', fetcher, { refreshInterval: 60000 })
  const { data: bank } = useSWR('/api/podcast/bank', fetcher, { refreshInterval: 60000 })

  const [historyFilter, setHistoryFilter] = useState('all')
  const [historyFormat, setHistoryFormat] = useState('all')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-neutral-400" />
      </div>
    )
  }

  const qualityTrend = overview?.qualityTrend || {}
  const trendDir = qualityTrend.current != null && qualityTrend.previous != null
    ? (qualityTrend.current > qualityTrend.previous ? 'up' : qualityTrend.current < qualityTrend.previous ? 'down' : 'flat')
    : null

  // Filter history
  let filteredHistory = history?.episodes || []
  if (historyFilter !== 'all') {
    filteredHistory = filteredHistory.filter(e => e.decision === historyFilter)
  }
  if (historyFormat !== 'all') {
    filteredHistory = filteredHistory.filter(e => e.format === historyFormat)
  }

  return (
    <div>
      <PageHeader
        title="Podcast"
        subtitle="The Tension Lines — Shawn + Anne"
        icon={<Mic size={28} />}
      />

      {/* Dashboard Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <div className="text-xs text-neutral-500 mb-1">Trial Progress</div>
          {overview?.trialPhase ? (
            <>
              <div className="text-2xl font-bold text-black">{Math.max(0, (overview.currentTrial || 1) - 1)}/8</div>
              <div className="mt-1 w-full h-2 bg-neutral-200 rounded-full">
                <div
                  className="h-full bg-gold rounded-full transition-all"
                  style={{ width: `${Math.max(0, (overview.currentTrial || 1) - 1) / 8 * 100}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-bold text-green-700">Locked</div>
              <div className="text-xs text-neutral-500">{overview?.formats?.[overview?.standardFormat]?.name || overview?.standardFormat}</div>
            </>
          )}
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <div className="text-xs text-neutral-500 mb-1">Total Episodes</div>
          <div className="text-2xl font-bold text-black">{overview?.totalEpisodes || 0}</div>
          <div className="flex gap-2 mt-1 text-xs">
            <span className="text-green-600">{overview?.approved || 0} approved</span>
            <span className="text-amber-600">{overview?.salvaged || 0} salvaged</span>
            <span className="text-red-600">{overview?.killed || 0} killed</span>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <div className="text-xs text-neutral-500 mb-1">Quality Trend</div>
          {qualityTrend.current != null ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-black">{qualityTrend.current}</span>
                {trendDir === 'up' && <TrendingUp size={18} className="text-green-600" />}
                {trendDir === 'down' && <TrendingDown size={18} className="text-red-600" />}
                {trendDir === 'flat' && <Minus size={18} className="text-neutral-400" />}
              </div>
              <div className="text-xs text-neutral-500 mt-1">avg rating (last 3)</div>
            </>
          ) : (
            <div className="text-lg text-neutral-400">No data</div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <div className="text-xs text-neutral-500 mb-1">Next Generation</div>
          {overview?.nextScheduled ? (
            <>
              <div className="text-lg font-bold text-black">
                {(() => {
                  const h = Math.max(0, Math.round((new Date(overview.nextScheduled) - new Date()) / 3600000))
                  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`
                })()}
              </div>
              <div className="text-xs text-neutral-500">Mon 9:30 AM PST</div>
            </>
          ) : (
            <div className="text-lg text-neutral-400">--</div>
          )}
        </div>
      </div>

      {/* Trial Stepper */}
      {overview?.trialPhase && (
        <TrialStepper
          schedule={overview.trialSchedule}
          currentTrial={overview.currentTrial}
          trialPhase={overview.trialPhase}
        />
      )}

      {/* Pending Review */}
      {overview?.pendingEpisode && (
        <PendingReview episode={overview.pendingEpisode} />
      )}

      {/* Episode History */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-serif font-semibold text-black flex items-center gap-2">
            <BarChart3 size={18} />
            Episode History
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              className="px-2 py-1 border border-neutral-200 rounded text-xs"
            >
              <option value="all">All decisions</option>
              <option value="approved">Approved</option>
              <option value="salvaged">Salvaged</option>
              <option value="killed">Killed</option>
            </select>
            <select
              value={historyFormat}
              onChange={(e) => setHistoryFormat(e.target.value)}
              className="px-2 py-1 border border-neutral-200 rounded text-xs"
            >
              <option value="all">All formats</option>
              {Object.entries(overview?.formats || {}).map(([key, fmt]) => (
                <option key={key} value={key}>{fmt.name}</option>
              ))}
            </select>
          </div>
        </div>
        {filteredHistory.length === 0 ? (
          <div className="bg-white rounded-lg border border-neutral-200 p-8 text-center text-neutral-500 text-sm">
            No episodes yet. Generate your first episode below.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredHistory.map(ep => (
              <EpisodeCard key={ep.id} episode={ep} />
            ))}
          </div>
        )}
      </div>

      {/* Format Analytics */}
      <div className="mb-6">
        <h3 className="text-lg font-serif font-semibold text-black mb-3 flex items-center gap-2">
          <BarChart3 size={18} />
          Format Analytics
        </h3>
        <FormatAnalytics trends={trends} overview={overview} />
      </div>

      {/* Content Bank */}
      <div className="mb-6">
        <h3 className="text-lg font-serif font-semibold text-black mb-3 flex items-center gap-2">
          <Archive size={18} />
          Content Bank
        </h3>
        <ContentBank bank={bank} />
      </div>

      {/* Generation Controls */}
      <GenerationControls overview={overview} />
    </div>
  )
}
