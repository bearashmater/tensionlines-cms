# TensionLines CMS - System Architecture

**Author:** Aristotle  
**Date:** 2026-02-02 11:19 PM PST  
**Version:** 1.0

---

## Overview

A lightweight, file-based CMS that aggregates and presents TensionLines content, concepts, team activity, and project metrics through a modern web interface.

---

## Core Principles

1. **File-Based Data**: No database required - read directly from existing JSON/MD files
2. **Real-Time Sync**: Watch file changes and update UI automatically
3. **Read-Only UI**: Display and search only (modifications happen through existing workflows)
4. **Zero Dependencies on External Services**: Self-contained, runs locally
5. **Performant**: Fast initial load, lazy-load heavy content

---

## Technology Stack

### Backend
- **Node.js + Express** - Lightweight API server
- **Chokidar** - File system watching for real-time updates
- **Gray-matter** - Markdown frontmatter parsing
- **CORS** - Allow local development

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool (fast, modern)
- **TailwindCSS** - Utility-first styling
- **React Router** - Client-side routing
- **SWR** - Data fetching/caching
- **Lucide React** - Icon library

---

## Data Sources

### Primary Files
```
mission-control/database.json      → Tasks, agents, activities, notifications
content/ideas-bank.md              → Captured ideas
memory/MEMORY.md                   → Long-term learnings
memory/YYYY-MM-DD.md               → Daily logs
philosophers/*/SOUL.md             → Agent identities
philosophers/*/HEARTBEAT.md        → Agent workflows
philosophers/*/drafts/*.md         → Content drafts
```

### Social Media State
```
scripts/bluesky-state.json         → Bluesky post history
scripts/twitter-state.json         → Twitter post history (future)
scripts/reddit-state.json          → Reddit post history (future)
```

### Book Structure
```
book/outline.md                    → Chapter structure
book/chapters/*.md                 → Chapter drafts
book/progress.json                 → Word counts, status
```

---

## API Endpoints

### Core Data
- `GET /api/dashboard` - Summary metrics (followers, tasks, costs, etc.)
- `GET /api/agents` - All agents with current status
- `GET /api/tasks` - Tasks with filters (status, assignee, reviewer)
- `GET /api/activities` - Activity feed (paginated)
- `GET /api/notifications` - Notifications (by agent, read/unread)

### Content
- `GET /api/ideas` - Ideas bank entries (parsed from MD)
- `GET /api/drafts` - All drafts by platform
- `GET /api/published` - Published content archive
- `GET /api/concepts` - Searchable philosophy concepts

### Analytics
- `GET /api/analytics/social` - Social media metrics
- `GET /api/analytics/revenue` - Patreon, newsletter revenue
- `GET /api/analytics/costs` - API usage, token costs

### Book
- `GET /api/book/outline` - Chapter structure
- `GET /api/book/progress` - Word counts, completion %
- `GET /api/book/chapters` - Chapter content + metadata

### Search
- `POST /api/search` - Global search across all content

---

## Data Models

### Agent
```typescript
interface Agent {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'idle' | 'blocked';
  currentTaskId: string | null;
  sessionKey: string;
  metadata?: {
    lastActive?: string;
    heartbeatSchedule?: string;
    platforms?: string[];
  };
}
```

### Task
```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'approved' | 'completed' | 'shipped';
  assigneeIds: string[];
  reviewerIds: string[];
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  reviewedAt?: string;
  shippedAt?: string;
  metadata?: Record<string, any>;
}
```

### Activity
```typescript
interface Activity {
  id: string;
  timestamp: string;
  type: string; // idea_captured, task_created, content_shipped, etc.
  agentId: string;
  description: string;
  metadata?: Record<string, any>;
}
```

### Notification
```typescript
interface Notification {
  id: string;
  timestamp: string;
  recipientId: string;
  type: string; // task_assignment, review_request, mention, etc.
  message: string;
  read: boolean;
  metadata?: Record<string, any>;
}
```

