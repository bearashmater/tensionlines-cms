import { useParams } from 'react-router-dom'
import useSWR from 'swr'
import { getChapter, getBooks } from '../lib/api'
import { formatNumber } from '../lib/formatters'
import { FileText, Lightbulb, BookOpen, Printer } from 'lucide-react'
import { BackButton, PageHeader } from './Navigation'

export default function ChapterDetail() {
  const { bookId, chapterNum } = useParams()
  
  const { data: books } = useSWR('/books', getBooks)
  const { data: chapter, error } = useSWR(
    bookId && chapterNum ? `/books/${bookId}/chapters/${chapterNum}` : null,
    () => getChapter(bookId, parseInt(chapterNum)),
    { refreshInterval: 120000 }
  )

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-600">Failed to load chapter</p>
      </div>
    )
  }

  if (!chapter) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Loading chapter...</p>
      </div>
    )
  }

  const book = books?.find(b => b.id === bookId)
  const chapterTitle = chapter.number === 0 ? 'Introduction' : `Chapter ${chapter.number}`
  const fullTitle = chapter.title ? `${chapterTitle}: ${chapter.title}` : chapterTitle

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Back Button */}
      <BackButton to="/book" label="Back to Books" />

      {/* Header */}
      <div className="flex items-start justify-between">
        <PageHeader
          title={fullTitle}
          subtitle={book?.name}
          icon={<BookOpen size={28} />}
        />
        {chapter.wordCount > 0 && (
          <div className="flex gap-2 mt-1">
            <a
              href={`/print/${bookId}/chapter/${chapterNum}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 hover:text-black transition-colors"
            >
              <Printer size={14} />
              Print Chapter
            </a>
            <a
              href={`/print/${bookId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-600 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 hover:text-black transition-colors"
            >
              <Printer size={14} />
              Print Book
            </a>
          </div>
        )}
      </div>

      {/* Chapter Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<FileText size={20} className="text-gold" />}
          label="Word Count"
          value={formatNumber(chapter.wordCount)}
        />
        <StatCard
          icon={<Lightbulb size={20} className="text-gold" />}
          label="Linked Ideas"
          value={chapter.ideas.length}
        />
        <StatCard
          icon={<BookOpen size={20} className="text-gold" />}
          label="Status"
          value={chapter.wordCount > 0 ? 'Drafted' : 'Planning'}
        />
      </div>

      {/* Chapter Outline */}
      {chapter.outline && (
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-2">
            <BookOpen size={20} className="text-gold" />
            Chapter Outline
          </h2>
          <div className="prose prose-sm max-w-none text-neutral-700 whitespace-pre-wrap">
            {chapter.outline}
          </div>
        </div>
      )}

      {/* Linked Ideas */}
      {chapter.ideas.length > 0 && (
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-2">
            <Lightbulb size={20} className="text-gold" />
            Ideas & Inspiration
          </h2>
          <div className="space-y-4">
            {chapter.ideas.map(idea => (
              <div key={idea.id} className="border-l-4 border-gold pl-4 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gold">Idea #{idea.id}</span>
                  <span className="text-sm text-neutral-500">{idea.capturedAt}</span>
                </div>
                <p className="text-neutral-700">{idea.quote || idea.text}</p>
                {idea.tags.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    {idea.tags.map(tag => (
                      <span key={tag} className="text-xs px-2 py-1 bg-neutral-100 text-neutral-600 rounded">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chapter Content */}
      {chapter.content && (
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <h2 className="text-xl font-serif font-semibold mb-4 flex items-center gap-2">
            <FileText size={20} className="text-gold" />
            Chapter Content
          </h2>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap">
            {chapter.content}
          </div>
        </div>
      )}

      {/* Empty state if no content */}
      {!chapter.content && chapter.ideas.length === 0 && (
        <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
          <FileText size={48} className="text-neutral-300 mx-auto mb-4" />
          <p className="text-neutral-600">No content yet for this chapter.</p>
          <p className="text-neutral-500 text-sm mt-2">
            Add ideas or start drafting to see them here.
          </p>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value }) {
  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4 flex items-center gap-3">
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <p className="text-sm text-neutral-600">{label}</p>
        <p className="text-2xl font-serif font-bold text-black">{value}</p>
      </div>
    </div>
  )
}
