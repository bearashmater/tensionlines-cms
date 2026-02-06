# CMS Security Audit Report

**Date:** 2026-02-05
**Auditor:** Claude (automated security scan)
**Status:** Partial fixes applied, 2 items need human decision

---

## Executive Summary

The TensionLines CMS was audited for security vulnerabilities. **10 issues** were found across multiple severity levels. **6 have been automatically fixed**, **2 require human decision**, and **2 are informational**.

---

## Fixed Issues

### 1. Vulnerable Dependencies (MEDIUM)
- **Issue:** esbuild/Vite had known vulnerability allowing request interception
- **Fix:** Upgraded Vite from 5.0.8 to 7.3.1
- **Status:** FIXED

### 2. Rate Limiting Not Endpoint-Specific (MEDIUM)
- **Issue:** Same rate limit for read and write operations (100/min)
- **Fix:** Added separate limiters - 100/min for reads, 30/min for writes
- **Status:** FIXED

### 3. CORS Not Environment-Aware (LOW)
- **Issue:** Hardcoded localhost origins
- **Fix:** Added `ALLOWED_ORIGINS` env var support
- **Status:** FIXED

### 4. CSP Disabled (HIGH)
- **Issue:** Content Security Policy completely disabled
- **Fix:** Enabled CSP in production mode with restrictive policy
- **Status:** FIXED (production only)

### 5. Missing Platform Filter Whitelist (MEDIUM)
- **Issue:** `/api/drafts` accepted any platform/philosopher parameter
- **Fix:** Added whitelist validation for both parameters
- **Status:** FIXED

### 6. Unvalidated Direct Links (LOW)
- **Issue:** Task `directLink` URLs rendered without protocol validation
- **Fix:** Added `isValidHttpUrl()` check to only allow http/https
- **Status:** FIXED

---

## Requires Human Decision

### 7. No Authentication/Authorization (CRITICAL)
- **Severity:** CRITICAL
- **Location:** All POST/PATCH/DELETE endpoints in server.js
- **Issue:** Zero authentication on any API endpoint. Anyone can:
  - Complete/reopen tasks
  - Modify posting queue
  - Reassign tasks
  - Mark notifications read

- **Risk:** CRITICAL if ever exposed beyond localhost
- **Current mitigation:** localhost-only access

**Decision needed:** See task "SECURITY: Decide on CMS Authentication Strategy"

Options:
1. Keep localhost-only (accept risk)
2. Add basic auth (simple)
3. Add JWT auth (proper)
4. Add API key (middle ground)

### 8. XSS via dangerouslySetInnerHTML (HIGH)
- **Severity:** HIGH
- **Location:** `src/components/HumanTasks.jsx:198`
- **Issue:** Task descriptions rendered as HTML without sanitization

```javascript
// VULNERABLE CODE
dangerouslySetInnerHTML={{ __html: formatDescription(task.description) }}
```

**Attack vector:** If attacker modifies task description:
```html
<img src=x onerror="alert('XSS')">
```

**Decision needed:** See task "SECURITY: Fix XSS Vulnerability in Task Descriptions"

Options:
1. Use DOMPurify to sanitize HTML
2. Use react-markdown for safe rendering
3. Remove HTML rendering entirely

---

## Informational

### 9. Error Message Sanitization (LOW)
- Error messages are generic ("Internal server error")
- Full errors logged server-side only
- **Status:** Acceptable

### 10. File Path Traversal (N/A)
- Path traversal checks exist for book IDs
- Other file operations enumerate directories (safe)
- **Status:** Already protected

---

## Security Configuration Summary

### Current server.js Security Middleware

```javascript
// Rate limiting
const readLimiter = rateLimit({ max: 100 });  // 100 reads/min
const writeLimiter = rateLimit({ max: 30 });  // 30 writes/min

// CORS (environment-aware)
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ||
  ['http://localhost:5173', 'http://127.0.0.1:5173'];

// CSP (production only)
const cspConfig = IS_PRODUCTION ? { /* strict policy */ } : false;

// Helmet security headers
app.use(helmet({ contentSecurityPolicy: cspConfig }));
```

### Input Validation

| Endpoint | Validation |
|----------|------------|
| `/api/drafts` | Platform + philosopher whitelist |
| `/api/search` | Query length 2-200 chars |
| `/api/books/:id` | Path traversal check |
| Others | Basic type checking |

---

## Recommendations

### Immediate (Before any network exposure)
1. Implement authentication (task-031)
2. Fix XSS vulnerability (task-032)

### Short-term
3. Add audit logging for sensitive operations
4. Implement CSRF protection if adding auth
5. Add request validation library (joi/zod)

### Long-term
6. Set up automated security scanning (npm audit in CI)
7. Add security headers for production deployment
8. Implement backup/recovery for database.json

---

## Test Commands

```bash
# Test rate limiting
for i in {1..35}; do curl -s -X POST http://localhost:5173/api/search -H 'Content-Type: application/json' -d '{"query":"test"}' & done

# Test platform whitelist
curl "http://localhost:5173/api/drafts?platform=invalid"
# Expected: {"error":"Invalid platform parameter"}

# Test URL validation (frontend)
# Add task with directLink: "javascript:alert(1)" - should not render as link
```

---

## Files Modified

- `server.js` - Rate limiting, CORS, CSP, input validation
- `src/components/HumanTasks.jsx` - URL validation for directLink
- `package.json` - Updated vite/esbuild dependencies
- `mission-control/database.json` - Added security tasks

---

*Report generated by automated security audit. Review findings and make decisions on items requiring human input.*