### Idea
```typescript
interface Idea {
  id: string;
  text: string;
  capturedAt: string;
  tags: string[];
  status: 'captured' | 'assigned' | 'drafted' | 'shipped';
  linkedTasks?: string[];
  linkedContent?: string[];
}
```

### PublishedContent
```typescript
interface PublishedContent {
  id: string;
  platform: 'twitter' | 'bluesky' | 'threads' | 'reddit' | 'medium' | 'substack';
  url: string;
  text: string;
  publishedAt: string;
  authorId: string;
  sourceIdeaId?: string;
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
  };
}
```

---

## File Structure

```
cms/
├── README.md
├── package.json
├── server.js                    # Express API server
├── scripts/
│   ├── parse-ideas.js          # Parse ideas-bank.md
│   ├── parse-memory.js         # Parse memory files
│   ├── parse-drafts.js         # Parse philosopher drafts
│   └── watch-files.js          # File system watcher
├── src/
│   ├── main.jsx                # React entry point
│   ├── App.jsx                 # Root component
│   ├── api/                    # API client
│   │   └── client.js
│   ├── components/             # React components
│   │   ├── Dashboard.jsx
│   │   ├── AgentCard.jsx
│   │   ├── TaskBoard.jsx
│   │   ├── ActivityFeed.jsx
│   │   ├── ContentPipeline.jsx
│   │   ├── KnowledgeBase.jsx
│   │   ├── Analytics.jsx
│   │   └── Search.jsx
│   ├── lib/                    # Utilities
│   │   ├── formatters.js
│   │   └── filters.js
│   └── styles/
│       └── index.css
├── public/
│   └── index.html
└── docs/
    ├── ARCHITECTURE.md         # This file
    ├── USER_GUIDE.md           # Usage instructions
    └── screenshots/
```

---

## Real-Time Updates

### WebSocket Strategy (Phase 2)
- Current: Poll `/api/activities` every 30s
- Future: WebSocket connection for instant updates

### File Watching
Server watches key files and broadcasts changes:
- `mission-control/database.json`
- `memory/*.md`
- `content/ideas-bank.md`
- `philosophers/*/drafts/*.md`

---

## Security

- **Read-Only**: No mutations through the CMS (safety)
- **Local-Only**: Runs on localhost, no external exposure
- **No Auth Required**: Trust local environment

---

## Performance Optimizations

1. **Lazy Loading**: Load heavy content (drafts, memories) on demand
2. **Pagination**: Activity feed, task lists (50 items/page)
3. **Caching**: SWR caches API responses, revalidates on focus
4. **Debounced Search**: Wait 300ms after typing before searching
5. **Virtual Scrolling**: For long lists (1000+ items)

---

## Future Enhancements

### Phase 2
- [ ] WebSocket real-time updates
- [ ] Advanced search (filters, facets)
- [ ] Export capabilities (CSV, JSON)
- [ ] Dark mode toggle

### Phase 3
- [ ] Analytics dashboards (charts, graphs)
- [ ] Content calendar view
- [ ] Agent performance metrics
- [ ] Cost projections

---

## Integration Points

### With Existing Systems
- **Mission Control**: Primary data source for tasks/agents/activities
- **Cron Jobs**: Trigger scheduled tasks (Marcus/Diogenes heartbeats)
- **Social Scripts**: Read state files for post history
- **Memory System**: Display and search daily/long-term memory

### No Conflicts
- CMS is **read-only** - existing workflows unchanged
- File watching detects external edits (git commits, manual changes)

---

**Next Steps:**
1. Build Express API server (Aristotle)
2. Create React frontend shell (Leonardo)
3. Implement core components (Leonardo)
4. Test with real data (All)
5. Polish UI/UX (Leonardo)

**Deadline:** 8:00 AM PST (9 hours remaining)
