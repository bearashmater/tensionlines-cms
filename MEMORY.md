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

**9 jobs need fixing (as of 2026-02-11):**
All content-creation jobs (morning/midday/evening social, newsletters, articles) are posting directly instead of adding to queue. Need to:
1. Review CMS posting queue schema in `mission-control/database.json`
2. Update each job to add drafts to queue instead of posting
3. Test workflow end-to-end

**Correct cron jobs:** Philosopher heartbeats, engagement bots (monitoring), moderation checks, CMS review, compound review, book work.

## Technical Stack

- **CMS:** Node.js + Express backend, React + Vite frontend at `localhost:3001`
- **Database:** File-based JSON at `mission-control/database.json`
- **Twitter:** Bird CLI (`/opt/homebrew/bin/bird`) - READ ONLY (write blocked by Twitter)
- **Bluesky:** AT Protocol via server.js - read + write works
- **Git:** Always use `tensionlines-cms` repo, never `tension-lines-website`

## Engagement Automation

- **Twitter bot:** Every 30 minutes (1800000ms) - calls CMS `/api/engagement/scan`
- **Bluesky bot:** Every 45 minutes (2700000ms) - calls CMS `/api/engagement/scan`
- Both scan for engagement opportunities, add to CMS queue
- **Fixed 2026-02-12:** Pointed both jobs to CMS API endpoints instead of non-existent scripts

## Content Drafting Patterns (2026-02-11)

**Threads posts:** Conversational, relatable hooks. "Scale of 1-10" format worked well.
**Bluesky posts:** Intellectual but accessible. Clear distinctions and definitions.

Both kept under platform limits, used line breaks for readability.

## Mistakes to Avoid

- Don't post content directly via automation tools
- Don't bypass the CMS posting queue
- Don't touch `tension-lines-website` repo
- Don't assume server is running - always check first
- Don't create cron jobs that post without human review

## Project Status

- **TensionLines CMS:** Functional, needs workflow fix for cron jobs
- **10 Philosopher Agents:** SOULs defined in `philosophers/*/SOUL.md`
- **Ideas Bank:** Active at `content/ideas-bank.md` (100+ ideas)
- **5 Books:** In development (details TBD)
