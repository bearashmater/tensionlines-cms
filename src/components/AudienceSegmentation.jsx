import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  Users, TrendingUp, Layers, ChevronDown, ChevronUp,
  Camera, Sparkles, BarChart3, Activity
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts'

const SEGMENT_COLORS = {
  'Religion & Ethics': '#8B5CF6',
  'Polarity & Paradox': '#D4A574',
  'Identity & Meaning': '#3B82F6',
  'Movement & Stillness': '#10B981',
  'Creative Expression': '#F59E0B',
  'Practical Wisdom': '#EF4444',
  'Philosophy (General)': '#6B7280'
}

const BEHAVIOR_LABELS = {
  active_engager: { label: 'Active Engagers', desc: 'Replied or followed back', color: '#10B981' },
  silent_follower: { label: 'Silent Followers', desc: 'Followed back, never replied', color: '#3B82F6' },
  prospect: { label: 'Prospects', desc: 'Outreach target, no engagement yet', color: '#F59E0B' },
  organic: { label: 'Organic', desc: 'Found us via engagement inbox', color: '#8B5CF6' }
}

function StatCard({ icon, label, value, subtitle }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-neutral-500 mb-1">{label}</p>
          <p className="text-3xl font-bold text-black">{value}</p>
          {subtitle && <p className="text-xs text-neutral-400 mt-1">{subtitle}</p>}
        </div>
        <div className="p-2.5 rounded-lg bg-neutral-100 text-neutral-600">
          {icon}
        </div>
      </div>
    </div>
  )
}

const CustomBarTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-black mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-neutral-600">
          {p.name}: <span className="font-medium text-black">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

const CustomLineTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-black mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="text-sm">
          {p.name}: <span className="font-medium">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

