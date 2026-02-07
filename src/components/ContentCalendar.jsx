import { useState, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Clock,
  Check,
  CheckCircle,
  Trash2,
  Send,
  Calendar,
  GripVertical,
  Instagram,
  MessageCircle,
  AlertTriangle
} from 'lucide-react'

// ── Icons ────────────────────────────────────────────────────────────────────

function BlueskyIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.862 13.862c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69L12 14.492l-1.37 1.37c-.478.478-1.12.69-1.746.69-.626 0-1.268-.212-1.746-.69-.964-.964-.964-2.528 0-3.492L9.508 10l-2.37-2.37c-.964-.964-.964-2.528 0-3.492.964-.964 2.528-.964 3.492 0L12 5.508l1.37-1.37c.964-.964 2.528-.964 3.492 0 .964.964.964 2.528 0 3.492L14.492 10l2.37 2.37c.964.964.964 2.528 0 3.492z"/>
    </svg>
  )
}

function getPlatformIcon(platform, size = 16) {
  switch (platform) {
    case 'instagram': return <Instagram size={size} className="text-pink-600" />
    case 'threads': return <MessageCircle size={size} className="text-neutral-700" />
    case 'bluesky': return <BlueskyIcon size={size} className="text-blue-500" />
    default: return null
  }
}

function getPlatformBg(platform) {
  switch (platform) {
    case 'bluesky': return 'bg-blue-50 border-blue-200'
    case 'instagram': return 'bg-pink-50 border-pink-200'
    case 'threads': return 'bg-neutral-50 border-neutral-200'
    default: return 'bg-white border-neutral-200'
  }
}

