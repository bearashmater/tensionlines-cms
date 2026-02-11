import { useEffect, useRef, useCallback, useState } from 'react'
import { useSWRConfig } from 'swr'

// Map WebSocket channels to the SWR keys they should invalidate
const CHANNEL_KEYS = {
  tasks: ['/tasks', '/dashboard', '/activities'],
  'posting-queue': ['/api/posting-queue', '/dashboard'],
  'reply-queue': ['/api/reply-queue'],
  'comment-queue': ['/api/comment-queue'],
  engagement: ['/api/engagement', '/api/engagement-trends'],
  notifications: ['/notifications', '/dashboard'],
  analytics: ['/api/analytics', '/api/content/engagement', '/api/engagement-trends'],
  messages: (key) => typeof key === 'string' && key.startsWith('/api/messages'),
  ideas: ['/ideas', '/api/ideas/stats', '/api/repost-candidates', '/api/future-needs'],
  system: ['/api/system/events', '/api/system/crons', '/api/system/approvals'],
  podcast: ['/api/podcast/overview', '/api/podcast/history', '/api/podcast/quality-trends'],
}

/**
 * useWebSocket — connects to the CMS WebSocket server and triggers SWR
 * revalidation when the server broadcasts invalidation events.
 *
 * Falls back to polling automatically when disconnected.
 * Reconnects with exponential backoff.
 */
export function useWebSocket() {
  const { mutate } = useSWRConfig()
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const backoff = useRef(1000)
  const [connected, setConnected] = useState(false)

  const invalidateChannel = useCallback((channel) => {
    const mapping = CHANNEL_KEYS[channel]
    if (!mapping) return

    if (typeof mapping === 'function') {
      // Matcher function — revalidate all matching keys
      mutate(mapping)
    } else {
      // Array of exact keys
      for (const key of mapping) {
        mutate(key)
      }
    }
  }, [mutate])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onopen = () => {
      setConnected(true)
      backoff.current = 1000 // reset backoff on successful connect
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'invalidate' && msg.channel) {
          invalidateChannel(msg.channel)
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      // Reconnect with exponential backoff (max 30s)
      reconnectTimer.current = setTimeout(() => {
        backoff.current = Math.min(backoff.current * 2, 30000)
        connect()
      }, backoff.current)
    }

    ws.onerror = () => {
      ws.close()
    }

    wsRef.current = ws
  }, [invalidateChannel])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return connected
}
