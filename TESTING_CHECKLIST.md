# TensionLines CMS - Testing Checklist

**Run through this checklist before declaring the CMS "done"**

---

## Installation & Startup

- [ ] Fresh install: `npm install` completes without errors
- [ ] Server starts: `npm run dev` launches both backend + frontend
- [ ] Browser opens: http://localhost:5173 loads
- [ ] No console errors in browser DevTools

---

## Backend API (Test with `curl` or browser)

### Core Endpoints
- [ ] `GET http://localhost:3001/api/health` - Returns 200 OK
- [ ] `GET http://localhost:3001/api/dashboard` - Returns metrics
- [ ] `GET http://localhost:3001/api/agents` - Returns agent list
- [ ] `GET http://localhost:3001/api/tasks` - Returns tasks
- [ ] `GET http://localhost:3001/api/activities` - Returns activity feed
- [ ] `GET http://localhost:3001/api/notifications` - Returns notifications
- [ ] `GET http://localhost:3001/api/ideas` - Returns ideas bank
- [ ] `GET http://localhost:3001/api/drafts` - Returns drafts
- [ ] `GET http://localhost:3001/api/memory` - Returns memory files

### Filters
- [ ] `GET /api/tasks?status=completed` - Filters by status
- [ ] `GET /api/tasks?assignee=aristotle` - Filters by assignee
- [ ] `GET /api/drafts?platform=twitter` - Filters by platform
- [ ] `GET /api/notifications?unread=true` - Filters unread only

### Search
- [ ] `POST /api/search` with `{"query": "tension"}` - Returns results

---

## Frontend Views

### Dashboard (/)
- [ ] Metrics cards display correct numbers
- [ ] Progress bar shows task completion %
- [ ] Recent activity feed shows last 8 items
- [ ] Activity items have timestamps
- [ ] No loading flicker after initial load

### Team (/agents)
- [ ] All agents display with avatars
- [ ] Status badges show correct color (active=green, idle=gray)
- [ ] Agents with tasks show "Working on: task-XXX"
- [ ] Stats cards show correct totals

### Tasks (/tasks)
- [ ] All tasks display with status badges
- [ ] Filter buttons work (click "In Progress" → only shows in_progress tasks)
- [ ] Task descriptions are readable (not cut off)
- [ ] Created dates show relative time ("2h ago", "3d ago")

### Content (/content)
- [ ] Ideas bank shows all ideas with status badges
- [ ] Ideas display tags (e.g., #balance, #movement)
- [ ] Drafts show philosopher name + platform badge
- [ ] Drafts sorted by most recent first

### Knowledge (/knowledge)
- [ ] MEMORY.md highlighted with gold border
- [ ] Daily logs show calendar icon
- [ ] File sizes display correctly
- [ ] Modified dates show relative time

### Search (/search)
- [ ] Search form accepts input
- [ ] Typing "task" → shows task results
- [ ] Typing "idea" → shows idea results
- [ ] Results show correct type badge (task/idea/draft)
- [ ] "No results" message shows for invalid queries

### Navigation
- [ ] Sidebar links highlight on active page
- [ ] Menu button (☰) toggles sidebar on/off
- [ ] All 7 routes load without errors
- [ ] Browser back/forward buttons work

---

## Real-Time Updates

### File Watching
- [ ] Edit `mission-control/database.json` (add a fake task)
- [ ] Within 30s, new task appears in CMS (refresh if needed)
- [ ] Edit `content/ideas-bank.md` (add a fake idea)
- [ ] Within 30s, new idea appears in CMS

---

## Data Accuracy

### Dashboard Metrics
- [ ] Active agents count matches `mission-control/database.json`
- [ ] Tasks in progress matches actual count
- [ ] Ideas total matches `ideas-bank.md`
- [ ] Completion % calculation is correct

### Task Status
- [ ] Task status badges match database status field
- [ ] Assignee names display correctly
- [ ] Task descriptions show full text (no truncation bugs)

### Content Pipeline
- [ ] Ideas status matches what's in ideas-bank.md
- [ ] Drafts list matches actual files in `philosophers/*/drafts/`
- [ ] Philosopher names correct

---

## Responsive Design

### Desktop (1920x1080)
- [ ] Sidebar visible by default
- [ ] Content centered with good margins
- [ ] No horizontal scroll
- [ ] Text readable (not too small)

### Tablet (768x1024)
- [ ] Sidebar collapses by default
- [ ] Menu button toggles sidebar
- [ ] Cards stack properly
- [ ] No overlapping elements

### Mobile (375x667)
- [ ] Sidebar hidden by default
- [ ] Menu button accessible
- [ ] Cards stack vertically
- [ ] Text still readable
- [ ] No horizontal scroll

---

## Performance

- [ ] Initial page load <2s
- [ ] Navigation between views <500ms
- [ ] Search results appear <1s
- [ ] No janky scrolling
- [ ] Images/icons load instantly

---

## Error Handling

### Backend Down
- [ ] Stop server: kill the `node server.js` process
- [ ] Frontend shows "Error loading data" (not blank page)
- [ ] Restart server → data loads again

### Empty Data
- [ ] Delete all tasks from `database.json`
- [ ] Tasks view shows "No tasks found" (not error)

---

## Browser Compatibility

- [ ] Chrome (latest)
- [ ] Safari (latest)
- [ ] Firefox (latest)
- [ ] Edge (optional)

---

## Final Polish

- [ ] No console errors in browser DevTools
- [ ] No console warnings (except dev mode warnings)
- [ ] Brand colors match TensionLines guide (cream, gold, black)
- [ ] Typography: Libre Baskerville headers, Inter body
- [ ] Loading spinners use gold color
- [ ] Badges use correct status colors

---

## Documentation

- [ ] README.md is accurate
- [ ] QUICKSTART.md guides user correctly
- [ ] USER_GUIDE.md workflows match actual UI
- [ ] ARCHITECTURE.md technical specs are current
- [ ] Screenshots captured for all 7 views (Leonardo)

---

## Success Criteria (from Task #006)

✅ **Shawn can visually browse all content** - Dashboard, tasks, ideas, drafts all visible  
✅ **Easy to understand what's happening** - Activity feed, status badges, clear labels  
✅ **Search works across everything** - Global search functional  
🟡 **Mobile-friendly** - Basic responsive, needs final testing  
✅ **Looks modern & professional** - TailwindCSS, clean design  
✅ **Actually useful** - Real data, real-time updates, practical workflows  

---

## Sign-Off

**Tested by:** _____________  
**Date:** _____________  
**Issues found:** _____________  
**Ready for Shawn:** ⬜ Yes  ⬜ No (needs work)

---

**Last Updated:** Feb 2, 2026 11:19 PM PST
