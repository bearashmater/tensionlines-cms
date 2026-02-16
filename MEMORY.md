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
  - **Tested 2026-02-12:** All core features working (dashboard, navigation, book progress, queues)
  - **Key API Endpoints:**
    - `/api/engagement/scan` - Scan for engagement opportunities (platform param: twitter|bluesky)
    - `/api/engagement-actions/scan` - Scan for engagement targets
    - `/api/engagement-actions/execute` - Execute queued actions
    - `/api/dashboard` - Live metrics (agents, tasks, ideas, queue counts)
- **Database:** File-based JSON at `mission-control/database.json`
- **Twitter:** Bird CLI (`/opt/homebrew/bin/bird`) - READ ONLY (write blocked by Twitter)
- **Bluesky:** AT Protocol via server.js - read + write works
- **Git:** Always use `tensionlines-cms` repo, never `tension-lines-website`

## Engagement Automation

- **Twitter bot:** Every 30 minutes (1800000ms) - calls CMS `/api/engagement/scan`
- **Bluesky bot:** Every 45 minutes (2700000ms) - calls CMS `/api/engagement/scan`
- **Auto-executor:** Runs 15 minutes after each scan - executes queued engagement actions
- Both scan for engagement opportunities, add to CMS queue
- **Performance (as of 2026-02-15):** 119 completed engagement actions tracked (likes, reposts on Twitter + Bluesky)
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
- Examples: "Scale of 1-10" format, "You know how some people..." tech support story, robot dog virtue ethics

**Bluesky posts (Socrates voice):**
- Intellectual but accessible
- Challenge dominant narratives ("Most of us approach X from...")
- Clear distinctions and definitions
- Socratic framing: questions over answers
- Can be longer (~800 chars) for developed arguments

**Medium articles (Plato voice):**
- Essayistic, reflective, well-structured
- Hook → Exploration → Examples → Application → Reflection
- 800-1500 words, links multiple ideas into coherent essay
- Examples: "The Description Is Not the Dance" (practice vs. theory)

**Effective Content Strategies:**
- **Ancient wisdom works:** Biblical/classical references (Ecclesiastes, Socrates) add credibility and universal recognition
- **Concrete examples:** Robot dog, tech support stories - relatable entry points for abstract ideas
- **Virtue ethics framing:** Shift from ontology ("what is X?") to character ("what do we become?")
- **Reframe dominant narratives:** Don't answer the common question, question the question
- **Multi-part Threads:** 2-3 posts allow full argument development without overwhelming

All kept under platform limits, used line breaks for readability.

## Debugging Patterns

**Cron job troubleshooting (learned 2026-02-12):**
1. Check if referenced files/scripts actually exist
2. Look for equivalent functionality in existing systems (CMS APIs vs standalone scripts)
3. Test endpoints manually before updating cron jobs
4. Prefer calling existing APIs over creating new scripts

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

- **TensionLines CMS:** Production-stable ✓
  - **Latest testing 2026-02-15:** All systems operational, no critical bugs found
  - Dashboard with live metrics (13 agents, 63 tasks, 39 posting queue items, 152 notifications)
  - Book progress tracking functional (5 books, phase/chapter/word count detail)
  - Ideas bank system operational (41 ideas, 11 published, weekly goal tracking)
  - Navigation, search, filtering, and UI controls all working
  - Engagement automation running smoothly (119 completed actions tracked)
- **10 Philosopher Agents:** SOULs defined in `philosophers/*/SOUL.md`
  - Voice assignments: Heraclitus (Threads), Socrates (Bluesky), Nietzsche (Twitter/X), Plato (Medium)
- **Ideas Bank:** Active at `content/ideas-bank.md` (41 ideas as of 2026-02-15)
  - 27 captured, 2 organizing, 1 drafting, 11 published
  - Recent usage: #007 (Exodus wilderness) - Threads + Bluesky midday posts (Feb 15)
  - 8-week streak maintained
  - 200+ tags available for organization
- **5 Books:** In development with phase/chapter tracking in CMS
  - Books: TensionLines, Practical Wisdom, Leadership, Therapeutic Applications, Philosophy of AI
  - TensionLines main book: 1,505 / 50,000 words (3%)
  - Chapter detail pages with full content, outlines, and linked ideas
- **Reddit:** r/TensionLines does not exist yet (moderation on hold until created)
- **Daily Content Automation:** Morning (9 AM) and midday (2 PM) social posts running smoothly via cron jobs
  - **Verified 2026-02-15:** Midday content correctly added to CMS queue (Threads + Bluesky using idea #007)

## CMS Enhancement Backlog

**Priority improvements identified 2026-02-14:**
1. **Batch Queue Actions** - Checkbox selection + bulk operations (mark posted, delete, reschedule)
2. **AI Writing Assistant** - Context-aware suggestions in chapter editor, "continue writing" feature
3. **Cross-Platform Preview** - Show how content renders on Twitter/Bluesky/Threads with character warnings
4. **Content Performance Analytics** - Track idea → post performance, tag correlation analysis
5. **Voice-to-Idea Capture** - Telegram voice message transcription → ideas bank integration
6. **Engagement Opportunity Scoring** - AI scoring for queue prioritization (high/medium/low ROI)

All enhancements non-blocking; CMS fully functional for current workflow.
