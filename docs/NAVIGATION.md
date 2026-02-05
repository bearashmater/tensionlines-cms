# Navigation System Documentation

## Overview

The CMS navigation system provides a consistent, hierarchical structure for navigating between all views. It includes:

- **Grouped Sidebar Navigation** with active states
- **Breadcrumbs** for location awareness
- **Mobile-responsive** menu with overlay
- **Reusable Components** for consistency

## Navigation Structure

### Sidebar Groups

1. **Overview**
   - Dashboard (`/`)

2. **Operations**
   - Team (`/agents`)
   - Tasks (`/tasks`)
   - Recurring Tasks (`/recurring`)
   - Schedule (`/schedule`)

3. **Content**
   - Pipeline (`/content`)
   - Ideas Bank (`/ideas`)
   - Book Progress (`/book`)
     - Chapter Detail (`/book/:bookId/chapter/:chapterNum`)

4. **Insights**
   - Knowledge (`/knowledge`)
   - Analytics (`/analytics`)
   - Search (`/search`)

## Navigation Components

### NavLink
Sidebar navigation link with automatic active state highlighting.

```jsx
import { NavLink } from './components/Navigation'

<NavLink 
  to="/agents" 
  icon={<Users size={20} />} 
  label="Team"
  isActive={currentPath === '/agents'}
/>
```

**Active State:**
- Gold background (`bg-gold`)
- Black text with medium weight
- Subtle shadow

### NavGroup
Grouped navigation items with section title.

```jsx
import { NavGroup } from './components/Navigation'

<NavGroup
  title="Operations"
  items={[
    { to: '/agents', icon: <Users size={20} />, label: 'Team' },
    { to: '/tasks', icon: <ListTodo size={20} />, label: 'Tasks' }
  ]}
  currentPath={location.pathname}
/>
```

### Breadcrumbs
Show current location path with clickable ancestors.

```jsx
import { Breadcrumbs } from './components/Navigation'

<Breadcrumbs location={location} />
```

**Features:**
- Auto-generates path from URL segments
- Readable names (maps `/agents` → "Team")
- Clickable intermediate paths
- Handles dynamic segments (bookId, chapterNum)

### PageHeader
Consistent page header with title, subtitle, and optional actions.

```jsx
import { PageHeader } from './components/Navigation'

<PageHeader 
  title="Chapter 1: The Tension Line"
  subtitle="Book 1: The Tension Lines"
  icon={<BookOpen size={28} />}
  actions={
    <button className="btn-primary">Edit</button>
  }
/>
```

### BackButton
Navigate to parent page with context.

```jsx
import { BackButton } from './components/Navigation'

<BackButton to="/book" label="Back to Books" />
```

## Mobile Navigation

- **Hamburger Menu:** Opens overlay sidebar on mobile
- **Close Button:** X icon in mobile menu
- **Auto-close:** Menu closes when navigation item clicked
- **Overlay:** Dark backdrop with click-to-close

## Responsive Behavior

- **Desktop (`md:` breakpoint and up):**
  - Sidebar visible by default
  - Toggle button collapses/expands sidebar
  - Main content shifts with sidebar state

- **Mobile (`< md` breakpoint):**
  - Sidebar hidden by default
  - Hamburger menu opens overlay
  - Main content uses full width

## Color System

**Active Navigation:**
- Background: `bg-gold` (#D4A574)
- Text: `text-black` (#1A1613)
- Shadow: `shadow-sm`

**Inactive Navigation:**
- Text: `text-neutral-700`
- Hover Background: `bg-neutral-100`
- Hover Text: `text-black`

**Breadcrumbs:**
- Current: `text-black font-semibold`
- Links: `text-neutral-600 hover:text-black`
- Separator: `text-neutral-400`

## Best Practices

### Adding New Pages

1. **Add route to `App.jsx`:**
```jsx
<Route path="/new-page" element={<NewPage />} />
```

2. **Add to navigation structure:**
```jsx
const navGroups = [
  {
    title: 'Your Group',
    items: [
      { to: '/new-page', icon: <Icon size={20} />, label: 'New Page' }
    ]
  }
]
```

3. **Add breadcrumb mapping:**
```jsx
const pathNames = {
  'new-page': 'New Page Display Name'
}
```

### Using PageHeader

Always use `PageHeader` for consistency:

```jsx
<PageHeader 
  title="Main Title"
  subtitle="Optional subtitle/context"
  icon={<RelevantIcon size={28} />}
/>
```

### Nested Views

For nested views (like Chapter Detail):

1. Add `BackButton` above `PageHeader`
2. Ensure parent route exists
3. Update breadcrumb mapping for dynamic segments

## Keyboard Navigation

- **Tab:** Navigate through links
- **Enter/Space:** Activate link
- **Escape:** Close mobile menu (if open)

## Accessibility

- Semantic HTML (`<nav>`, `<Link>`)
- ARIA labels on icon-only buttons
- Focus states on interactive elements
- Screen reader friendly breadcrumbs

## Future Enhancements

Potential additions:
- Search in navigation
- Recently viewed pages
- Keyboard shortcuts (Cmd+K)
- Favorites/bookmarks
- Collapsible nav groups
- Drag-and-drop reordering
