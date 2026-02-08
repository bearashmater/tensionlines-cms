import { useState, useEffect } from 'react'
import { Cloud, CloudOff, Instagram, MessageCircle } from 'lucide-react'

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

const PLATFORM_CONFIG = {
  bluesky: {
    label: 'Bluesky',
    icon: BlueskyIcon,
    connectedStyle: 'bg-blue-50 text-blue-600 border border-blue-200',
    manualStyle: 'bg-amber-50 text-amber-600 border border-amber-200',
    disconnectedStyle: 'bg-red-50 text-red-600 border border-red-200',
  },
  twitter: {
    label: 'Twitter',
    icon: TwitterIcon,
    connectedStyle: 'bg-neutral-50 text-neutral-700 border border-neutral-300',
    manualStyle: 'bg-amber-50 text-amber-600 border border-amber-200',
    disconnectedStyle: 'bg-red-50 text-red-600 border border-red-200',
  },
  instagram: {
    label: 'Instagram',
    icon: ({ size }) => <Instagram size={size} />,
    connectedStyle: 'bg-pink-50 text-pink-600 border border-pink-200',
    manualStyle: 'bg-amber-50 text-amber-600 border border-amber-200',
    disconnectedStyle: 'bg-red-50 text-red-600 border border-red-200',
  },
  threads: {
    label: 'Threads',
    icon: ({ size }) => <MessageCircle size={size} />,
    connectedStyle: 'bg-neutral-50 text-neutral-700 border border-neutral-300',
    manualStyle: 'bg-amber-50 text-amber-600 border border-amber-200',
    disconnectedStyle: 'bg-red-50 text-red-600 border border-red-200',
  },
}

export default function PlatformStatusBadges() {
  const [statuses, setStatuses] = useState(null)

  useEffect(() => {
    fetch('/api/platforms/status')
      .then(r => r.json())
      .then(setStatuses)
      .catch(() => setStatuses({
        bluesky: { connected: false },
        twitter: { connected: false },
        instagram: { connected: false, mode: 'manual' },
        threads: { connected: false, mode: 'manual' },
      }))
  }, [])

  if (!statuses) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {Object.entries(PLATFORM_CONFIG).map(([key, config]) => {
        const status = statuses[key] || { connected: false }
        const Icon = config.icon
        const isManual = status.mode === 'manual'
        const style = status.connected
          ? config.connectedStyle
          : isManual
            ? config.manualStyle
            : config.disconnectedStyle

        const statusIcon = status.connected
          ? <Cloud size={10} />
          : isManual
            ? null
            : <CloudOff size={10} />

        const statusText = status.connected
          ? ''
          : isManual
            ? 'manual'
            : 'off'

        return (
          <span
            key={key}
            className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full ${style}`}
            title={status.connected
              ? `${config.label} connected${status.handle ? ` as @${status.handle}` : ''}`
              : isManual
                ? `${config.label}: ${status.message || 'Manual posting'}`
                : `${config.label} disconnected`
            }
          >
            <Icon size={10} />
            {statusIcon}
            {statusText && <span>{statusText}</span>}
          </span>
        )
      })}
    </div>
  )
}
