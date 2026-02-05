import { useState } from 'react'
import useSWR from 'swr'
import { getTasks } from '../lib/api'
import { CheckCircle, Clock, ExternalLink, AlertCircle } from 'lucide-react'

export default function HumanTasks() {
  const { data: allTasks, error, mutate } = useSWR('/tasks', getTasks, {
    refreshInterval: 30000
  })
  
  const [completing, setCompleting] = useState(null)

  if (error) return <ErrorState />
  if (!allTasks) return <LoadingState />

  const humanTasks = allTasks.filter(t => 
    t.assigneeIds?.includes('human') && 
    t.status !== 'completed' && 
    t.status !== 'shipped'
  )

  if (humanTasks.length === 0) {
    return <EmptyState />
  }

  const handleComplete = async (taskId) => {
    setCompleting(taskId)
    
    try {
      // Update task status in database
      const response = await fetch(`/api/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completedBy: 'human' })
      })
      
      if (!response.ok) throw new Error('Failed to complete task')
      
      // Refresh tasks list
      mutate()
    } catch (err) {
      console.error('Error completing task:', err)
      alert('Failed to mark task complete. Please try again.')
    } finally {
      setCompleting(null)
    }
  }

  // Sort by priority
  const sortedTasks = [...humanTasks].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    const aPriority = a.metadata?.priority || 'medium'
    const bPriority = b.metadata?.priority || 'medium'
    return priorityOrder[aPriority] - priorityOrder[bPriority]
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-black">Your Tasks</h1>
          <p className="text-neutral-600 mt-1">
            {humanTasks.length} task{humanTasks.length === 1 ? '' : 's'} need your attention
          </p>
        </div>
        <AlertCircle className="text-gold" size={32} />
      </div>

      <div className="space-y-4">
        {sortedTasks.map(task => (
          <TaskCard 
            key={task.id} 
            task={task} 
            onComplete={handleComplete}
            completing={completing === task.id}
          />
        ))}
      </div>
    </div>
  )
}

function TaskCard({ task, onComplete, completing }) {
  const priority = task.metadata?.priority || 'medium'
  const estimatedMinutes = task.metadata?.estimatedMinutes || null
  const directLink = task.metadata?.directLink
  const unblocks = task.metadata?.unblocks

  const priorityColors = {
    high: 'border-l-red-500 bg-red-50',
    medium: 'border-l-yellow-500 bg-yellow-50',
    low: 'border-l-blue-500 bg-blue-50'
  }

  const priorityBadges = {
    high: 'bg-red-100 text-red-700 border-red-200',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    low: 'bg-blue-100 text-blue-700 border-blue-200'
  }

  return (
    <div className={`bg-white rounded-lg border-l-4 ${priorityColors[priority]} p-6 shadow-sm`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-xl font-serif font-semibold text-black">
              {task.title}
            </h3>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${priorityBadges[priority]}`}>
              {priority.toUpperCase()} PRIORITY
            </span>
          </div>
          
          {estimatedMinutes && (
            <div className="flex items-center gap-2 text-sm text-neutral-600 mb-3">
              <Clock size={14} />
              <span>Estimated time: {estimatedMinutes} minutes</span>
            </div>
          )}
        </div>
      </div>

      <div className="prose prose-sm max-w-none mb-4">
        <div 
          className="text-neutral-700 whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: formatDescription(task.description) }}
        />
      </div>

      {directLink && (
        <div className="mb-4">
          <a 
            href={directLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-gold hover:text-black font-medium transition-colors"
          >
            <ExternalLink size={16} />
            Open Link
          </a>
        </div>
      )}

      {unblocks && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
          <p className="text-sm text-green-800">
            <strong>✅ Unlocks:</strong> {Array.isArray(unblocks) ? unblocks.join(', ') : unblocks}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-neutral-200">
        <button
          onClick={() => onComplete(task.id)}
          disabled={completing}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
            completing
              ? 'bg-neutral-300 text-neutral-500 cursor-not-allowed'
              : 'bg-gold text-white hover:bg-black shadow-sm hover:shadow-md'
          }`}
        >
          <CheckCircle size={18} />
          {completing ? 'Marking Complete...' : 'Mark Complete'}
        </button>
        
        <span className="text-sm text-neutral-500">
          Task #{task.id.replace('task-', '')}
        </span>
      </div>
    </div>
  )
}

function formatDescription(description) {
  // Convert markdown-style formatting to HTML
  return description
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.*?)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
    .replace(/^- (.*?)$/gm, '<li class="ml-4">$1</li>')
    .replace(/```([\s\S]*?)```/g, '<pre class="bg-neutral-100 p-3 rounded-md overflow-x-auto text-sm my-3">$1</pre>')
    .replace(/\n\n/g, '</p><p class="mt-3">')
    .replace(/^(.*)$/gm, '<p>$1</p>')
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorState() {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-red-900 mb-2">Error Loading Tasks</h2>
      <p className="text-red-700">Failed to load your tasks. Please refresh the page.</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-12 text-center">
      <CheckCircle size={48} className="text-green-600 mx-auto mb-4" />
      <h2 className="text-2xl font-serif font-bold text-black mb-2">All Clear!</h2>
      <p className="text-neutral-700">
        No tasks need your attention right now. The philosopher squad is handling everything.
      </p>
    </div>
  )
}
