import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { getBooks } from '../lib/api'
import { formatNumber } from '../lib/formatters'
import { Book, CheckCircle2, Circle } from 'lucide-react'

export default function BookProgress() {
  const navigate = useNavigate()
  const { data: books, error } = useSWR('/books', getBooks, {
    refreshInterval: 120000
  })
  
  const [selectedBook, setSelectedBook] = useState(null)

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-600">Failed to load book data</p>
      </div>
    )
  }

  if (!books) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Loading books...</p>
      </div>
    )
  }

  const currentBook = selectedBook || books[0]

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold text-black">Book Progress</h1>
        <p className="text-neutral-600 mt-1">Track writing progress across the series</p>
      </div>

      {/* Book Selector */}
      {books.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {books.map(book => (
            <button
              key={book.id}
              onClick={() => setSelectedBook(book)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                currentBook?.id === book.id
                  ? 'bg-gold text-white'
                  : 'bg-white text-neutral-700 hover:bg-accent-tertiary border border-neutral-200'
              }`}
            >
              {book.name}
            </button>
          ))}
        </div>
      )}

      {currentBook && (
        <>
          {/* Overview Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard
              label="Total Progress"
              value={`${currentBook.percentComplete}%`}
              subtitle={`${formatNumber(currentBook.totalWords)} / ${formatNumber(currentBook.targetWords)} words`}
            />
            <StatCard
              label="Current Phase"
              value={currentBook.phase || 'Planning'}
              subtitle={`${currentBook.phases.length} phases defined`}
            />
            <StatCard
              label="Chapters"
              value={`${currentBook.chapters.filter(c => c.currentWords > 0).length} / ${currentBook.chapters.length}`}
              subtitle="Chapters started"
            />
          </div>

          {/* Phases */}
          <div className="bg-white rounded-lg border border-neutral-200 p-6">
            <h2 className="text-xl font-serif font-semibold mb-4">Phases</h2>
            <div className="space-y-4">
              {currentBook.phases.map(phase => (
                <div key={phase.number} className="border-l-4 border-gold pl-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="font-semibold">
                        Phase {phase.number}: {phase.name}
                      </h3>
                      <p className="text-sm text-neutral-600">{phase.status}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-semibold text-gold">{phase.percentComplete}%</p>
                      <p className="text-sm text-neutral-600">
                        {phase.tasks.filter(t => t.completed).length} / {phase.tasks.length} complete
                      </p>
                    </div>
                  </div>
                  
                  {/* Progress bar */}
                  <div className="w-full bg-neutral-100 rounded-full h-2 mb-3">
                    <div 
                      className="bg-gold rounded-full h-2 transition-all"
                      style={{ width: `${phase.percentComplete}%` }}
                    />
                  </div>

                  {/* Tasks */}
                  <div className="space-y-1">
                    {phase.tasks.map((task, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        {task.completed ? (
                          <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
                        ) : (
                          <Circle size={16} className="text-neutral-400 flex-shrink-0" />
                        )}
                        <span className={task.completed ? 'text-neutral-600' : 'text-neutral-800'}>
                          {task.task}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chapter Progress */}
          <div className="bg-white rounded-lg border border-neutral-200 p-6">
            <h2 className="text-xl font-serif font-semibold mb-4">Chapters</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <th className="text-left py-2 px-4 font-semibold">Chapter</th>
                    <th className="text-left py-2 px-4 font-semibold">Status</th>
                    <th className="text-right py-2 px-4 font-semibold">Progress</th>
                    <th className="text-right py-2 px-4 font-semibold">Words</th>
                  </tr>
                </thead>
                <tbody>
                  {currentBook.chapters.map(chapter => (
                    <tr 
                      key={chapter.number} 
                      onClick={() => navigate(`/book/${currentBook.id}/chapter/${chapter.number}`)}
                      className="border-b border-neutral-100 hover:bg-accent-tertiary cursor-pointer"
                    >
                      <td className="py-3 px-4 font-medium">
                        {chapter.number === 0 ? 'Introduction' : `Chapter ${chapter.number}`}
                        {chapter.title && <span className="text-neutral-600 font-normal ml-2">— {chapter.title}</span>}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                          chapter.status === 'Planning' ? 'bg-neutral-100 text-neutral-700' :
                          chapter.status === 'Drafting' ? 'bg-blue-100 text-blue-700' :
                          chapter.status === 'Revision' ? 'bg-yellow-100 text-yellow-700' :
                          chapter.status === 'Complete' ? 'bg-green-100 text-green-700' :
                          'bg-neutral-100 text-neutral-700'
                        }`}>
                          {chapter.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-sm font-medium">{chapter.percentComplete}%</span>
                          <div className="w-24 bg-neutral-100 rounded-full h-2">
                            <div 
                              className="bg-gold rounded-full h-2"
                              style={{ width: `${chapter.percentComplete}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-sm">
                        <span className="font-medium">{formatNumber(chapter.currentWords)}</span>
                        <span className="text-neutral-500"> / {formatNumber(chapter.targetWords)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-neutral-300 font-semibold">
                    <td className="py-3 px-4" colSpan="2">Total</td>
                    <td className="py-3 px-4 text-right">{currentBook.percentComplete}%</td>
                    <td className="py-3 px-4 text-right">
                      <span>{formatNumber(currentBook.totalWords)}</span>
                      <span className="text-neutral-500"> / {formatNumber(currentBook.targetWords)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, subtitle }) {
  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-6">
      <p className="text-sm text-neutral-600 mb-1">{label}</p>
      <p className="text-3xl font-serif font-bold text-black mb-1">{value}</p>
      {subtitle && <p className="text-sm text-neutral-500">{subtitle}</p>}
    </div>
  )
}
