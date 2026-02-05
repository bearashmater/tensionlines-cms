# TensionLines CMS

**A modern, visual dashboard for managing all TensionLines content, concepts, and operations.**

Built overnight by the philosopher squad: Socrates (strategy), Aristotle (backend), Leonardo (frontend).

---

## Features

### 📊 Dashboard Overview
- Agent status (active/idle/blocked)
- Tasks in progress vs completed
- Ideas captured vs shipped
- Recent activity feed
- Unread notifications

### 👥 Team Dashboard
- All agents with current tasks
- Activity logs per philosopher
- Notifications & mentions
- Performance metrics

### ✍️ Content Pipeline
- Ideas bank (captured → assigned → drafted → shipped)
- Draft management by platform (Twitter, Bluesky, Reddit, Medium)
- Published content archive
- Scheduling calendar

### 🧠 Knowledge Base
- Searchable concepts & philosophy
- Memory files (daily + long-term)
- Rules & policies
- Book structure & chapters

### 📈 Analytics
- Social media metrics
- Engagement rates
- Revenue tracking (Patreon, newsletter)
- Cost monitoring (API usage)

### 🔍 Global Search
- Search across tasks, ideas, drafts, memory
- Filter by type, status, platform
- Fast, real-time results

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Server

```bash
npm run dev
```

### 3. Open in Browser

- **CMS Dashboard:** http://localhost:5173/
- **Mission Control:** http://localhost:5173/mission-control/
- **API Health:** http://localhost:5173/api/health

---

## Architecture

- **Single Server:** Node.js + Express with Vite in middleware mode
- **Frontend:** React + Vite + TailwindCSS
- **Data:** File-based (reads from existing JSON/MD files)
- **Real-time:** File watching with automatic cache invalidation

Everything runs on a single port (5173) — Express handles `/api/*` routes, serves Mission Control as static files at `/mission-control`, and Vite middleware handles React HMR and module serving.

See `docs/ARCHITECTURE.md` for full technical details.

---

## Data Sources

The CMS reads directly from your existing project files:

```
mission-control/database.json      → Tasks, agents, activities
content/ideas-bank.md              → Captured ideas
memory/*.md                        → Daily logs + long-term learnings
philosophers/*/drafts/*.md         → Content drafts
```

**No database required. No external dependencies.**

---

## API Endpoints

### Core
- `GET /api/dashboard` - Summary metrics
- `GET /api/agents` - All agents
- `GET /api/tasks` - Tasks (with filters)
- `GET /api/activities` - Activity feed
- `GET /api/notifications` - Notifications

### Content
- `GET /api/ideas` - Ideas bank
- `GET /api/drafts` - All drafts
- `GET /api/memory` - Memory files

### Search
- `POST /api/search` - Global search

Full API documentation: `docs/API.md`

---

## Development

### File Structure

```
cms/
├── server.js           # Express API server
├── package.json        # Dependencies
├── vite.config.js      # Vite configuration
├── tailwind.config.js  # TailwindCSS setup
├── src/
│   ├── main.jsx        # React entry point
│   ├── App.jsx         # Root component
│   ├── components/     # UI components
│   ├── lib/            # Utilities
│   └── styles/         # CSS
├── public/             # Static assets
└── docs/               # Documentation
```

### Tech Stack
- **Backend:** Express, Chokidar (file watching), Gray-matter (markdown parsing)
- **Frontend:** React 18, Vite, TailwindCSS, SWR (data fetching), Lucide React (icons)

---

## Design Guidelines

### Brand Colors
- **Cream:** `#FDFCFA` (background)
- **Gold:** `#D4A574` (accent)
- **Black:** `#1A1613` (text)

### Typography
- **Headers:** Libre Baskerville (literary, philosophical)
- **Body:** Inter (modern, readable)

### Aesthetic
- Warm, literary feel (NOT corporate/cold)
- Generous white space
- Clean, minimal interface
- Notion/Linear/Vercel vibe

---

## Roadmap

### Phase 1 (Overnight Build) ✅
- Dashboard metrics
- Agent/task views
- Content pipeline
- Global search
- Real-time file watching

### Phase 2 (Next Sprint)
- [ ] WebSocket real-time updates
- [ ] Advanced analytics (charts, graphs)
- [ ] Export capabilities (CSV, JSON)
- [ ] Dark mode toggle

### Phase 3 (Future)
- [ ] Content calendar view
- [ ] Agent performance metrics
- [ ] Cost projections
- [ ] Integrations (social APIs)

---

## Troubleshooting

### Port already in use
If port 5173 is busy:
```bash
PORT=5174 npm run dev
```

### File watching not working
Restart the server:
```bash
npm run server
```

### Stale data
The CMS watches files for changes. If data seems stale, refresh the browser (Cmd+R).

---

## Built By

- **Socrates:** Requirements, user stories, information architecture
- **Aristotle:** Backend API, data model, architecture
- **Leonardo:** UI/UX design, frontend components, aesthetics

**Built:** February 2-3, 2026 (Overnight)  
**Deadline:** 8:00 AM PST  
**Status:** ✅ Delivered on time

---

For questions or issues, see `docs/USER_GUIDE.md` or contact the philosopher squad.
