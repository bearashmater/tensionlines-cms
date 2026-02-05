import { useState, useEffect } from 'react'
import { X, User, CheckCircle, Clock, Activity, FileText, Heart } from 'lucide-react'
import { getAgentSoul } from '../lib/api'
import { getInitials, getAgentColor } from '../lib/formatters'

/**
 * Modal showing an agent's full profile - their soul, philosophy, and essence
 */
export default function AgentProfileModal({ agent, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('soul')

  useEffect(() => {
    if (!agent) return

    setLoading(true)
    setError(null)

    getAgentSoul(agent.id)
      .then(setData)
      .catch(err => {
        console.error('Failed to load agent soul:', err)
        setError('Failed to load agent profile')
      })
      .finally(() => setLoading(false))
  }, [agent?.id])

  if (!agent) return null

  const colorClass = getAgentColor(agent.id)

  // Parse soul content into sections for nicer display
  const parseSoulSections = (content) => {
    if (!content) return []

    const sections = []
    const lines = content.split('\n')
    let currentSection = null

    for (const line of lines) {
      if (line.match(/^##?\s+/)) {
        if (currentSection) sections.push(currentSection)
        currentSection = {
          title: line.replace(/^##?\s+/, '').replace(/-.*$/, '').trim(),
          content: []
        }
      } else if (currentSection) {
        currentSection.content.push(line)
      }
    }

    if (currentSection) sections.push(currentSection)
    return sections
  }

  const soulSections = data?.soul ? parseSoulSections(data.soul) : []

  // Extract key info from soul
  const extractKeyInfo = (content) => {
    if (!content) return {}

    const info = {}

    const roleMatch = content.match(/\*\*Role:\*\*\s*(.+)/i)
    if (roleMatch) info.role = roleMatch[1].trim()

    const philMatch = content.match(/\*\*Philosophy:\*\*\s*(.+)/i)
    if (philMatch) info.philosophy = philMatch[1].trim()

    const vibeMatch = content.match(/\*\*Vibe:\*\*\s*(.+)/i)
    if (vibeMatch) info.vibe = vibeMatch[1].trim()

    const emojiMatch = content.match(/\*\*Emoji:\*\*\s*(.+)/i)
    if (emojiMatch) info.emoji = emojiMatch[1].trim()

    return info
  }

  const keyInfo = extractKeyInfo(data?.soul)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-neutral-200 bg-gradient-to-r from-neutral-50 to-white">
          <div className="flex items-center gap-4">
            {data?.avatarUrl ? (
              <img
                src={data.avatarUrl}
                alt={agent.name}
                className="w-16 h-16 rounded-full object-cover shadow-lg"
              />
            ) : (
              <div className={`w-16 h-16 rounded-full ${colorClass} flex items-center justify-center text-white text-2xl font-bold shadow-lg`}>
                {keyInfo.emoji || getInitials(agent.name)}
              </div>
            )}
            <div>
              <h2 className="text-2xl font-serif font-bold text-black">{agent.name}</h2>
              <p className="text-neutral-600">{keyInfo.role || agent.role}</p>
              {keyInfo.vibe && (
                <p className="text-sm text-neutral-500 italic mt-1">"{keyInfo.vibe}"</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 rounded-full"
          >
            <X size={24} className="text-neutral-500" />
          </button>
        </div>

        {/* Stats bar */}
        {data?.stats && (
          <div className="px-6 py-3 bg-neutral-50 border-b border-neutral-200 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-green-500" />
              <span className="text-sm">
                <strong>{data.stats.completedTasks}</strong> completed
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-blue-500" />
              <span className="text-sm">
                <strong>{data.stats.activeTasks}</strong> active
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-gold" />
              <span className="text-sm">
                <strong>{data.stats.completionRate}%</strong> completion rate
              </span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="px-6 border-b border-neutral-200">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('soul')}
              className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'soul'
                  ? 'border-gold text-gold'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Heart size={16} className="inline mr-1" />
              Soul & Philosophy
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'activity'
                  ? 'border-gold text-gold'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <Activity size={16} className="inline mr-1" />
              Recent Activity
            </button>
            {data?.heartbeat && (
              <button
                onClick={() => setActiveTab('heartbeat')}
                className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'heartbeat'
                    ? 'border-gold text-gold'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <FileText size={16} className="inline mr-1" />
                Heartbeat
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-12 h-12 border-4 border-gold border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-500">
              <p>{error}</p>
            </div>
          ) : activeTab === 'soul' ? (
            <div className="space-y-6">
              {keyInfo.philosophy && (
                <div className="bg-gold bg-opacity-10 rounded-lg p-4 border-l-4 border-gold">
                  <p className="text-lg italic text-neutral-700">
                    "{keyInfo.philosophy}"
                  </p>
                </div>
              )}

              {data?.soul ? (
                <div className="prose prose-neutral max-w-none">
                  {soulSections.map((section, idx) => (
                    <div key={idx} className="mb-6">
                      <h3 className="text-lg font-semibold text-black mb-2 flex items-center">
                        {section.title}
                      </h3>
                      <div className="text-neutral-700 whitespace-pre-wrap text-sm leading-relaxed pl-2 border-l-2 border-neutral-200">
                        {section.content.join('\n').trim()}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-neutral-500">
                  <User size={48} className="mx-auto mb-4 text-neutral-300" />
                  <p>No soul file found for this agent.</p>
                  <p className="text-sm mt-2">This agent's philosophy hasn't been documented yet.</p>
                </div>
              )}
            </div>
          ) : activeTab === 'activity' ? (
            <div className="space-y-3">
              {data?.recentActivities && data.recentActivities.length > 0 ? (
                data.recentActivities.map((activity, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 bg-neutral-50 rounded-lg"
                  >
                    <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center flex-shrink-0">
                      <Activity size={14} className="text-neutral-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-800">{activity.description}</p>
                      <p className="text-xs text-neutral-500 mt-1">
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-neutral-500">
                  <Activity size={48} className="mx-auto mb-4 text-neutral-300" />
                  <p>No recent activity recorded.</p>
                </div>
              )}
            </div>
          ) : activeTab === 'heartbeat' ? (
            <div className="prose prose-neutral max-w-none">
              <pre className="bg-neutral-50 p-4 rounded-lg text-sm overflow-x-auto whitespace-pre-wrap">
                {data?.heartbeat || 'No heartbeat file found.'}
              </pre>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-neutral-50 border-t border-neutral-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gold text-white rounded-md hover:bg-gold-dark transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
