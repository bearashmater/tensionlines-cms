/**
 * API Client for TensionLines CMS
 * 
 * Provides fetch wrappers for all backend endpoints
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api'

/**
 * SWR-compatible fetcher function
 */
export const fetcher = (url) => fetch(url).then(res => res.json())

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  }
  
  try {
    const response = await fetch(url, config)
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }
    
    return await response.json()
  } catch (error) {
    console.error('API Fetch Error:', error)
    throw error
  }
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
