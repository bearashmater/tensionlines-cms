import useSWR from 'swr'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Check, CheckCheck, Filter, Clock, AlertTriangle, MessageSquare, MessageSquareReply, User, ChevronDown, ChevronUp, X, Lightbulb, DollarSign, BarChart3, ListTodo, UserCheck, AtSign, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

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
    engagement_reply: <MessageSquareReply size={18} />,
    engagement_mention: <AtSign size={18} />,
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
              {type === 'daily_summary' && metadata ? (
                <BriefingMessage metadata={metadata} />
              ) : (
                <p className="text-sm text-neutral-800 whitespace-pre-wrap">{message}</p>
              )}

              {/* Recipients */}
              {to && to.length > 0 && (
                <div className="text-sm">
                  <span className="text-neutral-500">To: </span>
                  <span className="text-neutral-700">{to.join(', ')}</span>
                </div>
              )}

              {/* Metadata (skip for daily_summary — shown inline) */}
              {type !== 'daily_summary' && metadata && Object.keys(metadata).length > 0 && (
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

              {/* Engagement Actions */}
              {(type === 'engagement_reply' || type === 'engagement_mention') && metadata && (
                <EngagementActions metadata={metadata} />
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

function BriefingMessage({ metadata }) {
  const [expanded, setExpanded] = useState({})
  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const m = metadata
  const sections = []

  // Progress — completed yesterday
  sections.push({
    key: 'progress',
    icon: <BarChart3 size={16} className="text-green-600" />,
    label: `${m.completedYesterday} task${m.completedYesterday !== 1 ? 's' : ''} completed yesterday`,
    color: 'bg-green-50 border-green-200 hover:bg-green-100',
    labelColor: 'text-green-800',
    hasDetails: m.completedDetails?.length > 0,
    linkTo: '/tasks',
    content: m.completedDetails?.length > 0 ? (
      <div className="space-y-2">
        {m.completedDetails.map(t => (
          <div key={t.id} className="flex items-center gap-2 text-sm">
            <Check size={14} className="text-green-500 flex-shrink-0" />
            <span className="font-medium text-neutral-900">{t.title}</span>
            <span className="text-xs text-neutral-500 font-mono">{t.id}</span>
          </div>
        ))}
      </div>
    ) : null
  })

  // Active tasks
  sections.push({
    key: 'active',
    icon: <ListTodo size={16} className="text-blue-600" />,
    label: `${m.activeTasks} task${m.activeTasks !== 1 ? 's' : ''} in progress${m.stuckTasks > 0 ? ` (${m.stuckTasks} stuck)` : ''}`,
    color: m.stuckTasks > 0 ? 'bg-amber-50 border-amber-200 hover:bg-amber-100' : 'bg-blue-50 border-blue-200 hover:bg-blue-100',
    labelColor: m.stuckTasks > 0 ? 'text-amber-800' : 'text-blue-800',
    hasDetails: m.activeDetails?.length > 0,
    linkTo: '/tasks',
    content: m.activeDetails?.length > 0 ? (
      <div className="space-y-2">
        {m.activeDetails.map(t => (
          <div key={t.id} className="flex items-start gap-2 text-sm">
            {t.alertLevel === 'red' ? <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" /> :
             t.alertLevel === 'yellow' ? <Clock size={14} className="text-yellow-500 mt-0.5 flex-shrink-0" /> :
             <ListTodo size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />}
            <div className="flex-1">
              <span className="font-medium text-neutral-900">{t.title}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-neutral-500 font-mono">{t.id}</span>
                <span className="text-xs text-neutral-500">{t.status}</span>
                {t.timeInStatus && <span className="text-xs text-neutral-500">{t.timeInStatus}</span>}
                {t.assignees.length > 0 && <span className="text-xs text-neutral-500">→ {t.assignees.join(', ')}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    ) : null
  })

  // Human tasks
  sections.push({
    key: 'human',
    icon: <UserCheck size={16} className="text-purple-600" />,
    label: `${m.humanTasks} awaiting your attention`,
    color: m.humanTasks > 0 ? 'bg-purple-50 border-purple-200 hover:bg-purple-100' : 'bg-neutral-50 border-neutral-200 hover:bg-neutral-100',
    labelColor: m.humanTasks > 0 ? 'text-purple-800' : 'text-neutral-600',
    hasDetails: m.humanDetails?.length > 0,
    linkTo: '/tasks',
    content: m.humanDetails?.length > 0 ? (
      <div className="space-y-2">
        {m.humanDetails.map(t => (
          <div key={t.id} className="flex items-center gap-2 text-sm">
            <User size={14} className="text-purple-500 flex-shrink-0" />
            <span className="font-medium text-neutral-900">{t.title}</span>
            <span className="text-xs text-neutral-500 font-mono">{t.id}</span>
          </div>
        ))}
      </div>
    ) : null
  })

  // Notifications
  sections.push({
    key: 'notifs',
    icon: <Bell size={16} className="text-amber-600" />,
    label: `${m.unreadCount ?? 0} unread notification${(m.unreadCount ?? 0) !== 1 ? 's' : ''}`,
    color: 'bg-neutral-50 border-neutral-200 hover:bg-neutral-100',
    labelColor: 'text-neutral-700',
    hasDetails: false,
    linkTo: '/notifications'
  })

  // Cost
  if (m.costStatus) {
    sections.push({
      key: 'cost',
      icon: <DollarSign size={16} className="text-emerald-600" />,
      label: `Monthly Cost: ${m.costStatus}`,
      color: 'bg-neutral-50 border-neutral-200 hover:bg-neutral-100',
      labelColor: 'text-neutral-700',
      hasDetails: false,
      linkTo: '/analytics'
    })
  }

  // High priority issues
  if (m.highPriorityDetails?.length > 0) {
    sections.push({
      key: 'issues',
      icon: <AlertTriangle size={16} className="text-red-500" />,
      label: `${m.highPriorityIssues} high priority issue${m.highPriorityIssues !== 1 ? 's' : ''} need attention`,
      color: 'bg-red-50 border-red-200 hover:bg-red-100',
      labelColor: 'text-red-700 font-semibold',
      hasDetails: true,
      content: (
        <div className="space-y-3">
          {m.highPriorityDetails.map((issue, i) => (
            <div key={i} className="border-b border-neutral-100 last:border-0 pb-3 last:pb-0">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-neutral-900">{issue.title}</p>
                  <p className="text-xs text-neutral-600 mt-1">{issue.description}</p>
                  <div className="mt-2 flex items-start gap-1.5 p-2 bg-amber-50 rounded-md border border-amber-200">
                    <Lightbulb size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs font-medium text-amber-800">{issue.recommendation}</p>
                  </div>
                  {issue.taskId && (
                    <Link to="/tasks" className="inline-flex items-center gap-1 mt-2 text-xs text-gold hover:text-gold/80 font-medium">
                      View task {issue.taskId} →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )
    })
  }

  return (
    <div className="space-y-2">
      {sections.map(section => (
        <div key={section.key}>
          {section.hasDetails ? (
            <button
              onClick={() => toggle(section.key)}
              className={`flex items-center gap-2 text-left w-full px-3 py-2 rounded-lg border transition-colors group ${section.color}`}
            >
              {section.icon}
              <span className={`flex-1 text-sm font-medium ${section.labelColor}`}>{section.label}</span>
              <span className="text-xs text-neutral-400 group-hover:text-neutral-600">
                {expanded[section.key] ? 'Hide' : 'View'}
              </span>
              {expanded[section.key] ? <ChevronUp size={14} className="text-neutral-400" /> : <ChevronDown size={14} className="text-neutral-400" />}
            </button>
          ) : section.linkTo ? (
            <Link
              to={section.linkTo}
              className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg border transition-colors group ${section.color}`}
            >
              {section.icon}
              <span className={`flex-1 text-sm font-medium ${section.labelColor}`}>{section.label}</span>
              <span className="text-xs text-neutral-400 group-hover:text-neutral-600">Open →</span>
            </Link>
          ) : (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${section.color}`}>
              {section.icon}
              <span className={`text-sm font-medium ${section.labelColor}`}>{section.label}</span>
            </div>
          )}

          {expanded[section.key] && section.content && (
            <div className="mt-2 border border-neutral-200 rounded-lg p-4 bg-white">
              {section.content}
              {section.linkTo && (
                <Link to={section.linkTo} className="inline-flex items-center gap-1 mt-3 text-xs text-gold hover:text-gold/80 font-medium">
                  View all →
                </Link>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function EngagementActions({ metadata }) {
  const navigate = useNavigate()
  const [drafting, setDrafting] = useState(false)

  const handleDraftReply = async () => {
    if (!metadata.engagementId) return
    setDrafting(true)
    try {
      const res = await fetch(`/api/engagement/${metadata.engagementId}/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        navigate('/reply-queue')
      }
    } catch (err) {
      console.error('Error creating draft reply:', err)
    }
    setDrafting(false)
  }

  return (
    <div className="flex items-center gap-2 pt-2">
      {metadata.postUrl && (
        <a
          href={metadata.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-neutral-100 text-neutral-700 rounded hover:bg-neutral-200"
        >
          <ExternalLink size={12} />
          View Post
        </a>
      )}
      {metadata.engagementId && (
        <button
          onClick={handleDraftReply}
          disabled={drafting}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-gold text-white rounded hover:bg-amber-600 disabled:opacity-50"
        >
          <MessageSquareReply size={12} />
          {drafting ? 'Creating...' : 'Draft Reply'}
        </button>
      )}
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
