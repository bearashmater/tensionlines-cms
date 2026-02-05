# TensionLines CMS - User Guide

**Welcome to the TensionLines Content Management System!**

This guide will help you navigate and use the CMS to manage all aspects of the TensionLines project.

---

## Getting Started

### First Launch

1. **Install dependencies:**
   ```bash
   cd cms
   npm install
   ```

2. **Start the CMS:**
   ```bash
   npm run dev
   ```

3. **Open in browser:**
   ```
   http://localhost:5173
   ```

That's it! The CMS will automatically read from your existing project files.

---

## Dashboard Views

### 🏠 Dashboard
**Purpose:** Quick overview of everything happening in the project

**What you'll see:**
- Active agents count
- Tasks in progress
- Ideas captured
- Unread notifications
- Task completion rate (with progress bar)
- Recent activity feed (last 8 activities)

**When to use:** Start here every morning to see what's happening across the project.

---

### 👥 Team
**Purpose:** View all philosopher agents and their current status

**What you'll see:**
- Total agents, active count, idle count
- Agent cards showing:
  - Name and role
  - Current status (active/idle/blocked)
  - Current task (if working on one)

**When to use:** Check who's working on what, identify idle agents who could take on tasks.

---

### ✅ Tasks
**Purpose:** Manage and track all project tasks

**What you'll see:**
- Full task list with filters (All, Assigned, In Progress, Review, Completed, Shipped)
- Task cards showing:
  - Status badge
  - Task ID
  - Title and description
  - Assigned agents
  - Creation date

**When to use:** 
- Track progress on specific tasks
- See what's stuck in review
- Review completed work
- Find tasks by status

**Pro tip:** Use the filter buttons at the top to quickly narrow down tasks by status.

---

### ✍️ Content Pipeline
**Purpose:** Track ideas from capture to publication

**What you'll see:**
- **Ideas Bank section:** All captured ideas with status (captured/assigned/drafted/shipped)
- **Drafts section:** Content drafts by philosopher, organized by platform

**When to use:**
- Review captured ideas
- Check draft progress
- See what's ready to ship
- Track idea → content transformation

**Understanding idea status:**
- 🔵 Captured: Raw idea, not yet assigned
- 🟣 Assigned: Philosopher working on it
- 🟡 Drafted: Content written, in review
- 🟢 Shipped: Published to platform

---

### 🧠 Knowledge Base
**Purpose:** Access memory files and learnings

**What you'll see:**
- **MEMORY.md** (long-term learnings) - highlighted with gold border
- **Daily logs** (2026-02-02.md format) - sorted by date
- File size and last modified date

**When to use:**
- Review past decisions
- Check daily logs for recent work
- Search through accumulated knowledge

**Pro tip:** The MEMORY.md file is your curated long-term memory. Daily files are raw logs.

---

### 📊 Analytics
**Purpose:** Track metrics, engagement, and revenue

**Current status:** Coming in Phase 2

**Planned features:**
- Social media follower growth charts
- Engagement rate graphs
- Revenue tracking (Patreon, newsletter)
- Cost monitoring (API usage)
- ROI calculations

---

### 🔍 Search
**Purpose:** Find anything across the entire project

**What you can search:**
- Tasks (title and description)
- Ideas (text and tags)
- Drafts (content)
- Memory files (coming soon)

**How to use:**
1. Type at least 2 characters
2. Press Enter or click Search
3. Results appear instantly
4. Click any result to view details

**Pro tip:** Search is fast and searches across ALL content types simultaneously.

---

## Key Features

### Real-Time Updates
The CMS watches your project files for changes and automatically refreshes data every 30 seconds. No manual refresh needed!

**Files being watched:**
- `mission-control/database.json`
- `content/ideas-bank.md`
- `memory/*.md`
- `philosophers/*/drafts/*.md`

### Status Badges
Color-coded badges make it easy to understand status at a glance:

**Agent Status:**
- 🟢 Green = Active
- ⚪ Gray = Idle
- 🔴 Red = Blocked

**Task Status:**
- 🔵 Blue = Inbox/Captured
- 🟣 Purple = Assigned
- 🟡 Yellow = In Progress/Drafted
- 🟠 Orange = Review
- 🔵 Teal = Approved
- 🟢 Green = Completed
- 💚 Emerald = Shipped

### Responsive Design
The CMS works on desktop, tablet, and mobile. Use the menu button (☰) to toggle the sidebar on smaller screens.

---

## Common Workflows

### Morning Check-In
1. Open **Dashboard** to see overnight activity
2. Check **Team** to see who's active
3. Review **Tasks** (filter by "In Progress" and "Review")
4. Check **Content Pipeline** for ready-to-ship content

### Task Management
1. Go to **Tasks**
2. Filter by status (e.g., "Review" to see what needs approval)
3. Click task to see full details
4. Check assignee and timeline

### Content Review
1. Go to **Content Pipeline**
2. Check **Drafts** section
3. See what each philosopher has drafted
4. Cross-reference with **Tasks** to see review status

### Finding Something Specific
1. Go to **Search**
2. Type keyword (task name, idea text, philosopher name)
3. Review results
4. Note the type badge (task/idea/draft) to understand context

---

## Tips & Tricks

### Keyboard Shortcuts
*(Coming in Phase 2)*

### Bookmarking Views
You can bookmark specific views in your browser:
- Dashboard: `http://localhost:5173/`
- Tasks: `http://localhost:5173/tasks`
- Content: `http://localhost:5173/content`
- Search: `http://localhost:5173/search`

### Multi-Monitor Setup
Open multiple views in separate browser tabs or windows:
- Tab 1: Dashboard (overview)
- Tab 2: Tasks (detailed work tracking)
- Tab 3: Content (shipping pipeline)

### Dark Mode
*(Coming in Phase 2)*

---

## Troubleshooting

### "Error loading data"
**Cause:** API server not running or file permissions issue

**Fix:**
1. Make sure `npm run dev` is running
2. Check terminal for errors
3. Verify files exist in expected locations

### Data seems stale
**Cause:** File watching may have stopped

**Fix:**
1. Refresh browser (Cmd+R or Ctrl+R)
2. Restart server: `npm run dev`

### Port already in use
**Cause:** Another app is using port 3001 or 5173

**Fix:**
```bash
PORT=3002 npm run server    # Use different port
PORT=5174 npx vite          # Use different port
```

### Slow performance
**Cause:** Large number of files or browser cache

**Fix:**
1. Clear browser cache
2. Close unused tabs
3. Restart CMS

---

## Data Privacy

**Important:** The CMS is **read-only** and runs **locally only**.

- No data is sent to external servers
- All files stay on your machine
- No internet connection required (except for npm install)
- Safe to use with private/sensitive project data

---

## What's Next?

### Phase 2 (Next Sprint)
- [ ] WebSocket real-time updates (no 30s delay)
- [ ] Advanced search with filters
- [ ] Export data (CSV, JSON)
- [ ] Dark mode toggle
- [ ] Keyboard shortcuts

### Phase 3 (Future)
- [ ] Analytics dashboards with charts
- [ ] Content calendar view
- [ ] Agent performance metrics
- [ ] Cost projection tools

---

## Getting Help

**Documentation:**
- Architecture details: `docs/ARCHITECTURE.md`
- Setup instructions: `README.md`
- This guide: `docs/USER_GUIDE.md`

**Questions?**
Contact the philosopher squad through Mission Control or Telegram.

---

**Built by:** Socrates, Aristotle, Leonardo  
**Build Date:** February 2-3, 2026  
**Version:** 1.0
