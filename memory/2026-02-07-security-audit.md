# Security Audit Report - 2026-02-07

## Summary
Full security audit of the TensionLines CMS (server.js + React frontend). Found and fixed 3 critical/high issues and 3 medium issues. Overall posture is strong for a localhost admin tool.

## Issues Fixed (This Audit)

### 1. CRITICAL: Path Traversal in Backup Restore
**Server.js line ~4208** — `POST /api/backups/restore/:filename` passed user-supplied filename directly into `path.join()` without validation. Attacker could traverse directories with `../` to read arbitrary files.
**Fix:** Added regex validation (`/^[a-zA-Z0-9._-]+$/`), plus `path.resolve()` containment check ensuring resolved path stays within BACKUPS_DIR.

### 2. HIGH: Prototype Pollution in Posting Queue
**Server.js line ~1898** — `POST /api/posting-queue` used `...req.body` spread, allowing attackers to override server-generated `id`, `createdAt`, `status` fields and inject arbitrary properties.
**Fix:** Replaced spread with explicit destructuring of allowed fields only (`platform`, `content`, `caption`, `parts`, `canvaComplete`).

### 3. HIGH: Missing Status Validation on Optimization Findings
**Server.js line ~5020** — `PATCH /api/optimizations/findings/:id` accepted any string as `status` without whitelist validation.
**Fix:** Added validation against `['pending', 'resolved', 'dismissed', 'in_progress']`.

### 4. MEDIUM: URL Injection in HumanTasks.jsx
**Lines 239, 258** — `linkUrl` from API data used in `window.open()` and `<a href>` without protocol validation. Could allow `javascript:` URLs.
**Fix:** Applied existing `isValidHttpUrl()` check to all dynamic URLs before use.

### 5. MEDIUM: URL Injection in ManualPostingQueue.jsx
**Line 309** — `item.postUrl` used directly in `<a href>` without validation.
**Fix:** Added `/^https?:\/\//` protocol check before rendering the link.

### 6. MEDIUM: .vite/ Not Gitignored + Hardcoded localhost
- Added `.vite/` to `.gitignore`
- Fixed hardcoded `http://localhost:3001` in RecurringTasks.jsx to use relative `/api/` path

## Known Accepted Risks

### Race Conditions on JSON File Writes (MEDIUM)
Multiple endpoints do read-modify-write on `database.json` without file locking. Under concurrent requests, one write could overwrite another. Accepted risk for a single-user localhost tool. Would need a proper database (SQLite/Postgres) or file locking for multi-user.

### No Authentication (INFO)
No auth on any endpoint. Acceptable because server binds to `localhost` only. If ever network-exposed, auth is mandatory.

### CSP Disabled in Development (INFO)
Content Security Policy is disabled when `NODE_ENV !== 'production'` for Vite HMR compatibility. Should be enabled in any production deployment.

### ReactMarkdown Link Sanitization (LOW)
`ReactMarkdown` in HumanTasks.jsx could render `[text](javascript:...)` links. Low risk since task descriptions are authored internally. Could add `rehype-sanitize` for defense-in-depth.

### SWR Fetcher Doesn't Check res.ok (LOW)
Several components use `fetch(url).then(r => r.json())` without checking response status. Server errors could cause UI crashes. Not a security vulnerability but a reliability concern.

## Passing Checks ✓

| Check | Status |
|-------|--------|
| Server bound to localhost only | ✓ |
| Rate limiting (100 read, 30 write/min) | ✓ |
| Helmet security headers | ✓ |
| CORS restricted to localhost | ✓ |
| JSON body limit (1MB) | ✓ |
| Task ID regex validation | ✓ |
| Agent ID allowlist for file paths | ✓ |
| Book ID path traversal protection | ✓ |
| Backup filename validation | ✓ (fixed) |
| Status/priority whitelist validation | ✓ |
| No hardcoded credentials | ✓ |
| No secrets in frontend code | ✓ |
| No localStorage/sessionStorage usage | ✓ |
| No dangerouslySetInnerHTML | ✓ |
| No open redirect vulnerabilities | ✓ |
| npm audit clean (0 vulnerabilities) | ✓ |
| .env files gitignored | ✓ |
| .vite/ gitignored | ✓ (fixed) |
| Backup files blocked from static serving | ✓ |
| Dotfiles ignored | ✓ |

## Files Modified
- `cms/server.js` — Backup restore validation, posting queue sanitization, finding status validation
- `cms/src/components/HumanTasks.jsx` — URL protocol validation
- `cms/src/components/ManualPostingQueue.jsx` — URL protocol validation
- `cms/src/components/RecurringTasks.jsx` — Relative URL fix
- `cms/.gitignore` — Added .vite/
