import { useState } from 'react'
import { search } from '../lib/api'
import { Search, FileText, Lightbulb, ListTodo } from 'lucide-react'

export default function SearchView() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  const handleSearch = async (e) => {
    e.preventDefault()
    if (query.length < 2) return

    setLoading(true)
    try {
      const data = await search(query)
      setResults(data)
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Search</h1>
        <p className="text-neutral-600 mt-1">Find anything across the project</p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="card">
        <div className="relative">
          <Search className="absolute left-3 top-3 text-neutral-400" size={20} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, ideas, drafts, memory..."
            className="input-search w-full"
          />
        </div>
      </form>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-12 h-12 border-4 border-gold border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">{results.length} results found</p>
          {results.map((result, idx) => (
            <ResultCard key={idx} result={result} />
          ))}
        </div>
      )}

      {!loading && query && results.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-neutral-500">No results found for "{query}"</p>
        </div>
      )}
    </div>
  )
}

function ResultCard({ result }) {
  const getIcon = () => {
    switch (result.type) {
      case 'task': return <ListTodo size={20} className="text-gold" />
      case 'idea': return <Lightbulb size={20} className="text-gold" />
      case 'draft': return <FileText size={20} className="text-gold" />
      default: return <FileText size={20} className="text-gold" />
    }
  }

  return (
    <div className="card card-hover">
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0 mt-1">{getIcon()}</div>
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-1">
            <span className="badge bg-neutral-200 text-neutral-700">{result.type}</span>
          </div>
          <h3 className="font-medium text-black mb-1">{result.title}</h3>
          <p className="text-sm text-neutral-600">{result.snippet}...</p>
        </div>
      </div>
    </div>
  )
}
