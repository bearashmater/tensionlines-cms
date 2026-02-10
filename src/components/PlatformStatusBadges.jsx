import { useState, useEffect } from 'react'
import { Cloud, Hand, Instagram, MessageCircle, Hash, BookOpen } from 'lucide-react'

function BlueskyIcon({ size = 12, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.862 13.862c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69L12 14.492l-1.37 1.37c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69-.964-.964-.964-2.528 0-3.492L9.508 10l-2.37-2.37c-.964-.964-.964-2.528 0-3.492.964-.964 2.528-.964 3.492 0L12 5.508l1.37-1.37c.964-.964 2.528-.964 3.492 0 .964.964.964 2.528 0 3.492L14.492 10l2.37 2.37c.964.964.964 2.528 0 3.492z"/>
    </svg>
  )
}

function TwitterIcon({ size = 12, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  )
}

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', icon: ({ size }) => <Instagram size={size} />, color: 'pink' },
  { key: 'threads', label: 'Threads', icon: ({ size }) => <MessageCircle size={size} />, color: 'neutral' },
  { key: 'bluesky', label: 'Bluesky', icon: BlueskyIcon, color: 'blue' },
  { key: 'twitter', label: 'Twitter / X', icon: TwitterIcon, color: 'neutral' },
  { key: 'reddit', label: 'Reddit', icon: ({ size }) => <Hash size={size} />, color: 'orange' },
  { key: 'medium', label: 'Medium', icon: ({ size }) => <BookOpen size={size} />, color: 'green' },
]

const MODE_STYLES = {
  manual: {
    pink:    'bg-pink-50 text-pink-600 border-pink-200 hover:bg-pink-100',
    neutral: 'bg-neutral-50 text-neutral-600 border-neutral-300 hover:bg-neutral-100',
    blue:    'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100',
    orange:  'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100',
    green:   'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
  },
  auto: {
    pink:    'bg-pink-600 text-white border-pink-600 hover:bg-pink-700',
    neutral: 'bg-neutral-700 text-white border-neutral-700 hover:bg-neutral-800',
    blue:    'bg-blue-600 text-white border-blue-600 hover:bg-blue-700',
    orange:  'bg-orange-500 text-white border-orange-500 hover:bg-orange-600',
    green:   'bg-green-600 text-white border-green-600 hover:bg-green-700',
  },
}

export default function PlatformStatusBadges() {
  const [modes, setModes] = useState(null)
  const [saving, setSaving] = useState(null) // platform key being saved

  useEffect(() => {
    fetch('/api/settings/posting-modes')
      .then(r => r.json())
      .then(setModes)
      .catch(() => setModes({
        twitter: 'manual', bluesky: 'manual', threads: 'manual',
        instagram: 'manual', reddit: 'manual', medium: 'manual',
      }))
  }, [])

  if (!modes) return null

  const toggleMode = async (platform) => {
    const newMode = modes[platform] === 'manual' ? 'auto' : 'manual'
    const updated = { ...modes, [platform]: newMode }
    setModes(updated)
    setSaving(platform)
    try {
      await fetch('/api/settings/posting-modes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [platform]: newMode })
      })
    } catch (err) {
      // Revert on failure
      setModes(modes)
      console.error('Failed to save posting mode:', err)
    }
    setSaving(null)
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PLATFORMS.map(({ key, label, icon: Icon, color }) => {
        const mode = modes[key] || 'manual'
        const isAuto = mode === 'auto'
        const style = MODE_STYLES[mode]?.[color] || MODE_STYLES.manual.neutral

        return (
          <button
            key={key}
            onClick={() => toggleMode(key)}
            disabled={saving === key}
            className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border cursor-pointer transition-all ${style} ${saving === key ? 'opacity-50' : ''}`}
            title={`${label}: ${isAuto ? 'Auto-post' : 'Manual posting'} — click to toggle`}
          >
            <Icon size={10} />
            {isAuto ? <Cloud size={9} /> : <Hand size={9} />}
            <span>{isAuto ? 'auto' : 'manual'}</span>
          </button>
        )
      })}
    </div>
  )
}
