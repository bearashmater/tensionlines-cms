import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Bug, AlertTriangle, CheckCircle, XCircle, Clock, Play, User, RefreshCw } from 'lucide-react'

const fetcher = (url) => fetch(url).then(r => r.json())

export default function DebugPanel() {
  const { data: approvalsData } = useSWR('/api/system/approvals', fetcher, { refreshInterval: 30000 })
  const { data: tasksData } = useSWR('/api/tasks', fetcher, { refreshInterval: 30000 })

  const pendingApprovals = (approvalsData?.approvals || []).filter(a => !a.decision)
  const tasks = tasksData?.tasks || []

  // Stuck tasks: active tasks with yellow or red alert level
  const stuckTasks = tasks.filter(t =>
    ['assigned', 'in_progress', 'review'].includes(t.status) &&
    (t.alertLevel === 'yellow' || t.alertLevel === 'red')
  )

  return (
    <div className="space-y-6">
      {/* Approval Queue */}
      <div>
        <h3 className="text-lg font-serif font-semibold mb-3 flex items-center gap-2">
          <CheckCircle size={18} /> Approval Queue
          {pendingApprovals.length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">{pendingApprovals.length}</span>
          )}
        </h3>
        {pendingApprovals.length === 0 ? (
          <div className="bg-white rounded-lg border border-neutral-200 p-6 text-center text-neutral-400 text-sm">
            No pending approvals
          </div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map(approval => (
              <ApprovalCard key={approval.id} approval={approval} />
            ))}
          </div>
        )}
      </div>

      {/* Stuck Tasks */}
      <div>
        <h3 className="text-lg font-serif font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle size={18} /> Stuck Tasks
          {stuckTasks.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">{stuckTasks.length}</span>
          )}
        </h3>
        {stuckTasks.length === 0 ? (
          <div className="bg-white rounded-lg border border-neutral-200 p-6 text-center text-neutral-400 text-sm">
            No stuck tasks. Everything is moving smoothly.
          </div>
        ) : (
          <div className="space-y-3">
            {stuckTasks.map(task => (
              <StuckTaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ApprovalCard({ approval }) {
  const [deciding, setDeciding] = useState(false)

  const handleDecision = async (decision) => {
    setDeciding(true)
    try {
      await fetch(`/api/system/approvals/${approval.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      })
      mutate('/api/system/approvals')
    } catch (e) {
      console.error('Decision failed:', e)
    }
    setDeciding(false)
  }

  return (
    <div className="bg-white rounded-lg border border-amber-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-neutral-800">{approval.description || approval.taskId}</h4>
          {approval.estimatedCost && (
            <p className="text-sm text-neutral-500 mt-1">Estimated cost: ${approval.estimatedCost.toFixed(2)}</p>
          )}
          {approval.reason && (
            <p className="text-sm text-neutral-500 mt-1">{approval.reason}</p>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => handleDecision('approved')}
            disabled={deciding}
            className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-md hover:bg-green-600 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => handleDecision('denied')}
            disabled={deciding}
            className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-md hover:bg-red-600 disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}

function StuckTaskCard({ task }) {
  const [debugging, setDebugging] = useState(false)
  const [debugResult, setDebugResult] = useState(task.debugResults?.[task.debugResults?.length - 1] || null)

  const handleDebug = async () => {
    setDebugging(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/debug`, { method: 'POST' })
      const data = await res.json()
      setDebugResult(data)
      mutate('/api/tasks')
    } catch (e) {
      console.error('Debug failed:', e)
    }
    setDebugging(false)
  }

  const assigneeNames = task.assigneeNames || task.assigneeIds || []

  return (
    <div className={`bg-white rounded-lg border p-4 ${task.alertLevel === 'red' ? 'border-red-200' : 'border-amber-200'}`}>
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-2 ${task.alertLevel === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-neutral-800 truncate">{task.title}</h4>
          <div className="flex flex-wrap gap-3 mt-1 text-xs text-neutral-500">
            {assigneeNames.length > 0 && (
              <span className="flex items-center gap-1">
                <User size={10} />
                {Array.isArray(assigneeNames) ? assigneeNames.join(', ') : assigneeNames}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {task.timeInStatusHuman || 'unknown'}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
              task.alertLevel === 'red' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {task.status}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          onClick={handleDebug}
          disabled={debugging}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-purple-50 text-purple-700 rounded-md hover:bg-purple-100 disabled:opacity-50 w-full md:w-auto justify-center"
        >
          {debugging ? <RefreshCw size={14} className="animate-spin" /> : <Bug size={14} />}
          {debugging ? 'Analyzing...' : 'Debug (Sonnet)'}
        </button>
      </div>

      {/* Debug Results */}
      {debugResult && (
        <div className="mt-3 p-3 bg-neutral-50 rounded-md border border-neutral-100 text-sm">
          <p className="text-xs font-medium text-neutral-500 mb-1">Last Debug Analysis:</p>
          <p className="text-neutral-700 whitespace-pre-wrap text-xs">{debugResult.analysis || debugResult.message || JSON.stringify(debugResult)}</p>
        </div>
      )}
    </div>
  )
}
