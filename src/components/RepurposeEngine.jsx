import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  Sparkles,
  Twitter,
  Instagram,
  MessageCircle,
  BookOpen,
  Hash,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  CheckSquare,
  Square,
  AlertTriangle,
  Send,
  Type,
  Lightbulb,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'

// Bluesky icon
function BlueskyIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.862 13.862c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69L12 14.492l-1.37 1.37c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69-.964-.964-.964-2.528 0-3.492L9.508 10l-2.37-2.37c-.964-.964-.964-2.528 0-3.492.964-.964 2.528-.964 3.492 0L12 5.508l1.37-1.37c.964-.964 2.528-.964 3.492 0 .964.964.964 2.528 0 3.492L14.492 10l2.37 2.37c.964.964.964 2.528 0 3.492z"/>
    </svg>
  )
}

const PLATFORMS = {
  twitter: { label: 'Twitter', icon: (s) => <Twitter size={s} className="text-sky-500" />, limit: 280, unit: 'chars' },
  bluesky: { label: 'Bluesky', icon: (s) => <BlueskyIcon size={s} className="text-blue-500" />, limit: 300, unit: 'chars' },
  instagram: { label: 'Instagram', icon: (s) => <Instagram size={s} className="text-pink-500" />, limit: 2200, unit: 'chars' },
  reddit: { label: 'Reddit', icon: (s) => <Hash size={s} className="text-orange-500" />, limit: 300, unit: 'words' },
  medium: { label: 'Medium', icon: (s) => <BookOpen size={s} className="text-green-700" />, limit: 200, unit: 'words' },
  threads: { label: 'Threads', icon: (s) => <MessageCircle size={s} className="text-gray-700" />, limit: 500, unit: 'chars' }
}

const PHILOSOPHERS = [
  { id: 'nietzsche', label: 'Nietzsche' },
  { id: 'heraclitus', label: 'Heraclitus' },
  { id: 'hypatia', label: 'Hypatia' },
  { id: 'socrates', label: 'Socrates' },
  { id: 'plato', label: 'Plato' },
  { id: 'aristotle', label: 'Aristotle' },
  { id: 'diogenes', label: 'Diogenes' },
  { id: 'marcus', label: 'Marcus Aurelius' },
  { id: 'leonardo', label: 'Leonardo' },
  { id: 'tension', label: 'TensionLines' }
]

