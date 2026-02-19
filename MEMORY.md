# MEMORY.md - TensionLines Long-Term Memory

## Content Workflow (Critical)

**Shawn's Intended Workflow:**
1. All content drafts → CMS posting queue at `localhost:3001/posting-queue`
2. Shawn reviews queue in dashboard
3. Manual posting via copy/paste + "open link where to post" pattern
4. Mark as posted in CMS

**NEVER post directly via Bird CLI, message tool, or browser automation.**
**ALWAYS add to CMS posting queue for Shawn's review.**

## Cron Jobs - Content Posting

**Status (2026-02-15): All content jobs working correctly** ✓
Content creation jobs (morning/midday/evening social, newsletters, articles) are correctly adding drafts to CMS posting queue for Shawn's review, NOT posting directly.

**Verified working jobs:**
- Morning/midday/evening social posts → CMS queue (verified 2026-02-15 midday: Threads + Bluesky using idea #007)
- Weekly Medium articles → CMS queue
- Engagement bots → CMS `/api/engagement/scan` endpoint (3x daily: 11 AM, 3 PM, 7 PM)
- Auto-executor for engagement actions (15 min after each scan)
- Philosopher heartbeats, moderation checks, CMS review, compound review, book work

**Note:** Some job instructions still reference direct posting - ignore and follow MEMORY.md workflow instead.

## Technical Stack

- **CMS:** Node.js + Express backend, React + Vite frontend at `localhost:3001`
  - **Tested 2026-02-17:** Core features working, 2 bugs identified (see Known Issues below)
  - **Key API Endpoints:**
    - `/api/engagement/scan` - Scan for engagement opportunities (platform param: twitter|bluesky)
    - `/api/engagement-actions/scan` - Scan for engagement targets
    - `/api/engagement-actions/execute` - Execute queued actions
    - `/api/dashboard` - Live metrics (agents, tasks, ideas, queue counts)
    - `/api/search` - ⚠️ **BROKEN:** Returns HTML instead of JSON
- **Database Architecture (file-based):**
  - `mission-control/database.json` - Agents, tasks, messages, activities, notifications
  - `content/ideas-bank.md` - All ideas (Markdown file, not in database.json)
  - `books/` directory - Book content stored as individual files per book
  - Dashboard API computes live metrics from multiple file sources
  - **Note:** `database.json` shows `books: 0` and `ideas: 0` because data lives in separate files
- **Twitter:** Bird CLI (`/opt/homebrew/bin/bird`) - READ ONLY (write blocked by Twitter)
- **Bluesky:** AT Protocol via server.js - read + write works
- **Git:** Always use `tensionlines-cms` repo, never `tension-lines-website`

## Known Issues

**CRITICAL - Rate Limiting Too Aggressive (discovered 2026-02-18):**
- Read limiter set to 100 requests per minute
- Easily triggered during normal testing/usage and cron job operations
- Blocks legitimate localhost API calls with "Too many requests" error
- Impact: Blocks development, testing, and potentially cron jobs making frequent API calls
- Priority: CRITICAL - blocking core functionality
- Fix: Increase to 300/min for reads or exempt localhost entirely

**Search API Broken (discovered 2026-02-17):**
- `/api/search?q=<query>` returns rate limit errors immediately (compounded by rate limit issue)
- Impact: Search functionality non-functional via API
- Priority: High - core feature
- Likely cause: Missing API route or incorrect middleware order in server.js

**Chapter Word Count Inconsistency (discovered 2026-02-17):**
- Books API shows different word counts than chapter detail API
- Example: Chapter 1 shows 1505 words in books list, null in chapter detail
- Impact: Book progress tracking unreliable
- Priority: Medium

## Engagement Automation

- **Twitter bot:** Every 30 minutes (1800000ms) - calls CMS `/api/engagement/scan`
- **Bluesky bot:** Every 45 minutes (2700000ms) - calls CMS `/api/engagement/scan`
- **Auto-executor:** Runs 15 minutes after each scan - executes queued engagement actions
- Both scan for engagement opportunities, add to CMS queue
- **Performance (as of 2026-02-17):** 85 completed engagement actions tracked (likes, reposts on Twitter + Bluesky)
- **Fixed 2026-02-12:** Pointed both jobs to CMS API endpoints instead of non-existent scripts

## Day-of-Week Content Strategy

**Friday = Reflection, Integration, Synthesis**
- Ancient wisdom and classical philosophy
- Recognizing patterns and seasons
- Integration of week's tensions
- Examples: Ecclesiastes on seasons, virtue ethics applications

**Midday Posts (All Days):**
- Deeper philosophical exploration than morning
- More developed arguments (multi-part threads, longer Bluesky posts)
- Intellectual depth while remaining accessible

## Content Drafting Patterns

**Twitter/X posts (Nietzsche voice):**
- Sharp, punchy, memorable
- Challenge conventional wisdom directly
- Under 280 chars, easily quotable
- Strong declarative statements
- Example: "The Bible didn't say find the middle. It said know the season."

**Threads posts (Heraclitus voice):**
- Conversational, relatable hooks ("You know how..." works well)
- Personal anecdotes that reveal larger truths
- Practical wisdom grounded in real situations
- Multi-part threads (2-3 parts) for deeper exploration
- Narrative-driven transformation themes (wilderness as the work, not obstacle)
- Examples: "Scale of 1-10" format, "You know how some people..." tech support story, robot dog virtue ethics, Exodus wilderness narrative

**Bluesky posts (Socrates voice):**
- Intellectual but accessible
- Challenge dominant narratives ("Most X gets this backwards...")
- Clear distinctions and definitions
- Socratic framing: questions over answers
- Reframe the question, not just answer it (false binaries vs. generative tensions)
- Can be longer (~800 chars) for developed arguments

**Medium articles (Plato voice):**
- Essayistic, reflective, well-structured
- Hook → Exploration → Examples → Application → Reflection
- 800-1500 words, links multiple ideas into coherent essay
- Examples: "The Description Is Not the Dance" (practice vs. theory)

**Effective Content Strategies:**
- **Ancient wisdom works:** Biblical/classical references (Ecclesiastes, Exodus, Socrates) add credibility and universal recognition
- **Concrete examples:** Robot dog, tech support stories - relatable entry points for abstract ideas
- **Virtue ethics framing:** Shift from ontology ("what is X?") to character ("what do we become?")
- **Reframe dominant narratives:** Don't answer the common question, question the question
- **Transformation in the wilderness:** Challenge "getting through hard times" mindset - wilderness IS the work, not obstacle to overcome
- **False binaries vs. generative tensions:** Not all polarities are equal - discernment matters (idea #021)
- **Multi-part Threads:** 2-3 posts allow full argument development without overwhelming

All kept under platform limits, used line breaks for readability.

## Debugging Patterns

**Cron job troubleshooting (learned 2026-02-12):**
1. Check if referenced files/scripts actually exist
2. Look for equivalent functionality in existing systems (CMS APIs vs standalone scripts)
3. Test endpoints manually before updating cron jobs
4. Prefer calling existing APIs over creating new scripts

**API testing workarounds (learned 2026-02-18):**
- When browser automation fails or rate limits block UI access, use curl
- `curl -s localhost:3001/api/endpoint` bypasses frontend and tests API directly
- Useful for validating endpoints without triggering aggressive rate limiters
- Always test via command line before assuming API is broken

**Before creating new tools:**
- Check CMS server.js for existing API endpoints
- Review `mission-control/database.json` schema
- Test with curl/Postman before automating

## Mistakes to Avoid

- Don't post content directly via automation tools
- Don't bypass the CMS posting queue
- Don't touch `tension-lines-website` repo
- Don't assume server is running - always check first
- Don't create cron jobs that post without human review

## Project Status

- **TensionLines CMS:** Production-stable with 3 known bugs (1 critical, see Known Issues) ⚠️
  - **Latest testing 2026-02-18:** Core systems operational, rate limiting blocking development/testing
  - Dashboard with live metrics (13 agents, 63 tasks, 3 posting queue items, 162 notifications)
  - Book progress tracking functional (5 books, phase/chapter tracking) - word count inconsistency noted
  - Ideas bank system operational (41 ideas, 12 shipped, weekly goal tracking)
  - Navigation, filtering, and UI controls working
  - Engagement automation running smoothly (85 completed actions tracked)
  - **CRITICAL priority:** Fix rate limiting to unblock testing and cron job reliability
- **10 Philosopher Agents:** SOULs defined in `philosophers/*/SOUL.md`
  - Voice assignments: Heraclitus (Threads), Socrates (Bluesky), Nietzsche (Twitter/X), Plato (Medium)
- **Ideas Bank:** Active at `content/ideas-bank.md` (41 ideas as of 2026-02-17)
  - 28 captured, 1 drafted, 12 shipped
  - Idea-to-publish conversion rate: ~43% (12 shipped / 28 captured)
  - 8-week streak maintained
  - 200+ tags available for organization
- **5 Books:** In development with phase/chapter tracking in CMS
  - Books: TensionLines, Practical Wisdom, Leadership, Therapeutic Applications, Philosophy of AI
  - TensionLines main book: 1,505 / 50,000 words (3%)
  - Chapter detail pages with full content, outlines, and linked ideas
- **Reddit:** r/TensionLines does not exist yet (moderation on hold until created)
- **Daily Content Automation:** Morning (9 AM) and midday (2 PM) social posts running smoothly via cron jobs

## CMS Enhancement Backlog

**Priority improvements identified 2026-02-14:**
1. **Batch Queue Actions** - Checkbox selection + bulk operations (mark posted, delete, reschedule)
2. **AI Writing Assistant** - Context-aware suggestions in chapter editor, "continue writing" feature
3. **Cross-Platform Preview** - Show how content renders on Twitter/Bluesky/Threads with character warnings
4. **Content Performance Analytics** - Track idea → post performance, tag correlation analysis
5. **Voice-to-Idea Capture** - Telegram voice message transcription → ideas bank integration
6. **Engagement Opportunity Scoring** - AI scoring for queue prioritization (high/medium/low ROI)

**Additional ideas identified 2026-02-17:**
7. **Quick Engagement Dashboard Widget** - Show today's engagement stats on main dashboard (likes/reposts sent, queue size, success rate, top accounts)
8. **Chapter Writing Momentum Tracker** - Words per day trend, estimated completion, velocity alerts, hot streak badges
9. **Idea-to-Post Pipeline View** - Visual funnel with conversion rates, stage timing, bottleneck alerts, aging idea warnings

All enhancements non-blocking; CMS fully functional for current workflow (minus search API bug).
