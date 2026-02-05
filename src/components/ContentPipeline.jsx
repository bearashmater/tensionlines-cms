import useSWR from 'swr'
import { getIdeas, getDrafts } from '../lib/api'
import { formatDate, getStatusColor } from '../lib/formatters'
import { Lightbulb, FileText } from 'lucide-react'

export default function ContentPipeline() {
  const { data: ideas } = useSWR('/ideas', getIdeas, { refreshInterval: 120000 })
  const { data: drafts } = useSWR('/drafts', getDrafts, { refreshInterval: 120000 })

  if (!ideas || !drafts) return <LoadingState />

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Content Pipeline</h1>
        <p className="text-neutral-600 mt-1">Ideas → Drafts → Published</p>
      </div>

      {/* Ideas Section */}
      <div>
        <h2 className="text-xl font-serif font-semibold mb-4 flex items-center">
          <Lightbulb size={24} className="mr-2 text-gold" />
          Ideas Bank ({ideas.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ideas.slice(0, 6).map(idea => (
            <IdeaCard key={idea.id} idea={idea} />
          ))}
        </div>
      </div>

      {/* Drafts Section */}
      <div>
        <h2 className="text-xl font-serif font-semibold mb-4 flex items-center">
          <FileText size={24} className="mr-2 text-gold" />
          Drafts ({drafts.length})
        </h2>
        <div className="space-y-3">
          {drafts.slice(0, 8).map(draft => (
            <DraftCard key={draft.filename} draft={draft} />
          ))}
        </div>
      </div>
    </div>
  )
}

function IdeaCard({ idea }) {
  const statusColor = getStatusColor(idea.status)

  return (
    <div className="card card-hover">
      <div className="flex items-start justify-between mb-2">
        <span className="text-sm font-mono text-neutral-500">#{idea.id}</span>
        <span className={`badge ${statusColor}`}>{idea.status}</span>
      </div>
      <p className="text-sm text-black mb-2">{idea.text}</p>
      {idea.tags && idea.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {idea.tags.map(tag => (
            <span key={tag} className="text-xs px-2 py-1 bg-neutral-100 text-neutral-600 rounded">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DraftCard({ draft }) {
  return (
    <div className="card card-hover">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <span className="badge badge-status">{draft.platform}</span>
            <span className="text-xs text-neutral-500">{draft.philosopher}</span>
          </div>
          <h3 className="font-medium text-black mb-1">{draft.filename}</h3>
          <p className="text-sm text-neutral-600 line-clamp-2">{draft.content.substring(0, 150)}...</p>
          <p className="text-xs text-neutral-500 mt-2">
            Modified {formatDate(draft.modified)}
          </p>
        </div>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-16 h-16 border-4 border-gold border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
