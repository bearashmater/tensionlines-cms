import useSWR from 'swr'
import { useState } from 'react'
import { Bell, Check, CheckCheck, Filter, Clock, AlertTriangle, MessageSquare, User, ChevronDown, ChevronUp, X } from 'lucide-react'

export default function NotificationsView() {
  const [filter, setFilter] = useState('unread') // 'all' | 'unread'
  const [expandedId, setExpandedId] = useState(null)

  const { data: notifications, mutate } = useSWR(
    `/api/notifications${filter === 'unread' ? '?unread=true' : ''}`,
    (url) => fetch(url).then(r => r.json()),
    { refreshInterval: 30000 }
  )

  if (!notifications) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const unreadCount = notifications.filter(n => !n.read).length

  const markAsRead = async (notifId) => {
    try {
      await fetch(`/api/notifications/${notifId}/read`, { method: 'POST' })
      mutate()
    } catch (err) {
      console.error('Failed to mark as read:', err)
    }
  }

  const markAllAsRead = async () => {
    try {
      await fetch('/api/notifications/mark-all-read', { method: 'POST' })
      mutate()
    } catch (err) {
      console.error('Failed to mark all as read:', err)
    }
  }

  // Group notifications by date
  const groupedNotifications = notifications.reduce((acc, notif) => {
    const date = new Date(notif.createdAt).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    if (!acc[date]) acc[date] = []
    acc[date].push(notif)
    return acc
  }, {})

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Notifications</h1>
          <p className="text-neutral-600 mt-1">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
          </p>
        </div>
        <Bell className="text-gold" size={32} />
      </div>

      {/* Filters & Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('unread')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'unread'
                ? 'bg-gold text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Unread ({unreadCount})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-gold text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            All
          </button>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gold hover:bg-gold/10 rounded-lg transition-colors"
          >
            <CheckCheck size={18} />
            Mark all as read
          </button>
        )}
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="text-center py-12">
          <Bell size={48} className="mx-auto mb-4 text-neutral-300" />
          <p className="text-neutral-500">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedNotifications).map(([date, notifs]) => (
            <div key={date}>
              <h3 className="text-sm font-semibold text-neutral-500 mb-3">{date}</h3>
              <div className="space-y-2">
                {notifs.map(notif => (
                  <NotificationCard
                    key={notif.id}
                    notification={notif}
                    expanded={expandedId === notif.id}
                    onToggle={() => setExpandedId(expandedId === notif.id ? null : notif.id)}
                    onMarkRead={() => markAsRead(notif.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NotificationCard({ notification, expanded, onToggle, onMarkRead }) {
  const { id, type, title, message, from, to, createdAt, read, priority, actionRequired, metadata } = notification

  const priorityColors = {
    high: 'border-l-red-500 bg-red-50',
    medium: 'border-l-amber-500 bg-amber-50',
    low: 'border-l-blue-500 bg-blue-50'
  }

  const typeIcons = {
    task_assignment: <User size={18} />,
    backend_ready: <Check size={18} />,
    stuck_task_alert: <AlertTriangle size={18} />,
    message: <MessageSquare size={18} />,
    default: <Bell size={18} />
  }

  const timeAgo = getTimeAgo(new Date(createdAt))

  return (
    <div
      className={`card border-l-4 ${priority ? priorityColors[priority] : 'border-l-neutral-300'} ${
        !read ? 'ring-2 ring-gold/30' : 'opacity-75'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`p-2 rounded-full ${!read ? 'bg-gold/20 text-gold' : 'bg-neutral-100 text-neutral-500'}`}>
          {typeIcons[type] || typeIcons.default}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className={`font-medium ${!read ? 'text-black' : 'text-neutral-700'}`}>
                {title}
              </h4>
              <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                <span>From: {from}</span>
                <span>•</span>
                <span>{timeAgo}</span>
                {actionRequired && (
                  <>
                    <span>•</span>
                    <span className="text-red-600 font-medium">Action Required</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!read && (
                <button
                  onClick={(e) => { e.stopPropagation(); onMarkRead() }}
                  className="p-1 hover:bg-neutral-100 rounded transition-colors"
                  title="Mark as read"
                >
                  <Check size={16} className="text-green-600" />
                </button>
              )}
              <button
                onClick={onToggle}
                className="p-1 hover:bg-neutral-100 rounded transition-colors"
              >
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
          </div>

          {/* Message Preview */}
          {!expanded && (
            <p className="text-sm text-neutral-600 mt-2 line-clamp-2">{message}</p>
          )}

          {/* Expanded Content */}
          {expanded && (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-neutral-800 whitespace-pre-wrap">{message}</p>

              {/* Recipients */}
              {to && to.length > 0 && (
                <div className="text-sm">
                  <span className="text-neutral-500">To: </span>
                  <span className="text-neutral-700">{to.join(', ')}</span>
                </div>
              )}

              {/* Metadata */}
              {metadata && Object.keys(metadata).length > 0 && (
                <div className="p-3 bg-neutral-100 rounded-lg text-sm space-y-2">
                  {metadata.taskId && (
                    <div>
                      <span className="text-neutral-500">Task: </span>
                      <span className="font-mono text-neutral-700">{metadata.taskId}</span>
                    </div>
                  )}
                  {metadata.apiChanges && (
                    <div>
                      <span className="text-neutral-500 block mb-1">API Changes:</span>
                      <ul className="list-disc list-inside text-neutral-700 space-y-1">
                        {metadata.apiChanges.map((change, i) => (
                          <li key={i} className="text-xs">{change}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {metadata.uiWork && (
                    <div>
                      <span className="text-neutral-500 block mb-1">UI Work Needed:</span>
                      <ul className="list-disc list-inside text-neutral-700 space-y-1">
                        {metadata.uiWork.map((work, i) => (
                          <li key={i} className="text-xs">{work}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {metadata.thresholds && (
                    <div>
                      <span className="text-neutral-500 block mb-1">Thresholds:</span>
                      <div className="text-xs text-neutral-700 font-mono">
                        {Object.entries(metadata.thresholds).map(([key, val]) => (
                          <div key={key}>{key}: {val}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Read Status */}
              {read && notification.readAt && (
                <div className="text-xs text-neutral-400">
                  Read {getTimeAgo(new Date(notification.readAt))}
                  {notification.readBy && ` by ${notification.readBy}`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString()
}
