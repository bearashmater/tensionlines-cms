import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { Home, Users, ListTodo, Activity, FileText, Lightbulb, BarChart3, Search, Menu, Book, Calendar, Repeat, X, DollarSign, AlertTriangle, Rocket, Target, Bell } from 'lucide-react'
import { useState } from 'react'

// Import navigation components
import { NavGroup, Breadcrumbs } from './components/Navigation'

// Import page components
import Dashboard from './components/Dashboard'
import AgentsView from './components/AgentsView'
import TasksView from './components/TasksView'
import ContentPipeline from './components/ContentPipeline'
import KnowledgeBase from './components/KnowledgeBase'
import Analytics from './components/Analytics'
import SearchView from './components/SearchView'
import BookProgress from './components/BookProgress'
import ChapterDetail from './components/ChapterDetail'
import PostingSchedule from './components/PostingSchedule'
import RecurringTasks from './components/RecurringTasks'
import CostDashboard from './components/CostDashboard'
import HumanTasks from './components/HumanTasks'
import SquadLeadDashboard from './components/SquadLeadDashboard'
import NotificationsView from './components/NotificationsView'

// Navigation structure with grouping
const navGroups = [
  {
    title: 'Overview',
    items: [
      { to: '/', icon: <Home size={20} />, label: 'Dashboard' },
      { to: '/human-tasks', icon: <AlertTriangle size={20} />, label: 'Your Tasks', priority: true },
      { to: '/notifications', icon: <Bell size={20} />, label: 'Notifications' },
      { to: '/costs', icon: <DollarSign size={20} />, label: 'Cost Management', priority: true }
    ]
  },
  {
    title: 'Operations',
    items: [
      { to: '/agents', icon: <Users size={20} />, label: 'Team' },
      { to: '/tasks', icon: <ListTodo size={20} />, label: 'Tasks' },
      { to: '/recurring', icon: <Repeat size={20} />, label: 'Recurring Tasks' },
      { to: '/schedule', icon: <Calendar size={20} />, label: 'Schedule' },
      { to: '/squad-lead', icon: <Target size={20} />, label: 'Squad Lead' },
      { to: '/mission-control/', icon: <Rocket size={20} />, label: 'Mission Control', external: true }
    ]
  },
  {
    title: 'Content',
    items: [
      { to: '/content', icon: <FileText size={20} />, label: 'Pipeline' },
      { to: '/ideas', icon: <Lightbulb size={20} />, label: 'Ideas Bank' },
      { to: '/book', icon: <Book size={20} />, label: 'Book Progress' }
    ]
  },
  {
    title: 'Insights',
    items: [
      { to: '/knowledge', icon: <Activity size={20} />, label: 'Knowledge' },
      { to: '/analytics', icon: <BarChart3 size={20} />, label: 'Analytics' },
      { to: '/search', icon: <Search size={20} />, label: 'Search' }
    ]
  }
]

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <Router>
      <AppContent 
        sidebarOpen={sidebarOpen} 
        setSidebarOpen={setSidebarOpen}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />
    </Router>
  )
}

function AppContent({ sidebarOpen, setSidebarOpen, mobileMenuOpen, setMobileMenuOpen }) {
  const location = useLocation()

  return (
    <div className="min-h-screen bg-cream">
      {/* Desktop Sidebar */}
      <aside className={`fixed top-0 left-0 z-40 h-screen transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} w-64 bg-white border-r border-neutral-200 hidden md:block`}>
        <Sidebar 
          location={location} 
          onClose={() => setSidebarOpen(false)} 
        />
      </aside>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="fixed top-0 left-0 z-50 h-screen w-64 bg-white border-r border-neutral-200 md:hidden shadow-xl">
            <Sidebar 
              location={location} 
              onClose={() => setMobileMenuOpen(false)}
              showCloseButton={true}
            />
          </aside>
        </>
      )}

      {/* Main Content */}
      <div className={`${sidebarOpen ? 'md:ml-64' : 'md:ml-0'} transition-all duration-300`}>
        {/* Top Bar */}
        <header className="bg-white border-b border-neutral-200 px-4 md:px-6 py-4 sticky top-0 z-30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 min-w-0 flex-1">
              {/* Desktop Toggle */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 rounded-md hover:bg-neutral-100 hidden md:block flex-shrink-0"
                title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
              >
                <Menu size={20} />
              </button>

              {/* Mobile Toggle */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="p-2 rounded-md hover:bg-neutral-100 md:hidden flex-shrink-0"
                title="Open menu"
              >
                <Menu size={20} />
              </button>

              {/* Breadcrumbs */}
              <div className="min-w-0 flex-1">
                <Breadcrumbs location={location} />
              </div>
            </div>
            
            <div className="flex items-center space-x-4 flex-shrink-0">
              <span className="text-sm text-neutral-600 hidden sm:block">
                {new Date().toLocaleTimeString()}
              </span>
            </div>
          </div>
        </header>

        {/* Routes */}
        <main className="p-4 md:p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/human-tasks" element={<HumanTasks />} />
            <Route path="/notifications" element={<NotificationsView />} />
            <Route path="/costs" element={<CostDashboard />} />
            <Route path="/agents" element={<AgentsView />} />
            <Route path="/tasks" element={<TasksView />} />
            <Route path="/recurring" element={<RecurringTasks />} />
            <Route path="/schedule" element={<PostingSchedule />} />
            <Route path="/content" element={<ContentPipeline />} />
            <Route path="/ideas" element={<ContentPipeline />} />
            <Route path="/book" element={<BookProgress />} />
            <Route path="/book/:bookId/chapter/:chapterNum" element={<ChapterDetail />} />
            <Route path="/knowledge" element={<KnowledgeBase />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/search" element={<SearchView />} />
            <Route path="/squad-lead" element={<SquadLeadDashboard />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

// Sidebar Component
function Sidebar({ location, onClose, showCloseButton = false }) {
  return (
    <div className="h-full px-3 py-4 overflow-y-auto flex flex-col">
      {/* Logo */}
      <div className="flex items-center justify-between mb-8 px-3">
        <h1 className="text-2xl font-serif font-bold text-black">
          TensionLines
        </h1>
        {showCloseButton && (
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-neutral-100"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="space-y-6 flex-1">
        {navGroups.map((group, idx) => (
          <NavGroup
            key={idx}
            title={group.title}
            items={group.items}
            currentPath={location.pathname}
            onItemClick={showCloseButton ? onClose : undefined}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="pt-4 border-t border-neutral-200 mt-auto">
        <p className="text-xs text-neutral-500 px-3">
          Built by the philosopher squad
        </p>
        <p className="text-xs text-neutral-400 px-3 mt-1">
          v1.0 • Feb 2026
        </p>
      </div>
    </div>
  )
}

export default App
