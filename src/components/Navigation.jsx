import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

/**
 * NavLink - Sidebar navigation link with active state
 */
export function NavLink({ to, icon, label, isActive, onClick, external }) {
  const className = `flex items-center space-x-3 px-3 py-2 rounded-md transition-colors ${
    isActive
      ? 'bg-gold text-black font-medium shadow-sm'
      : 'text-neutral-700 hover:bg-neutral-100 hover:text-black'
  }`

  if (external) {
    return (
      <a
        href={to}
        onClick={onClick}
        className={className}
      >
        <span className={isActive ? 'text-black' : 'text-neutral-600'}>
          {icon}
        </span>
        <span>{label}</span>
      </a>
    )
  }

  return (
    <Link
      to={to}
      onClick={onClick}
      className={className}
    >
      <span className={isActive ? 'text-black' : 'text-neutral-600'}>
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  )
}

/**
 * Breadcrumbs - Show current location path
 */
export function Breadcrumbs({ location }) {
  const pathSegments = location.pathname.split('/').filter(Boolean)
  
  // Map paths to readable names
  const pathNames = {
    'costs': 'Cost Management',
    'agents': 'Team',
    'tasks': 'Tasks',
    'recurring': 'Recurring Tasks',
    'schedule': 'Schedule',
    'content': 'Content Pipeline',
    'ideas': 'Ideas Bank',
    'book': 'Book Progress',
    'knowledge': 'Knowledge Base',
    'analytics': 'Analytics',
    'search': 'Search',
    'chapter': 'Chapter'
  }

  if (pathSegments.length === 0) {
    return <span className="text-lg font-semibold text-black">Dashboard</span>
  }

  return (
    <div className="flex items-center space-x-2 text-sm overflow-x-auto max-w-full">
      <Link to="/" className="text-neutral-600 hover:text-black whitespace-nowrap">
        Dashboard
      </Link>
      {pathSegments.map((segment, idx) => {
        const path = '/' + pathSegments.slice(0, idx + 1).join('/')
        const isLast = idx === pathSegments.length - 1
        
        // For dynamic segments (like bookId, chapterNum), show as-is
        const name = pathNames[segment] || segment.replace(/-/g, ' ')
        const displayName = name.charAt(0).toUpperCase() + name.slice(1)

        return (
          <div key={path} className="flex items-center space-x-2">
            <ChevronRight size={16} className="text-neutral-400 flex-shrink-0" />
            {isLast ? (
              <span className="text-black font-semibold whitespace-nowrap">{displayName}</span>
            ) : (
              <Link to={path} className="text-neutral-600 hover:text-black whitespace-nowrap">
                {displayName}
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * NavGroup - Grouped navigation items with title
 */
export function NavGroup({ title, items, currentPath, onItemClick }) {
  return (
    <div>
      <h3 className="px-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
        {title}
      </h3>
      <div className="space-y-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            isActive={currentPath === item.to}
            onClick={onItemClick}
            external={item.external}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * PageHeader - Consistent page header with title and optional actions
 */
export function PageHeader({ title, subtitle, actions, icon }) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            {icon && <span className="text-gold">{icon}</span>}
            <h1 className="text-3xl font-serif font-bold text-black">{title}</h1>
          </div>
          {subtitle && (
            <p className="text-neutral-600 text-lg">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center space-x-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * BackButton - Navigate back with context
 */
export function BackButton({ to, label = "Back" }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center space-x-2 text-neutral-600 hover:text-black transition-colors mb-4"
    >
      <ChevronRight size={16} className="rotate-180" />
      <span>{label}</span>
    </Link>
  )
}

/**
 * useActiveRoute - Hook to check if a route is active
 */
export function useActiveRoute(path) {
  const location = useLocation()
  return location.pathname === path || location.pathname.startsWith(path + '/')
}