function getPlatformDot(platform) {
  switch (platform) {
    case 'bluesky': return 'bg-blue-500'
    case 'instagram': return 'bg-pink-500'
    case 'threads': return 'bg-neutral-500'
    default: return 'bg-neutral-400'
  }
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function startOfWeek(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function formatDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isSameDay(a, b) {
  return formatDateKey(a) === formatDateKey(b)
}

function isPast(date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d < today
}

function formatTime(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function toLocalDatetimeValue(isoStr) {
  const d = new Date(isoStr)
  const offset = d.getTimezoneOffset()
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// ── Main Component ───────────────────────────────────────────────────────────

export default function ContentCalendar() {
  const today = new Date()
  const [viewDate, setViewDate] = useState(today)
  const [viewMode, setViewMode] = useState('week') // 'week' | 'month'
  const [selectedItem, setSelectedItem] = useState(null)
  const [scheduleDate, setScheduleDate] = useState(null) // date string for "Add" modal
  const [dragItem, setDragItem] = useState(null)

  // Calculate date range for the API
  const { apiStart, apiEnd, weekStart } = useMemo(() => {
    if (viewMode === 'week') {
      const ws = startOfWeek(viewDate)
      const we = addDays(ws, 6)
      return {
        apiStart: formatDateKey(ws),
        apiEnd: formatDateKey(we),
        weekStart: ws
      }
    } else {
      const ms = startOfMonth(viewDate)
      const me = endOfMonth(viewDate)
      // Extend to full weeks
      const calStart = startOfWeek(ms)
      const calEnd = addDays(startOfWeek(addDays(me, 6)), 6)
      return {
        apiStart: formatDateKey(calStart),
        apiEnd: formatDateKey(calEnd),
        weekStart: startOfWeek(viewDate)
      }
    }
  }, [viewDate, viewMode])

  const { data, error, isLoading, mutate } = useSWR(
    `/api/calendar?start=${apiStart}&end=${apiEnd}`,
    fetcher,
    { refreshInterval: 30000 }
  )

  const byDate = data?.byDate || {}
  const unscheduled = data?.unscheduled || []

  // ── Navigation ────────────────────────────────────────────────────────

  const goToday = () => setViewDate(new Date())

  const goPrev = () => {
    if (viewMode === 'week') {
      setViewDate(prev => addDays(prev, -7))
    } else {
      setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
    }
  }

  const goNext = () => {
    if (viewMode === 'week') {
      setViewDate(prev => addDays(prev, 7))
    } else {
      setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
    }
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────

  const handleDragStart = useCallback((e, item) => {
    setDragItem(item)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', item.id)
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(async (e, dateKey) => {
    e.preventDefault()
    if (!dragItem) return

    // Build new scheduledFor: keep original time or default to 9 AM
    let time = '09:00:00'
    if (dragItem.scheduledFor) {
      time = dragItem.scheduledFor.split('T')[1]?.split('.')[0] || '09:00:00'
    }
    const newScheduledFor = `${dateKey}T${time}`

    // Optimistic update
    const oldData = data
    const optimistic = { ...data }
    const newByDate = { ...optimistic.byDate }
    const newUnscheduled = [...(optimistic.unscheduled || [])]

    // Remove from old location
    if (dragItem.scheduledFor) {
      const oldKey = dragItem.scheduledFor.split('T')[0]
      if (newByDate[oldKey]) {
        newByDate[oldKey] = newByDate[oldKey].filter(i => i.id !== dragItem.id)
        if (newByDate[oldKey].length === 0) delete newByDate[oldKey]
      }
    } else {
      const idx = newUnscheduled.findIndex(i => i.id === dragItem.id)
      if (idx !== -1) newUnscheduled.splice(idx, 1)
    }

    // Add to new date
    const updatedItem = { ...dragItem, scheduledFor: new Date(newScheduledFor).toISOString(), status: 'scheduled' }
    if (!newByDate[dateKey]) newByDate[dateKey] = []
    newByDate[dateKey].push(updatedItem)
    newByDate[dateKey].sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''))

    optimistic.byDate = newByDate
    optimistic.unscheduled = newUnscheduled
    mutate(optimistic, false)

    setDragItem(null)

    try {
      await fetch(`/api/posting-queue/${dragItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor: new Date(newScheduledFor).toISOString() })
      })
      mutate()
    } catch (err) {
      console.error('Failed to reschedule:', err)
      mutate(oldData, false)
    }
  }, [dragItem, data, mutate])

  // ── Render ────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-red-800">Failed to load calendar</h3>
      </div>
    )
  }

  const dateLabel = viewMode === 'week'
    ? `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONTH_NAMES[addDays(weekStart, 6).getMonth()]} ${addDays(weekStart, 6).getDate()}, ${addDays(weekStart, 6).getFullYear()}`
    : `${MONTH_NAMES[viewDate.getMonth()]} ${viewDate.getFullYear()}`

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <CalendarHeader
        dateLabel={dateLabel}
        viewMode={viewMode}
        onViewMode={setViewMode}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
      />

      {isLoading && !data ? (
        <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
          <Clock className="w-12 h-12 mx-auto mb-3 text-neutral-300 animate-pulse" />
          <p className="text-neutral-500">Loading calendar...</p>
        </div>
      ) : viewMode === 'week' ? (
        <WeekView
          weekStart={weekStart}
          byDate={byDate}
          today={today}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onItemClick={setSelectedItem}
          onAddClick={(dateKey) => setScheduleDate(dateKey)}
        />
      ) : (
        <MonthView
          viewDate={viewDate}
          byDate={byDate}
          today={today}
          onDayClick={(date) => {
            setViewDate(date)
            setViewMode('week')
          }}
        />
      )}

      {/* Unscheduled sidebar */}
      {unscheduled.length > 0 && (
        <UnscheduledSidebar
          items={unscheduled}
          onDragStart={handleDragStart}
          onItemClick={setSelectedItem}
        />
      )}

      {/* Detail modal */}
      {selectedItem && (
        <PostDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onSave={() => {
            setSelectedItem(null)
            mutate()
          }}
        />
      )}

      {/* Schedule modal */}
      {scheduleDate && (
        <SchedulePostModal
          dateKey={scheduleDate}
          onClose={() => setScheduleDate(null)}
          onAdd={() => {
            setScheduleDate(null)
            mutate()
          }}
        />
      )}
    </div>
  )
}

// ── CalendarHeader ───────────────────────────────────────────────────────────

function CalendarHeader({ dateLabel, viewMode, onViewMode, onPrev, onNext, onToday }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Content Calendar</h1>
        <p className="text-neutral-600 mt-1">Schedule and track your posts</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onToday}
          className="px-3 py-1.5 text-sm border border-neutral-300 rounded-lg hover:bg-neutral-50"
        >
          Today
        </button>
        <div className="flex items-center gap-1">
          <button onClick={onPrev} className="p-1.5 rounded hover:bg-neutral-100">
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm font-medium min-w-[200px] text-center">{dateLabel}</span>
          <button onClick={onNext} className="p-1.5 rounded hover:bg-neutral-100">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="flex rounded-lg border border-neutral-300 overflow-hidden">
          <button
            onClick={() => onViewMode('week')}
            className={`px-3 py-1.5 text-sm ${viewMode === 'week' ? 'bg-gold text-white' : 'hover:bg-neutral-50'}`}
          >
            Week
          </button>
          <button
            onClick={() => onViewMode('month')}
            className={`px-3 py-1.5 text-sm ${viewMode === 'month' ? 'bg-gold text-white' : 'hover:bg-neutral-50'}`}
          >
            Month
          </button>
        </div>
      </div>
    </div>
  )
}

// ── WeekView ─────────────────────────────────────────────────────────────────

function WeekView({ weekStart, byDate, today, onDragStart, onDragOver, onDrop, onItemClick, onAddClick }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map(day => {
        const dateKey = formatDateKey(day)
        const items = byDate[dateKey] || []
        const isToday = isSameDay(day, today)
        const past = isPast(day)

        return (
          <DayColumn
            key={dateKey}
            date={day}
            dateKey={dateKey}
            items={items}
            isToday={isToday}
            isPast={past}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onItemClick={onItemClick}
            onAddClick={onAddClick}
          />
        )
      })}
    </div>
  )
}

function DayColumn({ date, dateKey, items, isToday, isPast: past, onDragStart, onDragOver, onDrop, onItemClick, onAddClick }) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      className={`bg-white rounded-lg border min-h-[220px] flex flex-col transition-colors ${
        isToday ? 'ring-2 ring-amber-400 border-amber-300' : 'border-neutral-200'
      } ${dragOver ? 'bg-amber-50 border-amber-300' : ''}`}
      onDragOver={(e) => {
        onDragOver(e)
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false)
        onDrop(e, dateKey)
      }}
    >
      {/* Day header */}
      <div className={`px-2 py-1.5 border-b text-center ${isToday ? 'bg-amber-50 border-amber-200' : 'border-neutral-100'}`}>
        <div className="text-xs text-neutral-500">{DAY_NAMES[date.getDay()]}</div>
        <div className={`text-lg font-semibold ${isToday ? 'text-amber-700' : past ? 'text-neutral-400' : 'text-neutral-800'}`}>
          {date.getDate()}
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 p-1.5 space-y-1.5 overflow-y-auto max-h-[300px]">
        {items.map(item => (
          <CalendarItem
            key={item.id}
            item={item}
            onDragStart={onDragStart}
            onClick={() => onItemClick(item)}
          />
        ))}
      </div>

      {/* Add button (non-past days only) */}
      {!past && (
        <div className="px-1.5 pb-1.5">
          <button
            onClick={() => onAddClick(dateKey)}
            className="w-full flex items-center justify-center gap-1 py-1 text-xs text-neutral-400 hover:text-neutral-700 hover:bg-neutral-50 rounded transition-colors"
          >
            <Plus size={12} />
            Add
          </button>
        </div>
      )}
    </div>
  )
}

function CalendarItem({ item, onDragStart, onClick }) {
  const isPosted = item.status === 'posted' || item._source === 'posted'
  const isDraggable = !isPosted
  const contentPreview = (item.content || '').substring(0, 50) + ((item.content || '').length > 50 ? '...' : '')

  return (
    <div
      draggable={isDraggable}
      onDragStart={isDraggable ? (e) => onDragStart(e, item) : undefined}
      onClick={onClick}
      className={`p-1.5 rounded border text-xs cursor-pointer transition-colors hover:shadow-sm ${getPlatformBg(item.platform)} ${
        isDraggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isPosted ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-1 mb-0.5">
        {getPlatformIcon(item.platform, 12)}
        <span className="font-medium capitalize truncate">{item.platform}</span>
        {isPosted && <CheckCircle size={10} className="text-green-500 ml-auto flex-shrink-0" />}
      </div>
      <p className="text-neutral-600 line-clamp-2 leading-tight">{contentPreview || 'No content'}</p>
      {(item.scheduledFor || item.postedAt) && (
        <div className="text-neutral-400 mt-0.5 flex items-center gap-0.5">
          <Clock size={10} />
          {formatTime(item.scheduledFor || item.postedAt)}
        </div>
      )}
    </div>
  )
}

// ── MonthView ────────────────────────────────────────────────────────────────

function MonthView({ viewDate, byDate, today, onDayClick }) {
  const ms = startOfMonth(viewDate)
  const me = endOfMonth(viewDate)
  const calStart = startOfWeek(ms)

  // Build 6 weeks of cells
  const weeks = []
  let current = calStart
  for (let w = 0; w < 6; w++) {
    const week = []
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current))
      current = addDays(current, 1)
    }
    weeks.push(week)
    // Stop if we've gone past the month end + that week
    if (current > addDays(me, 7)) break
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
      {/* Day name headers */}
      <div className="grid grid-cols-7 border-b border-neutral-200">
        {DAY_NAMES.map(name => (
          <div key={name} className="px-2 py-2 text-xs font-medium text-neutral-500 text-center">
            {name}
          </div>
        ))}
      </div>

      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-neutral-100 last:border-b-0">
          {week.map(day => {
            const dateKey = formatDateKey(day)
            const items = byDate[dateKey] || []
            const isCurrentMonth = day.getMonth() === viewDate.getMonth()
            const isToday = isSameDay(day, today)
            const hasItems = items.length > 0

            return (
              <div
                key={dateKey}
                onClick={hasItems ? () => onDayClick(day) : undefined}
                className={`min-h-[80px] p-1.5 border-r border-neutral-100 last:border-r-0 transition-colors ${
                  isCurrentMonth ? '' : 'bg-neutral-50'
                } ${isToday ? 'bg-amber-50' : ''} ${hasItems ? 'cursor-pointer hover:bg-neutral-50' : ''}`}
              >
                <div className={`text-sm mb-1 ${
                  isToday ? 'font-bold text-amber-700' : isCurrentMonth ? 'text-neutral-700' : 'text-neutral-400'
                }`}>
                  {day.getDate()}
                </div>
                {/* Platform dots */}
                <div className="flex flex-wrap gap-1">
                  {items.map(item => (
                    <div
                      key={item.id}
                      className={`w-2 h-2 rounded-full ${getPlatformDot(item.platform)}`}
                      title={`${item.platform}: ${(item.content || '').substring(0, 30)}`}
                    />
                  ))}
                </div>
                {items.length > 4 && (
                  <div className="text-[10px] text-neutral-400 mt-0.5">+{items.length - 4} more</div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── UnscheduledSidebar ───────────────────────────────────────────────────────

function UnscheduledSidebar({ items, onDragStart, onItemClick }) {
  return (
    <div className="bg-white rounded-lg border border-neutral-200">
      <div className="px-4 py-3 border-b border-neutral-200">
        <h2 className="font-semibold text-neutral-900 flex items-center gap-2">
          <Calendar size={18} />
          Unscheduled ({items.length})
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">Drag onto a day to schedule</p>
      </div>
      <div className="p-3 flex flex-wrap gap-2">
        {items.map(item => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => onDragStart(e, item)}
            onClick={() => onItemClick(item)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing hover:shadow-sm transition-colors ${getPlatformBg(item.platform)}`}
          >
            <GripVertical size={14} className="text-neutral-400 flex-shrink-0" />
            {getPlatformIcon(item.platform, 14)}
            <span className="text-sm truncate max-w-[200px]">
              {(item.content || '').substring(0, 40) || 'No content'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── PostDetailModal ──────────────────────────────────────────────────────────

function PostDetailModal({ item, onClose, onSave }) {
  const [content, setContent] = useState(item.content || '')
  const [scheduledFor, setScheduledFor] = useState(
    item.scheduledFor ? toLocalDatetimeValue(item.scheduledFor) : ''
  )
  const [isSaving, setIsSaving] = useState(false)
  const isPosted = item.status === 'posted' || item._source === 'posted'

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const body = { content }
      if (scheduledFor) {
        body.scheduledFor = new Date(scheduledFor).toISOString()
      } else if (item.scheduledFor) {
        body.scheduledFor = null
      }
      await fetch(`/api/posting-queue/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      onSave()
    } catch (err) {
      console.error('Error saving:', err)
    }
    setIsSaving(false)
  }

  const handleUnschedule = async () => {
    setIsSaving(true)
    try {
      await fetch(`/api/posting-queue/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor: null })
      })
      onSave()
    } catch (err) {
      console.error('Error unscheduling:', err)
    }
    setIsSaving(false)
  }

  const handleDelete = async () => {
    if (!confirm('Delete this post?')) return
    setIsSaving(true)
    try {
      await fetch(`/api/posting-queue/${item.id}`, { method: 'DELETE' })
      onSave()
    } catch (err) {
      console.error('Error deleting:', err)
    }
    setIsSaving(false)
  }

  const handleMarkPosted = async () => {
    setIsSaving(true)
    try {
      await fetch(`/api/posting-queue/${item.id}/posted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      onSave()
    } catch (err) {
      console.error('Error marking posted:', err)
    }
    setIsSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getPlatformIcon(item.platform, 20)}
            <h2 className="text-lg font-semibold capitalize">{item.platform} Post</h2>
            {isPosted && (
              <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">Posted</span>
            )}
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Content</label>
            {isPosted ? (
              <p className="text-neutral-800 whitespace-pre-wrap bg-neutral-50 rounded p-3 text-sm">{item.content}</p>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
              />
            )}
          </div>

          {/* Schedule */}
          {!isPosted && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">Scheduled For</label>
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
            </div>
          )}

          {/* Posted info */}
          {isPosted && item.postedAt && (
            <div className="text-sm text-neutral-600">
              <span className="font-medium">Posted:</span> {new Date(item.postedAt).toLocaleString()}
            </div>
          )}

          {/* Created */}
          {item.createdAt && (
            <div className="text-xs text-neutral-400">
              Created {new Date(item.createdAt).toLocaleString()}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isPosted && (
          <div className="px-6 py-4 border-t border-neutral-200 flex items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={isSaving}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
              >
                <Trash2 size={14} />
                Delete
              </button>
              {item.scheduledFor && (
                <button
                  onClick={handleUnschedule}
                  disabled={isSaving}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 rounded disabled:opacity-50"
                >
                  <Calendar size={14} />
                  Unschedule
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleMarkPosted}
                disabled={isSaving}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                <Check size={14} />
                Mark Posted
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gold text-white rounded hover:bg-amber-600 disabled:opacity-50"
              >
                <Send size={14} />
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── SchedulePostModal ────────────────────────────────────────────────────────

function SchedulePostModal({ dateKey, onClose, onAdd }) {
  const [platform, setPlatform] = useState('bluesky')
  const [content, setContent] = useState('')
  const [scheduledFor, setScheduledFor] = useState(`${dateKey}T09:00`)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!content.trim()) return

    setIsSubmitting(true)
    try {
      await fetch('/api/posting-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          content,
          scheduledFor: new Date(scheduledFor).toISOString()
        })
      })
      onAdd()
    } catch (err) {
      console.error('Error scheduling post:', err)
    }
    setIsSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Schedule a Post</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Platform */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">Platform</label>
            <div className="flex gap-3">
              {[
                { id: 'bluesky', icon: <BlueskyIcon size={20} className="text-blue-500" />, label: 'Bluesky', activeClass: 'border-blue-500 bg-blue-50 text-blue-700' },
                { id: 'instagram', icon: <Instagram size={20} />, label: 'Instagram', activeClass: 'border-pink-500 bg-pink-50 text-pink-700' },
                { id: 'threads', icon: <MessageCircle size={20} />, label: 'Threads', activeClass: 'border-neutral-500 bg-neutral-100 text-neutral-700' }
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={`flex-1 p-3 rounded-lg border flex items-center justify-center gap-2 transition-colors ${
                    platform === p.id ? p.activeClass : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  {p.icon}
                  <span className="text-sm font-medium">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="What do you want to post?"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Schedule For</label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!content.trim() || isSubmitting}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-gold text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              <Calendar size={16} />
              {isSubmitting ? 'Scheduling...' : 'Schedule Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