export default function AudienceSegmentation() {
  const [expandedSegment, setExpandedSegment] = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [recsLoading, setRecsLoading] = useState(false)

  const { data, error, isLoading, mutate } = useSWR('/api/audience-segments', fetcher, {
    refreshInterval: 60000
  })

  async function takeSnapshot() {
    setSnapshotLoading(true)
    try {
      await fetch('/api/audience-segments/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generateRecommendations: false })
      })
      mutate()
    } catch (e) {
      console.error('Snapshot failed:', e)
    }
    setSnapshotLoading(false)
  }

  async function generateRecs() {
    setRecsLoading(true)
    try {
      await fetch('/api/audience-segments/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generateRecommendations: true })
      })
      mutate()
    } catch (e) {
      console.error('Recommendations failed:', e)
    }
    setRecsLoading(false)
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-red-600">Failed to load audience segments</p>
      </div>
    )
  }

  const {
    segments = [], behaviorCounts = {}, totalPeople = 0,
    activeSegments = 0, overallEngagementRate = 0, topTheme = 'None',
    snapshots = [], recommendations = []
  } = data

  // Cold start
  if (totalPeople < 5) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-3xl font-serif font-bold text-black mb-2">Audience Segmentation</h1>
          <p className="text-neutral-600">Understand who engages with TensionLines by topic interest and behavior.</p>
        </div>
        <div className="card p-8 text-center">
          <Layers size={48} className="mx-auto text-neutral-300 mb-4" />
          <h2 className="text-xl font-semibold text-black mb-2">Building Your Audience Map</h2>
          <p className="text-neutral-600 mb-6 max-w-md mx-auto">
            Segmentation works best with more data. Keep engaging through outreach and comments
            to build up your audience picture.
          </p>
          <div className="max-w-xs mx-auto">
            <div className="flex justify-between text-sm text-neutral-500 mb-1">
              <span>{totalPeople} people tracked</span>
              <span>5 needed</span>
            </div>
            <div className="w-full bg-neutral-200 rounded-full h-3">
              <div
                className="bg-gold h-3 rounded-full transition-all"
                style={{ width: `${Math.min((totalPeople / 5) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Bar chart data
  const barData = segments.map(s => ({
    name: s.theme.replace(' & ', '\n& ').replace(' (', '\n('),
    shortName: s.theme.split(' ')[0],
    members: s.memberCount,
    active: s.activeCount,
    color: s.color
  }))

  // Behavior data for progress bars
  const behaviorEntries = Object.entries(BEHAVIOR_LABELS).map(([key, meta]) => ({
    key,
    ...meta,
    count: behaviorCounts[key] || 0,
    pct: totalPeople > 0 ? Math.round(((behaviorCounts[key] || 0) / totalPeople) * 100) : 0
  }))

  // Growth chart from snapshots
  const growthData = snapshots.map(snap => ({
    date: new Date(snap.takenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    total: snap.totalPeople,
    engagement: snap.overallEngagementRate,
    ...(snap.segments || []).reduce((acc, s) => {
      acc[s.theme] = s.memberCount
      return acc
    }, {})
  }))

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-serif font-bold text-black mb-2">Audience Segmentation</h1>
            <p className="text-neutral-600">
              {totalPeople} people tracked across {activeSegments} topic segments.
              {snapshots.length > 0 && ` ${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''} saved.`}
            </p>
          </div>
          <button
            onClick={takeSnapshot}
            disabled={snapshotLoading}
            className="flex items-center space-x-2 px-4 py-2 bg-black text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 transition-colors"
          >
            <Camera size={16} />
            <span>{snapshotLoading ? 'Saving...' : 'Take Snapshot'}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<Users size={20} />}
          label="Total People"
          value={totalPeople}
          subtitle="Across all segments"
        />
        <StatCard
          icon={<Layers size={20} />}
          label="Active Segments"
          value={activeSegments}
          subtitle="With 1+ members"
        />
        <StatCard
          icon={<Activity size={20} />}
          label="Engagement Rate"
          value={`${overallEngagementRate}%`}
          subtitle="Active + organic"
        />
        <StatCard
          icon={<TrendingUp size={20} />}
          label="Top Theme"
          value={topTheme.split(' ')[0]}
          subtitle={topTheme}
        />
      </div>

      {/* Segment Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Bar Chart */}
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-black mb-4 flex items-center space-x-2">
            <BarChart3 size={18} />
            <span>Segment Distribution</span>
          </h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="shortName" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="members" name="Members" radius={[4, 4, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Behavior Breakdown */}
        <div className="card p-5">
          <h2 className="text-lg font-semibold text-black mb-4 flex items-center space-x-2">
            <Activity size={18} />
            <span>Behavior Breakdown</span>
          </h2>
          <div className="space-y-5">
            {behaviorEntries.map(b => (
              <div key={b.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <span className="text-sm font-medium text-black">{b.label}</span>
                    <span className="text-xs text-neutral-400 ml-2">{b.desc}</span>
                  </div>
                  <span className="text-sm font-semibold text-black">{b.count} ({b.pct}%)</span>
                </div>
                <div className="w-full bg-neutral-100 rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full transition-all"
                    style={{ width: `${b.pct}%`, backgroundColor: b.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Growth Over Time */}
      <div className="card p-5 mb-6">
        <h2 className="text-lg font-semibold text-black mb-4 flex items-center space-x-2">
          <TrendingUp size={18} />
          <span>Growth Over Time</span>
        </h2>
        {snapshots.length >= 2 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={growthData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomLineTooltip />} />
              <Line type="monotone" dataKey="total" name="Total People" stroke="#000" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="engagement" name="Engagement %" stroke="#D4A574" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-center py-8">
            <Camera size={32} className="mx-auto text-neutral-300 mb-3" />
            <p className="text-neutral-500">
              {snapshots.length === 0 ? 'Take your first snapshot' : 'Take one more snapshot'} to see growth trends.
            </p>
            <button
              onClick={takeSnapshot}
              disabled={snapshotLoading}
              className="mt-3 px-4 py-2 bg-neutral-100 text-neutral-700 rounded-lg hover:bg-neutral-200 transition-colors text-sm"
            >
              {snapshotLoading ? 'Saving...' : 'Take Snapshot'}
            </button>
          </div>
        )}
      </div>

      {/* Segment Detail Cards */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-black mb-4">Segment Details</h2>
        <div className="space-y-3">
          {segments.filter(s => s.memberCount > 0).map(seg => {
            const isExpanded = expandedSegment === seg.theme
            return (
              <div key={seg.theme} className="card overflow-hidden">
                <button
                  onClick={() => setExpandedSegment(isExpanded ? null : seg.theme)}
                  className="w-full p-4 flex items-center justify-between hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                    <span className="font-medium text-black">{seg.theme}</span>
                    <span className="text-sm text-neutral-500">
                      {seg.memberCount} member{seg.memberCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-neutral-500">{seg.engagementRate}% engaged</span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-neutral-100 p-4 bg-neutral-50">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {seg.members.map((m, i) => (
                        <div key={i} className="text-sm bg-white rounded-md px-3 py-2 border border-neutral-100">
                          <span className="font-medium text-black">{m.username}</span>
                          <span className="block text-xs text-neutral-400">{m.behavior.replace('_', ' ')} · {m.platform}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Content Recommendations */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-black flex items-center space-x-2">
            <Sparkles size={18} />
            <span>Content Recommendations</span>
          </h2>
          <button
            onClick={generateRecs}
            disabled={recsLoading}
            className="flex items-center space-x-2 px-3 py-1.5 bg-neutral-100 text-neutral-700 rounded-lg hover:bg-neutral-200 disabled:opacity-50 transition-colors text-sm"
          >
            <Sparkles size={14} />
            <span>{recsLoading ? 'Generating...' : 'Generate Recommendations'}</span>
          </button>
        </div>

        {recommendations.length > 0 ? (
          <div className="space-y-3">
            {recommendations.map((rec, i) => (
              <div key={i} className="border border-neutral-100 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-black">{rec.title}</h3>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full text-white flex-shrink-0 ml-2"
                    style={{ backgroundColor: SEGMENT_COLORS[rec.segment] || '#6B7280' }}
                  >
                    {rec.segment}
                  </span>
                </div>
                <p className="text-sm text-neutral-600 mb-2">{rec.rationale}</p>
                <div className="flex items-center space-x-3 text-xs text-neutral-400">
                  <span>Platform: {rec.platform}</span>
                  <span>Philosopher: {rec.philosopher}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-neutral-500 text-sm">
              No recommendations yet. Click "Generate Recommendations" to get AI-powered content ideas for each segment.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
