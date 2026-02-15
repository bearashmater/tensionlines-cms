/**
 * API Client for TensionLines CMS
 *
 * Provides fetch wrappers for all backend endpoints
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api'

/**
 * Get auth headers from stored token
 */
function getAuthHeaders() {
  const token = localStorage.getItem('cms_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Handle 401 responses — clear token and trigger re-auth
 */
function handleUnauthorized() {
  localStorage.removeItem('cms_token')
  window.dispatchEvent(new Event('cms-unauthorized'))
}

/**
 * SWR-compatible fetcher function
 */
export const fetcher = (url) =>
  fetch(url, { headers: getAuthHeaders() }).then(res => {
    if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized') }
    return res.json()
  })

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`

  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers
    }
  }

  try {
    const response = await fetch(url, config)

    if (response.status === 401) {
      handleUnauthorized()
      throw new Error('Unauthorized')
    }

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('API Fetch Error:', error)
    throw error
  }
}

/**
 * Login with password — stores token on success
 */
export async function login(password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Login failed')
  localStorage.setItem('cms_token', data.token)
  return data
}

/**
 * Setup password (first-time only)
 */
export async function setupPassword(password) {
  const res = await fetch(`${API_BASE}/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Setup failed')
  return data
}

/**
 * Check auth status
 */
export async function getAuthStatus() {
  const res = await fetch(`${API_BASE}/auth/status`)
  return res.json()
}

/**
 * Logout — clear stored token
 */
export function logout() {
  localStorage.removeItem('cms_token')
  window.location.reload()
}

// ============================================================================
// DASHBOARD
// ============================================================================

export async function getDashboard() {
  return apiFetch('/dashboard')
}

// ============================================================================
// AGENTS
// ============================================================================

export async function getAgents() {
  return apiFetch('/agents')
}

export async function getAgent(id) {
  return apiFetch(`/agents/${id}`)
}

export async function getAgentSoul(id) {
  return apiFetch(`/agents/${id}/soul`)
}

// ============================================================================
// TASKS
// ============================================================================

export async function getTasks(filters = {}) {
  const params = new URLSearchParams(filters)
  return apiFetch(`/tasks?${params}`)
}

export async function getTask(id) {
  return apiFetch(`/tasks/${id}`)
}

export async function createTask(data) {
  return apiFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

// ============================================================================
// ACTIVITIES
// ============================================================================

export async function getActivities(page = 1, limit = 50) {
  return apiFetch(`/activities?page=${page}&limit=${limit}`)
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export async function getNotifications(filters = {}) {
  const params = new URLSearchParams(filters)
  return apiFetch(`/notifications?${params}`)
}

// ============================================================================
// IDEAS
// ============================================================================

export async function getIdeas() {
  return apiFetch('/ideas')
}

// ============================================================================
// DRAFTS
// ============================================================================

export async function getDrafts(filters = {}) {
  const params = new URLSearchParams(filters)
  return apiFetch(`/drafts?${params}`)
}

// ============================================================================
// MEMORY
// ============================================================================

export async function getMemory() {
  return apiFetch('/memory')
}

// ============================================================================
// BOOKS
// ============================================================================

export async function getBooks() {
  return apiFetch('/books')
}

export async function getChapter(bookId, chapterNum) {
  return apiFetch(`/books/${bookId}/chapters/${chapterNum}`)
}

// ============================================================================
// SEARCH
// ============================================================================

export async function search(query) {
  return apiFetch('/search', {
    method: 'POST',
    body: JSON.stringify({ query })
  })
}

// ============================================================================
// HEALTH
// ============================================================================

export async function getHealth() {
  return apiFetch('/health')
}

// ============================================================================
// SQUAD LEAD
// ============================================================================

export async function getSquadOverview() {
  return apiFetch('/squad-lead/overview')
}

export async function getAgentDetail(id) {
  return apiFetch(`/squad-lead/agent/${id}`)
}

export async function getAvailableAgents() {
  return apiFetch('/squad-lead/available-agents')
}

export async function reassignTask(taskId, newAssigneeId, reason) {
  return apiFetch(`/tasks/${taskId}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ newAssigneeId, reason })
  })
}

export async function setTaskDueDate(taskId, dueDate) {
  return apiFetch(`/tasks/${taskId}/due-date`, {
    method: 'POST',
    body: JSON.stringify({ dueDate })
  })
}

export async function reopenTask(taskId, reason) {
  return apiFetch(`/tasks/${taskId}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  })
}

export async function getIdeaStats() {
  return apiFetch('/ideas/stats')
}

// ============================================================================
// TASK DISPATCH & STEPS
// ============================================================================

export async function dispatchTask(id) {
  return apiFetch(`/tasks/${id}/dispatch`, {
    method: 'POST'
  })
}

export async function deleteTask(id) {
  return apiFetch(`/tasks/${id}`, {
    method: 'DELETE'
  })
}

export async function addTaskStep(id, description, status, agentId) {
  return apiFetch(`/tasks/${id}/steps`, {
    method: 'POST',
    body: JSON.stringify({ description, status, agentId })
  })
}

export async function updateTaskStep(id, stepId, status) {
  return apiFetch(`/tasks/${id}/steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  })
}

export async function getTaskBreakdown(id) {
  return apiFetch(`/tasks/${id}/breakdown`)
}

export async function debugTask(id, level = 'debug') {
  return apiFetch(`/tasks/${id}/debug?level=${level}`, {
    method: 'POST'
  })
}

export async function getStepAverages() {
  return apiFetch('/step-averages')
}

// ============================================================================
// FUTURE NEEDS
// ============================================================================

export async function getFutureNeeds(filters = {}) {
  const params = new URLSearchParams(filters)
  return apiFetch(`/future-needs?${params}`)
}

export async function getFutureNeedsStats() {
  return apiFetch('/future-needs/stats')
}

export async function getFutureNeed(id) {
  return apiFetch(`/future-needs/${id}`)
}

export async function createFutureNeed(data) {
  return apiFetch('/future-needs', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

export async function updateFutureNeed(id, data) {
  return apiFetch(`/future-needs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  })
}

export async function voteFutureNeed(id, voter) {
  return apiFetch(`/future-needs/${id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ voter })
  })
}

export async function commentFutureNeed(id, text, author) {
  return apiFetch(`/future-needs/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text, author })
  })
}

export async function deleteFutureNeed(id) {
  return apiFetch(`/future-needs/${id}`, {
    method: 'DELETE'
  })
}
