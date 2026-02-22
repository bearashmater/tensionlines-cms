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
- Morning/midday/evening social posts → CMS queue (verified 2026-02-20: all three daily jobs executing correctly)
- Weekly Medium articles → CMS queue
- Reddit evening posts → Draft creation (blocked by missing subreddit - see Reddit Status below)
- Engagement bots → CMS `/api/engagement/scan` endpoint (3x daily: 11 AM, 3 PM, 7 PM)
- Auto-executor for engagement actions (15 min after each scan)
- Philosopher heartbeats, moderation checks, CMS review, compound review, book work

**Note:** Some job instructions still reference direct posting - ignore and follow MEMORY.md workflow instead.

## Reddit Status

**⚠️ Subreddit Does Not Exist Yet (as of 2026-02-20)**
- r/thetensionlines has not been created
- Evening Reddit post cron (6 PM) creates drafts but cannot post
- **Ready to deploy:** Three quality discussion posts drafted and waiting:
  - 2026-02-18: Pain measurement paradox (idea #009) - "Your 6 isn't my 6"
  - 2026-02-19: Protection and connection (idea #015) - "The Distance We Create"
  - 2026-02-20: Agency vs. surrender (idea #017) - "When do you rest, and when do you push?"
- Drafts stored in `memory/reddit-post-YYYY-MM-DD.md`

**Next Steps for Shawn:**
1. Create r/thetensionlines subreddit (public, discussion-focused)
2. Set basic rules (genuine exploration, no dunking, personal experience welcome)
3. Post introductory pinned post explaining philosophy
4. Begin publishing backlog of drafted posts (1 every 1-2 days initially)

## Technical Stack

- **CMS:** Node.js + Express backend, React + Vite frontend at `localhost:3001`
  - **Tested 2026-02-21:** System health 9.5/10 - all core features operational, stable 48h+ uptime
  - **Key API Endpoints:**
    - `/api/engagement/scan` - Scan for engagement opportunities (platform param: twitter|bluesky)
    - `/api/engagement-actions/scan` - Scan for engagement targets
    - `/api/engagement-actions/execute` - Execute queued actions
    - `/api/dashboard` - Live metrics (agents, tasks, ideas, queue counts)
    - `/api/search` - ⚠️ **BROKEN:** Returns HTML instead of JSON
  - **Tools Created:** `cms/post-to-bluesky.js` - Standalone ES module for Bluesky posting via AT Protocol
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

**CMS Review (2026-02-21):**
- **System Health: 9.5/10** - All core functionality operational, 48h+ stable uptime
- Dashboard, Books, Ideas, Tasks, Agents, Notifications all working correctly
- API endpoints responding properly
- Zero critical bugs

**Minor Issues Identified:**

1. **Search Endpoint Method Confusion**
   - Search is `POST /api/search` (correct implementation)
   - Documentation might benefit from clarifying this is POST not GET
   - Impact: None if frontend uses correct method
   - Priority: Low (documentation only)

2. **Chapter Detail API Returns Minimal Metadata**
   - Individual chapter endpoint returns basic data structure
   - Dashboard shows richer section-level progress not exposed in detail endpoint
   - Impact: Low - dashboard has the data, just not exposed in dedicated endpoint
   - Priority: Low (future enhancement)

3. **Ideas Array Empty in database.json**
   - `database.json` has empty `ideas: []` array
   - Ideas correctly parsed from `content/ideas-bank.md` (source of truth)
   - No functional impact - ideas system works perfectly
   - Impact: None (architectural choice, not a bug)

**Recently Fixed:**
- ✅ Rate Limiting (2026-02-19): Increased read limit 100→300 req/min, unblocked development/testing
- ✅ WebSocket Port Warnings (2026-02-21): Resolved, cleaner console output

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
- **Frame shifts as liberation:** Expose "lose-lose" situations as fixed frames, offer reframe as "win-win" (idea #022)
- **Projection in communication:** The judgment you imagine from others is usually self-judgment; to speak clearly is to listen (idea #018)
- **Agency vs. surrender timing:** Develop sensitivity for when to rest vs. when to push - no universal answer (idea #017)
- **Kobayashi Maru principle:** Some tensions are traps, not navigation opportunities - question the premise, change the rules (idea #020)
- **Counter-positioning thought leaders:** Quote dominant view (Haidt: "people reconcile incompatible beliefs"), then offer TensionLines alternative ("Don't reconcile—inhabit the tension") - creates clear contrast (ideas #013 + #014)
- **Idea pairing for depth:** Combine complementary ideas (Haidt quote + core thesis) for richer, more compelling content

**Reddit Post Voice (discovered 2026-02-18 to 2026-02-20):**
- Start with vulnerable question, not assertion ("Does this moment require me to be held, or does it require me to move?")
- Admit to getting it wrong regularly - opens authentic discussion
- Universal human experiences (pain scales, protective distance, rest/push paradox)
- End with genuine question inviting community wisdom
- 250-350 word sweet spot for discussion posts
- No preaching - genuine exploration tone

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

- **TensionLines CMS:** Production-stable, health score 9/10 (as of 2026-02-20)
  - **Latest status 2026-02-20:** Comprehensive review completed - all core systems operational ✅
  - Dashboard with live metrics (13 agents, 63 tasks, posting queue, notifications)
  - Book progress tracking functional (5 books, phase/chapter tracking) - minor word count inconsistency noted
  - Ideas bank system operational (42 ideas, 12 shipped, weekly goal tracking)
  - Navigation, filtering, and UI controls working
  - Engagement automation running smoothly (85 completed actions tracked)
  - Daily content automation executing correctly (3x daily: morning/midday/evening posts to CMS queue)
  - Only minor issues: WebSocket port warnings, missing search endpoint (see Known Issues)
- **10 Philosopher Agents:** SOULs defined in `philosophers/*/SOUL.md`
  - Voice assignments: Heraclitus (Threads), Socrates (Bluesky), Nietzsche (Twitter/X), Plato (Medium), Diogenes (Reddit - pending subreddit creation)
- **Ideas Bank:** Active at `content/ideas-bank.md` (43 ideas as of 2026-02-21)
  - Recent usage (2026-02-21 Saturday): #020 (Kobayashi Maru), #013/#014 (Haidt pairing), #018 (communication/projection)
  - Previous day (2026-02-20 Friday): #022 (frame shifts), #018 (communication), #017 (agency/surrender)
  - 28 captured, 1 drafted, 15 shipped (3 more today)
  - Idea-to-publish conversion rate: ~54% (15 shipped / 28 captured) - improving
  - 8-week streak maintained
  - 200+ tags available for organization
  - **Pattern:** Saturday "reflection/synthesis" theme working well (3 posts, cohesive but distinct)
- **5 Books:** In development with phase/chapter tracking in CMS
  - Books: TensionLines, Practical Wisdom, Leadership, Therapeutic Applications, Philosophy of AI
  - TensionLines main book: 11% progress (per 2026-02-20 CMS review)
  - Chapter 1: 3,957 / 8,000 words (49%)
  - Chapter 2: 1,721 / 12,000 words (14%)
  - Chapter detail pages with full content, outlines, and linked ideas
- **Reddit:** r/TensionLines does not exist yet
  - **Blocker identified 2026-02-20:** Evening post cron discovered subreddit missing
  - **Ready content:** Three quality discussion posts drafted (ideas #009, #015, #017)
  - Awaiting Shawn to create subreddit and establish moderation
- **Daily Content Automation:** All three daily jobs executing correctly (verified 2026-02-20)
  - Morning (9 AM), Midday (2 PM), Evening (6 PM Reddit draft)
  - Friday theme "reflection, integration, synthesis" executing well
  - All posts adding to CMS queue for Shawn's review (correct workflow)

## Content Production Insights

**Daily Posting Cadence Working Well (2026-02-21 Saturday):**
- Three Bluesky posts executed successfully: 9 AM, 2 PM (afternoon), 2 PM (midday)
- Morning: False binaries / Kobayashi Maru (idea #020) - framework limits
- Afternoon: Haidt counter-positioning + core thesis (ideas #013 + #014) - foundational message
- Midday: Communication/projection/presence (idea #018) - practical application
- Saturday "reflection/synthesis" theme: cohesive across all three posts
- **Idea pairing success:** Combined #013 + #014 for stronger, clearer contrast (Haidt's view → TensionLines alternative)

**Sustained Performance (2026-02-20 Friday):**
- Three cron jobs executed successfully: 9 AM, 2 PM, 6 PM
- Morning: Frame shifts (idea #022), Midday: Communication/projection (idea #018), Evening: Reddit (idea #017)
- Friday theme consistency maintained across all three posts
- Platform voice adaptation working: Bluesky (philosophical), Threads (conversational), Reddit (vulnerable questioning)

**Process Strengths:**
- Ideas bank → daily posting pipeline is smooth and reliable
- Each philosopher voice adapting appropriately to platform
- Day-of-week themes being honored (Friday = reflection, Saturday = synthesis)
- Time-of-day content depth strategy working (morning accessible, midday/afternoon deeper)
- **Idea conversion improving:** 54% shipped rate (up from 43% yesterday)

**Process Gap Identified:**
- Reddit posts drafting correctly but awaiting subreddit creation
- Three posts backlogged and ready to deploy immediately once subreddit exists
- Pattern: Content creation crons can continue during blockers, no waste

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

**High-value improvements identified 2026-02-21:**
10. **Quick Content Creation Workflow** - "Create Content from Idea" button in Ideas Bank with pre-filled platforms, real-time character counts, reduced friction (~4h effort, ~50% time savings)
11. **Book Writing Session Tracking** - Start/stop writing timer, words/hour velocity, daily/weekly charts, projected completion dates, gamified progress (~5-6h effort)
12. **Smart Task Prioritization** - Auto-prioritize stuck/overdue tasks, "What should I work on next?" recommendations, color-coded urgency (~3-4h effort)

All enhancements non-blocking; CMS fully functional for current workflow.
