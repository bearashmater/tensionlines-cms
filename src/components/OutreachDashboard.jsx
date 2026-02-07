import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  Users, TrendingUp, MessageCircle, CheckCircle, XCircle,
  Target, ChevronDown, ChevronUp, ExternalLink
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

// Bluesky icon (same as ManualPostingQueue)
function BlueskyIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.862 13.862c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69L12 14.492l-1.37 1.37c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69-.964-.964-.964-2.528 0-3.492L9.508 10l-2.37-2.37c-.964-.964-.964-2.528 0-3.492.964-.964 2.528-.964 3.492 0L12 5.508l1.37-1.37c.964-.964 2.528-.964 3.492 0 .964.964.964 2.528 0 3.492L14.492 10l2.37 2.37c.964.964.964 2.528 0 3.492z"/>
    </svg>
  )
}

function StatCard({ icon, label, value, subtitle, color }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    sky: 'bg-sky-50 text-sky-600'
  }
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-neutral-500 mb-1">{label}</p>
          <p className="text-3xl font-bold text-black">{value}</p>
          {subtitle && <p className="text-xs text-neutral-400 mt-1">{subtitle}</p>}
        </div>
        <div className={`p-2.5 rounded-lg ${colorClasses[color] || colorClasses.blue}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function HeatmapCell({ value }) {
  let bg = 'bg-neutral-100'
  if (value >= 5) bg = 'bg-gold text-black font-medium'
  else if (value >= 3) bg = 'bg-amber-300 text-black'
  else if (value >= 1) bg = 'bg-amber-100 text-amber-800'
  return (
    <div className={`rounded h-10 flex items-center justify-center text-sm ${bg}`}>
      {value > 0 ? value : ''}
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

export default function OutreachDashboard() {
  const [sortField, setSortField] = useState('count')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedTarget, setExpandedTarget] = useState(null)

  const { data, error, isLoading } = useSWR('/api/outreach-analytics', fetcher, { refreshInterval: 60000 })

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load outreach analytics</p>
      </div>
    )
  }

  const { summary, byDay, heatmap, themes, targets, engagement } = data

  // Date range for subtitle
  const dateRange = byDay.length > 0
    ? `${byDay[0].label} – ${byDay[byDay.length - 1].label}, 2026`
    : 'No data yet'

  // Sort themes
  const sortedThemes = [...themes].sort((a, b) => {
    const valA = a[sortField]
    const valB = b[sortField]
    return sortDir === 'desc' ? valB - valA : valA - valB
  })

  function toggleThemeSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  function SortIcon({ field }) {
    if (sortField !== field) return null
    return sortDir === 'desc'
      ? <ChevronDown size={14} className="inline ml-0.5" />
      : <ChevronUp size={14} className="inline ml-0.5" />
  }

  const timeSlots = ['morning', 'afternoon', 'evening', 'night']
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const slotLabels = { morning: '5am–12pm', afternoon: '12–5pm', evening: '5–9pm', night: '9pm–5am' }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold text-black flex items-center gap-3">
          <Target className="text-gold" size={32} />
          Outreach Effectiveness
        </h1>
        <p className="text-neutral-600 mt-1">
          Twitter engagement campaign &middot; {dateRange}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users size={22} />}
          label="Total Targets"
          value={summary.totalTargets}
          subtitle={`${summary.avgTargetsPerDay}/day across ${summary.totalDays} days`}
          color="blue"
        />
        <StatCard
          icon={<TrendingUp size={22} />}
          label="Follow-Back Rate"
          value={`${summary.followBackRate}%`}
          subtitle="Of targeted users followed back"
          color="green"
        />
        <StatCard
          icon={<MessageCircle size={22} />}
          label="Reply Rate"
          value={`${summary.replyRate}%`}
          subtitle="Of targeted users replied"
          color="amber"
        />
        <StatCard
          icon={<BlueskyIcon size={22} />}
          label="Bluesky Engagement"
          value={engagement.bluesky.length}
          subtitle="Replies from Bluesky audience"
          color="sky"
        />
      </div>

      {/* Daily Activity Chart */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-black mb-4">Daily Activity</h2>
        {byDay.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byDay} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="label" tick={{ fontSize: 13 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 13 }} />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="targets" name="Targets" fill="#D4A574" radius={[4, 4, 0, 0]} />
              <Bar dataKey="followBacks" name="Follow-Backs" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="replies" name="Replies" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-neutral-400 text-center py-8">No daily data yet</p>
        )}
      </div>

      {/* Heatmap + Theme Performance side by side on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Heatmap */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-black mb-4">Posting Schedule Heatmap</h2>
          <p className="text-xs text-neutral-400 mb-3">Day of week vs time of day (UTC)</p>
          <div className="space-y-1">
            {/* Header row */}
            <div className="grid grid-cols-8 gap-1 text-xs text-neutral-500 text-center">
              <div></div>
              {dayLabels.map(d => <div key={d}>{d}</div>)}
            </div>
            {/* Data rows */}
            {timeSlots.map(slot => (
              <div key={slot} className="grid grid-cols-8 gap-1 items-center">
                <div className="text-xs text-neutral-500 text-right pr-2 truncate" title={slotLabels[slot]}>
                  {slot}
                </div>
                {dayLabels.map(day => (
                  <HeatmapCell key={day} value={heatmap[slot]?.[day] || 0} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Theme Performance */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-black mb-4">Theme Performance</h2>
          {sortedThemes.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left">
                    <th className="py-2 pr-3 text-neutral-500 font-medium">Theme</th>
                    <th className="py-2 px-3 text-neutral-500 font-medium cursor-pointer select-none" onClick={() => toggleThemeSort('count')}>
                      Targets<SortIcon field="count" />
                    </th>
                    <th className="py-2 px-3 text-neutral-500 font-medium cursor-pointer select-none" onClick={() => toggleThemeSort('replies')}>
                      Replies<SortIcon field="replies" />
                    </th>
                    <th className="py-2 px-3 text-neutral-500 font-medium cursor-pointer select-none" onClick={() => toggleThemeSort('followBacks')}>
                      Follows<SortIcon field="followBacks" />
                    </th>
                    <th className="py-2 pl-3 text-neutral-500 font-medium cursor-pointer select-none" onClick={() => toggleThemeSort('replyRate')}>
                      Rate<SortIcon field="replyRate" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedThemes.map((t, i) => (
                    <tr
                      key={t.theme}
                      className={`border-b border-neutral-100 ${i === 0 ? 'border-l-2 border-l-gold' : ''}`}
                    >
                      <td className="py-2.5 pr-3 font-medium text-black">{t.theme}</td>
                      <td className="py-2.5 px-3 text-neutral-700">{t.count}</td>
                      <td className="py-2.5 px-3 text-neutral-700">{t.replies}</td>
                      <td className="py-2.5 px-3 text-neutral-700">{t.followBacks}</td>
                      <td className="py-2.5 pl-3 text-neutral-700">{t.replyRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-neutral-400 text-center py-8">No theme data</p>
          )}
        </div>
      </div>

      {/* All Targets */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-black mb-4">
          All Targets <span className="text-sm font-normal text-neutral-400">({targets.length})</span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left">
                <th className="py-2 pr-3 text-neutral-500 font-medium">Username</th>
                <th className="py-2 px-3 text-neutral-500 font-medium">Date</th>
                <th className="py-2 px-3 text-neutral-500 font-medium">Theme</th>
                <th className="py-2 px-3 text-neutral-500 font-medium text-center">Replied</th>
                <th className="py-2 pl-3 text-neutral-500 font-medium text-center">Followed Back</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t, i) => (
                <tr
                  key={`${t.username}-${t.date}`}
                  className="border-b border-neutral-100 hover:bg-neutral-50 cursor-pointer"
                  onClick={() => setExpandedTarget(expandedTarget === i ? null : i)}
                >
                  <td className="py-2.5 pr-3">
                    <span className="font-medium text-black">{t.username}</span>
                  </td>
                  <td className="py-2.5 px-3 text-neutral-600">
                    {new Date(t.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded-full text-xs">
                      {t.theme}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {t.replied
                      ? <CheckCircle size={16} className="inline text-green-500" />
                      : <XCircle size={16} className="inline text-red-400" />
                    }
                  </td>
                  <td className="py-2.5 pl-3 text-center">
                    {t.followedBack
                      ? <CheckCircle size={16} className="inline text-green-500" />
                      : <XCircle size={16} className="inline text-red-400" />
                    }
                  </td>
                </tr>
              ))}
              {targets.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-neutral-400">
                    No outreach targets recorded yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {expandedTarget !== null && targets[expandedTarget] && (
          <div className="mt-3 p-4 bg-neutral-50 rounded-lg border border-neutral-200 text-sm">
            <p className="text-neutral-500 mb-1">Reason for targeting:</p>
            <p className="text-black">{targets[expandedTarget].reason}</p>
            {targets[expandedTarget].commentedAt && (
              <p className="text-neutral-400 mt-2 text-xs">
                Commented at {new Date(targets[expandedTarget].commentedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bluesky Engagement */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
          <BlueskyIcon size={20} className="text-sky-500" />
          Bluesky Engagement
          <span className="text-sm font-normal text-neutral-400">({engagement.bluesky.length})</span>
        </h2>
        {engagement.bluesky.length > 0 ? (
          <div className="space-y-3">
            {engagement.bluesky.map((item, i) => (
              <div key={i} className="border border-neutral-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-black text-sm">{item.author}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      item.status === 'replied' ? 'bg-green-100 text-green-700' :
                      item.status === 'seen' ? 'bg-amber-100 text-amber-700' :
                      'bg-neutral-100 text-neutral-600'
                    }`}>
                      {item.status}
                    </span>
                  </div>
                  {item.postUrl && (
                    <a href={item.postUrl} target="_blank" rel="noopener noreferrer"
                       className="text-neutral-400 hover:text-black">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                <p className="text-neutral-700 text-sm">{item.text}</p>
                {item.indexedAt && (
                  <p className="text-xs text-neutral-400 mt-2">
                    {new Date(item.indexedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-neutral-400 text-center py-8">No Bluesky engagement yet</p>
        )}

        {/* Twitter engagement section */}
        {engagement.twitter.length > 0 && (
          <>
            <h3 className="text-md font-semibold text-black mt-6 mb-3">Twitter Engagement</h3>
            <div className="space-y-3">
              {engagement.twitter.map((item, i) => (
                <div key={i} className="border border-neutral-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-black text-sm">{item.author}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-neutral-100 text-neutral-600">
                      {item.status}
                    </span>
                  </div>
                  <p className="text-neutral-700 text-sm">{item.text}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
