# TOOLS.md - Local Environment

## CMS Server

- **URL:** `http://localhost:3001`
- **Start:** `cd /Users/admin/clawd/cms && node server.js`
- **Process:** Check with `pgrep -f "node.*server.js"`
- **Build frontend:** `cd /Users/admin/clawd/cms && npm run build`

## Bird CLI (Twitter)

- **Path:** `/opt/homebrew/bin/bird` (v0.8.0)
- **Config:** `~/.config/bird/config.json5` (Chrome Profile 2 cookies)
- **Account:** `@thetensionlines`
- **Read:** Works (`bird search`, `bird mentions`, `bird followers`)
- **Write:** Blocked by Twitter error 226 (spam detection)
- **Note:** Subagents can't use Bird (no Bash permission)

## Bluesky (AT Protocol)

- **Handle:** `thetensionlines.bsky.social`
- **Auth:** Credentials in `cms/.env` (`BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`)
- **Read + Write:** Both work via AT Protocol API in server.js

## Git

- **Repo:** `tensionlines-cms` at `https://github.com/bearashmater/tensionlines-cms.git`
- **Branch:** `main`
- **Working dirs:** `/Users/admin/clawd` (root) and `/Users/admin/clawd/cms` (both point to same repo)
- **NEVER use** `tension-lines-website` repo

## Notification Sounds

- **Glass** (`/System/Library/Sounds/Glass.aiff`) = Task complete, no action needed
- **Funk** (`/System/Library/Sounds/Funk.aiff`) = Need user input, come look

## Key Paths

- Database: `mission-control/database.json`
- Ideas bank: `content/ideas-bank.md`
- Philosopher SOULs: `philosophers/*/SOUL.md`
- Agent avatars: `cms/public/avatars/`
- Daily memory: `memory/YYYY-MM-DD.md`