const VOICE_COLORS = {
  strong: { bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500', text: 'text-green-700' },
  good: { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', text: 'text-blue-700' },
  weak: { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', text: 'text-amber-700' },
  'off-voice': { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', text: 'text-red-700' }
}

function VoiceCheckBadge({ result, loading, onRecheck }) {
  const [expanded, setExpanded] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-50 border border-neutral-200 text-xs text-neutral-500 mb-3">
        <Loader2 size={12} className="animate-spin" />
        Checking voice...
      </div>
    )
  }

  if (!result) return null

  const colors = VOICE_COLORS[result.verdict] || VOICE_COLORS.good
  const severityDot = { low: 'bg-blue-400', medium: 'bg-amber-400', high: 'bg-red-400' }

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} mb-3 text-xs`}>
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
        <span className={`font-medium ${colors.text}`}>{result.score}</span>
        <span className={colors.text}>{result.verdict}</span>
        <ChevronRight size={12} className={`${colors.text} transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <button
          onClick={(e) => { e.stopPropagation(); onRecheck() }}
          className="ml-auto text-neutral-400 hover:text-neutral-600"
          title="Re-check voice"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      {expanded && (
        <div className={`px-3 pb-2 space-y-1.5 ${colors.text}`}>
          {result.strengths?.length > 0 && (
            <div>
              <span className="font-medium">Strengths:</span>
              {result.strengths.map((s, i) => <p key={i} className="ml-2">+ {s}</p>)}
            </div>
          )}
          {result.issues?.length > 0 && (
            <div>
              <span className="font-medium">Issues:</span>
              {result.issues.map((issue, i) => (
                <p key={i} className="ml-2 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${severityDot[issue.severity] || severityDot.low}`} />
                  {issue.description}
                </p>
              ))}
            </div>
          )}
          {result.suggestions?.length > 0 && (
            <div>
              <span className="font-medium">Suggestions:</span>
              {result.suggestions.map((s, i) => <p key={i} className="ml-2">- {s}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function RepurposeEngine() {
  // Source state
  const [sourceMode, setSourceMode] = useState('idea') // 'idea' | 'text'
  const [selectedIdeaId, setSelectedIdeaId] = useState('')
  const [rawText, setRawText] = useState('')

  // Controls
  const [philosopher, setPhilosopher] = useState('nietzsche')
  const [selectedPlatforms, setSelectedPlatforms] = useState(
    Object.keys(PLATFORMS).reduce((acc, k) => ({ ...acc, [k]: true }), {})
  )

  // Generation state
  const [status, setStatus] = useState('idle') // idle | loading | drafts | queued
  const [drafts, setDrafts] = useState({})
  const [editedDrafts, setEditedDrafts] = useState({})
  const [checkedDrafts, setCheckedDrafts] = useState({})
  const [error, setError] = useState(null)
  const [queueResult, setQueueResult] = useState(null)

  // Voice check state
  const [voiceChecks, setVoiceChecks] = useState({})       // { platform: result }
  const [voiceCheckLoading, setVoiceCheckLoading] = useState({}) // { platform: bool }

  // Fetch ideas for dropdown
  const { data: ideas } = useSWR('/api/ideas', fetcher)

  const activePlatforms = Object.entries(selectedPlatforms)
    .filter(([, v]) => v)
    .map(([k]) => k)

  const canGenerate = (sourceMode === 'idea' ? selectedIdeaId : rawText.trim()) && activePlatforms.length > 0

  async function runVoiceCheck(platform, content, phil) {
    setVoiceCheckLoading(prev => ({ ...prev, [platform]: true }))
    try {
      const res = await fetch('/api/voice-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, philosopher: phil, platform })
      })
      const data = await res.json()
      if (res.ok) {
        setVoiceChecks(prev => ({ ...prev, [platform]: data }))
      }
    } catch (err) {
      console.error(`Voice check failed for ${platform}:`, err)
    }
    setVoiceCheckLoading(prev => ({ ...prev, [platform]: false }))
  }

  function getDraftContent(platform, draft) {
    if (platform === 'instagram') return [draft.cardText, draft.caption].filter(Boolean).join('\n\n')
    if (platform === 'reddit') return [draft.title, draft.body].filter(Boolean).join('\n\n')
    return draft.content || ''
  }

  async function handleGenerate() {
    setStatus('loading')
    setError(null)
    setDrafts({})
    setEditedDrafts({})
    setCheckedDrafts({})
    setVoiceChecks({})
    setVoiceCheckLoading({})
    setQueueResult(null)

    try {
      const body = {
        platforms: activePlatforms,
        philosopher
      }
      if (sourceMode === 'idea') {
        body.ideaId = selectedIdeaId
      } else {
        body.rawText = rawText
      }

      const res = await fetch('/api/repurpose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Generation failed')
      }

      setDrafts(data.drafts)
      // Initialize editable copies and check all by default
      const edited = {}
      const checked = {}
      for (const [platform, draft] of Object.entries(data.drafts)) {
        edited[platform] = { ...draft }
        checked[platform] = true
      }
      setEditedDrafts(edited)
      setCheckedDrafts(checked)
      setStatus('drafts')

      // Auto-run voice checks in parallel
      for (const [platform, draft] of Object.entries(data.drafts)) {
        const content = platform === 'instagram'
          ? [draft.cardText, draft.caption].filter(Boolean).join('\n\n')
          : platform === 'reddit'
            ? [draft.title, draft.body].filter(Boolean).join('\n\n')
            : draft.content || ''
        if (content) runVoiceCheck(platform, content, philosopher)
      }
    } catch (err) {
      setError(err.message)
      setStatus('idle')
    }
  }

  async function handleQueueSelected() {
    const toQueue = Object.entries(checkedDrafts)
      .filter(([, v]) => v)
      .map(([platform]) => ({
        platform,
        ...editedDrafts[platform],
        ideaId: sourceMode === 'idea' ? selectedIdeaId : undefined,
        philosopher
      }))

    if (toQueue.length === 0) return

    try {
      const res = await fetch('/api/repurpose/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drafts: toQueue })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Queue failed')

      setQueueResult(data)
      setStatus('queued')
    } catch (err) {
      setError(err.message)
    }
  }

  function togglePlatform(p) {
    setSelectedPlatforms(prev => ({ ...prev, [p]: !prev[p] }))
  }

  function updateDraftField(platform, field, value) {
    setEditedDrafts(prev => ({
      ...prev,
      [platform]: { ...prev[platform], [field]: value }
    }))
  }

  function getCharCount(platform) {
    const draft = editedDrafts[platform]
    if (!draft) return 0
    if (platform === 'instagram') return draft.caption?.length || 0
    if (platform === 'reddit') return draft.body?.split(/\s+/).length || 0
    if (platform === 'medium') return draft.content?.split(/\s+/).length || 0
    return draft.content?.length || 0
  }

  function getLimit(platform) {
    return PLATFORMS[platform]?.limit || 0
  }

  function isOverLimit(platform) {
    return getCharCount(platform) > getLimit(platform)
  }

  function reset() {
    setStatus('idle')
    setDrafts({})
    setEditedDrafts({})
    setCheckedDrafts({})
    setVoiceChecks({})
    setVoiceCheckLoading({})
    setError(null)
    setQueueResult(null)
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold text-black flex items-center gap-3">
          <Sparkles className="text-amber-500" size={28} />
          Content Repurposer
        </h1>
        <p className="text-neutral-600 mt-1">
          Turn one idea into platform-ready drafts in any philosopher's voice
        </p>
      </div>

      {/* Source Section */}
      <div className="bg-white rounded-xl border border-neutral-200 p-6">
        <h2 className="text-lg font-semibold text-black mb-4">Source</h2>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setSourceMode('idea')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sourceMode === 'idea'
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-neutral-50 text-neutral-600 border border-neutral-200 hover:bg-neutral-100'
            }`}
          >
            <Lightbulb size={16} />
            Pick an Idea
          </button>
          <button
            onClick={() => setSourceMode('text')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              sourceMode === 'text'
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-neutral-50 text-neutral-600 border border-neutral-200 hover:bg-neutral-100'
            }`}
          >
            <Type size={16} />
            Paste Text
          </button>
        </div>

        {sourceMode === 'idea' ? (
          <div className="relative">
            <select
              value={selectedIdeaId}
              onChange={(e) => setSelectedIdeaId(e.target.value)}
              className="w-full p-3 pr-10 border border-neutral-200 rounded-lg bg-white text-sm appearance-none cursor-pointer"
            >
              <option value="">Select an idea...</option>
              {ideas && ideas.map(idea => (
                <option key={idea.id} value={idea.id}>
                  #{idea.id}{idea.repurposeCount ? ` (${idea.repurposeCount}x)` : ''} — {(idea.quote || idea.text || '(no text)').slice(0, 80)}{(idea.quote || idea.text || '').length > 80 ? '...' : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          </div>
        ) : (
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste your idea, quote, or raw thought here..."
            rows={4}
            className="w-full p-3 border border-neutral-200 rounded-lg text-sm resize-y"
          />
        )}
      </div>

      {/* Controls Row */}
      <div className="bg-white rounded-xl border border-neutral-200 p-6">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Philosopher */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-neutral-700 mb-2">Voice</label>
            <div className="relative">
              <select
                value={philosopher}
                onChange={(e) => setPhilosopher(e.target.value)}
                className="w-full p-3 pr-10 border border-neutral-200 rounded-lg bg-white text-sm appearance-none cursor-pointer"
              >
                {PHILOSOPHERS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            </div>
          </div>

          {/* Platforms */}
          <div className="flex-[2]">
            <label className="block text-sm font-medium text-neutral-700 mb-2">Platforms</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PLATFORMS).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => togglePlatform(key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    selectedPlatforms[key]
                      ? 'bg-white border-neutral-300 text-black shadow-sm'
                      : 'bg-neutral-50 border-neutral-100 text-neutral-400'
                  }`}
                >
                  {p.icon(16)}
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <div className="mt-6">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || status === 'loading'}
            className="flex items-center gap-2 px-6 py-3 bg-gold text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {status === 'loading' ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={20} />
                Generate Drafts
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <p className="text-sm font-medium text-red-800">Generation Failed</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Queued Success */}
      {status === 'queued' && queueResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <Check className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-green-800">
            {queueResult.count} draft{queueResult.count !== 1 ? 's' : ''} added to posting queue
          </h3>
          <p className="text-sm text-green-600 mt-1">
            Head to the <a href="/posting-queue" className="underline font-medium">Posting Queue</a> to review and publish.
          </p>
          <button
            onClick={reset}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-green-100 rounded-lg hover:bg-green-200"
          >
            <RefreshCw size={16} />
            Repurpose Another
          </button>
        </div>
      )}

      {/* Drafts Grid */}
      {status === 'drafts' && Object.keys(editedDrafts).length > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Object.entries(editedDrafts).map(([platform, draft]) => {
              const spec = PLATFORMS[platform]
              if (!spec) return null

              const count = getCharCount(platform)
              const limit = getLimit(platform)
              const over = count > limit
              const unit = spec.unit

              return (
                <div key={platform} className="bg-white rounded-xl border border-neutral-200 p-5">
                  {/* Card Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {spec.icon(20)}
                      <h3 className="font-semibold text-black">{spec.label}</h3>
                    </div>
                    <button
                      onClick={() => setCheckedDrafts(prev => ({ ...prev, [platform]: !prev[platform] }))}
                      className="text-neutral-400 hover:text-amber-600"
                      title={checkedDrafts[platform] ? 'Deselect' : 'Select for queue'}
                    >
                      {checkedDrafts[platform]
                        ? <CheckSquare size={20} className="text-amber-600" />
                        : <Square size={20} />
                      }
                    </button>
                  </div>

                  {/* Voice Check Badge */}
                  <VoiceCheckBadge
                    result={voiceChecks[platform]}
                    loading={voiceCheckLoading[platform]}
                    onRecheck={() => runVoiceCheck(platform, getDraftContent(platform, draft), philosopher)}
                  />

                  {/* Platform-specific fields */}
                  {platform === 'instagram' ? (
                    <>
                      <label className="block text-xs font-medium text-neutral-500 mb-1">Card Text (for Canva image)</label>
                      <textarea
                        value={draft.cardText || ''}
                        onChange={(e) => updateDraftField(platform, 'cardText', e.target.value)}
                        rows={2}
                        className="w-full p-2 border border-neutral-200 rounded-lg text-sm mb-2 resize-y"
                      />
                      <div className="flex justify-end mb-3">
                        <span className={`text-xs ${(draft.cardText?.length || 0) > 100 ? 'text-red-500 font-medium' : 'text-neutral-400'}`}>
                          {draft.cardText?.length || 0}/100 chars
                        </span>
                      </div>
                      <label className="block text-xs font-medium text-neutral-500 mb-1">Caption</label>
                      <textarea
                        value={draft.caption || ''}
                        onChange={(e) => updateDraftField(platform, 'caption', e.target.value)}
                        rows={5}
                        className="w-full p-2 border border-neutral-200 rounded-lg text-sm resize-y"
                      />
                      <div className="flex justify-end mt-1">
                        <span className={`text-xs ${over ? 'text-red-500 font-medium' : 'text-neutral-400'}`}>
                          {count}/{limit} {unit}
                        </span>
                      </div>
                    </>
                  ) : platform === 'reddit' ? (
                    <>
                      <label className="block text-xs font-medium text-neutral-500 mb-1">Title</label>
                      <input
                        type="text"
                        value={draft.title || ''}
                        onChange={(e) => updateDraftField(platform, 'title', e.target.value)}
                        className="w-full p-2 border border-neutral-200 rounded-lg text-sm mb-2"
                      />
                      <label className="block text-xs font-medium text-neutral-500 mb-1">Body</label>
                      <textarea
                        value={draft.body || ''}
                        onChange={(e) => updateDraftField(platform, 'body', e.target.value)}
                        rows={6}
                        className="w-full p-2 border border-neutral-200 rounded-lg text-sm resize-y"
                      />
                      <div className="flex justify-end mt-1">
                        <span className={`text-xs ${over ? 'text-red-500 font-medium' : 'text-neutral-400'}`}>
                          {count}/{limit} {unit}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <textarea
                        value={draft.content || ''}
                        onChange={(e) => updateDraftField(platform, 'content', e.target.value)}
                        rows={platform === 'medium' ? 6 : 4}
                        className="w-full p-2 border border-neutral-200 rounded-lg text-sm resize-y"
                      />
                      <div className="flex justify-end mt-1">
                        <span className={`text-xs ${over ? 'text-red-500 font-medium' : 'text-neutral-400'}`}>
                          {count}/{limit} {unit}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between bg-white rounded-xl border border-neutral-200 p-4">
            <div className="text-sm text-neutral-600">
              {Object.values(checkedDrafts).filter(Boolean).length} of {Object.keys(editedDrafts).length} selected
            </div>
            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200"
              >
                <RefreshCw size={16} />
                Start Over
              </button>
              <button
                onClick={handleQueueSelected}
                disabled={Object.values(checkedDrafts).filter(Boolean).length === 0}
                className="flex items-center gap-2 px-5 py-2 bg-gold text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
              >
                {Object.entries(checkedDrafts).some(([p, checked]) => checked && voiceChecks[p]?.score < 60) && (
                  <AlertTriangle size={16} className="text-amber-200" />
                )}
                <Send size={16} />
                Queue Selected
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
