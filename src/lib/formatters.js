/**
 * Utility functions for formatting data
 */

/**
 * Format date to human-readable string
 */
export function formatDate(dateString) {
  if (!dateString) return 'N/A'
  
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  })
}

/**
 * Format timestamp to time string
 */
export function formatTime(dateString) {
  if (!dateString) return 'N/A'
  
  const date = new Date(dateString)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

/**
 * Format task status to display string
 */
export function formatStatus(status) {
  const statusMap = {
    'inbox': 'Inbox',
    'assigned': 'Assigned',
    'in_progress': 'In Progress',
    'review': 'In Review',
    'approved': 'Approved',
    'completed': 'Completed',
    'shipped': 'Shipped'
  }
  return statusMap[status] || status
}

/**
 * Get status badge color class
 */
export function getStatusColor(status) {
  const colorMap = {
    'active': 'bg-green-100 text-green-800',
    'idle': 'bg-gray-100 text-gray-800',
    'blocked': 'bg-red-100 text-red-800',
    'inbox': 'bg-blue-100 text-blue-800',
    'assigned': 'bg-purple-100 text-purple-800',
    'in_progress': 'bg-yellow-100 text-yellow-800',
    'review': 'bg-orange-100 text-orange-800',
    'approved': 'bg-teal-100 text-teal-800',
    'completed': 'bg-green-100 text-green-800',
    'shipped': 'bg-emerald-100 text-emerald-800',
    'captured': 'bg-blue-100 text-blue-800',
    'drafted': 'bg-yellow-100 text-yellow-800'
  }
  return colorMap[status] || 'bg-gray-100 text-gray-800'
}

/**
 * Truncate text to specified length
 */
export function truncate(text, maxLength = 100) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength).trim() + '...'
}

/**
 * Format number with commas
 */
export function formatNumber(num) {
  if (num === null || num === undefined) return '0'
  return num.toLocaleString('en-US')
}

/**
 * Format percentage
 */
export function formatPercent(value) {
  if (value === null || value === undefined) return '0%'
  return `${Math.round(value)}%`
}

/**
 * Get initials from name
 */
export function getInitials(name) {
  if (!name) return '?'
  const parts = name.split(' ')
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Get agent color for avatar
 */
export function getAgentColor(agentId) {
  const colors = [
    'bg-blue-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-red-500',
    'bg-indigo-500',
    'bg-teal-500'
  ]
  
  // Simple hash function to consistently map agent ID to color
  const hash = agentId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

/**
 * Format file size
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}

/**
 * Get alert level color classes for time-in-status indicators
 */
export function getAlertLevelColor(alertLevel) {
  const colorMap = {
    'yellow': 'bg-yellow-100 text-yellow-700',
    'red': 'bg-red-100 text-red-700'
  }
  return colorMap[alertLevel] || ''
}
