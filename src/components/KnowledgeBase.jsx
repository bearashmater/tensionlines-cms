import useSWR from 'swr'
import { getMemory } from '../lib/api'
import { formatDate, formatFileSize } from '../lib/formatters'
import { FileText, Calendar } from 'lucide-react'

export default function KnowledgeBase() {
  const { data: memory } = useSWR('/memory', getMemory, { refreshInterval: 120000 })

  if (!memory) return <LoadingState />

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Knowledge Base</h1>
        <p className="text-neutral-600 mt-1">Memory & learnings repository</p>
      </div>

      {/* Memory Files */}
      <div className="space-y-3">
        {memory.map(file => (
          <MemoryCard key={file.filename} file={file} />
        ))}
      </div>
    </div>
  )
}

function MemoryCard({ file }) {
  const isDaily = file.filename.match(/\d{4}-\d{2}-\d{2}\.md/)
  const isMainMemory = file.filename === 'MEMORY.md'

  return (
    <div className={`card card-hover ${isMainMemory ? 'border-2 border-gold' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            {isDaily ? (
              <Calendar size={20} className="text-gold" />
            ) : (
              <FileText size={20} className="text-gold" />
            )}
            <h3 className="font-medium text-black">{file.filename}</h3>
            {isMainMemory && (
              <span className="badge bg-gold text-white">Long-term Memory</span>
            )}
          </div>
          
          <div className="flex items-center space-x-4 text-sm text-neutral-600">
            <span>{formatFileSize(file.size)}</span>
            <span>Modified {formatDate(file.modified)}</span>
          </div>
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
