import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { X, User, ArrowRight, AlertTriangle } from 'lucide-react'
import { fetcher, reassignTask } from '../../lib/api'

export default function ReassignModal({ task, onClose, onReassign }) {
  const [selectedAgent, setSelectedAgent] = useState(null)
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const { data: agents } = useSWR('/api/squad-lead/available-agents', fetcher)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selectedAgent) return

    setIsSubmitting(true)
    setError(null)

    try {
      await reassignTask(task.id, selectedAgent.id, reason)
      onReassign()
    } catch (err) {
      setError(err.message || 'Failed to reassign task')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Sort agents by workload (lowest first)
  const sortedAgents = agents
    ? [...agents].sort((a, b) => a.workloadScore - b.workloadScore)
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">Reassign Task</h2>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Task Info */}
        <div className="px-6 py-4 bg-neutral-50 border-b border-neutral-200">
          <div className="text-sm text-neutral-500 mb-1">Task:</div>
          <div className="font-medium text-neutral-900">{task.title}</div>
          <div className="text-sm text-neutral-600 mt-1">
            Currently assigned to: {task.assigneeIds?.join(', ') || 'Unassigned'}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Agent Selection */}
          <div className="px-6 py-4">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Select New Assignee
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {sortedAgents.length === 0 ? (
                <p className="text-sm text-neutral-500 text-center py-4">Loading agents...</p>
              ) : (
                sortedAgents.map((agent) => {
                  const isCurrentAssignee = task.assigneeIds?.includes(agent.id)
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      disabled={isCurrentAssignee}
                      onClick={() => setSelectedAgent(agent)}
                      className={`w-full p-3 rounded-lg border text-left flex items-center justify-between transition-all ${
                        selectedAgent?.id === agent.id
                          ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-200'
                          : isCurrentAssignee
                          ? 'border-neutral-200 bg-neutral-100 opacity-50 cursor-not-allowed'
                          : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {agent.avatarUrl ? (
                          <img
                            src={agent.avatarUrl}
                            alt={agent.name}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center text-sm font-medium">
                            {agent.name?.charAt(0) || '?'}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-neutral-900">{agent.name}</div>
                          <div className="text-xs text-neutral-500">{agent.role}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-medium ${
                          agent.workloadScore >= 80 ? 'text-red-600' :
                          agent.workloadScore >= 60 ? 'text-orange-600' :
                          agent.workloadScore >= 40 ? 'text-yellow-600' :
                          'text-green-600'
                        }`}>
                          {agent.workloadScore}%
                        </div>
                        <div className="text-xs text-neutral-500">workload</div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Reason */}
          <div className="px-6 py-4 border-t border-neutral-100">
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Reason for Reassignment (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Original assignee is overloaded, skill mismatch, etc."
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-500"
              rows={2}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="px-6 py-2">
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertTriangle size={16} />
                {error}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-6 py-4 border-t border-neutral-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedAgent || isSubmitting}
              className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? 'Reassigning...' : (
                <>
                  Reassign
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
