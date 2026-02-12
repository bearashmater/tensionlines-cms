#!/usr/bin/env node

/**
 * TensionLines CMS - API Server
 * 
 * Lightweight Express server that reads from existing files
 * and provides REST API for the React frontend.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import matter from 'gray-matter';
import chokidar from 'chokidar';
import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { execSync, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import { BskyAgent, RichText } from '@atproto/api';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file for Bluesky credentials
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Rate limiting - separate limits for read vs write operations
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,  // 100 reads per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,  // 30 writes per minute (more restrictive)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please try again later' }
});

// Environment-aware CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ||
  ['http://localhost:5173', 'http://127.0.0.1:5173'];

// Environment-aware CSP - stricter in production
const cspConfig = IS_PRODUCTION
  ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"]
      }
    }
  : false;  // Disabled for Vite dev server in development

// Middleware
app.use(helmet({
  contentSecurityPolicy: cspConfig,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));

// Apply rate limiters based on method
app.use((req, res, next) => {
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
    return writeLimiter(req, res, next);
  }
  return readLimiter(req, res, next);
});

// ─── WebSocket Server ────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'connected' }));
});

// Heartbeat: drop dead connections every 30s
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

/**
 * Broadcast an invalidation event to all connected WebSocket clients.
 * Frontend uses this to trigger SWR revalidation for the given channel.
 */
function broadcast(channel) {
  const msg = JSON.stringify({ type: 'invalidate', channel });
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

// Route-to-channel mapping for auto-broadcast
const ROUTE_CHANNELS = [
  ['/api/tasks', 'tasks'],
  ['/api/posting-queue', 'posting-queue'],
  ['/api/repurpose', 'posting-queue'],
  ['/api/reply-queue', 'reply-queue'],
  ['/api/comment-queue', 'comment-queue'],
  ['/api/engagement', 'engagement'],
  ['/api/notifications', 'notifications'],
  ['/api/analytics', 'analytics'],
  ['/api/content/engagement', 'analytics'],
  ['/api/messages', 'messages'],
  ['/api/repost-candidates', 'ideas'],
  ['/api/future-needs', 'ideas'],
  ['/api/system', 'system'],
];

// ─── System Event Log (in-memory ring buffer) ───────────────────────────────
const systemEventLog = [];
const MAX_SYSTEM_EVENTS = 200;

function logSystemEvent(type, message, metadata = {}) {
  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    type,
    message,
    metadata,
    timestamp: new Date().toISOString()
  };
  systemEventLog.push(event);
  if (systemEventLog.length > MAX_SYSTEM_EVENTS) systemEventLog.shift();
  broadcast('system');
}

// ─── Cron Registry ──────────────────────────────────────────────────────────
const cronRegistry = {};

function registerCron(id, schedule, description) {
  cronRegistry[id] = {
    id,
    schedule,
    description,
    lastRun: null,
    lastResult: null,
    lastError: null,
    runCount: 0
  };
}

function recordCronRun(id, result = 'ok', error = null) {
  if (!cronRegistry[id]) return;
  cronRegistry[id].lastRun = new Date().toISOString();
  cronRegistry[id].lastResult = error ? 'error' : result;
  cronRegistry[id].lastError = error;
  cronRegistry[id].runCount++;
}

// Register all crons
registerCron('comment-scan', '0 10,14,18 * * *', 'Comment queue scan (3x daily)');
registerCron('backup', '55 1 * * *', 'Nightly backup');
registerCron('optimization', '0 2 * * *', 'Nightly optimization');
registerCron('daily-summary', '0 8 * * *', 'Morning summary notification');
registerCron('repost-convert', '0 9 * * *', 'Repost candidate conversion');
registerCron('weekly-idea-reset', '0 0 * * 1', 'Weekly idea batch reset');
registerCron('twitter-metrics', '15 6 * * *', 'Daily Twitter metrics snapshot');
registerCron('weekly-report', '0 7 * * 1', 'Weekly report generation');
registerCron('weekly-review', '0 22 * * 0', 'Weekly project review');
registerCron('auto-pipeline', '0 6 * * *', 'Auto-pipeline draft generation');
registerCron('engagement-scan', '0 11,15,19 * * *', 'Engagement target scan (3x daily)');
registerCron('engagement-execute', '15 11,15,19 * * *', 'Engagement action execution (3x daily)');
registerCron('auto-voice-check', '30 6 * * *', 'Auto voice check (Diogenes quality gate)');
registerCron('queue-replenishment', '0 16 * * *', 'Queue replenishment (auto-draft low queues)');
registerCron('evening-recap', '0 20 * * *', 'Evening performance recap');
registerCron('peer-review', '0 7 * * *', 'Peer review pipeline');
registerCron('tension-standup', '30 7 * * *', 'Tension daily standup');
registerCron('book-pipeline', '0 11 * * 3', 'Book pipeline (weekly chapter drafting)');
registerCron('weekly-newsletter', '0 9 * * 1', 'Weekly newsletter generation (Monday 9 AM)');
registerCron('weekly-podcast', '30 9 * * 1', 'Weekly podcast generation (Monday 9:30 AM)');

// Auto-broadcast middleware: intercepts res.json() on mutation requests
// and broadcasts an invalidation event on success (2xx status)
app.use((req, res, next) => {
  if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) return next();

  const channel = ROUTE_CHANNELS.find(([prefix]) => req.path.startsWith(prefix))?.[1];
  if (!channel) return next();

  const originalJson = res.json.bind(res);
  res.json = function(body) {
    const result = originalJson(body);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      broadcast(channel);
    }
    return result;
  };
  next();
});

// Base paths
const BASE_DIR = path.resolve(__dirname, '..');
const MISSION_CONTROL_DB = path.join(BASE_DIR, 'mission-control/database.json');
const OPTIMIZATIONS_DB = path.join(BASE_DIR, 'mission-control/optimizations.json');
const BACKUPS_DIR = path.join(BASE_DIR, 'mission-control/backups');
const IDEAS_BANK = path.join(BASE_DIR, 'content/ideas-bank.md');
const MEMORY_DIR = path.join(BASE_DIR, 'memory');
const PHILOSOPHERS_DIR = path.join(BASE_DIR, 'philosophers');
const BOOKS_DIR = path.join(BASE_DIR, 'books');
const POSTING_SCHEDULE = path.join(BASE_DIR, 'POSTING_SCHEDULE.md');
const REPOST_CANDIDATES_FILE = path.join(BASE_DIR, 'content', 'repost-candidates.json');
const FUTURE_NEEDS_FILE = path.join(BASE_DIR, 'mission-control', 'future-needs.json');
const ANALYTICS_DATA_FILE = path.join(BASE_DIR, 'mission-control', 'analytics-data.json');
const ENGAGEMENT_INBOX_FILE = path.join(BASE_DIR, 'content', 'queue', 'engagement-inbox.json');
const COMMENT_QUEUE_FILE = path.join(BASE_DIR, 'content', 'queue', 'comment-queue.json');
const WEEKLY_REPORTS_DIR = path.join(BASE_DIR, 'mission-control', 'weekly-reports');
const AUDIENCE_SEGMENTS_FILE = path.join(BASE_DIR, 'mission-control', 'audience-segments.json');
const FOLLOWS_TRACKER_FILE = path.join(BASE_DIR, 'content', 'queue', 'follows-tracker.json');
const ENGAGEMENT_ACTIONS_FILE = path.join(BASE_DIR, 'content', 'queue', 'engagement-actions.json');
const AUTO_PIPELINE_STATE_FILE = path.join(BASE_DIR, 'content', 'queue', 'auto-pipeline-state.json');
const APPROVAL_QUEUE_FILE = path.join(BASE_DIR, 'mission-control', 'approval-queue.json');
const BOOK_PIPELINE_STATE_FILE = path.join(BOOKS_DIR, 'book1-philosophy', 'pipeline-state.json');

// Claude API client (lazy — only created when ANTHROPIC_API_KEY is set)
let anthropicClient = null;
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

// Cache for frequently accessed data - invalidated by chokidar watcher
let cache = {
  missionControl: null,
  ideasBank: null,
  memoryFiles: null,
  drafts: null,
  booksProgress: null,
  postingSchedule: null,
  recurringTasks: null,
  repostCandidates: null,
  futureNeeds: null,
  analyticsData: null,
  engagementInbox: null,
  audienceSegments: null,
  lastUpdate: null
};

function invalidateCache(filePath) {
  if (filePath.includes('database.json')) {
    cache.missionControl = null;
  } else if (filePath.includes('ideas-bank')) {
    cache.ideasBank = null;
  } else if (filePath.includes(MEMORY_DIR)) {
    cache.memoryFiles = null;
  } else if (filePath.includes(PHILOSOPHERS_DIR)) {
    cache.drafts = null;
  } else if (filePath.includes(BOOKS_DIR)) {
    cache.booksProgress = null;
  } else if (filePath.includes('POSTING_SCHEDULE')) {
    cache.postingSchedule = null;
  } else if (filePath.includes('recurring-tasks')) {
    cache.recurringTasks = null;
  } else if (filePath.includes('repost-candidates')) {
    cache.repostCandidates = null;
  } else if (filePath.includes('future-needs')) {
    cache.futureNeeds = null;
  } else if (filePath.includes('analytics-data')) {
    cache.analyticsData = null;
  } else if (filePath.includes('audience-segments')) {
    cache.audienceSegments = null;
  }
  cache.lastUpdate = new Date().toISOString();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Theme extraction from reason/text field — shared by outreach-analytics and audience-segments
 */
function extractTheme(reason) {
  if (!reason) return 'Philosophy (General)';
  const r = reason.toLowerCase();
  if (/religion|faith|ethics/.test(r)) return 'Religion & Ethics';
  if (/polarity|paradox|opposites/.test(r)) return 'Polarity & Paradox';
  if (/identity|meaning|self|emotional/.test(r)) return 'Identity & Meaning';
  if (/movement|stillness|paralysis/.test(r)) return 'Movement & Stillness';
  if (/art|artist|writer|writing|creative/.test(r)) return 'Creative Expression';
  if (/practical|action|steps|coaching/.test(r)) return 'Practical Wisdom';
  return 'Philosophy (General)';
}

/**
 * Read and parse Mission Control database
 */
function getMissionControl() {
  if (cache.missionControl) return cache.missionControl;
  if (!fs.existsSync(MISSION_CONTROL_DB)) {
    return { agents: [], tasks: [], activities: [], notifications: [] };
  }
  const content = fs.readFileSync(MISSION_CONTROL_DB, 'utf8');
  cache.missionControl = JSON.parse(content);
  return cache.missionControl;
}

// ============================================================================
// WEEKLY REPORT HELPERS
// ============================================================================

function getISOWeekId(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Set to nearest Thursday (ISO weeks are defined by Thursday)
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo = 1 + Math.round(((d.getTime() - yearStart.getTime()) / 86400000 - 3 + ((yearStart.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getWeekBounds(weekId) {
  const [yearStr, weekStr] = weekId.split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(weekStr);
  // Jan 4 is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function getPreviousWeekId(weekId) {
  const { start } = getWeekBounds(weekId);
  const prev = new Date(start);
  prev.setUTCDate(prev.getUTCDate() - 7);
  return getISOWeekId(prev);
}

function getNextWeekId(weekId) {
  const { start } = getWeekBounds(weekId);
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 7);
  return getISOWeekId(next);
}

function readWeeklyReport(weekId) {
  const filePath = path.join(WEEKLY_REPORTS_DIR, `${weekId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`Error reading weekly report ${weekId}:`, e);
    }
  }
  return null;
}

function saveWeeklyReport(weekId, data) {
  if (!fs.existsSync(WEEKLY_REPORTS_DIR)) {
    fs.mkdirSync(WEEKLY_REPORTS_DIR, { recursive: true });
  }
  fs.writeFileSync(
    path.join(WEEKLY_REPORTS_DIR, `${weekId}.json`),
    JSON.stringify(data, null, 2)
  );
}

/**
 * Parse ideas-bank.md into structured data
 */
function parseIdeasBank() {
  if (cache.ideasBank) return cache.ideasBank;
  if (!fs.existsSync(IDEAS_BANK)) {
    return [];
  }

  const content = fs.readFileSync(IDEAS_BANK, 'utf8');
  const lines = content.split('\n');
  const ideas = [];

  let currentIdea = null;
  let currentDate = null;
  let currentSection = null; // Track which section we're in (notes, potential content, etc.)
  let sectionContent = [];

  const saveSection = () => {
    if (currentIdea && currentSection && sectionContent.length > 0) {
      const text = sectionContent.join('\n').trim();
      if (text) {
        currentIdea[currentSection] = text;
      }
    }
    sectionContent = [];
    currentSection = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match date headers like "## 2026-02-02"
    const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      saveSection();
      currentDate = dateMatch[1];
      continue;
    }

    // Match idea headers like "### #001 - 06:42 AM PST"
    const headerMatch = line.match(/^###?\s+#?(\d+)\s+[-|]\s+(.+)/);
    if (headerMatch) {
      saveSection();
      if (currentIdea) ideas.push(currentIdea);
      currentIdea = {
        id: headerMatch[1],
        capturedAt: headerMatch[2].trim(),
        date: currentDate,
        text: '',
        quote: '',
        quoteOriginal: '',
        quoteRefined: '',
        tags: [],
        status: 'captured',
        statusDetail: '',
        chapter: '',
        notes: '',
        tension: '',
        paradox: '',
        connections: '',
        potentialContent: []
      };
      continue;
    }

    if (!currentIdea) continue;

    // Match Quote (original)
    const quoteOrigMatch = line.match(/\*\*Quote \(original\):\*\*\s+(.+)/);
    if (quoteOrigMatch) {
      saveSection();
      currentIdea.quoteOriginal = quoteOrigMatch[1].replace(/^"|"$/g, '');
      continue;
    }

    // Match Quote (refined)
    const quoteRefMatch = line.match(/\*\*Quote \(refined\):\*\*\s+(.+)/);
    if (quoteRefMatch) {
      saveSection();
      currentIdea.quoteRefined = quoteRefMatch[1].replace(/^"|"$/g, '');
      currentIdea.quote = currentIdea.quoteRefined;
      currentIdea.text = currentIdea.quoteRefined;
      continue;
    }

    // Match simple Quote
    const quoteMatch = line.match(/\*\*Quote:\*\*\s+(.+)/);
    if (quoteMatch) {
      saveSection();
      currentIdea.quote = quoteMatch[1].replace(/^"|"$/g, '');
      currentIdea.text = currentIdea.quote;
      continue;
    }

    // Match tags (supports "#tag1 #tag2" or "tag1, tag2" formats)
    const tagsMatch = line.match(/\*\*Tags:\*\*\s+(.+)/);
    if (tagsMatch) {
      saveSection();
      const raw = tagsMatch[1].trim();
      if (raw.includes('#')) {
        currentIdea.tags = raw.split(/\s+/).filter(t => t.startsWith('#')).map(t => t.substring(1));
      } else if (raw.includes(',')) {
        currentIdea.tags = raw.split(',').map(t => t.trim()).filter(Boolean);
      } else if (raw.length > 0) {
        currentIdea.tags = raw.split(/\s+/).filter(Boolean);
      }
      continue;
    }

    // Match chapter
    const chapterMatch = line.match(/\*\*Chapter:\*\*\s+(.+)/);
    if (chapterMatch) {
      saveSection();
      currentIdea.chapter = chapterMatch[1].trim();
      continue;
    }

    // Match status
    const statusMatch = line.match(/\*\*Status:\*\*\s+(.+)/);
    if (statusMatch) {
      saveSection();
      currentIdea.statusDetail = statusMatch[1].trim();
      const status = statusMatch[1].toLowerCase();
      if (status.includes('🟢') || status.includes('used') || status.includes('shipped') || status.includes('posted')) {
        currentIdea.status = 'shipped';
      } else if (status.includes('🟠') || status.includes('creating') || status.includes('drafted')) {
        currentIdea.status = 'drafted';
      } else if (status.includes('🟡') || status.includes('organizing') || status.includes('assigned')) {
        currentIdea.status = 'assigned';
      } else {
        currentIdea.status = 'captured';
      }
      continue;
    }

    // Match Notes section start
    if (line.match(/^\*\*Notes:\*\*/)) {
      saveSection();
      currentSection = 'notes';
      const inlineContent = line.replace(/^\*\*Notes:\*\*\s*/, '').trim();
      if (inlineContent) sectionContent.push(inlineContent);
      continue;
    }

    // Match The tension/The paradox sections
    if (line.match(/^\*\*The tension:\*\*/i)) {
      saveSection();
      currentSection = 'tension';
      const inlineContent = line.replace(/^\*\*The tension:\*\*\s*/i, '').trim();
      if (inlineContent) sectionContent.push(inlineContent);
      continue;
    }

    if (line.match(/^\*\*The paradox:\*\*/i)) {
      saveSection();
      currentSection = 'paradox';
      const inlineContent = line.replace(/^\*\*The paradox:\*\*\s*/i, '').trim();
      if (inlineContent) sectionContent.push(inlineContent);
      continue;
    }

    // Match Connection to other ideas / TensionLines angle
    if (line.match(/^\*\*(Connection|The TensionLines|Why)/i)) {
      saveSection();
      currentSection = 'connections';
      sectionContent.push(line);
      continue;
    }

    // Match Potential Content
    if (line.match(/^\*\*Potential Content:\*\*/)) {
      saveSection();
      currentSection = 'potentialContent';
      continue;
    }

    // Check for new bold section that ends current section
    if (line.match(/^\*\*[^*]+:\*\*/) && currentSection) {
      saveSection();
      // Re-process this line to handle the new section
      i--;
      continue;
    }

    // If we're in a section, add content
    if (currentSection) {
      // For potential content, parse bullet points
      if (currentSection === 'potentialContent') {
        const bulletMatch = line.match(/^-\s+(.+)/);
        if (bulletMatch) {
          if (!Array.isArray(currentIdea.potentialContent)) {
            currentIdea.potentialContent = [];
          }
          currentIdea.potentialContent.push(bulletMatch[1].trim());
        }
      } else {
        sectionContent.push(line);
      }
    }
  }

  // Save final section and idea
  saveSection();
  if (currentIdea) ideas.push(currentIdea);

  cache.ideasBank = ideas;
  return ideas;
}

// Max content size for API responses (1MB)
const MAX_CONTENT_SIZE = 1024 * 1024;

/**
 * Truncate content if too large
 */
function truncateContent(content, maxSize = MAX_CONTENT_SIZE) {
  if (content.length <= maxSize) return content;
  return content.substring(0, maxSize) + '\n\n[Content truncated - file too large]';
}

/**
 * Get all memory files
 */
function getMemoryFiles() {
  if (cache.memoryFiles) return cache.memoryFiles;
  if (!fs.existsSync(MEMORY_DIR)) return [];

  const files = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fullPath = path.join(MEMORY_DIR, f);
      const content = fs.readFileSync(fullPath, 'utf8');
      const stats = fs.statSync(fullPath);

      return {
        filename: f,
        content: truncateContent(content),
        size: stats.size,
        modified: stats.mtime
      };
    });

  cache.memoryFiles = files.sort((a, b) => b.modified - a.modified);
  return cache.memoryFiles;
}

/**
 * Get all philosopher drafts
 */
function getPhilosopherDrafts() {
  if (cache.drafts) return cache.drafts;
  if (!fs.existsSync(PHILOSOPHERS_DIR)) return [];
  
  const drafts = [];
  const philosophers = fs.readdirSync(PHILOSOPHERS_DIR)
    .filter(f => fs.statSync(path.join(PHILOSOPHERS_DIR, f)).isDirectory());
  
  for (const phil of philosophers) {
    const draftsDir = path.join(PHILOSOPHERS_DIR, phil, 'drafts');
    if (!fs.existsSync(draftsDir)) continue;
    
    const files = fs.readdirSync(draftsDir).filter(f => f.endsWith('.md'));
    
    for (const file of files) {
      const fullPath = path.join(draftsDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const stats = fs.statSync(fullPath);
      const parsed = matter(content);
      
      // Infer platform from filename
      let platform = 'unknown';
      if (file.includes('twitter')) platform = 'twitter';
      else if (file.includes('bluesky')) platform = 'bluesky';
      else if (file.includes('threads')) platform = 'threads';
      else if (file.includes('reddit')) platform = 'reddit';
      else if (file.includes('medium')) platform = 'medium';
      
      drafts.push({
        philosopher: phil,
        filename: file,
        platform: platform,
        content: truncateContent(parsed.content),
        metadata: parsed.data,
        modified: stats.mtime,
        size: stats.size
      });
    }
  }
  
  cache.drafts = drafts.sort((a, b) => b.modified - a.modified);
  return cache.drafts;
}

/**
 * Search across all content
 */
function searchContent(query) {
  const results = [];
  const lowerQuery = query.toLowerCase();

  // Search tasks
  const mc = getMissionControl();
  mc.tasks.forEach(task => {
    if (task.title.toLowerCase().includes(lowerQuery) ||
        task.description.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'task',
        id: task.id,
        title: task.title,
        snippet: task.description.substring(0, 150),
        status: task.status,
        assignees: task.assigneeIds,
        url: `/tasks/${task.id}`
      });
    }
  });

  // Search agents
  mc.agents.forEach(agent => {
    if (agent.name.toLowerCase().includes(lowerQuery) ||
        agent.role?.toLowerCase().includes(lowerQuery) ||
        agent.description?.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'agent',
        id: agent.id,
        title: agent.name,
        snippet: agent.role || agent.description?.substring(0, 150) || '',
        status: agent.status,
        url: `/agents/${agent.id}`
      });
    }
  });

  // Search activities
  mc.activities.slice(0, 100).forEach(activity => {
    if (activity.description?.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'activity',
        id: activity.id,
        title: activity.description,
        snippet: `${activity.type} by ${activity.agentId}`,
        url: `/activities`
      });
    }
  });

  // Search ideas
  const ideas = parseIdeasBank();
  ideas.forEach(idea => {
    if (idea.text.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'idea',
        id: idea.id,
        title: `Idea #${idea.id}`,
        snippet: idea.text.substring(0, 150),
        url: `/ideas/${idea.id}`
      });
    }
  });

  // Search drafts
  const drafts = getPhilosopherDrafts();
  drafts.forEach(draft => {
    if (draft.content.toLowerCase().includes(lowerQuery)) {
      results.push({
        type: 'draft',
        id: draft.filename,
        title: `${draft.philosopher}: ${draft.filename}`,
        snippet: draft.content.substring(0, 150),
        url: `/drafts/${draft.philosopher}/${draft.filename}`
      });
    }
  });

  return results;
}

/**
 * Parse chapter titles from MASTER_OUTLINE.md
 */
function parseChapterTitles(bookDir) {
  const outlinePath = path.join(BOOKS_DIR, bookDir, 'outline/MASTER_OUTLINE.md');
  if (!fs.existsSync(outlinePath)) return {};
  
  const content = fs.readFileSync(outlinePath, 'utf8');
  const lines = content.split('\n');
  const titles = {};
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match "#### Chapter 1: The Life That Stopped"
    const match = line.match(/^####\s+Chapter\s+(\d+):\s+(.+)/);
    if (match) {
      titles[parseInt(match[1])] = match[2].trim();
    }
  }
  
  return titles;
}

/**
 * Get book progress across all books
 */
function getBooksProgress() {
  if (cache.booksProgress) return cache.booksProgress;
  if (!fs.existsSync(BOOKS_DIR)) return [];
  
  const books = [];
  const bookDirs = fs.readdirSync(BOOKS_DIR)
    .filter(f => fs.statSync(path.join(BOOKS_DIR, f)).isDirectory());
  
  for (const bookDir of bookDirs) {
    const trackerPath = path.join(BOOKS_DIR, bookDir, 'PROJECT_TRACKER.md');
    if (!fs.existsSync(trackerPath)) continue;
    
    const content = fs.readFileSync(trackerPath, 'utf8');
    const lines = content.split('\n');
    
    const book = {
      id: bookDir,
      name: '',
      phase: '',
      totalWords: 0,
      targetWords: 0,
      chapters: [],
      phases: []
    };
    
    // Parse chapter titles from outline
    const chapterTitles = parseChapterTitles(bookDir);
    
    let inWordCountTable = false;
    let currentPhase = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Extract book title
      if (line.startsWith('# ') && !book.name) {
        book.name = line.replace('# ', '').replace(' - Project Tracker', '').trim();
      }
      
      // Extract current phase
      if (line.includes('**Current Phase:**')) {
        book.phase = line.split('**Current Phase:**')[1].trim();
      }
      
      // Extract phases with completion status
      const phaseMatch = line.match(/^###\s+Phase\s+(\d+):\s+(.+)\s+\((.+)\)/);
      if (phaseMatch) {
        currentPhase = {
          number: parseInt(phaseMatch[1]),
          name: phaseMatch[2].trim(),
          status: phaseMatch[3].trim(),
          tasks: []
        };
        book.phases.push(currentPhase);
      }
      
      // Extract phase tasks (checkboxes)
      if (currentPhase && line.match(/^-\s+\[([ x])\]/)) {
        const checked = line.includes('[x]');
        const task = line.replace(/^-\s+\[([ x])\]\s+/, '').trim();
        currentPhase.tasks.push({ task, completed: checked });
      }
      
      // Detect word count table
      if (line.includes('| Chapter | Target | Current | Status |')) {
        inWordCountTable = true;
        i++; // Skip separator line
        continue;
      }
      
      // Parse word count table
      if (inWordCountTable && line.startsWith('|')) {
        const parts = line.split('|').map(p => p.trim()).filter(p => p);
        
        if (parts[0] === '**Total**') {
          book.targetWords = parseInt(parts[1].replace(/,/g, '')) || 0;
          book.totalWords = parseInt(parts[2].replace(/,/g, '')) || 0;
          inWordCountTable = false;
        } else if (parts[0].startsWith('Ch ') || parts[0].startsWith('Intro')) {
          const chapterMatch = parts[0].match(/Ch\s+(\d+)/);
          const chapterNum = chapterMatch ? parseInt(chapterMatch[1]) : (parts[0] === 'Intro' ? 0 : null);
          
          if (chapterNum !== null) {
            const targetWords = parseInt(parts[1].replace(/,/g, '')) || 0;
            const currentWords = parseInt(parts[2].replace(/,/g, '')) || 0;
            const status = parts[3];
            
            book.chapters.push({
              number: chapterNum,
              title: chapterTitles[chapterNum] || (chapterNum === 0 ? 'Introduction' : ''),
              targetWords,
              currentWords,
              status,
              percentComplete: targetWords > 0 ? Math.round((currentWords / targetWords) * 100) : 0
            });
          }
        }
      }
    }
    
    // Calculate phase completion percentages
    book.phases.forEach(phase => {
      const totalTasks = phase.tasks.length;
      const completedTasks = phase.tasks.filter(t => t.completed).length;
      phase.percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    });
    
    // Calculate overall completion
    book.percentComplete = book.targetWords > 0 ? Math.round((book.totalWords / book.targetWords) * 100) : 0;
    
    books.push(book);
  }

  cache.booksProgress = books;
  return books;
}

/**
 * Validate bookId to prevent path traversal attacks
 */
function isValidBookId(bookId) {
  if (!bookId || typeof bookId !== 'string') return false;
  // Only allow alphanumeric, hyphens, underscores (no slashes, dots, etc.)
  if (!/^[a-zA-Z0-9_-]+$/.test(bookId)) return false;
  // Verify it's an actual book directory
  const bookDir = path.join(BOOKS_DIR, bookId);
  const resolvedPath = path.resolve(bookDir);
  // Ensure resolved path is still within BOOKS_DIR
  if (!resolvedPath.startsWith(path.resolve(BOOKS_DIR))) return false;
  return fs.existsSync(bookDir) && fs.statSync(bookDir).isDirectory();
}

/**
 * Validate philosopher name to prevent path traversal attacks
 */
function isValidPhilosopher(name) {
  if (!name || typeof name !== 'string') return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return false;
  const dir = path.join(PHILOSOPHERS_DIR, name);
  if (!path.resolve(dir).startsWith(path.resolve(PHILOSOPHERS_DIR))) return false;
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

/**
 * Get chapter details including content and linked ideas
 */
function getChapterDetails(bookId, chapterNum) {
  if (!isValidBookId(bookId)) {
    throw new Error('Invalid book ID');
  }
  if (!Number.isInteger(chapterNum) || chapterNum < 0 || chapterNum > 100) {
    throw new Error('Invalid chapter number');
  }
  const bookDir = path.join(BOOKS_DIR, bookId);
  
  const chapter = {
    bookId,
    number: chapterNum,
    title: '',
    content: '',
    wordCount: 0,
    ideas: [],
    outline: ''
  };
  
  // Get title from outline
  const titles = parseChapterTitles(bookId);
  chapter.title = titles[chapterNum] || `Chapter ${chapterNum}`;
  
  // Get chapter content if it exists
  const chapterPath = path.join(bookDir, 'chapters', `chapter-${chapterNum}.md`);
  if (fs.existsSync(chapterPath)) {
    const rawContent = fs.readFileSync(chapterPath, 'utf8');
    chapter.content = truncateContent(rawContent);
    chapter.wordCount = rawContent.split(/\s+/).filter(w => w).length;
  }
  
  // Get chapter outline from MASTER_OUTLINE.md
  const outlinePath = path.join(bookDir, 'outline/MASTER_OUTLINE.md');
  if (fs.existsSync(outlinePath)) {
    const content = fs.readFileSync(outlinePath, 'utf8');
    const lines = content.split('\n');
    
    let inChapter = false;
    let outlineLines = [];
    
    const chapterHeader = `#### Chapter ${chapterNum}:`;
    for (const line of lines) {
      if (line.startsWith(chapterHeader)) {
        inChapter = true;
        continue;
      }
      
      if (inChapter) {
        if (line.startsWith('####')) {
          break; // Next chapter
        }
        outlineLines.push(line);
      }
    }
    
    chapter.outline = outlineLines.join('\n').trim();
  }
  
  // Find ideas linked to this chapter (read file once, not per-idea)
  const ideas = parseIdeasBank();
  const ideasBankContent = fs.existsSync(IDEAS_BANK) ? fs.readFileSync(IDEAS_BANK, 'utf8') : '';
  chapter.ideas = ideas.filter(idea => {
    const ideaSection = ideasBankContent.split(`### #${idea.id}`)[1];
    if (!ideaSection) return false;

    const nextIdeaIndex = ideaSection.indexOf('### #');
    const thisIdeaText = nextIdeaIndex > 0 ? ideaSection.substring(0, nextIdeaIndex) : ideaSection;

    const chapterMatch = thisIdeaText.match(/\*\*Chapter:\*\*\s+Book\s+\d+\s+-\s+Chapter\s+(\d+)/);
    return chapterMatch && parseInt(chapterMatch[1]) === chapterNum;
  });
  
  return chapter;
}

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * Dashboard summary metrics
 */
app.get('/api/dashboard', (req, res) => {
  try {
    const mc = getMissionControl();
    const ideas = parseIdeasBank();
    
    // Calculate metrics
    const activeAgents = mc.agents.filter(a => a.status === 'active').length;
    const activeTasks = mc.tasks.filter(t => 
      ['assigned', 'in_progress', 'review'].includes(t.status)
    );
    const tasksInProgress = activeTasks.length;
    const tasksCompleted = mc.tasks.filter(t => 
      ['completed', 'shipped'].includes(t.status)
    ).length;
    const unreadNotifications = mc.notifications.filter(n => !n.read).length;
    
    // Calculate stuck tasks (yellow + red alerts)
    const tasksWithTracking = activeTasks.map(t => ({
      ...t,
      timeTracking: calculateTimeInStatus(t)
    }));
    
    const stuckTasks = tasksWithTracking.filter(t => 
      t.timeTracking.alertLevel === 'yellow' || t.timeTracking.alertLevel === 'red'
    ).length;
    
    const criticalTasks = tasksWithTracking.filter(t => 
      t.timeTracking.alertLevel === 'red'
    ).length;
    
    res.json({
      metrics: {
        totalAgents: mc.agents.length,
        activeTasks: tasksInProgress
      },
      agents: {
        total: mc.agents.length,
        active: activeAgents,
        idle: mc.agents.filter(a => a.status === 'idle').length
      },
      tasks: {
        total: mc.tasks.length,
        inProgress: tasksInProgress,
        completed: tasksCompleted,
        stuck: stuckTasks,
        critical: criticalTasks,
        completionRate: mc.tasks.length > 0
          ? Math.round((tasksCompleted / mc.tasks.length) * 100)
          : 0
      },
      ideas: {
        total: ideas.length,
        captured: ideas.filter(i => i.status === 'captured').length,
        drafted: ideas.filter(i => i.status === 'drafted').length,
        shipped: ideas.filter(i => i.status === 'shipped').length
      },
      notifications: {
        total: mc.notifications.length,
        unread: unreadNotifications
      },
      recentActivity: mc.activities.slice(0, 5)
    });
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get all agents
 */
app.get('/api/agents', (req, res) => {
  try {
    const mc = getMissionControl();

    // Add avatar URLs to each agent
    const agentsWithAvatars = mc.agents.map(agent => {
      let avatarUrl = null;
      const avatarExtensions = ['png', 'jpg', 'svg'];
      for (const ext of avatarExtensions) {
        const avatarPath = path.join(__dirname, 'public', 'avatars', `${agent.id}.${ext}`);
        if (fs.existsSync(avatarPath)) {
          avatarUrl = `/avatars/${agent.id}.${ext}`;
          break;
        }
      }
      return { ...agent, avatarUrl };
    });

    res.json(agentsWithAvatars);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get agent profile/soul
 * Returns the agent's SOUL.md content if available
 */
app.get('/api/agents/:id/soul', (req, res) => {
  try {
    const { id } = req.params;

    // Validate agent ID
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid agent ID' });
    }

    const mc = getMissionControl();
    const agent = mc.agents.find(a => a.id === id);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Map agent IDs to philosopher directory names
    const dirMap = {
      'nietzsche': 'nietzsche',
      'socrates': 'socrates',
      'aristotle': 'aristotle',
      'marcus': 'marcus',
      'heraclitus': 'heraclitus',
      'diogenes': 'diogenes',
      'plato': 'plato',
      'hypatia': 'hypatia',
      'leonardo': 'leonardo',
      'tension': 'tension',
      'human': 'human',
      'athena': 'athena',
      'anne': 'anne'
    };

    const philosopherDir = dirMap[id];
    let soulContent = null;
    let heartbeatContent = null;
    let avatarUrl = null;

    // Check for avatar image (png, jpg, or svg)
    const avatarExtensions = ['png', 'jpg', 'svg'];
    for (const ext of avatarExtensions) {
      const avatarPath = path.join(__dirname, 'public', 'avatars', `${id}.${ext}`);
      if (fs.existsSync(avatarPath)) {
        avatarUrl = `/avatars/${id}.${ext}`;
        break;
      }
    }

    if (philosopherDir) {
      // Try to read SOUL.md
      const soulPath = path.join(PHILOSOPHERS_DIR, philosopherDir, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        soulContent = fs.readFileSync(soulPath, 'utf8');
      }

      // Try to read HEARTBEAT.md for current status
      const heartbeatPath = path.join(PHILOSOPHERS_DIR, philosopherDir, 'HEARTBEAT.md');
      if (fs.existsSync(heartbeatPath)) {
        heartbeatContent = fs.readFileSync(heartbeatPath, 'utf8');
      }
    }

    // Get agent's tasks and metrics
    const agentTasks = mc.tasks.filter(t => t.assigneeIds?.includes(id));
    const activeTasks = agentTasks.filter(t =>
      ['assigned', 'in_progress', 'review'].includes(t.status)
    );
    const completedTasks = agentTasks.filter(t =>
      ['completed', 'shipped'].includes(t.status)
    );

    // Recent activities
    const recentActivities = mc.activities
      .filter(a => a.agentId === id)
      .slice(0, 10);

    res.json({
      agent,
      soul: soulContent,
      heartbeat: heartbeatContent,
      avatarUrl,
      stats: {
        totalTasks: agentTasks.length,
        activeTasks: activeTasks.length,
        completedTasks: completedTasks.length,
        completionRate: agentTasks.length > 0
          ? Math.round((completedTasks.length / agentTasks.length) * 100)
          : 0
      },
      recentActivities
    });
  } catch (error) {
    console.error('Error getting agent soul:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get detailed agent performance metrics
 * Used for optimization dashboard and squad lead
 */
app.get('/api/agents/:id/performance', (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid agent ID' });
    }

    const mc = getMissionControl();
    const agent = mc.agents.find(a => a.id === id);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const now = new Date();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const agentTasks = mc.tasks.filter(t => t.assigneeIds?.includes(id));
    const completedTasks = agentTasks.filter(t => ['completed', 'shipped'].includes(t.status) && t.completedAt);

    // Task completion by period
    const completed24h = completedTasks.filter(t => new Date(t.completedAt) >= dayAgo).length;
    const completed7d = completedTasks.filter(t => new Date(t.completedAt) >= weekAgo).length;
    const completed30d = completedTasks.filter(t => new Date(t.completedAt) >= monthAgo).length;

    // Average completion time (for tasks that have both startedAt and completedAt)
    const tasksWithTiming = completedTasks.filter(t => t.startedAt && t.completedAt);
    let avgCompletionTimeMinutes = 0;
    if (tasksWithTiming.length > 0) {
      const totalMs = tasksWithTiming.reduce((sum, t) => {
        return sum + (new Date(t.completedAt) - new Date(t.startedAt));
      }, 0);
      avgCompletionTimeMinutes = Math.round(totalMs / tasksWithTiming.length / (1000 * 60));
    }

    // Current workload
    const activeTasks = agentTasks.filter(t => ['assigned', 'in_progress', 'review'].includes(t.status));
    const stuckTasks = activeTasks.filter(t => {
      const tracking = calculateTimeInStatus(t);
      return tracking.alertLevel === 'red' || tracking.alertLevel === 'yellow';
    });

    // Workload score (0-100)
    const workloadScore = Math.min(100, activeTasks.length * 20);

    // Trend: compare this week vs last week
    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const lastWeekTasks = completedTasks.filter(t => {
      const d = new Date(t.completedAt);
      return d >= twoWeeksAgo && d < weekAgo;
    }).length;
    const trend = completed7d - lastWeekTasks;

    // Task type breakdown
    const taskTypes = agentTasks.reduce((acc, t) => {
      const type = t.type || 'general';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    res.json({
      agentId: id,
      agentName: agent.name,
      metrics: {
        completed24h,
        completed7d,
        completed30d,
        totalCompleted: completedTasks.length,
        totalAssigned: agentTasks.length,
        avgCompletionTimeMinutes,
        activeTasks: activeTasks.length,
        stuckTasks: stuckTasks.length,
        workloadScore,
        completionRate: agentTasks.length > 0 ? Math.round((completedTasks.length / agentTasks.length) * 100) : 0,
        trend,
        trendLabel: trend > 0 ? 'improving' : trend < 0 ? 'declining' : 'stable'
      },
      taskTypes,
      activeTasks: activeTasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.metadata?.priority || 'medium',
        timeInStatus: calculateTimeInStatus(t)
      }))
    });
  } catch (error) {
    console.error('Error getting agent performance:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get all agents with performance summary
 */
app.get('/api/agents/performance/summary', (req, res) => {
  try {
    const mc = getMissionControl();
    const now = new Date();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const summary = mc.agents
      .filter(a => a.id !== 'human')
      .map(agent => {
        const agentTasks = mc.tasks.filter(t => t.assigneeIds?.includes(agent.id));
        const completedTasks = agentTasks.filter(t => ['completed', 'shipped'].includes(t.status) && t.completedAt);
        const activeTasks = agentTasks.filter(t => ['assigned', 'in_progress', 'review'].includes(t.status));
        const completed7d = completedTasks.filter(t => new Date(t.completedAt) >= weekAgo).length;

        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          active: activeTasks.length,
          completed7d,
          totalCompleted: completedTasks.length,
          workloadScore: Math.min(100, activeTasks.length * 20)
        };
      })
      .sort((a, b) => b.completed7d - a.completed7d);

    res.json({ agents: summary, timestamp: now.toISOString() });
  } catch (error) {
    console.error('Error getting performance summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Calculate time in current status and alert level
 */
function calculateTimeInStatus(task) {
  const now = new Date();
  let statusStartTime = null;
  let statusLabel = task.status;
  
  // Determine when current status started
  if (task.status === 'assigned' && task.createdAt) {
    statusStartTime = new Date(task.createdAt);
  } else if (task.status === 'in_progress' && task.startedAt) {
    statusStartTime = new Date(task.startedAt);
  } else if (task.status === 'review' && task.completedAt) {
    statusStartTime = new Date(task.completedAt);
  } else if (task.status === 'completed' || task.status === 'shipped') {
    // No tracking for completed tasks
    return {
      timeInStatusMs: 0,
      timeInStatusHuman: '—',
      alertLevel: 'none'
    };
  }
  
  if (!statusStartTime) {
    return {
      timeInStatusMs: 0,
      timeInStatusHuman: 'unknown',
      alertLevel: 'none'
    };
  }
  
  const msInStatus = now - statusStartTime;
  const hoursInStatus = msInStatus / (1000 * 60 * 60);
  
  // Dynamic thresholds based on task estimate (in hours)
  const estimatedMs = task.metadata?.estimatedMinutes
    ? task.metadata.estimatedMinutes * 60 * 1000
    : null;

  const thresholds = estimatedMs ? {
    assigned: { yellow: Math.max(15 * 60 * 1000, estimatedMs * 0.5) / 3600000, red: Math.max(30 * 60 * 1000, estimatedMs) / 3600000 },
    in_progress: { yellow: Math.max(15 * 60 * 1000, estimatedMs * 1.5) / 3600000, red: Math.max(30 * 60 * 1000, estimatedMs * 2.5) / 3600000 },
    review: { yellow: 2, red: 4 }
  } : {
    assigned: { yellow: 3, red: 6 },
    in_progress: { yellow: 4, red: 8 },
    review: { yellow: 2, red: 4 }
  };
  
  const threshold = thresholds[task.status];
  let alertLevel = 'none';
  
  if (threshold) {
    if (hoursInStatus >= threshold.red) {
      alertLevel = 'red';
    } else if (hoursInStatus >= threshold.yellow) {
      alertLevel = 'yellow';
    }
  }
  
  // Human-readable time
  let timeHuman;
  if (hoursInStatus < 1) {
    const minutes = Math.floor(msInStatus / (1000 * 60));
    timeHuman = `${minutes}m`;
  } else if (hoursInStatus < 24) {
    const hours = Math.floor(hoursInStatus);
    const minutes = Math.floor((hoursInStatus - hours) * 60);
    timeHuman = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  } else {
    const days = Math.floor(hoursInStatus / 24);
    const hours = Math.floor(hoursInStatus % 24);
    timeHuman = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  
  return {
    timeInStatusMs: msInStatus,
    timeInStatusHuman: timeHuman,
    alertLevel,
    statusStartTime: statusStartTime.toISOString()
  };
}

/**
 * Sync the weekly idea batch task status based on idea count vs goal.
 * Auto-completes when weekly goal is met. Returns true if data was changed.
 */
function syncWeeklyIdeaTask(data) {
  const task = data.tasks.find(t =>
    t.metadata?.recurring === 'weekly' &&
    t.title.toLowerCase().includes('idea') &&
    (t.title.toLowerCase().includes('batch') || t.title.toLowerCase().includes('weekly'))
  );
  if (!task) return false;

  // Count this week's ideas (Monday = start of week)
  const ideas = parseIdeasBank();
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((day + 6) % 7)); // Monday
  startOfWeek.setHours(0, 0, 0, 0);
  const weekStart = startOfWeek.toISOString().split('T')[0];
  const thisWeekIdeas = ideas.filter(i => i.date && i.date >= weekStart);

  const goal = task.metadata?.weeklyGoal || 4;
  const progress = thisWeekIdeas.length;
  let changed = false;

  if (progress >= goal && task.status !== 'completed') {
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.completedBy = 'system';
    task.metadata.ideasThisWeek = progress;
    changed = true;
  }

  // Always keep the count in metadata up to date
  if (task.metadata.ideasThisWeek !== progress) {
    task.metadata.ideasThisWeek = progress;
    changed = true;
  }

  return changed;
}

/**
 * Record a completed step's duration to stepDurations history
 */
function recordStepDuration(data, step, taskId) {
  if (!step.startedAt || !step.completedAt) return;

  const durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
  if (durationMs <= 0) return;

  // Skip instant/trivial steps
  const desc = (step.description || '').trim().toLowerCase();
  if (desc === 'dispatched') return;

  if (!data.stepDurations) data.stepDurations = [];

  data.stepDurations.push({
    description: desc,
    durationMs,
    taskId,
    completedAt: step.completedAt
  });

  // Cap at 500 entries (drop oldest)
  if (data.stepDurations.length > 500) {
    data.stepDurations = data.stepDurations.slice(-500);
  }
}

/**
 * Compute average durations grouped by normalized step description
 */
function getStepAverages(data) {
  const durations = data.stepDurations || [];
  const groups = {};

  durations.forEach(entry => {
    const key = entry.description;
    if (!groups[key]) groups[key] = [];
    groups[key].push(entry.durationMs);
  });

  const averages = {};
  for (const [key, values] of Object.entries(groups)) {
    const sum = values.reduce((a, b) => a + b, 0);
    averages[key] = {
      avg: Math.round(sum / values.length),
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length
    };
  }

  return averages;
}

// Valid filter values
const VALID_STATUSES = ['pending', 'assigned', 'in_progress', 'review', 'completed', 'shipped', 'blocked', 'deferred'];
const VALID_TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'];
const MAX_FILTER_LENGTH = 100;

/**
 * Validate a query parameter (string, reasonable length, no special chars)
 */
function isValidFilter(value) {
  return typeof value === 'string' && value.length <= MAX_FILTER_LENGTH && /^[a-zA-Z0-9_-]+$/.test(value);
}

/**
 * Get tasks (with optional filters)
 */
app.get('/api/tasks', (req, res) => {
  try {
    const mc = getMissionControl();

    // Sync weekly idea task status before returning
    if (syncWeeklyIdeaTask(mc)) {
      fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
      cache.missionControl = null;
    }

    let tasks = mc.tasks;

    // Filter by status (validate against whitelist)
    if (req.query.status) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      tasks = tasks.filter(t => t.status === req.query.status);
    }

    // Filter by assignee (validate format)
    if (req.query.assignee) {
      if (!isValidFilter(req.query.assignee)) {
        return res.status(400).json({ error: 'Invalid assignee filter' });
      }
      tasks = tasks.filter(t => t.assigneeIds.includes(req.query.assignee));
    }

    // Filter by reviewer (validate format)
    if (req.query.reviewer) {
      if (!isValidFilter(req.query.reviewer)) {
        return res.status(400).json({ error: 'Invalid reviewer filter' });
      }
      tasks = tasks.filter(t => t.reviewerIds.includes(req.query.reviewer));
    }
    
    // Compute step averages once for all tasks
    const stepAverages = getStepAverages(mc);

    // Add time-in-status calculation and step averages to each task
    tasks = tasks.map(task => ({
      ...task,
      timeTracking: calculateTimeInStatus(task),
      _stepAverages: stepAverages
    }));

    res.json(tasks);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get single task by ID
 */
app.get('/api/tasks/:id', (req, res) => {
  try {
    const mc = getMissionControl();
    const task = mc.tasks.find(t => t.id === req.params.id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Add time-in-status calculation and step averages
    const taskWithTracking = {
      ...task,
      timeTracking: calculateTimeInStatus(task),
      _stepAverages: getStepAverages(mc)
    };

    res.json(taskWithTracking);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create a new task
 */
app.post('/api/tasks', (req, res) => {
  try {
    const { title, description, assigneeIds, status, llm, rationale, reviewerIds, metadata, createdBy } = req.body;

    // ── Required field validation ──
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'title is required and must be a non-empty string' });
    }
    if (title.length > 500) {
      return res.status(400).json({ error: 'title must be 500 characters or fewer' });
    }

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({ error: 'description is required and must be a non-empty string' });
    }
    if (description.length > 50000) {
      return res.status(400).json({ error: 'description must be 50000 characters or fewer' });
    }

    if (!assigneeIds || !Array.isArray(assigneeIds) || assigneeIds.length === 0) {
      return res.status(400).json({ error: 'assigneeIds is required and must be a non-empty array of agent IDs' });
    }
    // Validate each assignee is a safe string
    for (const aid of assigneeIds) {
      if (typeof aid !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(aid)) {
        return res.status(400).json({ error: `Invalid assigneeId: "${aid}". Must be alphanumeric/hyphens/underscores, 1-50 chars.` });
      }
    }

    // ── Optional field validation ──
    const taskStatus = status || 'pending';
    if (!VALID_STATUSES.includes(taskStatus)) {
      return res.status(400).json({ error: `Invalid status "${taskStatus}". Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const validLlms = ['sonnet', 'haiku', 'opus', 'ollama'];
    if (llm !== undefined && llm !== null && !validLlms.includes(llm)) {
      return res.status(400).json({ error: `Invalid llm "${llm}". Must be one of: ${validLlms.join(', ')} (or null)` });
    }

    if (rationale !== undefined && typeof rationale !== 'string') {
      return res.status(400).json({ error: 'rationale must be a string' });
    }

    if (reviewerIds !== undefined) {
      if (!Array.isArray(reviewerIds)) {
        return res.status(400).json({ error: 'reviewerIds must be an array' });
      }
      for (const rid of reviewerIds) {
        if (typeof rid !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(rid)) {
          return res.status(400).json({ error: `Invalid reviewerId: "${rid}"` });
        }
      }
    }

    if (metadata !== undefined && (typeof metadata !== 'object' || Array.isArray(metadata) || metadata === null)) {
      return res.status(400).json({ error: 'metadata must be a plain object' });
    }

    // Validate metadata.priority if provided
    if (metadata?.priority && !VALID_TASK_PRIORITIES.includes(metadata.priority)) {
      return res.status(400).json({ error: `Invalid metadata.priority "${metadata.priority}". Must be one of: ${VALID_TASK_PRIORITIES.join(', ')}` });
    }

    const creator = createdBy || 'system';
    if (typeof creator !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(creator)) {
      return res.status(400).json({ error: 'Invalid createdBy value' });
    }

    // ── Generate next task ID ──
    const data = getMissionControl();
    let maxNum = 0;
    for (const t of data.tasks) {
      const match = t.id.match(/^task-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    const nextNum = maxNum + 1;
    const newId = `task-${String(nextNum).padStart(3, '0')}`;

    // ── Build task object ──
    const now = new Date().toISOString();
    const newTask = {
      id: newId,
      title: title.trim(),
      description: description.trim(),
      status: taskStatus,
      assigneeIds,
      createdBy: creator,
      createdAt: now,
      llm: llm !== undefined ? llm : null,
      rationale: rationale || '',
      reviewerIds: reviewerIds || [],
      metadata: metadata || {}
    };

    // Set startedAt if status implies work has begun
    if (['in_progress', 'review'].includes(taskStatus)) {
      newTask.startedAt = now;
    }

    // ── Persist ──
    data.tasks.push(newTask);

    // Log activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'task_created',
      agentId: creator,
      taskId: newId,
      timestamp: now,
      description: `Created task: ${newTask.title}`,
      metadata: {
        assigneeIds,
        status: taskStatus,
        priority: metadata?.priority || null
      }
    });

    // Create notification for assignees
    data.notifications.unshift({
      id: `notif-${Date.now()}`,
      type: 'task_assigned',
      title: 'New Task Assigned',
      message: `**${newTask.title}**\n\nAssigned to: ${assigneeIds.join(', ')}\nPriority: ${metadata?.priority || 'not set'}\n\n${description.substring(0, 200)}${description.length > 200 ? '...' : ''}`,
      read: false,
      createdAt: now,
      metadata: {
        taskId: newId,
        assigneeIds,
        createdBy: creator
      }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    // Return the task with time tracking
    res.status(201).json({
      success: true,
      task: {
        ...newTask,
        timeTracking: calculateTimeInStatus(newTask)
      }
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

/**
 * Get step duration averages (debugging/dashboard)
 */
app.get('/api/step-averages', (req, res) => {
  try {
    const mc = getMissionControl();
    res.json(getStepAverages(mc));
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get activity feed (paginated)
 */
app.get('/api/activities', (req, res) => {
  try {
    const mc = getMissionControl();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));

    const start = (page - 1) * limit;
    const end = start + limit;

    const activities = mc.activities.slice(start, end);
    
    res.json({
      activities,
      pagination: {
        page,
        limit,
        total: mc.activities.length,
        pages: Math.ceil(mc.activities.length / limit)
      }
    });
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Update task status
 */
app.patch('/api/tasks/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate task ID
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    // Validate status
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const oldStatus = task.status;
    task.status = status;

    // Set timestamps based on status change
    if (status === 'completed' || status === 'shipped') {
      task.completedAt = new Date().toISOString();
    } else if (oldStatus === 'completed' || oldStatus === 'shipped') {
      // Reopening
      task.reopenedAt = new Date().toISOString();
      delete task.completedAt;
    }

    // Log activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'status_changed',
      agentId: 'human',
      taskId: id,
      timestamp: new Date().toISOString(),
      description: `Status changed: ${task.title} (${oldStatus} → ${status})`,
      metadata: { oldStatus, newStatus: status }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error updating task status:', error);
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

/**
 * Delete a task permanently
 */
app.delete('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const data = getMissionControl();
    const taskIndex = data.tasks.findIndex(t => t.id === id);

    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = data.tasks[taskIndex];
    data.tasks.splice(taskIndex, 1);

    // Log activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'task_deleted',
      agentId: 'human',
      taskId: id,
      timestamp: new Date().toISOString(),
      description: `Task deleted: ${task.title}`,
      metadata: { deletedTask: { id: task.id, title: task.title, status: task.status } }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, deleted: task.id });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

/**
 * Complete a task (for human tasks)
 */
app.post('/api/tasks/:id/complete', (req, res) => {
  try {
    const { id } = req.params;
    let { completedBy } = req.body;

    // Validate task ID format
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    // Validate completedBy - only allow alphanumeric, hyphens, underscores
    if (completedBy && (typeof completedBy !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(completedBy))) {
      return res.status(400).json({ error: 'Invalid completedBy value' });
    }
    completedBy = completedBy || 'human';

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Update task status
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.completedBy = completedBy;

    // Add activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'task_completed',
      agentId: completedBy || 'human',
      taskId: id,
      timestamp: new Date().toISOString(),
      description: `Completed: ${task.title}`,
      metadata: {
        completedBy: completedBy || 'human'
      }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

/**
 * Reopen a completed task (undo completion)
 */
app.post('/api/tasks/:id/reopen', (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Validate task ID format
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status !== 'completed' && task.status !== 'shipped') {
      return res.status(400).json({ error: 'Task is not completed' });
    }

    // Store previous status info
    const previousCompletedAt = task.completedAt;
    const previousCompletedBy = task.completedBy;

    // Reopen task - set back to assigned status
    task.status = 'assigned';
    task.reopenedAt = new Date().toISOString();
    delete task.completedAt;
    delete task.completedBy;

    // Add activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'task_reopened',
      agentId: 'human',
      taskId: id,
      timestamp: new Date().toISOString(),
      description: `Reopened: ${task.title}`,
      metadata: {
        previousCompletedAt,
        previousCompletedBy,
        reason: reason || 'Marked as undone'
      }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error reopening task:', error);
    res.status(500).json({ error: 'Failed to reopen task' });
  }
});

/**
 * Record actual LLM used for a task
 */
const VALID_LLMS = ['ollama', 'haiku', 'sonnet', 'opus'];

app.post('/api/tasks/:id/actual-llm', (req, res) => {
  try {
    const { id } = req.params;
    const { actualLLM } = req.body;

    // Validate task ID
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    // Validate LLM value
    if (!actualLLM || !VALID_LLMS.includes(actualLLM.toLowerCase())) {
      return res.status(400).json({ error: `Invalid LLM. Must be one of: ${VALID_LLMS.join(', ')}` });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Record actual LLM in metadata
    if (!task.metadata) task.metadata = {};
    task.metadata.actualLLM = actualLLM.toLowerCase();
    task.metadata.actualLLMRecordedAt = new Date().toISOString();

    // Check for mismatch and add activity
    const hasMismatch = task.llm && task.llm !== actualLLM.toLowerCase();
    if (hasMismatch) {
      data.activities.unshift({
        id: `activity-${Date.now()}`,
        type: 'llm_mismatch',
        agentId: 'system',
        taskId: id,
        timestamp: new Date().toISOString(),
        description: `LLM mismatch on "${task.title}": predicted ${task.llm}, actual ${actualLLM.toLowerCase()}`,
        metadata: {
          predictedLLM: task.llm,
          actualLLM: actualLLM.toLowerCase()
        }
      });
    }

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({
      success: true,
      task,
      mismatch: hasMismatch,
      message: hasMismatch
        ? `Mismatch detected: predicted ${task.llm}, actual ${actualLLM.toLowerCase()}`
        : 'Actual LLM recorded successfully'
    });
  } catch (error) {
    console.error('Error recording actual LLM:', error);
    res.status(500).json({ error: 'Failed to record actual LLM' });
  }
});

/**
 * Get LLM prediction accuracy stats
 */
app.get('/api/llm-stats', (req, res) => {
  try {
    const mc = getMissionControl();

    const tasksWithPredictions = mc.tasks.filter(t =>
      t.llm && (t.status === 'completed' || t.status === 'shipped')
    );

    const tasksWithActual = tasksWithPredictions.filter(t => t.metadata?.actualLLM);
    const matches = tasksWithActual.filter(t => t.llm === t.metadata.actualLLM);
    const mismatches = tasksWithActual.filter(t => t.llm !== t.metadata.actualLLM);

    res.json({
      totalPredicted: tasksWithPredictions.length,
      totalWithActual: tasksWithActual.length,
      matches: matches.length,
      mismatches: mismatches.length,
      accuracy: tasksWithActual.length > 0
        ? Math.round((matches.length / tasksWithActual.length) * 100)
        : 0,
      mismatchDetails: mismatches.map(t => ({
        id: t.id,
        title: t.title,
        predictedLLM: t.llm,
        actualLLM: t.metadata.actualLLM,
        assignees: t.assigneeIds
      }))
    });
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POSTING QUEUE
// ============================================================================

// ============================================================================
// BLUESKY SERVICE
// ============================================================================

let bskyAgent = null;

async function getBskyAgent() {
  if (bskyAgent) return bskyAgent;
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) throw new Error('Bluesky credentials not configured');

  bskyAgent = new BskyAgent({ service: 'https://bsky.social' });
  await bskyAgent.login({ identifier: handle, password });
  console.log(`[Bluesky] Connected as ${handle}`);
  return bskyAgent;
}

async function postToBluesky(text) {
  const agent = await getBskyAgent();
  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  const result = await agent.post({
    text: rt.text,
    facets: rt.facets,
    createdAt: new Date().toISOString()
  });
  const rkey = result.uri.split('/').pop();
  const postUrl = `https://bsky.app/profile/${process.env.BLUESKY_HANDLE}/post/${rkey}`;
  return { uri: result.uri, cid: result.cid, postUrl };
}

const POSTING_QUEUE_FILE = path.join(BASE_DIR, 'content', 'queue', 'posting-queue.json');

function getPostingQueue() {
  try {
    if (fs.existsSync(POSTING_QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(POSTING_QUEUE_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading posting queue:', err);
  }
  return { queue: [], posted: [], settings: {} };
}

function savePostingQueue(data) {
  fs.writeFileSync(POSTING_QUEUE_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get posting queue with rate limit status
 */
app.get('/api/posting-queue', (req, res) => {
  try {
    const queue = getPostingQueue();
    const settings = queue.settings || {};
    const posted = queue.posted || [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Count posts per platform today
    const postsToday = {
      instagram: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'instagram').length,
      threads: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'threads').length,
      bluesky: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'bluesky').length,
      twitter: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'twitter').length,
      reddit: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'reddit').length,
      medium: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'medium').length,
      substack: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'substack').length,
      podcast: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'podcast').length
    };

    // Check rate limits
    const instagramSettings = settings.platforms?.instagram || { maxPostsPerDay: 2 };
    const threadsSettings = settings.platforms?.threads || { maxPostsPerDay: 3 };
    const blueskySettings = settings.platforms?.bluesky || { maxPostsPerDay: 5 };
    const twitterSettings = settings.platforms?.twitter || { maxPostsPerDay: 5 };
    const redditSettings = settings.platforms?.reddit || { maxPostsPerDay: 3 };
    const mediumSettings = settings.platforms?.medium || { maxPostsPerDay: 1 };
    const substackSettings = settings.platforms?.substack || { maxPostsPerDay: 1 };
    const podcastSettings = settings.platforms?.podcast || { maxPostsPerDay: 1 };

    res.json({
      ...queue,
      postsToday,
      canPostInstagram: postsToday.instagram < instagramSettings.maxPostsPerDay,
      canPostThreads: postsToday.threads < threadsSettings.maxPostsPerDay,
      canPostBluesky: postsToday.bluesky < blueskySettings.maxPostsPerDay,
      canPostTwitter: postsToday.twitter < twitterSettings.maxPostsPerDay,
      canPostReddit: postsToday.reddit < redditSettings.maxPostsPerDay,
      canPostMedium: postsToday.medium < mediumSettings.maxPostsPerDay,
      canPostSubstack: postsToday.substack < substackSettings.maxPostsPerDay,
      canPostPodcast: postsToday.podcast < podcastSettings.maxPostsPerDay
    });
  } catch (error) {
    console.error('Error getting posting queue:', error);
    res.status(500).json({ error: 'Failed to get posting queue' });
  }
});

/**
 * Add item to posting queue
 */
app.post('/api/posting-queue', (req, res) => {
  try {
    const queue = getPostingQueue();
    const { platform, content, caption, parts, canvaComplete, scheduledFor, metadata, postUrl, createdBy, taskId } = req.body;

    // Validate required fields
    if (!platform || !['instagram', 'threads', 'bluesky', 'twitter', 'reddit', 'medium'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    // Validate scheduledFor if provided
    if (scheduledFor !== undefined && scheduledFor !== null) {
      const d = new Date(scheduledFor);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduledFor date' });
      }
    }

    const item = {
      id: `post-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: scheduledFor ? 'scheduled' : 'ready',
      platform,
      content: content || '',
      caption: caption || '',
      parts: Array.isArray(parts) ? parts : [],
      canvaComplete: canvaComplete === true
    };

    if (metadata) item.metadata = metadata;
    if (postUrl) item.postUrl = postUrl;
    if (createdBy) item.createdBy = createdBy;
    if (taskId) item.taskId = taskId;

    if (scheduledFor) {
      item.scheduledFor = new Date(scheduledFor).toISOString();
    }

    queue.queue.push(item);
    savePostingQueue(queue);

    res.json({ success: true, item });
  } catch (error) {
    console.error('Error adding to posting queue:', error);
    res.status(500).json({ error: 'Failed to add to posting queue' });
  }
});

/**
 * Update posting queue item
 */
app.patch('/api/posting-queue/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queue = getPostingQueue();
    const item = queue.queue.find(i => i.id === id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Update allowed fields
    const allowedFields = ['canvaComplete', 'status', 'content', 'caption', 'parts', 'selectedOption', 'tags', 'subreddit', 'createdBy'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        item[field] = req.body[field];
      }
    }

    // Handle scheduledFor separately
    if (req.body.scheduledFor !== undefined) {
      if (req.body.scheduledFor === null) {
        delete item.scheduledFor;
        if (item.status === 'scheduled') {
          item.status = 'ready';
        }
      } else {
        const d = new Date(req.body.scheduledFor);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ error: 'Invalid scheduledFor date' });
        }
        item.scheduledFor = d.toISOString();
        item.status = 'scheduled';
      }
    }

    savePostingQueue(queue);
    res.json({ success: true, item });
  } catch (error) {
    console.error('Error updating posting queue item:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

/**
 * Get calendar view of scheduled and posted items
 * Query params: start (ISO date), end (ISO date)
 */
app.get('/api/calendar', (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end query params required' });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const startStr = start.split('T')[0];
    const endStr = end.split('T')[0];
    const queue = getPostingQueue();
    const byDate = {};
    const unscheduled = [];

    // Process queue items
    for (const item of (queue.queue || [])) {
      if (item.scheduledFor) {
        const dateKey = item.scheduledFor.split('T')[0];
        if (dateKey >= startStr && dateKey <= endStr) {
          if (!byDate[dateKey]) byDate[dateKey] = [];
          byDate[dateKey].push({ ...item, _source: 'queue' });
        }
      } else {
        unscheduled.push({ ...item, _source: 'queue' });
      }
    }

    // Process posted items
    for (const item of (queue.posted || [])) {
      if (item.postedAt) {
        const dateKey = item.postedAt.split('T')[0];
        if (dateKey >= startStr && dateKey <= endStr) {
          if (!byDate[dateKey]) byDate[dateKey] = [];
          byDate[dateKey].push({ ...item, _source: 'posted' });
        }
      }
    }

    // Sort items within each date by time
    for (const dateKey of Object.keys(byDate)) {
      byDate[dateKey].sort((a, b) => {
        const timeA = a.scheduledFor || a.postedAt || '';
        const timeB = b.scheduledFor || b.postedAt || '';
        return timeA.localeCompare(timeB);
      });
    }

    res.json({ byDate, unscheduled });
  } catch (error) {
    console.error('Error getting calendar:', error);
    res.status(500).json({ error: 'Failed to get calendar data' });
  }
});

/**
 * Outreach Analytics - aggregated view of Twitter outreach effectiveness
 */
app.get('/api/outreach-analytics', (req, res) => {
  try {
    const TWITTER_OUTREACH_DIR = path.join(BASE_DIR, 'twitter-outreach');

    // Time slot from UTC hour
    function getTimeSlot(dateStr) {
      if (!dateStr) return null;
      const hour = new Date(dateStr).getUTCHours();
      if (hour >= 5 && hour <= 11) return 'morning';
      if (hour >= 12 && hour <= 16) return 'afternoon';
      if (hour >= 17 && hour <= 20) return 'evening';
      return 'night';
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Read outreach JSON files
    let outreachFiles = [];
    if (fs.existsSync(TWITTER_OUTREACH_DIR)) {
      outreachFiles = fs.readdirSync(TWITTER_OUTREACH_DIR)
        .filter(f => f.endsWith('.json'))
        .sort();
    }

    const allTargets = [];
    const byDay = [];
    const heatmap = {
      morning:   { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 },
      afternoon: { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 },
      evening:   { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 },
      night:     { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 }
    };
    const themeCounts = {};

    for (const file of outreachFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(TWITTER_OUTREACH_DIR, file), 'utf-8'));
        const date = data.date;
        const dateObj = new Date(date + 'T12:00:00Z');
        const label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const users = data.users || [];

        let dayFollowBacks = 0;
        let dayReplies = 0;
        let dayTimeSlot = null;

        for (const user of users) {
          const theme = extractTheme(user.reason);
          const timeSlot = getTimeSlot(user.commentedAt);
          if (!dayTimeSlot && timeSlot) dayTimeSlot = timeSlot;

          if (user.followedBack) dayFollowBacks++;
          if (user.replied) dayReplies++;

          // Heatmap
          if (timeSlot && user.commentedAt) {
            const dayOfWeek = dayNames[new Date(user.commentedAt).getUTCDay()];
            heatmap[timeSlot][dayOfWeek]++;
          }

          // Theme aggregation
          if (!themeCounts[theme]) {
            themeCounts[theme] = { theme, count: 0, replies: 0, followBacks: 0 };
          }
          themeCounts[theme].count++;
          if (user.replied) themeCounts[theme].replies++;
          if (user.followedBack) themeCounts[theme].followBacks++;

          allTargets.push({
            username: user.username,
            date,
            theme,
            replied: !!user.replied,
            followedBack: !!user.followedBack,
            commentedAt: user.commentedAt || null,
            reason: user.reason || ''
          });
        }

        byDay.push({
          date,
          label,
          targets: users.length,
          followBacks: dayFollowBacks,
          replies: dayReplies,
          timeSlot: dayTimeSlot
        });
      } catch (e) {
        // Skip malformed files
      }
    }

    // Theme array with reply rates
    const themes = Object.values(themeCounts)
      .map(t => ({ ...t, replyRate: t.count > 0 ? Math.round((t.replies / t.count) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    // Read engagement inbox
    let engagement = { bluesky: [], twitter: [] };
    try {
      const inbox = JSON.parse(fs.readFileSync(ENGAGEMENT_INBOX_FILE, 'utf-8'));
      engagement.bluesky = (inbox.bluesky?.items || []).map(item => ({
        author: item.authorHandle || item.authorDisplayName,
        text: item.postText,
        status: item.status,
        indexedAt: item.indexedAt,
        postUrl: item.postUrl
      }));
      engagement.twitter = (inbox.twitter?.items || []).map(item => ({
        author: item.authorHandle || item.authorDisplayName,
        text: item.postText,
        status: item.status,
        indexedAt: item.indexedAt,
        postUrl: item.postUrl
      }));
    } catch (e) {
      // No engagement data
    }

    const totalTargets = allTargets.length;
    const totalFollowBacks = allTargets.filter(t => t.followedBack).length;
    const totalReplies = allTargets.filter(t => t.replied).length;

    const summary = {
      totalTargets,
      followBackRate: totalTargets > 0 ? Math.round((totalFollowBacks / totalTargets) * 100) : 0,
      replyRate: totalTargets > 0 ? Math.round((totalReplies / totalTargets) * 100) : 0,
      totalDays: byDay.length,
      avgTargetsPerDay: byDay.length > 0 ? Math.round(totalTargets / byDay.length) : 0,
      blueskyEngagement: engagement.bluesky.length
    };

    // Sort targets newest first
    allTargets.sort((a, b) => b.date.localeCompare(a.date));

    res.json({ summary, byDay, heatmap, themes, targets: allTargets, engagement });
  } catch (error) {
    console.error('Error getting outreach analytics:', error);
    res.status(500).json({ error: 'Failed to get outreach analytics' });
  }
});

// ============================================================================
// AUDIENCE SEGMENTATION
// ============================================================================

function getAudienceSegments() {
  if (cache.audienceSegments) return cache.audienceSegments;
  try {
    if (fs.existsSync(AUDIENCE_SEGMENTS_FILE)) {
      cache.audienceSegments = JSON.parse(fs.readFileSync(AUDIENCE_SEGMENTS_FILE, 'utf8'));
      return cache.audienceSegments;
    }
  } catch (err) {
    console.error('Error reading audience segments:', err);
  }
  return { segments: [], snapshots: [], lastComputed: null, computeVersion: 1 };
}

function saveAudienceSegments(data) {
  fs.writeFileSync(AUDIENCE_SEGMENTS_FILE, JSON.stringify(data, null, 2));
  cache.audienceSegments = null;
}

function computeSegments() {
  const TWITTER_OUTREACH_DIR = path.join(BASE_DIR, 'twitter-outreach');
  const people = {}; // keyed by username

  // 1. Build person registry from twitter outreach files
  if (fs.existsSync(TWITTER_OUTREACH_DIR)) {
    const files = fs.readdirSync(TWITTER_OUTREACH_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(TWITTER_OUTREACH_DIR, file), 'utf-8'));
        for (const user of (data.users || [])) {
          const key = (user.username || '').toLowerCase().replace(/^@/, '');
          if (!key) continue;
          if (!people[key]) {
            people[key] = {
              username: user.username,
              source: 'outreach',
              themes: [],
              replied: false,
              followedBack: false,
              platform: 'twitter',
              firstSeen: data.date
            };
          }
          if (user.reason) people[key].themes.push(user.reason);
          if (user.replied) people[key].replied = true;
          if (user.followedBack) people[key].followedBack = true;
        }
      } catch (e) { /* skip malformed */ }
    }
  }

  // 2. Add people from engagement inbox (organic)
  try {
    if (fs.existsSync(ENGAGEMENT_INBOX_FILE)) {
      const inbox = JSON.parse(fs.readFileSync(ENGAGEMENT_INBOX_FILE, 'utf-8'));
      for (const platform of ['bluesky', 'twitter']) {
        const items = inbox[platform]?.items || [];
        for (const item of items) {
          const handle = (item.authorHandle || '').toLowerCase().replace(/^@/, '');
          if (!handle) continue;
          if (!people[handle]) {
            people[handle] = {
              username: '@' + handle,
              source: 'organic',
              themes: [],
              replied: true, // they engaged with us
              followedBack: false,
              platform,
              firstSeen: item.indexedAt || item.scannedAt
            };
          } else {
            // Existing person also found organically — mark as replied
            people[handle].replied = true;
          }
          if (item.postText) people[handle].themes.push(item.postText);
        }
      }
    }
  } catch (e) { /* skip */ }

  // 3. Add people from comment queue (targets we've commented on)
  try {
    if (fs.existsSync(COMMENT_QUEUE_FILE)) {
      const cq = JSON.parse(fs.readFileSync(COMMENT_QUEUE_FILE, 'utf-8'));
      for (const item of [...(cq.queue || []), ...(cq.posted || [])]) {
        const handle = (item.targetAuthor || '').toLowerCase().replace(/^@/, '');
        if (!handle) continue;
        if (!people[handle]) {
          people[handle] = {
            username: '@' + handle,
            source: 'outreach',
            themes: [],
            replied: false,
            followedBack: false,
            platform: item.platform || 'bluesky',
            firstSeen: item.createdAt
          };
        }
        if (item.targetText) people[handle].themes.push(item.targetText);
      }
    }
  } catch (e) { /* skip */ }

  // 4. Assign primary theme and behavior type to each person
  const personList = Object.values(people).map(p => {
    // Primary theme from most common theme keyword
    const allText = p.themes.join(' ');
    const theme = extractTheme(allText);

    // Behavior classification
    let behavior;
    if (p.source === 'organic') {
      behavior = 'organic';
    } else if (p.replied && p.followedBack) {
      behavior = 'active_engager';
    } else if (p.followedBack) {
      behavior = 'silent_follower';
    } else {
      behavior = 'prospect';
    }

    return {
      username: p.username,
      theme,
      behavior,
      platform: p.platform,
      source: p.source,
      firstSeen: p.firstSeen
    };
  });

  // 5. Group into theme segments
  const themeColors = {
    'Religion & Ethics': '#8B5CF6',
    'Polarity & Paradox': '#D4A574',
    'Identity & Meaning': '#3B82F6',
    'Movement & Stillness': '#10B981',
    'Creative Expression': '#F59E0B',
    'Practical Wisdom': '#EF4444',
    'Philosophy (General)': '#6B7280'
  };

  const segmentMap = {};
  for (const person of personList) {
    if (!segmentMap[person.theme]) {
      segmentMap[person.theme] = {
        theme: person.theme,
        color: themeColors[person.theme] || '#6B7280',
        members: [],
        activeCount: 0
      };
    }
    segmentMap[person.theme].members.push(person);
    if (person.behavior === 'active_engager' || person.behavior === 'organic') {
      segmentMap[person.theme].activeCount++;
    }
  }

  const segments = Object.values(segmentMap).map(seg => ({
    theme: seg.theme,
    color: seg.color,
    memberCount: seg.members.length,
    activeCount: seg.activeCount,
    engagementRate: seg.members.length > 0 ? Math.round((seg.activeCount / seg.members.length) * 100) : 0,
    members: seg.members
  })).sort((a, b) => b.memberCount - a.memberCount);

  // 6. Behavior breakdown
  const behaviorCounts = { active_engager: 0, silent_follower: 0, prospect: 0, organic: 0 };
  for (const p of personList) {
    behaviorCounts[p.behavior] = (behaviorCounts[p.behavior] || 0) + 1;
  }

  return {
    segments,
    behaviorCounts,
    totalPeople: personList.length,
    activeSegments: segments.filter(s => s.memberCount > 0).length,
    overallEngagementRate: personList.length > 0
      ? Math.round((personList.filter(p => p.behavior === 'active_engager' || p.behavior === 'organic').length / personList.length) * 100)
      : 0,
    topTheme: segments[0]?.theme || 'None'
  };
}

/**
 * GET /api/audience-segments — live-computed segments + persisted snapshots + recommendations
 */
app.get('/api/audience-segments', (req, res) => {
  try {
    const computed = computeSegments();
    const persisted = getAudienceSegments();

    res.json({
      ...computed,
      snapshots: persisted.snapshots || [],
      recommendations: persisted.recommendations || [],
      lastComputed: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error computing audience segments:', error);
    res.status(500).json({ error: 'Failed to compute audience segments' });
  }
});

/**
 * POST /api/audience-segments/snapshot — persist current state, optionally generate Haiku recommendations
 */
app.post('/api/audience-segments/snapshot', async (req, res) => {
  try {
    const { generateRecommendations } = req.body || {};
    const computed = computeSegments();
    const persisted = getAudienceSegments();

    const snapshot = {
      id: `snap-${Date.now()}`,
      takenAt: new Date().toISOString(),
      totalPeople: computed.totalPeople,
      activeSegments: computed.activeSegments,
      overallEngagementRate: computed.overallEngagementRate,
      segments: computed.segments.map(s => ({
        theme: s.theme,
        memberCount: s.memberCount,
        activeCount: s.activeCount,
        engagementRate: s.engagementRate
      }))
    };

    persisted.snapshots = persisted.snapshots || [];
    persisted.snapshots.push(snapshot);
    // Cap at 52 snapshots (one year of weekly)
    if (persisted.snapshots.length > 52) {
      persisted.snapshots = persisted.snapshots.slice(-52);
    }
    persisted.lastComputed = snapshot.takenAt;

    // Optionally generate Haiku recommendations
    let recommendations = persisted.recommendations || [];
    if (generateRecommendations) {
      const client = getAnthropicClient();
      if (client) {
        try {
          const segmentSummary = computed.segments
            .filter(s => s.memberCount > 0)
            .map(s => `- ${s.theme}: ${s.memberCount} people, ${s.engagementRate}% engagement rate`)
            .join('\n');

          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: 'You are a content strategist for TensionLines, a philosophy brand. Generate content recommendations for audience segments. Respond ONLY with valid JSON, no markdown wrapping.',
            messages: [{
              role: 'user',
              content: `Our audience segments:\n${segmentSummary}\n\nBehavior breakdown: ${JSON.stringify(computed.behaviorCounts)}\n\nGenerate 3-5 content recommendations. Each should target a specific segment. Return JSON array:\n[{"segment": "<theme name>", "title": "<content idea title>", "rationale": "<why this works for this segment>", "platform": "<twitter|bluesky|both>", "philosopher": "<nietzsche|heraclitus|marcus|diogenes|hypatia>"}]`
            }]
          });

          const text = response.content[0]?.text || '';
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            recommendations = JSON.parse(jsonMatch[0]);
          }
        } catch (aiErr) {
          console.error('Haiku recommendation error:', aiErr.message);
        }
      }
    }

    persisted.recommendations = recommendations;
    saveAudienceSegments(persisted);

    res.json({
      success: true,
      snapshot,
      recommendations,
      snapshotCount: persisted.snapshots.length
    });
  } catch (error) {
    console.error('Error taking audience snapshot:', error);
    res.status(500).json({ error: 'Failed to take snapshot' });
  }
});

// ============================================================================
// WEEKLY REPORT GENERATOR
// ============================================================================

function generateWeeklyReport(weekId) {
  const { start: weekStart, end: weekEnd } = getWeekBounds(weekId);
  const now = new Date();
  const partial = now < weekEnd;
  const prevWeekId = getPreviousWeekId(weekId);

  // Helper: check if a date string falls within the week
  function inWeek(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= weekStart && d <= weekEnd;
  }

  // --- Source 1: Posts Published ---
  let postsPublished = 0;
  const byPlatform = {};
  const byPhilosopher = {};
  const topPosts = [];
  try {
    const queue = getPostingQueue();
    const posted = (queue.posted || []).filter(p => inWeek(p.postedAt));
    postsPublished = posted.length;
    for (const p of posted) {
      const plat = p.platform || 'unknown';
      if (!byPlatform[plat]) byPlatform[plat] = { posts: 0 };
      byPlatform[plat].posts++;
      if (p.createdBy) {
        if (!byPhilosopher[p.createdBy]) byPhilosopher[p.createdBy] = { posts: 0 };
        byPhilosopher[p.createdBy].posts++;
      }
      topPosts.push({
        platform: plat,
        content: (p.content || p.text || '').slice(0, 200),
        url: p.url || p.postUrl || null,
        engagement: (p.likes || 0) + (p.comments || 0) + (p.shares || 0),
        postedAt: p.postedAt
      });
    }
    topPosts.sort((a, b) => b.engagement - a.engagement);
  } catch (e) {
    console.error('[WeeklyReport] Posts error:', e.message);
  }

  // --- Source 2: Engagement ---
  let totalLikes = 0, totalComments = 0, totalShares = 0, totalImpressions = 0;
  let avgEngagementRate = 0;
  const inboxActivity = { blueskyReplies: 0, twitterReplies: 0 };
  try {
    const engData = getEngagementData();
    const weekPosts = (engData.posts || []).filter(p => inWeek(p.publishedAt));
    for (const p of weekPosts) {
      totalLikes += p.likes || 0;
      totalComments += p.comments || 0;
      totalShares += p.shares || 0;
      totalImpressions += p.impressions || 0;
    }
    if (weekPosts.length > 0 && totalImpressions > 0) {
      avgEngagementRate = Math.round(((totalLikes + totalComments + totalShares) / totalImpressions) * 10000) / 100;
    }
  } catch (e) {
    console.error('[WeeklyReport] Engagement error:', e.message);
  }
  try {
    const inbox = getEngagementInbox();
    inboxActivity.blueskyReplies = (inbox.bluesky?.items || []).filter(i => inWeek(i.indexedAt)).length;
    inboxActivity.twitterReplies = (inbox.twitter?.items || []).filter(i => inWeek(i.indexedAt)).length;
  } catch (e) { /* no inbox data */ }

  // --- Source 3: Follower Delta ---
  const followerPlatforms = {};
  let totalFollowerDelta = 0;
  try {
    const analytics = getAnalyticsData();
    for (const [platform, info] of Object.entries(analytics.platforms || {})) {
      const history = info.history || [];
      if (history.length === 0) continue;
      // Find closest snapshots to week boundaries
      let startSnap = null, endSnap = null;
      for (const snap of history) {
        const snapDate = new Date(snap.date);
        if (snapDate <= weekStart || !startSnap) startSnap = snap;
        if (snapDate <= weekEnd) endSnap = snap;
      }
      if (!startSnap || !endSnap) continue;
      const startVal = startSnap.followers || 0;
      const endVal = endSnap.followers || 0;
      if (startVal === 0 && endVal === 0) continue;
      const delta = endVal - startVal;
      followerPlatforms[platform] = { start: startVal, end: endVal, delta };
      totalFollowerDelta += delta;
    }
  } catch (e) {
    console.error('[WeeklyReport] Follower error:', e.message);
  }

  // --- Source 4: Agent Productivity ---
  let totalCompleted = 0, totalCreated = 0;
  const agentCounts = {};
  let avgCompletionMs = 0;
  try {
    const mc = getMissionControl();
    const completedTasks = (mc.tasks || []).filter(t => inWeek(t.completedAt));
    const createdTasks = (mc.tasks || []).filter(t => inWeek(t.createdAt));
    totalCompleted = completedTasks.length;
    totalCreated = createdTasks.length;
    let completionTimeSum = 0, completionTimeCount = 0;
    for (const t of completedTasks) {
      const assignees = t.assigneeIds || [];
      for (const aid of assignees) {
        if (!agentCounts[aid]) agentCounts[aid] = { completed: 0 };
        agentCounts[aid].completed++;
      }
      if (t.createdAt && t.completedAt) {
        completionTimeSum += new Date(t.completedAt) - new Date(t.createdAt);
        completionTimeCount++;
      }
    }
    if (completionTimeCount > 0) {
      avgCompletionMs = Math.round(completionTimeSum / completionTimeCount);
    }
    // Map agent IDs to names
    const agentMap = {};
    for (const a of (mc.agents || [])) {
      agentMap[a.id] = a.name || a.id;
    }
    var byAgent = Object.entries(agentCounts)
      .map(([id, data]) => ({ id, name: agentMap[id] || id, completed: data.completed }))
      .sort((a, b) => b.completed - a.completed);
  } catch (e) {
    console.error('[WeeklyReport] Agent error:', e.message);
    var byAgent = [];
  }

  // --- Source 5: Cost Summary ---
  let totalSpent = 0, dailyBudget = 2;
  let costByDay = [];
  let costByModel = [];
  try {
    const costFilePath = path.join(BASE_DIR, 'cost-tracking/daily-costs.json');
    if (fs.existsSync(costFilePath)) {
      const costs = JSON.parse(fs.readFileSync(costFilePath, 'utf8'));
      dailyBudget = costs.daily?.budget || 2;
      costByDay = (costs.weekly || []).map(d => ({ label: d.date || d.label, cost: d.cost || 0 }));
      totalSpent = costByDay.reduce((sum, d) => sum + d.cost, 0);
      costByModel = (costs.models || []).map(m => ({ name: m.name, cost: m.cost || m.total || 0 }));
    }
  } catch (e) {
    console.error('[WeeklyReport] Cost error:', e.message);
  }

  // --- Source 6: Outreach ---
  let targetsContacted = 0, outreachFollowBacks = 0, outreachReplies = 0;
  try {
    const TWITTER_OUTREACH_DIR = path.join(BASE_DIR, 'twitter-outreach');
    if (fs.existsSync(TWITTER_OUTREACH_DIR)) {
      const files = fs.readdirSync(TWITTER_OUTREACH_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(TWITTER_OUTREACH_DIR, file), 'utf-8'));
        if (!inWeek(data.date ? data.date + 'T12:00:00Z' : null)) continue;
        const users = data.users || [];
        targetsContacted += users.length;
        outreachFollowBacks += users.filter(u => u.followedBack).length;
        outreachReplies += users.filter(u => u.replied).length;
      }
    }
  } catch (e) {
    console.error('[WeeklyReport] Outreach error:', e.message);
  }

  // --- Week-over-Week Comparison ---
  let comparison = null;
  const prevReport = readWeeklyReport(prevWeekId);
  if (prevReport) {
    comparison = {
      postsPublished: postsPublished - (prevReport.content?.postsPublished || 0),
      totalEngagement: (totalLikes + totalComments + totalShares) -
        ((prevReport.engagement?.totalLikes || 0) + (prevReport.engagement?.totalComments || 0) + (prevReport.engagement?.totalShares || 0)),
      followerDelta: totalFollowerDelta - (prevReport.followers?.totalDelta || 0),
      totalCost: totalSpent - (prevReport.costs?.totalSpent || 0),
      tasksCompleted: totalCompleted - (prevReport.agents?.totalCompleted || 0)
    };
  }

  const report = {
    weekId,
    weekStart: weekStart.toISOString().split('T')[0],
    weekEnd: weekEnd.toISOString().split('T')[0],
    generatedAt: now.toISOString(),
    partial,
    content: {
      postsPublished,
      byPlatform,
      byPhilosopher,
      topPosts: topPosts.slice(0, 5)
    },
    engagement: {
      totalLikes,
      totalComments,
      totalShares,
      avgEngagementRate,
      inboxActivity
    },
    followers: {
      platforms: followerPlatforms,
      totalDelta: totalFollowerDelta
    },
    agents: {
      totalCompleted,
      totalCreated,
      avgCompletionMs,
      byAgent
    },
    costs: {
      totalSpent: Math.round(totalSpent * 100) / 100,
      dailyBudget,
      byDay: costByDay,
      byModel: costByModel
    },
    outreach: {
      targetsContacted,
      followBackRate: targetsContacted > 0 ? Math.round((outreachFollowBacks / targetsContacted) * 100) : 0,
      replyRate: targetsContacted > 0 ? Math.round((outreachReplies / targetsContacted) * 100) : 0
    },
    comparison
  };

  // Only save completed weeks
  if (!partial) {
    saveWeeklyReport(weekId, report);
  }

  return report;
}

// ============================================================================
// WEEKLY REPORT API ENDPOINTS
// ============================================================================

/**
 * GET /api/weekly-report — Get report for a specific week (or current)
 */
app.get('/api/weekly-report', (req, res) => {
  try {
    const weekId = req.query.week || getISOWeekId(new Date());
    // Try stored report first
    let report = readWeeklyReport(weekId);
    if (!report) {
      report = generateWeeklyReport(weekId);
    }
    res.json(report);
  } catch (error) {
    console.error('Error getting weekly report:', error);
    res.status(500).json({ error: 'Failed to get weekly report' });
  }
});

/**
 * GET /api/weekly-report/list — List all stored reports
 */
app.get('/api/weekly-report/list', (req, res) => {
  try {
    if (!fs.existsSync(WEEKLY_REPORTS_DIR)) {
      return res.json([]);
    }
    const files = fs.readdirSync(WEEKLY_REPORTS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
    const list = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(WEEKLY_REPORTS_DIR, f), 'utf8'));
        return {
          weekId: data.weekId,
          weekStart: data.weekStart,
          weekEnd: data.weekEnd,
          generatedAt: data.generatedAt
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    res.json(list);
  } catch (error) {
    console.error('Error listing weekly reports:', error);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

/**
 * POST /api/weekly-report/generate — Force-regenerate a report
 */
app.post('/api/weekly-report/generate', (req, res) => {
  try {
    const weekId = req.body.week || getISOWeekId(new Date());
    const report = generateWeeklyReport(weekId);
    // Force save even if partial (user explicitly requested)
    saveWeeklyReport(weekId, report);
    res.json(report);
  } catch (error) {
    console.error('Error generating weekly report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * Delete posting queue item
 */
app.delete('/api/posting-queue/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queue = getPostingQueue();
    const index = queue.queue.findIndex(i => i.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Item not found' });
    }

    queue.queue.splice(index, 1);
    savePostingQueue(queue);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting posting queue item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

/**
 * Mark posting queue item as posted
 */
app.post('/api/posting-queue/:id/posted', (req, res) => {
  try {
    const { id } = req.params;
    const queue = getPostingQueue();
    const index = queue.queue.findIndex(i => i.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = queue.queue[index];
    item.postedAt = new Date().toISOString();
    item.status = 'posted';

    // Move to posted array
    if (!queue.posted) queue.posted = [];
    queue.posted.unshift(item);
    queue.queue.splice(index, 1);

    savePostingQueue(queue);
    res.json({ success: true, item });
  } catch (error) {
    console.error('Error marking as posted:', error);
    res.status(500).json({ error: 'Failed to mark as posted' });
  }
});

/**
 * Publish a Bluesky post directly via API
 */
app.post('/api/posting-queue/:id/publish', async (req, res) => {
  try {
    const queue = getPostingQueue();
    const idx = queue.queue.findIndex(item => item.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    const item = queue.queue[idx];
    const platform = item.platform;

    // Check posting mode
    const postingModes = queue.settings?.postingModes || {};
    const mode = postingModes[platform] || 'manual';
    if (mode !== 'auto') {
      return res.status(400).json({ error: `${platform} is set to manual posting. Toggle to auto in settings.` });
    }

    // Server-side rate limit enforcement
    const platformSettings = queue.settings?.platforms?.[platform] || {};
    const maxPerDay = platformSettings.maxPostsPerDay || 5;
    const minHours = platformSettings.minHoursBetweenPosts || 2;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const posted = queue.posted || [];
    const postedToday = posted.filter(p => p.postedAt?.startsWith(today) && p.platform === platform);

    if (postedToday.length >= maxPerDay) {
      return res.status(429).json({ error: `Daily limit reached (${maxPerDay} posts/day for ${platform})` });
    }

    if (postedToday.length > 0) {
      const lastPostedAt = new Date(postedToday[0].postedAt);
      const hoursSinceLast = (now - lastPostedAt) / (1000 * 60 * 60);
      if (hoursSinceLast < minHours) {
        const waitMins = Math.ceil((minHours * 60) - (hoursSinceLast * 60));
        return res.status(429).json({ error: `Too soon — wait ${waitMins} more minutes (${minHours}h minimum between posts)` });
      }
    }

    // Platform-specific publishing
    let result;
    switch (platform) {
      case 'bluesky':
        result = await postToBluesky(item.content);
        break;
      default:
        return res.status(400).json({ error: `Auto-posting for ${platform} is not yet connected. Use manual Copy & Open for now, or connect the ${platform} API.` });
    }

    item.status = 'posted';
    item.postedAt = new Date().toISOString();
    item.postUrl = result.postUrl;
    if (result.uri) item.bskyUri = result.uri;

    queue.queue.splice(idx, 1);
    if (!queue.posted) queue.posted = [];
    queue.posted.unshift(item);
    savePostingQueue(queue);

    console.log(`[${platform}] Published: ${result.postUrl}`);
    logSystemEvent('pipeline', `Auto-published to ${platform}: ${result.postUrl}`, { platform, postId: item.id });
    res.json({ success: true, item, postUrl: result.postUrl });
  } catch (error) {
    // Mark as failed but keep in queue for retry
    const queue = getPostingQueue();
    const item = queue.queue.find(i => i.id === req.params.id);
    if (item) {
      item.status = 'failed';
      item.lastError = error.message;
      item.lastAttempt = new Date().toISOString();
      savePostingQueue(queue);
    }
    console.error(`[${item?.platform || 'publish'}] Publish failed:`, error.message);
    res.status(500).json({ error: 'Failed to publish' });
  }
});

/**
 * Bluesky connection status
 */
app.get('/api/bluesky/status', async (req, res) => {
  try {
    const agent = await getBskyAgent();
    const profile = await agent.getProfile({ actor: process.env.BLUESKY_HANDLE });
    res.json({
      connected: true,
      handle: profile.data.handle,
      displayName: profile.data.displayName,
      followersCount: profile.data.followersCount,
      followsCount: profile.data.followsCount,
      postsCount: profile.data.postsCount
    });
  } catch (error) {
    bskyAgent = null; // Reset so next attempt re-authenticates
    res.json({ connected: false, error: error.message });
  }
});

app.get('/api/twitter/status', (req, res) => {
  try {
    const raw = execSync(`/opt/homebrew/bin/bird whoami 2>/dev/null`, { timeout: 5000, encoding: 'utf-8' });
    // First line is like "🙋 @thetensionlines (Shawn Brown)"
    const firstLine = raw.trim().split('\n')[0] || '';
    const handleMatch = firstLine.match(/@(\w+)/);
    const handle = handleMatch ? handleMatch[1] : 'thetensionlines';
    res.json({ connected: true, handle });
  } catch (error) {
    res.json({ connected: false, error: error.message });
  }
});

app.get('/api/instagram/status', (req, res) => {
  // Instagram is manual-only for now (no API integration)
  res.json({ connected: false, mode: 'manual', message: 'Manual posting via Canva' });
});

app.get('/api/threads/status', (req, res) => {
  // Threads is manual-only for now (no API integration)
  res.json({ connected: false, mode: 'manual', message: 'Manual posting' });
});

// Unified endpoint: all platform statuses in one call
app.get('/api/platforms/status', async (req, res) => {
  const results = {};
  const queue = getPostingQueue();
  const postingModes = queue.settings?.postingModes || {};

  // Bluesky
  try {
    const agent = await getBskyAgent();
    const profile = await agent.getProfile({ actor: process.env.BLUESKY_HANDLE });
    results.bluesky = { connected: true, handle: profile.data.handle, mode: postingModes.bluesky || 'manual' };
  } catch (error) {
    bskyAgent = null;
    results.bluesky = { connected: false, error: error.message, mode: postingModes.bluesky || 'manual' };
  }

  // Twitter
  try {
    const raw = execSync(`/opt/homebrew/bin/bird whoami 2>/dev/null`, { timeout: 5000, encoding: 'utf-8' });
    const firstLine = raw.trim().split('\n')[0] || '';
    const handleMatch = firstLine.match(/@(\w+)/);
    const handle = handleMatch ? handleMatch[1] : 'thetensionlines';
    results.twitter = { connected: true, handle, mode: postingModes.twitter || 'manual' };
  } catch (error) {
    results.twitter = { connected: false, error: error.message, mode: postingModes.twitter || 'manual' };
  }

  // Instagram
  results.instagram = { connected: false, mode: postingModes.instagram || 'manual', message: 'Manual posting via Canva' };

  // Threads
  results.threads = { connected: false, mode: postingModes.threads || 'manual', message: 'Manual posting' };

  // Reddit
  results.reddit = { connected: false, mode: postingModes.reddit || 'manual', message: 'Manual posting' };

  // Medium
  results.medium = { connected: false, mode: postingModes.medium || 'manual', message: 'Manual posting' };

  // Substack
  results.substack = { connected: false, mode: postingModes.substack || 'manual', message: 'Manual posting' };

  res.json(results);
});

// Get/set posting mode per platform (manual vs auto)
app.get('/api/settings/posting-modes', (req, res) => {
  const queue = getPostingQueue();
  res.json(queue.settings?.postingModes || {
    twitter: 'manual',
    bluesky: 'manual',
    threads: 'manual',
    instagram: 'manual',
    reddit: 'manual',
    medium: 'manual',
    substack: 'manual'
  });
});

app.patch('/api/settings/posting-modes', (req, res) => {
  try {
    const queue = getPostingQueue();
    if (!queue.settings) queue.settings = {};
    if (!queue.settings.postingModes) {
      queue.settings.postingModes = {
        twitter: 'manual', bluesky: 'manual', threads: 'manual',
        instagram: 'manual', reddit: 'manual', medium: 'manual', substack: 'manual'
      };
    }
    const validModes = ['manual', 'auto'];
    const validPlatforms = ['twitter', 'bluesky', 'threads', 'instagram', 'reddit', 'medium', 'substack'];
    for (const [platform, mode] of Object.entries(req.body)) {
      if (validPlatforms.includes(platform) && validModes.includes(mode)) {
        queue.settings.postingModes[platform] = mode;
      }
    }
    savePostingQueue(queue);
    broadcast('posting-queue');
    res.json(queue.settings.postingModes);
  } catch (error) {
    console.error('Error saving posting modes:', error);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// ============================================================================
// CONTENT REPURPOSING ENGINE
// ============================================================================

const PLATFORM_SPECS = {
  twitter: { label: 'Twitter', limit: 280, format: 'Punchy, standalone thought. Can be a thread of max 3 tweets separated by ---. Each tweet must be ≤280 characters.' },
  bluesky: { label: 'Bluesky', limit: 300, format: 'Conversational, observation-style. Single post. Must be ≤300 characters.' },
  instagram: { label: 'Instagram', limit: 2200, format: 'Two parts: 1) "cardText" — a bold quote for a Canva image card, under 100 characters. 2) "caption" — a longer reflection with relevant hashtags, up to ~2200 characters.' },
  reddit: { label: 'Reddit', limit: 300, format: 'Discussion-starter. Return "title" (compelling question or statement) and "body" (thoughtful, ~300 words, no hashtags). Invites conversation.' },
  medium: { label: 'Medium', limit: 200, format: 'Essay paragraph. Rich, flowing prose. Could be a section opener. ~200 words.' },
  substack: { label: 'Substack', limit: 500, format: 'Newsletter excerpt. Compelling opening hook (1-2 sentences), then a thoughtful exploration (~300-500 words). Should feel like the start of something the reader wants to finish. Include a provocative subject line as "title".' },
  threads: { label: 'Threads', limit: 500, format: 'Conversational, casual tone. Like talking to a smart friend. Can be a single post or a short thread (max 3 posts separated by ---). Each post must be ≤500 characters. No hashtags.' }
};

/**
 * Generate platform-specific drafts from an idea using Claude API
 */
app.post('/api/repurpose', async (req, res) => {
  try {
    const client = getAnthropicClient();
    if (!client) {
      return res.status(501).json({ error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to cms/.env' });
    }

    const { ideaId, rawText, platforms = ['twitter', 'bluesky', 'instagram', 'reddit', 'medium', 'threads'], philosopher = 'nietzsche' } = req.body;

    if (!isValidPhilosopher(philosopher)) {
      return res.status(400).json({ error: 'Invalid philosopher name' });
    }

    // Resolve source text
    let sourceText = '';
    let sourceIdea = null;
    if (ideaId) {
      const ideas = parseIdeasBank();
      sourceIdea = ideas.find(i => i.id === ideaId || `#${i.id}` === ideaId);
      if (!sourceIdea) {
        return res.status(404).json({ error: `Idea ${ideaId} not found` });
      }
      const parts = [];
      if (sourceIdea.quote) parts.push(`Quote: "${sourceIdea.quote}"`);
      if (sourceIdea.tension) parts.push(`Tension: ${sourceIdea.tension}`);
      if (sourceIdea.paradox) parts.push(`Paradox: ${sourceIdea.paradox}`);
      if (sourceIdea.notes) parts.push(`Notes: ${sourceIdea.notes}`);
      if (sourceIdea.text && !sourceIdea.quote) parts.push(sourceIdea.text);
      sourceText = parts.join('\n\n');
    } else if (rawText) {
      sourceText = rawText;
    } else {
      return res.status(400).json({ error: 'Provide either ideaId or rawText' });
    }

    const { drafts, usage } = await generatePlatformDrafts(sourceText, philosopher, platforms);

    res.json({
      drafts,
      sourceIdea: sourceIdea ? { id: sourceIdea.id, quote: sourceIdea.quote, date: sourceIdea.date } : null,
      philosopher,
      model: 'claude-sonnet-4-5-20250929',
      usage
    });
  } catch (error) {
    console.error('Repurpose error:', error);
    if (error.message?.includes('parse') || error instanceof SyntaxError) {
      return res.status(502).json({ error: 'Failed to parse Claude response as JSON' });
    }
    if (error.status === 401) {
      return res.status(502).json({ error: 'Invalid Anthropic API key' });
    }
    res.status(502).json({ error: 'Claude API call failed' });
  }
});

/**
 * Push approved repurposed drafts to the posting queue
 */
app.post('/api/repurpose/queue', (req, res) => {
  try {
    const { drafts } = req.body;
    if (!Array.isArray(drafts) || drafts.length === 0) {
      return res.status(400).json({ error: 'Provide an array of drafts' });
    }

    const queue = getPostingQueue();
    const added = [];

    for (const draft of drafts) {
      const { platform, content, caption, cardText, title, body, ideaId, philosopher } = draft;
      if (!platform) continue;

      const item = {
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
        status: 'ready',
        platform,
        content: content || title || cardText || '',
        caption: caption || '',
        parts: [],
        createdBy: philosopher || 'unknown',
        ideaId: ideaId || '',
        source: 'repurpose-engine'
      };

      // For reddit, store title + body in content
      if (platform === 'reddit' && title && body) {
        item.content = `${title}\n\n${body}`;
      }
      // For instagram, store cardText separately
      if (platform === 'instagram' && cardText) {
        item.content = cardText;
        item.caption = caption || '';
      }

      queue.queue.push(item);
      added.push(item);
    }

    savePostingQueue(queue);
    res.json({ success: true, added, count: added.length });
  } catch (error) {
    console.error('Repurpose queue error:', error);
    res.status(500).json({ error: 'Failed to add drafts to queue' });
  }
});

// ============================================================================
// AUTO-PIPELINE: Idea-to-Draft Automation
// ============================================================================

const AUTO_PIPELINE_CONFIG_DEFAULTS = {
  enabled: false,
  cronSchedule: '0 6 * * *', // 6 AM PST daily
  philosopher: 'nietzsche',
  platforms: ['twitter', 'bluesky', 'instagram', 'reddit', 'medium', 'threads'],
  maxIdeasPerRun: 3
};

// Each platform's designated philosopher voice
const PHILOSOPHER_BY_PLATFORM = {
  twitter: 'nietzsche',
  bluesky: 'heraclitus',
  threads: 'heraclitus',
  reddit: 'diogenes',
  medium: 'plato',
  substack: 'plato',
  instagram: 'heraclitus',
};

function getAutoPipelineState() {
  try {
    if (fs.existsSync(AUTO_PIPELINE_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(AUTO_PIPELINE_STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[AutoPipeline] Error reading state:', err.message);
  }
  return { config: { ...AUTO_PIPELINE_CONFIG_DEFAULTS }, processedIds: [], runs: [] };
}

function saveAutoPipelineState(state) {
  fs.writeFileSync(AUTO_PIPELINE_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Shared helper: generate platform drafts from source text via Claude API.
 * Extracted from /api/repurpose so both manual and auto-pipeline can reuse it.
 */
async function generatePlatformDrafts(sourceText, philosopher, platforms) {
  const client = getAnthropicClient();
  if (!client) throw new Error('Anthropic API key not configured');

  const validPlatforms = platforms.filter(p => PLATFORM_SPECS[p]);
  if (validPlatforms.length === 0) throw new Error('No valid platforms specified');

  // Build per-platform voice definitions using each platform's designated philosopher
  const voiceSections = [];
  for (const p of validPlatforms) {
    const platPhilosopher = PHILOSOPHER_BY_PLATFORM[p] || philosopher;
    const soulPath = path.join(PHILOSOPHERS_DIR, platPhilosopher, 'SOUL.md');
    if (fs.existsSync(soulPath)) {
      let soul = fs.readFileSync(soulPath, 'utf8');
      if (soul.length > 1500) soul = soul.substring(0, 1500) + '\n...(truncated)';
      voiceSections.push(`### Voice for ${p} (${platPhilosopher}):\n${soul}`);
    }
  }

  const platformInstructions = validPlatforms.map(p => {
    const spec = PLATFORM_SPECS[p];
    const platPhilosopher = PHILOSOPHER_BY_PLATFORM[p] || philosopher;
    return `### ${spec.label} (voice: ${platPhilosopher})\n${spec.format}`;
  }).join('\n\n');

  const systemPrompt = `You are a social media content writer for TensionLines — a philosophy brand that makes deep ideas accessible and provocative for modern audiences.

Each platform has a DIFFERENT philosopher voice. You MUST write each platform's draft in its designated philosopher's voice.

${voiceSections.length > 0 ? voiceSections.join('\n\n') + '\n' : ''}
## Rules:
- Write EACH platform's draft in that platform's designated philosopher voice — they should sound distinctly different.
- Never use generic motivational language. Be specific. Be surprising.
- Each platform draft should feel native to that platform, not just reformatted.
- Respect character limits strictly.
- Return ONLY valid JSON, no markdown fences.`;

  const userPrompt = `Take this idea and create a draft for each platform listed below.

## Source Idea:
${sourceText}

## Platforms:
${platformInstructions}

## Output Format:
Return a JSON object where each key is the platform name. For most platforms, the value has a "content" field. Exceptions:
- **instagram**: { "cardText": "...", "caption": "..." }
- **reddit**: { "title": "...", "body": "..." }
- **medium**: { "title": "...", "content": "...", "topics": ["topic1", "topic2", "topic3", "topic4", "topic5"] } (exactly 5 Medium topics/tags)
- **twitter**: { "content": "..." } (if a thread, separate tweets with ---)

Example structure:
{
  "twitter": { "content": "tweet text here" },
  "bluesky": { "content": "post text here" },
  "instagram": { "cardText": "short quote", "caption": "longer caption with #hashtags" },
  "reddit": { "title": "Discussion title", "body": "Discussion body..." },
  "medium": { "title": "Article Title", "content": "Article body...", "topics": ["Philosophy", "Self Improvement", "Life", "Mindfulness", "Psychology"] }
}

Only include the platforms requested: ${validPlatforms.join(', ')}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const responseText = message.content[0]?.text || '';
  const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const drafts = JSON.parse(cleaned);

  // Add char counts
  for (const platform of validPlatforms) {
    if (!drafts[platform]) continue;
    const draft = drafts[platform];
    if (draft.content) draft.charCount = draft.content.length;
    if (draft.cardText) draft.cardTextCharCount = draft.cardText.length;
    if (draft.caption) draft.captionCharCount = draft.caption.length;
    if (draft.title) draft.titleCharCount = draft.title.length;
    if (draft.body) draft.bodyWordCount = draft.body.split(/\s+/).length;
  }

  return { drafts, validPlatforms, usage: message.usage };
}

/**
 * Core auto-pipeline: process captured ideas into platform drafts
 */
async function runAutoPipeline() {
  const state = getAutoPipelineState();
  const config = state.config || AUTO_PIPELINE_CONFIG_DEFAULTS;

  console.log('[AutoPipeline] Starting run...');

  // Get captured ideas not yet processed
  cache.ideasBank = null; // Force fresh parse
  const allIdeas = parseIdeasBank();
  const processedSet = new Set(state.processedIds || []);
  const eligible = allIdeas.filter(i => i.status === 'captured' && !processedSet.has(i.id));

  if (eligible.length === 0) {
    console.log('[AutoPipeline] No new captured ideas to process.');
    const run = { timestamp: new Date().toISOString(), ideasProcessed: 0, draftsQueued: 0, status: 'empty' };
    state.runs.unshift(run);
    if (state.runs.length > 20) state.runs = state.runs.slice(0, 20);
    saveAutoPipelineState(state);
    return run;
  }

  const toProcess = eligible.slice(0, config.maxIdeasPerRun || 3);
  console.log(`[AutoPipeline] Processing ${toProcess.length} ideas: ${toProcess.map(i => '#' + i.id).join(', ')}`);

  let totalDraftsQueued = 0;
  const processedThisRun = [];
  const errors = [];

  for (const idea of toProcess) {
    try {
      // Build source text from idea fields
      const parts = [];
      if (idea.quote) parts.push(`Quote: "${idea.quote}"`);
      if (idea.tension) parts.push(`Tension: ${idea.tension}`);
      if (idea.paradox) parts.push(`Paradox: ${idea.paradox}`);
      if (idea.notes) parts.push(`Notes: ${idea.notes}`);
      if (idea.text && !idea.quote) parts.push(idea.text);
      const sourceText = parts.join('\n\n');

      if (!sourceText.trim()) {
        console.log(`[AutoPipeline] Idea #${idea.id} has no text content, skipping.`);
        state.processedIds.push(idea.id);
        continue;
      }

      const { drafts, validPlatforms } = await generatePlatformDrafts(
        sourceText,
        config.philosopher || 'nietzsche',
        config.platforms || ['twitter', 'bluesky', 'instagram', 'reddit', 'medium', 'threads']
      );

      // Queue each platform draft with pending-review status
      const queue = getPostingQueue();
      for (const platform of validPlatforms) {
        if (!drafts[platform]) continue;
        const draft = drafts[platform];

        const item = {
          id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: new Date().toISOString(),
          status: 'pending-review',
          platform,
          content: draft.content || draft.title || draft.cardText || '',
          caption: draft.caption || '',
          parts: [],
          createdBy: PHILOSOPHER_BY_PLATFORM[platform] || config.philosopher || 'nietzsche',
          ideaId: idea.id,
          source: 'auto-pipeline'
        };

        if (platform === 'reddit' && draft.title && draft.body) {
          item.content = `${draft.title}\n\n${draft.body}`;
        }
        if (platform === 'medium') {
          if (draft.title) item.title = draft.title;
          if (draft.topics) item.topics = draft.topics;
        }
        if (platform === 'instagram' && draft.cardText) {
          item.content = draft.cardText;
          item.caption = draft.caption || '';
        }

        queue.queue.push(item);
        totalDraftsQueued++;
      }
      savePostingQueue(queue);

      state.processedIds.push(idea.id);
      processedThisRun.push(idea.id);
      console.log(`[AutoPipeline] Idea #${idea.id} → ${validPlatforms.length} drafts queued.`);
    } catch (err) {
      console.error(`[AutoPipeline] Error processing idea #${idea.id}:`, err.message);
      errors.push({ ideaId: idea.id, error: err.message });
    }
  }

  // Create notification
  try {
    const mc = getMissionControl();
    mc.notifications.unshift({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'auto_pipeline',
      title: 'Auto-Pipeline Complete',
      message: `${processedThisRun.length} idea${processedThisRun.length !== 1 ? 's' : ''} auto-drafted → ${totalDraftsQueued} drafts queued for review.${errors.length ? ` (${errors.length} error${errors.length !== 1 ? 's' : ''})` : ''}`,
      from: 'auto-pipeline',
      read: false,
      createdAt: new Date().toISOString(),
      priority: 'medium',
      actionRequired: true,
      metadata: { processedIds: processedThisRun, draftsQueued: totalDraftsQueued, errors: errors.length }
    });
    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
    cache.missionControl = null;
  } catch (notifErr) {
    console.error('[AutoPipeline] Failed to create notification:', notifErr.message);
  }

  const run = {
    timestamp: new Date().toISOString(),
    ideasProcessed: processedThisRun.length,
    ideaIds: processedThisRun,
    draftsQueued: totalDraftsQueued,
    errors,
    status: errors.length ? 'partial' : 'success'
  };
  state.runs.unshift(run);
  if (state.runs.length > 20) state.runs = state.runs.slice(0, 20);
  saveAutoPipelineState(state);

  console.log(`[AutoPipeline] Run complete: ${processedThisRun.length} ideas → ${totalDraftsQueued} drafts.`);
  return run;
}

/**
 * POST /api/auto-pipeline/run — Manual trigger
 */
app.post('/api/auto-pipeline/run', async (req, res) => {
  try {
    const result = await runAutoPipeline();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[AutoPipeline] Manual run error:', err);
    res.status(500).json({ error: 'Auto-pipeline run failed', detail: err.message });
  }
});

/**
 * POST /api/ideas/:id/fast-track — Generate drafts for all platforms and queue them in one click
 */
app.post('/api/ideas/:id/fast-track', async (req, res) => {
  try {
    const ideaId = req.params.id;
    cache.ideasBank = null; // Force fresh parse
    const ideas = parseIdeasBank();
    const idea = ideas.find(i => i.id === ideaId || `#${i.id}` === ideaId);
    if (!idea) {
      return res.status(404).json({ error: `Idea #${ideaId} not found` });
    }

    // Build source text from idea fields
    const parts = [];
    if (idea.quote) parts.push(`Quote: "${idea.quote}"`);
    if (idea.tension) parts.push(`Tension: ${idea.tension}`);
    if (idea.paradox) parts.push(`Paradox: ${idea.paradox}`);
    if (idea.notes) parts.push(`Notes: ${idea.notes}`);
    if (idea.text && !idea.quote) parts.push(idea.text);
    const sourceText = parts.join('\n\n');

    if (!sourceText.trim()) {
      return res.status(400).json({ error: `Idea #${ideaId} has no text content` });
    }

    const platforms = ['twitter', 'bluesky', 'instagram', 'reddit', 'medium'];
    const { drafts, validPlatforms } = await generatePlatformDrafts(sourceText, 'nietzsche', platforms);

    // Queue each platform draft
    const queue = getPostingQueue();
    let draftCount = 0;
    for (const platform of validPlatforms) {
      if (!drafts[platform]) continue;
      const draft = drafts[platform];

      const item = {
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: new Date().toISOString(),
        status: 'pending-review',
        platform,
        content: draft.content || draft.title || draft.cardText || '',
        caption: draft.caption || '',
        parts: [],
        createdBy: 'nietzsche',
        ideaId: idea.id,
        source: 'fast-track'
      };

      if (platform === 'reddit' && draft.title && draft.body) {
        item.content = `${draft.title}\n\n${draft.body}`;
      }
      if (platform === 'medium' && draft.title) {
        item.title = draft.title;
      }
      if (platform === 'instagram' && draft.cardText) {
        item.content = draft.cardText;
        item.caption = draft.caption || '';
      }

      queue.queue.push(item);
      draftCount++;
    }
    savePostingQueue(queue);

    // Record in auto-pipeline state so daily cron won't re-process
    const state = getAutoPipelineState();
    if (!state.processedIds.includes(idea.id)) {
      state.processedIds.push(idea.id);
      saveAutoPipelineState(state);
    }

    console.log(`[FastTrack] Idea #${idea.id} → ${draftCount} drafts queued.`);
    res.json({ success: true, draftCount, platforms: validPlatforms, ideaId: idea.id });
  } catch (error) {
    console.error('[FastTrack] Error:', error);
    if (error.message?.includes('parse') || error instanceof SyntaxError) {
      return res.status(502).json({ error: 'Failed to parse Claude response as JSON' });
    }
    if (error.status === 401) {
      return res.status(502).json({ error: 'Invalid Anthropic API key' });
    }
    res.status(502).json({ error: 'Fast-track generation failed', detail: error.message });
  }
});

/**
 * GET /api/auto-pipeline/status — Current state, last run, eligible ideas
 */
app.get('/api/auto-pipeline/status', (req, res) => {
  try {
    const state = getAutoPipelineState();
    const config = state.config || AUTO_PIPELINE_CONFIG_DEFAULTS;

    cache.ideasBank = null;
    const allIdeas = parseIdeasBank();
    const processedSet = new Set(state.processedIds || []);
    const eligible = allIdeas.filter(i => i.status === 'captured' && !processedSet.has(i.id));

    res.json({
      config,
      eligibleIdeas: eligible.length,
      processedCount: (state.processedIds || []).length,
      lastRun: state.runs?.[0] || null,
      recentRuns: (state.runs || []).slice(0, 10)
    });
  } catch (err) {
    console.error('[AutoPipeline] Status error:', err);
    res.status(500).json({ error: 'Failed to get pipeline status' });
  }
});

/**
 * PATCH /api/auto-pipeline/config — Update pipeline config
 */
app.patch('/api/auto-pipeline/config', (req, res) => {
  try {
    const state = getAutoPipelineState();
    const { enabled, philosopher, platforms, maxIdeasPerRun } = req.body;

    if (typeof enabled === 'boolean') state.config.enabled = enabled;
    if (philosopher && isValidPhilosopher(philosopher)) state.config.philosopher = philosopher;
    if (Array.isArray(platforms)) state.config.platforms = platforms.filter(p => PLATFORM_SPECS[p]);
    if (typeof maxIdeasPerRun === 'number' && maxIdeasPerRun > 0 && maxIdeasPerRun <= 10) state.config.maxIdeasPerRun = maxIdeasPerRun;

    saveAutoPipelineState(state);
    res.json({ success: true, config: state.config });
  } catch (err) {
    console.error('[AutoPipeline] Config update error:', err);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// ============================================================================
// VOICE CHECK (Style Guide Enforcement)
// ============================================================================

/**
 * Extract voice-relevant sections from SOUL.md, stripping operational sections
 * like Responsibilities and Repost Curation that aren't about voice/tone.
 */
function extractVoiceSections(soulContent) {
  const lines = soulContent.split('\n');
  const result = [];
  let skip = false;

  for (const line of lines) {
    // Stop including content when we hit operational sections
    if (/^## (My Responsibilities|Repost Curation|What I Care About)/.test(line)) {
      skip = true;
      continue;
    }
    // Resume on next top-level section that isn't operational
    if (/^## /.test(line) && skip) {
      skip = false;
    }
    if (!skip) {
      result.push(line);
    }
  }

  return result.join('\n').trim();
}

app.post('/api/voice-check', async (req, res) => {
  try {
    const client = getAnthropicClient();
    if (!client) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    const { content, philosopher, platform } = req.body;
    if (!content || !philosopher) {
      return res.status(400).json({ error: 'content and philosopher are required' });
    }
    if (!isValidPhilosopher(philosopher)) {
      return res.status(400).json({ error: 'Invalid philosopher name' });
    }

    // Read SOUL.md
    const soulPath = path.join(PHILOSOPHERS_DIR, philosopher, 'SOUL.md');
    if (!fs.existsSync(soulPath)) {
      return res.status(404).json({ error: `No SOUL.md found for ${philosopher}` });
    }
    const soulRaw = fs.readFileSync(soulPath, 'utf8');
    const voiceDefinition = extractVoiceSections(soulRaw);

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `You are a voice consistency checker for a philosophy brand called TensionLines. You evaluate whether content matches a philosopher's defined voice and style. Be concise and specific. Respond ONLY with valid JSON, no markdown wrapping.`,
      messages: [{
        role: 'user',
        content: `## Voice Definition for "${philosopher}"
${voiceDefinition}

## Content to Check${platform ? ` (for ${platform})` : ''}
${content}

## Task
Analyze how well this content matches the voice definition above. Return JSON:
{
  "score": <0-100 integer>,
  "verdict": "<strong|good|weak|off-voice>",
  "issues": [{"type": "<tone|vocabulary|structure|length>", "description": "<specific issue>", "severity": "<low|medium|high>"}],
  "suggestions": ["<specific actionable suggestion>"],
  "strengths": ["<what matches the voice well>"]
}

Scoring: 80-100=strong (nails the voice), 60-79=good (mostly on voice), 40-59=weak (drifting), 0-39=off-voice (wrong voice entirely).
Keep issues, suggestions, and strengths to 1-3 items each. Be specific, not generic.`
      }]
    });

    const text = response.content[0]?.text || '';
    // Parse JSON from response, handling potential markdown wrapping
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse voice check response' });
    }

    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch (error) {
    console.error('Voice check error:', error);
    res.status(500).json({ error: 'Voice check failed' });
  }
});

app.post('/api/voice-improve', async (req, res) => {
  try {
    const client = getAnthropicClient();
    if (!client) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    const { content, philosopher, platform, issues, suggestions } = req.body;
    if (!content || !philosopher) {
      return res.status(400).json({ error: 'content and philosopher are required' });
    }
    if (!isValidPhilosopher(philosopher)) {
      return res.status(400).json({ error: 'Invalid philosopher name' });
    }

    // Read SOUL.md
    const soulPath = path.join(PHILOSOPHERS_DIR, philosopher, 'SOUL.md');
    if (!fs.existsSync(soulPath)) {
      return res.status(404).json({ error: `No SOUL.md found for ${philosopher}` });
    }
    const soulRaw = fs.readFileSync(soulPath, 'utf8');
    const voiceDefinition = extractVoiceSections(soulRaw);

    const feedbackLines = [];
    if (issues?.length) feedbackLines.push(`Issues found: ${issues.map(i => i.description).join('; ')}`);
    if (suggestions?.length) feedbackLines.push(`Suggestions: ${suggestions.join('; ')}`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: `You are a content rewriter for TensionLines, a philosophy brand. Rewrite content to better match a philosopher's voice. Return ONLY the improved text, no explanation or JSON wrapping.`,
      messages: [{
        role: 'user',
        content: `## Voice Definition for "${philosopher}"
${voiceDefinition}

## Original Content${platform ? ` (for ${platform})` : ''}
${content}

${feedbackLines.length > 0 ? `## Voice Check Feedback\n${feedbackLines.join('\n')}\n` : ''}
## Task
Rewrite this content to strongly match ${philosopher}'s voice. Keep the same core message and approximate length but make it sound authentically like ${philosopher}. ${platform ? `Optimize for ${platform}.` : ''} Return ONLY the rewritten text.`
      }]
    });

    const improved = response.content[0]?.text?.trim() || '';
    res.json({ improved, philosopher, platform });
  } catch (error) {
    console.error('Voice improve error:', error);
    res.status(500).json({ error: 'Voice improvement failed' });
  }
});

// ============================================================================
// CONVERSATIONAL HOOKS (for replies & comments)
// ============================================================================

// Hooks that flow into the text via em-dash (lowercase the first char of the reply)
const FLOW_HOOKS = [
  "I'm with you —",
  "This resonates —",
  "Spot on —",
  "Right there with you —",
  "Been thinking about this too —",
  "Hard to argue with that —",
  "This hits home —",
  "Love this take —",
  "You put words to something I've been sitting with —",
  "Can't stop thinking about this —",
  "Felt this one —",
  "This lands —",
  "Real talk —",
  "You're onto something here —",
  "Worth saying twice —",
];

// Hooks that stand alone as a sentence before the reply (keep original caps)
const STANDALONE_HOOKS = [
  "Exactly this.",
  "Yes.",
  "This stopped me mid-scroll.",
  "Underrated take.",
  "More people need to hear this.",
  "This is it.",
  "Needed to read this today.",
  "Been waiting for someone to say this.",
  "So much this.",
  "The kind of take that sticks with you.",
];

// Hooks that go at the end of the reply
const ENDING_HOOKS = [
  "More people need to sit with this.",
  "The kind of honesty that cuts through.",
  "Sitting with this one.",
  "Needed this reminder today.",
  "That's the part people skip over.",
  "This is the conversation worth having.",
  "The quiet part most people won't say out loud.",
];

/**
 * Add a conversational hook to reply/comment text.
 * Makes replies feel human — agreement, resonance, a bridge into the thought.
 * Returns the text with a hook added (beginning or end).
 */
function addConversationalHook(text) {
  if (!text || text.length < 10) return text;

  // Use a simple hash of the text to pick deterministically
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  hash = Math.abs(hash);

  // 45% flow hooks, 30% standalone, 25% ending
  const bucket = hash % 100;

  if (bucket < 45) {
    const hook = FLOW_HOOKS[hash % FLOW_HOOKS.length];
    // Lowercase first char unless it's "I" (pronoun) or a quote
    const first = text[0];
    const lowered = (first === 'I' && (text[1] === ' ' || text[1] === "'")) || first === '"' || first === '"'
      ? text
      : first.toLowerCase() + text.slice(1);
    return `${hook} ${lowered}`;
  } else if (bucket < 75) {
    const hook = STANDALONE_HOOKS[hash % STANDALONE_HOOKS.length];
    return `${hook} ${text}`;
  } else {
    const hook = ENDING_HOOKS[hash % ENDING_HOOKS.length];
    // If text ends with period/exclamation, just append
    const trimmed = text.trimEnd();
    const lastChar = trimmed[trimmed.length - 1];
    const needsPeriod = lastChar !== '.' && lastChar !== '!' && lastChar !== '?';
    return `${trimmed}${needsPeriod ? '.' : ''} ${hook}`;
  }
}

// ============================================================================
// HASHTAGS (for replies & comments)
// ============================================================================

const HASHTAG_POOLS = {
  philosophy: ['#philosophy', '#deepthoughts', '#bigquestions', '#thinkdifferent', '#philosophyoflife'],
  wisdom: ['#wisdom', '#lifelessons', '#truth', '#perspective', '#knowthyself'],
  growth: ['#personalgrowth', '#selfawareness', '#innerwork', '#growthmindset', '#selfdiscovery'],
  emotion: ['#emotionalintelligence', '#vulnerability', '#authenticity', '#realness', '#honesty'],
  mindset: ['#mindset', '#mindfulness', '#presence', '#awareness', '#intention'],
  identity: ['#identity', '#selfknowledge', '#whoami', '#bereal', '#ownit'],
  tension: ['#tensionlines', '#holdthetension', '#bothcanbtrue'],
  resilience: ['#resilience', '#courage', '#strength', '#keepgoing', '#dontlookaway'],
  language: ['#wordsmatter', '#storytelling', '#writingcommunity', '#quotestoliveby'],
};

// Keywords that map reply content to hashtag pools
const KEYWORD_TO_POOL = [
  { keywords: ['wisdom', 'wise', 'lesson', 'learn', 'teach'], pool: 'wisdom' },
  { keywords: ['emotion', 'feel', 'feeling', 'grief', 'pain', 'joy', 'anger'], pool: 'emotion' },
  { keywords: ['grow', 'growth', 'change', 'evolve', 'transform', 'becoming'], pool: 'growth' },
  { keywords: ['mind', 'think', 'thought', 'aware', 'conscious', 'attention', 'present', 'presence'], pool: 'mindset' },
  { keywords: ['identity', 'self', 'who', 'define', 'definition', 'label', 'authentic'], pool: 'identity' },
  { keywords: ['tension', 'paradox', 'contradict', 'both', 'opposite', 'between'], pool: 'tension' },
  { keywords: ['courage', 'brave', 'fear', 'resilient', 'struggle', 'hold', 'stay'], pool: 'resilience' },
  { keywords: ['word', 'story', 'write', 'narrat', 'sentence', 'language', 'name', 'naming'], pool: 'language' },
  { keywords: ['philosophy', 'philosopher', 'existential', 'meaning', 'purpose', 'truth'], pool: 'philosophy' },
];

/**
 * Add relevant hashtags to reply/comment text on a variable schedule.
 * ~30% no tags, ~45% 1 tag, ~25% 2 tags. Keeps replies from looking spammy.
 */
function addRelevantHashtags(text) {
  if (!text || text.length < 20) return text;

  // Hash for deterministic selection (different seed than hooks)
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 7) - hash + text.charCodeAt(i)) | 0;
  }
  hash = Math.abs(hash);

  // Variable schedule: 30% skip, 45% one tag, 25% two tags
  const bucket = hash % 100;
  let tagCount;
  if (bucket < 30) return text;        // no hashtags
  else if (bucket < 75) tagCount = 1;  // 1 hashtag
  else tagCount = 2;                   // 2 hashtags

  // Find matching pools based on content keywords
  const lower = text.toLowerCase();
  const matchedPools = new Set();

  for (const mapping of KEYWORD_TO_POOL) {
    if (mapping.keywords.some(kw => lower.includes(kw))) {
      matchedPools.add(mapping.pool);
    }
  }

  // Always include tension pool as a candidate (brand tag)
  matchedPools.add('tension');

  // If no keyword matches, use philosophy + wisdom as fallback
  if (matchedPools.size <= 1) {
    matchedPools.add('philosophy');
    matchedPools.add('wisdom');
  }

  // Collect candidate hashtags from matched pools
  const candidates = [];
  for (const poolName of matchedPools) {
    const pool = HASHTAG_POOLS[poolName];
    if (pool) candidates.push(...pool);
  }

  // Dedupe and pick deterministically
  const unique = [...new Set(candidates)];
  const picked = [];
  for (let i = 0; i < tagCount && i < unique.length; i++) {
    const idx = (hash + i * 7) % unique.length;
    const tag = unique[idx];
    if (!picked.includes(tag)) picked.push(tag);
  }

  if (picked.length === 0) return text;

  // Append tags after a line break
  const trimmed = text.trimEnd();
  return `${trimmed}\n\n${picked.join(' ')}`;
}

// ============================================================================
// REPLY QUEUE
// ============================================================================

const REPLY_QUEUE_FILE = path.join(BASE_DIR, 'content', 'queue', 'reply-queue.json');

function getReplyQueue() {
  try {
    if (fs.existsSync(REPLY_QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(REPLY_QUEUE_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading reply queue:', err);
  }
  return { queue: [], posted: [], settings: { platforms: { bluesky: { maxRepliesPerDay: 5, minMinutesBetweenReplies: 15 }, twitter: { maxRepliesPerDay: 5, minMinutesBetweenReplies: 15 } } } };
}

function saveReplyQueue(data) {
  fs.writeFileSync(REPLY_QUEUE_FILE, JSON.stringify(data, null, 2));
}

/**
 * When a reply is published/posted, mark the linked task as completed
 */
function completeLinkedTask(taskId, platform) {
  if (!taskId) return;
  try {
    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === taskId);
    if (!task || task.status === 'completed' || task.status === 'shipped') return;

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.completedBy = platform === 'bluesky' ? 'reply-queue-auto' : 'human';

    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'task_completed',
      agentId: task.completedBy,
      taskId,
      timestamp: new Date().toISOString(),
      description: `Completed: ${task.title}`,
      metadata: {
        completedBy: task.completedBy,
        source: 'reply-queue',
        platform
      }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;
    console.log(`[ReplyQueue] Marked task ${taskId} as completed`);
  } catch (err) {
    console.error(`[ReplyQueue] Failed to complete task ${taskId}:`, err.message);
  }
}

/**
 * Resolve a bsky.app URL to uri + cid + author + text
 */
async function resolveBskyUrl(url) {
  const match = url.match(/bsky\.app\/profile\/([^/]+)\/post\/([^/?]+)/);
  if (!match) throw new Error('Invalid Bluesky URL format');
  const [, handle, rkey] = match;

  const agent = await getBskyAgent();

  // Resolve handle to DID
  const resolved = await agent.resolveHandle({ handle });
  const did = resolved.data.did;

  // Construct AT URI and fetch post
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  const postRes = await agent.getPosts({ uris: [uri] });
  const post = postRes.data.posts[0];
  if (!post) throw new Error('Post not found');

  return {
    targetUri: post.uri,
    targetCid: post.cid,
    targetAuthor: post.author.handle,
    targetText: post.record?.text || ''
  };
}

/**
 * Post a reply to Bluesky
 */
async function replyToBluesky(text, parentUri, parentCid) {
  const agent = await getBskyAgent();
  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  const result = await agent.post({
    text: rt.text,
    facets: rt.facets,
    reply: {
      root: { uri: parentUri, cid: parentCid },
      parent: { uri: parentUri, cid: parentCid }
    },
    createdAt: new Date().toISOString()
  });
  const rkey = result.uri.split('/').pop();
  const postUrl = `https://bsky.app/profile/${process.env.BLUESKY_HANDLE}/post/${rkey}`;
  return { uri: result.uri, cid: result.cid, postUrl };
}

/**
 * Get reply queue with rate limit status
 */
app.get('/api/reply-queue', (req, res) => {
  try {
    const data = getReplyQueue();
    const settings = data.settings || {};
    const posted = data.posted || [];
    const today = new Date().toISOString().split('T')[0];

    const repliesToday = {
      bluesky: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'bluesky').length,
      twitter: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'twitter').length
    };

    const bskySettings = settings.platforms?.bluesky || { maxRepliesPerDay: 5 };
    const twitterSettings = settings.platforms?.twitter || { maxRepliesPerDay: 5 };

    res.json({
      ...data,
      repliesToday,
      canReplyBluesky: repliesToday.bluesky < bskySettings.maxRepliesPerDay,
      canReplyTwitter: repliesToday.twitter < twitterSettings.maxRepliesPerDay
    });
  } catch (error) {
    console.error('Error getting reply queue:', error);
    res.status(500).json({ error: 'Failed to get reply queue' });
  }
});

/**
 * Add item to reply queue
 */
app.post('/api/reply-queue', (req, res) => {
  try {
    const data = getReplyQueue();
    const { platform, targetUrl, targetAuthor, targetText, replyText, taskId } = req.body;

    if (!platform || !['bluesky', 'twitter'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform (bluesky or twitter)' });
    }
    if (!targetUrl || !replyText) {
      return res.status(400).json({ error: 'targetUrl and replyText are required' });
    }

    // Add conversational hook and hashtags unless caller opts out
    let processedReplyText = req.body.skipHook ? replyText : addConversationalHook(replyText);
    if (!req.body.skipHook) processedReplyText = addRelevantHashtags(processedReplyText);

    const item = {
      id: `reply-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'ready',
      platform,
      targetUrl,
      targetAuthor: targetAuthor || '',
      targetText: targetText || '',
      replyText: processedReplyText,
      taskId: taskId || null,
      targetUri: null,
      targetCid: null
    };

    // Follow-outreach fields
    if (req.body.followTarget) {
      item.followTarget = true;
      item.followUrl = req.body.followUrl || '';
    }

    data.queue.push(item);
    saveReplyQueue(data);
    res.json({ success: true, item });
  } catch (error) {
    console.error('Error adding to reply queue:', error);
    res.status(500).json({ error: 'Failed to add to reply queue' });
  }
});

/**
 * Edit reply queue item
 */
app.patch('/api/reply-queue/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = getReplyQueue();
    const item = data.queue.find(i => i.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const allowedFields = ['replyText', 'targetUrl', 'targetAuthor', 'targetText', 'taskId'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        item[field] = req.body[field];
      }
    }
    // Clear resolved data if URL changed
    if (req.body.targetUrl) {
      item.targetUri = null;
      item.targetCid = null;
    }

    saveReplyQueue(data);
    res.json({ success: true, item });
  } catch (error) {
    console.error('Error updating reply queue item:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

/**
 * Delete reply queue item
 */
app.delete('/api/reply-queue/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = getReplyQueue();
    const index = data.queue.findIndex(i => i.id === id);
    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    data.queue.splice(index, 1);
    saveReplyQueue(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting reply queue item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

/**
 * Mark reply as manually posted (Twitter)
 */
app.post('/api/reply-queue/:id/posted', (req, res) => {
  try {
    const { id } = req.params;
    const data = getReplyQueue();
    const index = data.queue.findIndex(i => i.id === id);
    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    const item = data.queue[index];
    item.postedAt = new Date().toISOString();
    item.status = 'posted';

    if (!data.posted) data.posted = [];
    data.posted.unshift(item);
    data.queue.splice(index, 1);

    saveReplyQueue(data);
    completeLinkedTask(item.taskId, item.platform);
    res.json({ success: true, item });
  } catch (error) {
    console.error('Error marking reply as posted:', error);
    res.status(500).json({ error: 'Failed to mark as posted' });
  }
});

/**
 * Auto-publish a Bluesky reply
 */
app.post('/api/reply-queue/:id/publish', async (req, res) => {
  try {
    const data = getReplyQueue();
    const idx = data.queue.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    const item = data.queue[idx];
    if (item.platform !== 'bluesky') {
      return res.status(400).json({ error: 'Only Bluesky replies can be auto-published' });
    }

    // Rate limit checks
    const settings = data.settings?.platforms?.bluesky || {};
    const maxPerDay = settings.maxRepliesPerDay || 5;
    const minMinutes = settings.minMinutesBetweenReplies || 15;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const posted = data.posted || [];
    const bskyPostedToday = posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'bluesky');

    if (bskyPostedToday.length >= maxPerDay) {
      return res.status(429).json({ error: `Daily limit reached (${maxPerDay} replies/day)` });
    }

    if (bskyPostedToday.length > 0) {
      const lastPostedAt = new Date(bskyPostedToday[0].postedAt);
      const minutesSinceLast = (now - lastPostedAt) / (1000 * 60);
      if (minutesSinceLast < minMinutes) {
        const waitMins = Math.ceil(minMinutes - minutesSinceLast);
        return res.status(429).json({ error: `Too soon — wait ${waitMins} more minutes (${minMinutes}min minimum between replies)` });
      }
    }

    // Resolve target URL if not already resolved
    if (!item.targetUri || !item.targetCid) {
      const resolved = await resolveBskyUrl(item.targetUrl);
      item.targetUri = resolved.targetUri;
      item.targetCid = resolved.targetCid;
      if (!item.targetAuthor) item.targetAuthor = resolved.targetAuthor;
      if (!item.targetText) item.targetText = resolved.targetText;
    }

    const result = await replyToBluesky(item.replyText, item.targetUri, item.targetCid);

    item.status = 'posted';
    item.postedAt = new Date().toISOString();
    item.postUrl = result.postUrl;
    item.replyUri = result.uri;

    data.queue.splice(idx, 1);
    if (!data.posted) data.posted = [];
    data.posted.unshift(item);
    saveReplyQueue(data);

    console.log(`[Bluesky] Reply published: ${result.postUrl}`);
    completeLinkedTask(item.taskId, item.platform);
    res.json({ success: true, item, postUrl: result.postUrl });
  } catch (error) {
    // Mark as failed but keep in queue for retry
    const data = getReplyQueue();
    const item = data.queue.find(i => i.id === req.params.id);
    if (item) {
      item.status = 'failed';
      item.lastError = error.message;
      item.lastAttempt = new Date().toISOString();
      saveReplyQueue(data);
    }
    console.error('[Bluesky] Reply publish failed:', error.message);
    res.status(500).json({ error: 'Failed to publish reply' });
  }
});

// ============================================================================
// COMMENT QUEUE (Proactive outreach — commenting on other people's posts)
// ============================================================================

function getCommentQueue() {
  try {
    if (fs.existsSync(COMMENT_QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(COMMENT_QUEUE_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading comment queue:', err);
  }
  return {
    queue: [], posted: [],
    settings: {
      platforms: {
        bluesky: { enabled: true, maxCommentsPerDay: 5, minMinutesBetweenComments: 15 },
        twitter: { enabled: true, maxCommentsPerDay: 5, minMinutesBetweenComments: 15 }
      },
      scanKeywords: ['philosophy', 'stoicism', 'nietzsche', 'existentialism', 'meaning of life', 'paradox', 'tension', 'self-knowledge'],
      scanEnabled: true
    }
  };
}

function saveCommentQueue(data) {
  fs.writeFileSync(COMMENT_QUEUE_FILE, JSON.stringify(data, null, 2));
}

/**
 * Get comment queue with rate limit status
 */
app.get('/api/comment-queue', (req, res) => {
  try {
    const data = getCommentQueue();
    const settings = data.settings || {};
    const posted = data.posted || [];
    const today = new Date().toISOString().split('T')[0];

    const commentsToday = {
      bluesky: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'bluesky').length,
      twitter: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'twitter').length
    };

    const bskySettings = settings.platforms?.bluesky || { maxCommentsPerDay: 5 };
    const twitterSettings = settings.platforms?.twitter || { maxCommentsPerDay: 5 };

    res.json({
      ...data,
      commentsToday,
      canCommentBluesky: commentsToday.bluesky < bskySettings.maxCommentsPerDay,
      canCommentTwitter: commentsToday.twitter < twitterSettings.maxCommentsPerDay
    });
  } catch (error) {
    console.error('Error getting comment queue:', error);
    res.status(500).json({ error: 'Failed to get comment queue' });
  }
});

/**
 * Add item to comment queue manually
 */
app.post('/api/comment-queue', async (req, res) => {
  try {
    const data = getCommentQueue();
    const { platform, targetUrl, targetText, commentText, philosopher } = req.body;

    if (!platform || !['bluesky', 'twitter'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform (bluesky or twitter)' });
    }
    if (!targetUrl) {
      return res.status(400).json({ error: 'targetUrl is required' });
    }

    const item = {
      id: `comment-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: commentText ? 'ready' : 'draft',
      platform,
      targetUrl,
      targetAuthor: '',
      targetText: targetText || '',
      commentText: commentText || '',
      philosopher: philosopher || 'nietzsche',
      source: 'manual',
      targetUri: null,
      targetCid: null
    };

    // Try to resolve Bluesky URL for metadata
    if (platform === 'bluesky' && targetUrl.includes('bsky.app')) {
      try {
        const resolved = await resolveBskyUrl(targetUrl);
        item.targetUri = resolved.targetUri;
        item.targetCid = resolved.targetCid;
        if (!item.targetAuthor) item.targetAuthor = resolved.targetAuthor;
        if (!item.targetText) item.targetText = resolved.targetText;
      } catch (e) {
        console.log('[CommentQueue] Could not resolve Bluesky URL (will retry on publish):', e.message);
      }
    }

    data.queue.push(item);
    saveCommentQueue(data);
    res.json({ success: true, item });
  } catch (error) {
    console.error('Error adding to comment queue:', error);
    res.status(500).json({ error: 'Failed to add to comment queue' });
  }
});

/**
 * Manual trigger for comment scan (must be before :id routes)
 */
app.post('/api/comment-queue/scan', async (req, res) => {
  try {
    const result = await scanForCommentableContent();
    res.json(result);
  } catch (error) {
    console.error('[CommentQueue] Manual scan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Edit comment queue item
 */
app.patch('/api/comment-queue/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = getCommentQueue();
    const item = data.queue.find(i => i.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const allowedFields = ['commentText', 'targetUrl', 'targetAuthor', 'targetText', 'philosopher', 'status'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        item[field] = req.body[field];
      }
    }

    // If comment text was added/changed, upgrade from draft to ready
    if (req.body.commentText && item.status === 'draft') {
      item.status = 'ready';
    }

    // Clear resolved data if URL changed
    if (req.body.targetUrl) {
      item.targetUri = null;
      item.targetCid = null;
    }

    saveCommentQueue(data);
    res.json({ success: true, item });
  } catch (error) {
    console.error('Error updating comment queue item:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

/**
 * Delete comment queue item
 */
app.delete('/api/comment-queue/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = getCommentQueue();
    const index = data.queue.findIndex(i => i.id === id);
    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    data.queue.splice(index, 1);
    saveCommentQueue(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting comment queue item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

/**
 * Mark comment as manually posted (Twitter)
 */
app.post('/api/comment-queue/:id/posted', (req, res) => {
  try {
    const { id } = req.params;
    const data = getCommentQueue();
    const index = data.queue.findIndex(i => i.id === id);
    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    const item = data.queue[index];
    item.postedAt = new Date().toISOString();
    item.status = 'posted';

    if (!data.posted) data.posted = [];
    data.posted.unshift(item);
    data.queue.splice(index, 1);

    saveCommentQueue(data);
    res.json({ success: true, item });
  } catch (error) {
    console.error('Error marking comment as posted:', error);
    res.status(500).json({ error: 'Failed to mark as posted' });
  }
});

/**
 * Auto-publish a Bluesky comment (uses replyToBluesky — comments ARE replies on Bluesky)
 */
app.post('/api/comment-queue/:id/publish', async (req, res) => {
  try {
    const data = getCommentQueue();
    const idx = data.queue.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    const item = data.queue[idx];
    if (item.platform !== 'bluesky') {
      return res.status(400).json({ error: 'Only Bluesky comments can be auto-published' });
    }
    if (!item.commentText) {
      return res.status(400).json({ error: 'Comment text is empty — generate or write one first' });
    }

    // Rate limit checks
    const settings = data.settings?.platforms?.bluesky || {};
    const maxPerDay = settings.maxCommentsPerDay || 5;
    const minMinutes = settings.minMinutesBetweenComments || 15;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const posted = data.posted || [];
    const bskyPostedToday = posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'bluesky');

    if (bskyPostedToday.length >= maxPerDay) {
      return res.status(429).json({ error: `Daily limit reached (${maxPerDay} comments/day)` });
    }

    if (bskyPostedToday.length > 0) {
      const lastPostedAt = new Date(bskyPostedToday[0].postedAt);
      const minutesSinceLast = (now - lastPostedAt) / (1000 * 60);
      if (minutesSinceLast < minMinutes) {
        const waitMins = Math.ceil(minMinutes - minutesSinceLast);
        return res.status(429).json({ error: `Too soon — wait ${waitMins} more minutes (${minMinutes}min minimum between comments)` });
      }
    }

    // Resolve target URL if not already resolved
    if (!item.targetUri || !item.targetCid) {
      const resolved = await resolveBskyUrl(item.targetUrl);
      item.targetUri = resolved.targetUri;
      item.targetCid = resolved.targetCid;
      if (!item.targetAuthor) item.targetAuthor = resolved.targetAuthor;
      if (!item.targetText) item.targetText = resolved.targetText;
    }

    const result = await replyToBluesky(item.commentText, item.targetUri, item.targetCid);

    item.status = 'posted';
    item.postedAt = new Date().toISOString();
    item.postUrl = result.postUrl;
    item.commentUri = result.uri;

    data.queue.splice(idx, 1);
    if (!data.posted) data.posted = [];
    data.posted.unshift(item);
    saveCommentQueue(data);

    console.log(`[CommentQueue] Comment published: ${result.postUrl}`);
    res.json({ success: true, item, postUrl: result.postUrl });
  } catch (error) {
    // Mark as failed but keep in queue for retry
    const data = getCommentQueue();
    const item = data.queue.find(i => i.id === req.params.id);
    if (item) {
      item.status = 'failed';
      item.lastError = error.message;
      item.lastAttempt = new Date().toISOString();
      saveCommentQueue(data);
    }
    console.error('[CommentQueue] Publish failed:', error.message);
    res.status(500).json({ error: 'Failed to publish comment' });
  }
});

/**
 * Generate a comment using Claude (Sonnet) in a philosopher's voice
 */
app.post('/api/comment-queue/:id/generate', async (req, res) => {
  try {
    const client = getAnthropicClient();
    if (!client) {
      return res.status(501).json({ error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to cms/.env' });
    }

    const data = getCommentQueue();
    const item = data.queue.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const philosopher = item.philosopher || 'nietzsche';
    if (!isValidPhilosopher(philosopher)) {
      return res.status(400).json({ error: 'Invalid philosopher name' });
    }

    // Read philosopher SOUL.md for voice
    let soulContent = '';
    const soulPath = path.join(PHILOSOPHERS_DIR, philosopher, 'SOUL.md');
    if (fs.existsSync(soulPath)) {
      soulContent = fs.readFileSync(soulPath, 'utf8');
      if (soulContent.length > 2000) soulContent = soulContent.substring(0, 2000) + '\n...(truncated)';
    }

    const systemPrompt = `You are a philosopher commenting on someone else's social media post. You write as ${philosopher} — through the TensionLines brand.

${soulContent ? `## Voice & Personality:\n${soulContent}\n` : ''}
## Rules:
- Write a thoughtful, authentic comment that adds to the conversation.
- Be genuinely engaging — NOT self-promotional. Don't mention TensionLines or your own content.
- Match the tone of the original post — if it's casual, be casual. If it's deep, go deeper.
- Be concise. This is a comment, not an essay. One to three sentences.
- Never use generic motivational language. Be specific. Be surprising.
- IMPORTANT: Start or end with a short conversational hook — a phrase of agreement, resonance, or respectful pushback that connects you to what they said. Examples: "I'm with you —", "Spot on.", "This stopped me mid-scroll.", "Been thinking about this too —", "Hard to argue with that —", "Real talk —". Vary the hooks, make them feel natural, not templated. The hook bridges your thought to theirs.
- ${item.platform === 'bluesky' ? 'Must be ≤300 characters.' : 'Keep it tweet-length, under 280 characters.'}
- Return ONLY the comment text, nothing else. No quotes, no labels.`;

    const userPrompt = `Write a comment on this ${item.platform === 'bluesky' ? 'Bluesky' : 'Twitter'} post by @${item.targetAuthor || 'someone'}:

"${item.targetText}"

Write a single comment that would naturally fit in this conversation.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const commentText = (message.content[0]?.text || '').trim();
    if (!commentText) {
      return res.status(502).json({ error: 'Claude returned empty response' });
    }

    item.commentText = addRelevantHashtags(commentText);
    item.status = 'ready';
    item.generatedAt = new Date().toISOString();
    item.generatedModel = 'claude-sonnet-4-5-20250929';
    saveCommentQueue(data);

    console.log(`[CommentQueue] Generated comment for ${item.id} (${commentText.length} chars)`);
    res.json({ success: true, item, usage: message.usage });
  } catch (error) {
    console.error('[CommentQueue] Generate failed:', error);
    if (error.status === 401) {
      return res.status(502).json({ error: 'Invalid Anthropic API key' });
    }
    res.status(502).json({ error: 'Claude API call failed' });
  }
});

/**
 * Scan Bluesky for commentable philosophy-related posts
 */
async function scanForCommentableContent() {
  console.log('[CommentQueue] Starting scan for commentable content...');
  const data = getCommentQueue();
  const settings = data.settings || {};

  if (settings.scanEnabled === false) {
    console.log('[CommentQueue] Scanning disabled in settings');
    return { success: true, added: 0, message: 'Scanning disabled' };
  }

  const keywords = settings.scanKeywords || ['philosophy', 'stoicism', 'nietzsche', 'existentialism'];

  try {
    const agent = await getBskyAgent();
    const existingUrls = new Set([
      ...data.queue.map(i => i.targetUrl),
      ...data.posted.map(i => i.targetUrl)
    ]);

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    let candidates = [];

    // Search each keyword
    for (const keyword of keywords.slice(0, 4)) {
      try {
        const searchRes = await agent.app.bsky.feed.searchPosts({
          q: keyword,
          limit: 25,
          sort: 'top'
        });

        for (const post of (searchRes.data?.posts || [])) {
          const postUrl = `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`;

          // Skip: own posts, already queued, older than 24h
          if (post.author.handle === process.env.BLUESKY_HANDLE) continue;
          if (existingUrls.has(postUrl)) continue;
          const postDate = new Date(post.record?.createdAt || post.indexedAt);
          if (postDate < oneDayAgo) continue;

          const engagement = {
            likes: post.likeCount || 0,
            replies: post.replyCount || 0,
            reposts: post.repostCount || 0
          };
          const score = engagement.likes + (engagement.replies * 2) + engagement.reposts;

          candidates.push({
            uri: post.uri,
            cid: post.cid,
            url: postUrl,
            author: post.author.handle,
            text: post.record?.text || '',
            engagement,
            score,
            postDate
          });

          existingUrls.add(postUrl);
        }
      } catch (searchErr) {
        console.error(`[CommentQueue] Search failed for "${keyword}":`, searchErr.message);
      }
    }

    // Sort by engagement score and take top 10
    candidates.sort((a, b) => b.score - a.score);
    candidates = candidates.slice(0, 10);

    // Add to queue as drafts
    let added = 0;
    for (const c of candidates) {
      data.queue.push({
        id: `comment-${Date.now()}-${added}`,
        createdAt: new Date().toISOString(),
        status: 'draft',
        platform: 'bluesky',
        targetUrl: c.url,
        targetAuthor: c.author,
        targetText: c.text,
        commentText: '',
        philosopher: 'nietzsche',
        source: 'scan',
        targetUri: c.uri,
        targetCid: c.cid,
        engagement: c.engagement
      });
      added++;
    }

    if (added > 0) {
      saveCommentQueue(data);
    }

    console.log(`[CommentQueue] Scan complete: ${added} new candidates from ${candidates.length + (data.queue.length - added)} total found`);
    return { success: true, added, message: `Found ${added} new posts` };
  } catch (error) {
    console.error('[CommentQueue] Scan error:', error.message);
    return { success: false, error: error.message };
  }
}

// Comment queue scan cron: 3x daily at prime engagement hours (10 AM, 2 PM, 6 PM PST)
cron.schedule('0 10,14,18 * * *', async () => {
  try {
    await scanForCommentableContent();
    recordCronRun('comment-scan');
    logSystemEvent('cron', 'Comment queue scan completed');
  } catch (e) {
    console.error('[CommentQueue] Scheduled scan failed:', e.message);
    recordCronRun('comment-scan', null, e.message);
    logSystemEvent('error', `Comment scan failed: ${e.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[CommentQueue] Scan scheduled: 10 AM, 2 PM, 6 PM PST daily');

// ============================================================================
// ENGAGEMENT INBOX (Reply & Mention Monitor)
// ============================================================================

function getEngagementInbox() {
  if (cache.engagementInbox) return cache.engagementInbox;
  try {
    if (fs.existsSync(ENGAGEMENT_INBOX_FILE)) {
      cache.engagementInbox = JSON.parse(fs.readFileSync(ENGAGEMENT_INBOX_FILE, 'utf8'));
      return cache.engagementInbox;
    }
  } catch (err) {
    console.error('Error reading engagement inbox:', err);
  }
  return {
    bluesky: { lastScannedAt: null, items: [] },
    twitter: { lastScannedAt: null, items: [] },
    settings: {
      bluesky: { scanIntervalMinutes: 15, autoScan: true },
      twitter: { autoScan: false }
    }
  };
}

function saveEngagementInbox(data) {
  fs.writeFileSync(ENGAGEMENT_INBOX_FILE, JSON.stringify(data, null, 2));
  cache.engagementInbox = null;
}

function createEngagementNotification(item) {
  try {
    const mc = getMissionControl();
    const notifType = item.type === 'reply' ? 'engagement_reply' : 'engagement_mention';
    const title = item.type === 'reply'
      ? `Reply from @${item.authorHandle}`
      : `Mentioned by @${item.authorHandle}`;

    mc.notifications.unshift({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: notifType,
      title,
      message: item.postText || '(no text)',
      from: 'engagement-monitor',
      read: false,
      createdAt: new Date().toISOString(),
      priority: 'medium',
      actionRequired: true,
      metadata: {
        platform: item.platform,
        engagementId: item.id,
        authorHandle: item.authorHandle,
        postUrl: item.postUrl,
        postUri: item.postUri || null,
        postCid: item.postCid || null,
        ourPostUrl: item.ourPostUrl || null
      }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
    cache.missionControl = null;
  } catch (err) {
    console.error('[Engagement] Failed to create notification:', err.message);
  }
}

async function scanBlueskyEngagement() {
  console.log('[Engagement] Scanning Bluesky notifications...');
  try {
    const agent = await getBskyAgent();
    const response = await agent.listNotifications({ limit: 50 });
    const notifications = response.data.notifications || [];

    const relevant = notifications.filter(n => n.reason === 'reply' || n.reason === 'mention');
    if (relevant.length === 0) {
      console.log('[Engagement] No new Bluesky replies/mentions found');
    }

    const inbox = getEngagementInbox();
    const existingIds = new Set(inbox.bluesky.items.map(i => i.id));
    let newCount = 0;

    for (const notif of relevant) {
      const itemId = `bsky-${notif.uri}`;
      if (existingIds.has(itemId)) continue;

      const authorHandle = notif.author?.handle || 'unknown';
      const authorDisplayName = notif.author?.displayName || authorHandle;
      const postText = notif.record?.text || '';
      const rkey = notif.uri.split('/').pop();
      const postUrl = `https://bsky.app/profile/${authorHandle}/post/${rkey}`;

      // Build our post URL if this is a reply
      let ourPostUrl = null;
      if (notif.reason === 'reply' && notif.record?.reply?.parent?.uri) {
        const ourRkey = notif.record.reply.parent.uri.split('/').pop();
        ourPostUrl = `https://bsky.app/profile/${process.env.BLUESKY_HANDLE}/post/${ourRkey}`;
      }

      const item = {
        id: itemId,
        platform: 'bluesky',
        type: notif.reason === 'reply' ? 'reply' : 'mention',
        authorHandle,
        authorDisplayName,
        postText,
        postUrl,
        postUri: notif.uri,
        postCid: notif.cid,
        ourPostUrl,
        indexedAt: notif.indexedAt,
        scannedAt: new Date().toISOString(),
        status: 'new'
      };

      inbox.bluesky.items.unshift(item);
      createEngagementNotification(item);
      newCount++;
    }

    // Cap at 200 items
    if (inbox.bluesky.items.length > 200) {
      inbox.bluesky.items = inbox.bluesky.items.slice(0, 200);
    }

    inbox.bluesky.lastScannedAt = new Date().toISOString();
    saveEngagementInbox(inbox);

    console.log(`[Engagement] Bluesky scan complete: ${newCount} new items found`);
    return { success: true, newCount, total: inbox.bluesky.items.length };
  } catch (err) {
    console.error('[Engagement] Bluesky scan failed:', err.message);
    return { success: false, error: err.message };
  }
}

function scanTwitterEngagement() {
  console.log('[Engagement] Scanning Twitter mentions...');
  try {
    if (!fs.existsSync(BIRD_CLI)) {
      return { success: false, error: 'Bird CLI not found' };
    }

    const opts = { timeout: 30000, encoding: 'utf8' };
    let mentions = [];
    try {
      const raw = execSync(`${BIRD_CLI} mentions --json 2>/dev/null`, opts);
      mentions = JSON.parse(raw);
      if (!Array.isArray(mentions)) mentions = mentions.tweets || mentions.data || [];
    } catch (e) {
      console.error('[Engagement] Bird mentions command failed:', e.message);
      return { success: false, error: `Bird CLI error: ${e.message}` };
    }

    const inbox = getEngagementInbox();
    const existingIds = new Set(inbox.twitter.items.map(i => i.id));
    let newCount = 0;

    for (const tweet of mentions) {
      const tweetId = tweet.id || tweet.id_str;
      if (!tweetId) continue;
      const itemId = `twitter-${tweetId}`;
      if (existingIds.has(itemId)) continue;

      const authorHandle = tweet.user?.screen_name || tweet.author?.username || 'unknown';
      const authorDisplayName = tweet.user?.name || tweet.author?.name || authorHandle;
      const postText = tweet.text || tweet.full_text || '';
      const postUrl = `https://x.com/${authorHandle}/status/${tweetId}`;

      // Check if this is a reply to us or a mention
      const isReply = tweet.in_reply_to_screen_name?.toLowerCase() === 'thetensionlines' ||
                      tweet.in_reply_to_user_id != null;

      let ourPostUrl = null;
      if (isReply && tweet.in_reply_to_status_id_str) {
        ourPostUrl = `https://x.com/thetensionlines/status/${tweet.in_reply_to_status_id_str}`;
      }

      const item = {
        id: itemId,
        platform: 'twitter',
        type: isReply ? 'reply' : 'mention',
        authorHandle,
        authorDisplayName,
        postText,
        postUrl,
        postUri: null,
        postCid: null,
        ourPostUrl,
        indexedAt: tweet.created_at || new Date().toISOString(),
        scannedAt: new Date().toISOString(),
        status: 'new'
      };

      inbox.twitter.items.unshift(item);
      createEngagementNotification(item);
      newCount++;
    }

    // Cap at 200 items
    if (inbox.twitter.items.length > 200) {
      inbox.twitter.items = inbox.twitter.items.slice(0, 200);
    }

    inbox.twitter.lastScannedAt = new Date().toISOString();
    saveEngagementInbox(inbox);

    console.log(`[Engagement] Twitter scan complete: ${newCount} new items found`);
    return { success: true, newCount, total: inbox.twitter.items.length };
  } catch (err) {
    console.error('[Engagement] Twitter scan failed:', err.message);
    return { success: false, error: err.message };
  }
}

// --- Engagement API Routes ---

/**
 * GET /api/engagement - List engagement items with optional filters
 */
app.get('/api/engagement', (req, res) => {
  try {
    const inbox = getEngagementInbox();
    const { platform, status } = req.query;

    let items = [
      ...inbox.bluesky.items.map(i => ({ ...i })),
      ...inbox.twitter.items.map(i => ({ ...i }))
    ];

    if (platform) {
      items = items.filter(i => i.platform === platform);
    }
    if (status) {
      items = items.filter(i => i.status === status);
    }

    // Sort by indexedAt descending
    items.sort((a, b) => new Date(b.indexedAt) - new Date(a.indexedAt));

    const stats = {
      bluesky: {
        total: inbox.bluesky.items.length,
        new: inbox.bluesky.items.filter(i => i.status === 'new').length,
        lastScannedAt: inbox.bluesky.lastScannedAt
      },
      twitter: {
        total: inbox.twitter.items.length,
        new: inbox.twitter.items.filter(i => i.status === 'new').length,
        lastScannedAt: inbox.twitter.lastScannedAt
      }
    };

    res.json({ items, stats, settings: inbox.settings });
  } catch (err) {
    console.error('Error getting engagement inbox:', err);
    res.status(500).json({ error: 'Failed to get engagement inbox' });
  }
});

/**
 * POST /api/engagement/scan - Trigger a scan
 */
app.post('/api/engagement/scan', async (req, res) => {
  try {
    const { platform } = req.body;
    const results = {};

    if (!platform || platform === 'bluesky') {
      results.bluesky = await scanBlueskyEngagement();
    }
    if (!platform || platform === 'twitter') {
      results.twitter = scanTwitterEngagement();
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error('Error scanning engagement:', err);
    res.status(500).json({ error: 'Scan failed', message: err.message });
  }
});

/**
 * PATCH /api/engagement/:id - Update item status
 */
app.patch('/api/engagement/:id', (req, res) => {
  try {
    const { status } = req.body;
    if (!['new', 'seen', 'replied', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: new, seen, replied, dismissed' });
    }

    const inbox = getEngagementInbox();
    const id = req.params.id;

    // Find in bluesky or twitter items
    let item = inbox.bluesky.items.find(i => i.id === id);
    if (!item) item = inbox.twitter.items.find(i => i.id === id);
    if (!item) return res.status(404).json({ error: 'Engagement item not found' });

    item.status = status;
    if (status === 'seen' || status === 'replied' || status === 'dismissed') {
      item.updatedAt = new Date().toISOString();
    }
    saveEngagementInbox(inbox);

    res.json({ success: true, item });
  } catch (err) {
    console.error('Error updating engagement item:', err);
    res.status(500).json({ error: 'Failed to update engagement item' });
  }
});

/**
 * POST /api/engagement/:id/draft-reply - Create reply queue item from engagement
 */
app.post('/api/engagement/:id/draft-reply', (req, res) => {
  try {
    const inbox = getEngagementInbox();
    const id = req.params.id;

    let item = inbox.bluesky.items.find(i => i.id === id);
    if (!item) item = inbox.twitter.items.find(i => i.id === id);
    if (!item) return res.status(404).json({ error: 'Engagement item not found' });

    // Create reply queue entry
    const replyQueue = getReplyQueue();
    const replyItem = {
      id: `reply-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'ready',
      platform: item.platform,
      targetUrl: item.postUrl,
      targetAuthor: item.authorHandle,
      targetText: item.postText,
      replyText: '',
      taskId: null,
      targetUri: item.postUri || null,
      targetCid: item.postCid || null,
      engagementId: item.id
    };

    replyQueue.queue.unshift(replyItem);
    saveReplyQueue(replyQueue);

    // Mark engagement item as replied
    item.status = 'replied';
    item.updatedAt = new Date().toISOString();
    saveEngagementInbox(inbox);

    res.json({ success: true, replyItem });
  } catch (err) {
    console.error('Error creating draft reply from engagement:', err);
    res.status(500).json({ error: 'Failed to create draft reply' });
  }
});

// Auto-scan Bluesky every 15 minutes
let engagementScanInterval = null;
setTimeout(() => {
  console.log('[Engagement] Initial Bluesky scan in 60 seconds...');
  setTimeout(async () => {
    try { await scanBlueskyEngagement(); } catch (e) { console.error('[Engagement] Initial scan failed:', e.message); }
  }, 60000);

  const intervalMinutes = 15;
  engagementScanInterval = setInterval(async () => {
    try { await scanBlueskyEngagement(); } catch (e) { console.error('[Engagement] Auto-scan failed:', e.message); }
  }, intervalMinutes * 60 * 1000);
  console.log(`[Engagement] Bluesky auto-scan scheduled every ${intervalMinutes} minutes`);
}, 1000);

// ============================================================================
// REPOST CANDIDATES
// ============================================================================

function getRepostCandidates() {
  if (cache.repostCandidates) return cache.repostCandidates;
  try {
    if (fs.existsSync(REPOST_CANDIDATES_FILE)) {
      cache.repostCandidates = JSON.parse(fs.readFileSync(REPOST_CANDIDATES_FILE, 'utf8'));
      return cache.repostCandidates;
    }
  } catch (err) {
    console.error('Error reading repost candidates:', err);
  }
  return { candidates: [], converted: [], settings: { maxPerDay: 5 } };
}

function saveRepostCandidates(data) {
  fs.writeFileSync(REPOST_CANDIDATES_FILE, JSON.stringify(data, null, 2));
  cache.repostCandidates = null;
}

/**
 * Get pending repost candidates
 */
app.get('/api/repost-candidates', (req, res) => {
  try {
    const data = getRepostCandidates();
    const pending = data.candidates.filter(c => c.status === 'pending');
    res.json({
      candidates: pending,
      convertedCount: data.converted.length,
      settings: data.settings
    });
  } catch (error) {
    console.error('Error getting repost candidates:', error);
    res.status(500).json({ error: 'Failed to get repost candidates' });
  }
});

/**
 * Submit a new repost candidate
 */
app.post('/api/repost-candidates', (req, res) => {
  try {
    const { url, platform, submittedBy, author, originalText, commentary, reason, action } = req.body;

    // Validate required fields
    if (!url || !platform || !submittedBy || !commentary) {
      return res.status(400).json({
        error: 'Missing required fields: url, platform, submittedBy, commentary'
      });
    }

    const validActions = ['retweet', 'quote', 'reply', 'repost', 'share'];
    if (action && !validActions.includes(action)) {
      return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` });
    }

    const data = getRepostCandidates();
    const candidate = {
      id: `repost-${Date.now()}`,
      platform,
      submittedBy,
      url,
      author: author || null,
      originalText: originalText || null,
      commentary,
      reason: reason || null,
      action: action || 'quote',
      status: 'pending',
      submittedAt: new Date().toISOString()
    };

    data.candidates.push(candidate);
    saveRepostCandidates(data);

    console.log(`[Repost] New candidate from ${submittedBy}: ${url}`);
    res.json({ success: true, candidate });
  } catch (error) {
    console.error('Error adding repost candidate:', error);
    res.status(500).json({ error: 'Failed to add repost candidate' });
  }
});

/**
 * Reject/remove a repost candidate
 */
app.delete('/api/repost-candidates/:id', (req, res) => {
  try {
    const data = getRepostCandidates();
    const index = data.candidates.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    data.candidates.splice(index, 1);
    saveRepostCandidates(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing repost candidate:', error);
    res.status(500).json({ error: 'Failed to remove repost candidate' });
  }
});

/**
 * Convert pending repost candidates into human tasks
 */
function convertRepostCandidates() {
  console.log('[RepostCuration] Converting pending candidates to tasks...');

  const data = getRepostCandidates();
  const pending = data.candidates.filter(c => c.status === 'pending');

  if (pending.length === 0) {
    console.log('[RepostCuration] No pending candidates to convert');
    return { converted: 0 };
  }

  const maxPerDay = data.settings.maxPerDay || 5;
  const toConvert = pending.slice(0, maxPerDay);

  const mc = getMissionControl();

  // Find highest existing task number
  let highestNum = 0;
  mc.tasks.forEach(t => {
    const match = t.id.match(/^task-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > highestNum) highestNum = num;
    }
  });
  const baseNum = highestNum + 1;
  const baseId = `task-${String(baseNum).padStart(3, '0')}`;
  const suffixes = ['', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

  const now = new Date().toISOString();
  const convertedTasks = [];

  toConvert.forEach((candidate, index) => {
    const taskId = index === 0 ? baseId : `${baseId}${suffixes[index] || String.fromCharCode(97 + index)}`;

    // Build action label
    const actionLabels = {
      retweet: 'Retweet',
      quote: 'Quote tweet',
      reply: 'Reply to',
      repost: 'Repost',
      share: 'Share'
    };
    const actionLabel = actionLabels[candidate.action] || 'Share';
    const authorDisplay = candidate.author || 'this post';

    // Build description in task-033 format
    let description = `${actionLabel} ${authorDisplay} on ${candidate.platform}.\n`;

    if (candidate.originalText) {
      description += `\n**They said:** "${candidate.originalText}"\n`;
    }

    if (candidate.reason) {
      description += `\n**Why:** ${candidate.reason}\n`;
    }

    description += `\n${candidate.url}\n`;
    description += `\n> ${candidate.commentary}`;

    const task = {
      id: taskId,
      title: `${actionLabel} ${authorDisplay}`,
      description,
      status: 'assigned',
      assigneeIds: ['human'],
      llm: null,
      rationale: `Repost candidate from ${candidate.submittedBy}`,
      reviewerIds: [],
      createdBy: candidate.submittedBy,
      createdAt: now,
      startedAt: now,
      dispatchedAt: now,
      dispatchedBy: 'system',
      steps: [{
        id: `step-${Date.now()}-${index}`,
        description: `Submitted by ${candidate.submittedBy}`,
        status: 'completed',
        startedAt: candidate.submittedAt,
        completedAt: now,
        agentId: candidate.submittedBy
      }],
      metadata: {
        priority: 'medium',
        category: 'social',
        platform: candidate.platform,
        repostCandidate: true,
        repostAction: candidate.action,
        candidateId: candidate.id,
        originalText: candidate.originalText || null,
        estimatedMinutes: 2,
        tags: [candidate.platform, 'repost', candidate.action, 'social'],
        actionItems: [{
          label: actionLabel,
          url: candidate.url,
          suggestedComment: candidate.commentary
        }]
      }
    };

    mc.tasks.push(task);
    convertedTasks.push(task);

    // Mark candidate as converted
    candidate.status = 'converted';
    candidate.convertedAt = now;
    candidate.taskId = taskId;
  });

  // Move converted candidates to the converted array
  data.candidates = data.candidates.filter(c => c.status === 'pending');
  data.converted.push(...toConvert);

  // Log activity
  mc.activities.unshift({
    id: `act-${Date.now()}`,
    type: 'repost_conversion',
    agentId: 'system',
    message: `Converted ${convertedTasks.length} repost candidates into human tasks`,
    taskIds: convertedTasks.map(t => t.id),
    timestamp: now
  });

  // Save both files
  fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
  cache.missionControl = null;
  saveRepostCandidates(data);

  console.log(`[RepostCuration] Created ${convertedTasks.length} tasks: ${convertedTasks.map(t => t.id).join(', ')}`);
  return { converted: convertedTasks.length, tasks: convertedTasks.map(t => t.id) };
}

/**
 * Manually trigger repost candidate conversion
 */
app.post('/api/repost-candidates/convert', (req, res) => {
  try {
    const result = convertRepostCandidates();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error converting repost candidates:', error);
    res.status(500).json({ error: 'Failed to convert repost candidates' });
  }
});

/**
 * Get notifications (by agent, read/unread)
 */
app.get('/api/notifications', (req, res) => {
  try {
    const mc = getMissionControl();
    let notifications = mc.notifications;

    // Filter by recipient
    if (req.query.agent) {
      notifications = notifications.filter(n => n.recipientId === req.query.agent);
    }

    // Filter by read status
    if (req.query.unread === 'true') {
      notifications = notifications.filter(n => !n.read);
    }

    res.json(notifications);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Mark a notification as read
 */
app.post('/api/notifications/:id/read', (req, res) => {
  try {
    const mc = getMissionControl();
    const notifIndex = mc.notifications.findIndex(n => n.id === req.params.id);

    if (notifIndex === -1) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    mc.notifications[notifIndex].read = true;
    mc.notifications[notifIndex].readAt = new Date().toISOString();
    mc.notifications[notifIndex].readBy = 'human';

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
    cache.missionControl = null;

    res.json({ success: true, notification: mc.notifications[notifIndex] });
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Mark all notifications as read
 */
app.post('/api/notifications/mark-all-read', (req, res) => {
  try {
    const mc = getMissionControl();
    const now = new Date().toISOString();
    let markedCount = 0;

    mc.notifications.forEach(n => {
      if (!n.read) {
        n.read = true;
        n.readAt = now;
        n.readBy = 'human';
        markedCount++;
      }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
    cache.missionControl = null;

    res.json({ success: true, markedCount });
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get ideas bank
 */
app.get('/api/ideas', (req, res) => {
  try {
    const ideas = parseIdeasBank();

    // Count how many times each idea has been repurposed (posting queue + tasks)
    const counts = {};
    try {
      const queue = getPostingQueue();
      const allItems = [...(queue.queue || []), ...(queue.posted || [])];
      for (const item of allItems) {
        if (item.ideaId) {
          counts[item.ideaId] = (counts[item.ideaId] || 0) + 1;
        }
      }
    } catch (e) { /* ignore */ }
    try {
      const mc = JSON.parse(fs.readFileSync(MISSION_CONTROL_DB, 'utf8'));
      for (const task of mc.tasks || []) {
        if (task.ideaId && task.type === 'content') {
          counts[task.ideaId] = (counts[task.ideaId] || 0) + 1;
        }
      }
    } catch (e) { /* ignore */ }

    const enriched = ideas.map(idea => ({
      ...idea,
      repurposeCount: counts[idea.id] || 0
    }));

    res.json(enriched);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Add a new idea to ideas-bank.md
 */
app.post('/api/ideas', (req, res) => {
  try {
    const { text, source } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text is required' });
    }

    // Find next idea ID
    const ideas = parseIdeasBank();
    const maxId = ideas.reduce((max, idea) => {
      const num = parseInt(idea.id, 10);
      return num > max ? num : max;
    }, 0);
    const nextId = String(maxId + 1).padStart(3, '0');

    // Format timestamp
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles'
    }) + ' PST';
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD

    // Check if today's date section exists
    const content = fs.readFileSync(IDEAS_BANK, 'utf8');
    const dateSectionExists = content.includes(`## ${dateStr}`);

    // Build the new entry
    let entry = '';
    if (!dateSectionExists) {
      entry += `\n## ${dateStr}\n`;
    }
    entry += `\n### #${nextId} - ${timeStr}\n`;
    entry += `**Quote:** "${text.trim()}"\n`;
    entry += `**Tags:** \n`;
    entry += `**Status:** 🔵 New\n`;
    if (source) {
      entry += `**Source:** ${source}\n`;
    }
    entry += '\n---\n';

    // Append to file
    fs.appendFileSync(IDEAS_BANK, entry);

    // Invalidate cache
    cache.ideasBank = null;

    // Broadcast update via WebSocket
    broadcast('ideas');

    const newIdea = {
      id: nextId,
      date: dateStr,
      capturedAt: timeStr,
      text: text.trim(),
      status: 'captured',
      source: source || 'cms'
    };

    console.log(`[Ideas] New idea #${nextId} captured via ${source || 'cms'}: "${text.trim().substring(0, 60)}..."`);

    // Auto-complete the weekly idea task if goal is now met
    try {
      const mc = getMissionControl();
      if (syncWeeklyIdeaTask(mc)) {
        fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
        cache.missionControl = null;
        broadcast('tasks');
      }
    } catch (e) { /* non-critical */ }

    // Fire-and-forget: auto-tag + agent takes
    processNewIdea(nextId, text.trim()).catch(err =>
      console.error('[Ideas] Background processing failed:', err.message)
    );

    res.status(201).json(newIdea);
  } catch (error) {
    console.error('Error adding idea:', error);
    res.status(500).json({ error: 'Failed to add idea' });
  }
});

/**
 * Process a new idea: auto-tag with Claude + get agent takes.
 * Runs async in the background after capture.
 */
async function processNewIdea(ideaId, ideaText) {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[Ideas] Skipping auto-process: no ANTHROPIC_API_KEY');
    return;
  }

  // Step 1: Auto-tag
  try {
    const tagResponse = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: 'You tag philosophical ideas for a content system. Return ONLY a JSON array of 3-7 lowercase tag strings. Tags should capture core themes, tensions, and relevant philosophical concepts. No explanation, just the JSON array.',
      messages: [{
        role: 'user',
        content: `Tag this idea:\n"${ideaText}"`
      }]
    });

    const tagText = tagResponse.content[0]?.text || '';
    const tagMatch = tagText.match(/\[[\s\S]*\]/);
    if (tagMatch) {
      const tags = JSON.parse(tagMatch[0]).filter(t => typeof t === 'string').map(t => t.toLowerCase().replace(/[^a-z0-9-]/g, ''));
      if (tags.length > 0) {
        // Update the markdown file: replace empty **Tags:** line with actual tags
        const content = fs.readFileSync(IDEAS_BANK, 'utf8');
        const paddedId = String(ideaId).padStart(3, '0');
        // Find the Tags line for this idea (between its header and the next --- or header)
        const ideaHeaderPattern = new RegExp(`(### #${paddedId}[\\s\\S]*?\\*\\*Tags:\\*\\*)\\s*\\n`);
        const updated = content.replace(ideaHeaderPattern, `$1 ${tags.join(', ')}\n`);
        if (updated !== content) {
          fs.writeFileSync(IDEAS_BANK, updated);
          cache.ideasBank = null;
          broadcast('ideas');
          console.log(`[Ideas] Auto-tagged #${paddedId}: ${tags.join(', ')}`);
        }
      }
    }
  } catch (err) {
    console.error('[Ideas] Auto-tag failed:', err.message);
  }

  // Step 2: Agent takes — pick 3 agents for varied perspectives
  const agents = [
    { id: 'nietzsche', name: 'Nietzsche', voice: 'provocative, challenges assumptions, finds the hidden tension' },
    { id: 'diogenes', name: 'Diogenes', voice: 'blunt, strips pretension, asks the uncomfortable question' },
    { id: 'hypatia', name: 'Hypatia', voice: 'precise, finds the structural connection, bridges theory and practice' }
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: `You are generating brief reactions from three philosophical voices to a new idea. Each voice gives their honest, distinct take in 1-2 sentences. Keep it punchy and useful — these are working notes, not essays.

Return ONLY valid JSON in this format:
[
  {"agent": "nietzsche", "take": "..."},
  {"agent": "diogenes", "take": "..."},
  {"agent": "hypatia", "take": "..."}
]

Voice guide:
- nietzsche: provocative, challenges assumptions, finds the hidden tension
- diogenes: blunt, strips pretension, asks the uncomfortable real-world question
- hypatia: precise, finds structural connections, bridges theory and practice`,
      messages: [{
        role: 'user',
        content: `New idea captured:\n"${ideaText}"\n\nGive each agent's quick take.`
      }]
    });

    const takesText = response.content[0]?.text || '';
    const takesMatch = takesText.match(/\[[\s\S]*\]/);
    if (takesMatch) {
      const takes = JSON.parse(takesMatch[0]);
      const paddedId = String(ideaId).padStart(3, '0');

      // Send each take as an agent message
      for (const take of takes) {
        const agent = agents.find(a => a.id === take.agent);
        if (!agent || !take.take) continue;

        sendAgentMessage({
          from: take.agent,
          to: 'human',
          subject: `Take on idea #${paddedId}`,
          body: take.take,
          type: 'idea-take',
          priority: 'low',
          metadata: { ideaId: paddedId, ideaText: ideaText.substring(0, 200) }
        });
      }
      console.log(`[Ideas] Agent takes sent for #${paddedId}: ${takes.length} responses`);
    }
  } catch (err) {
    console.error('[Ideas] Agent takes failed:', err.message);
  }
}

/**
 * Delete an idea from ideas-bank.md
 */
app.delete('/api/ideas/:id', (req, res) => {
  try {
    const targetId = req.params.id.replace(/^#/, '');
    const content = fs.readFileSync(IDEAS_BANK, 'utf8');
    const lines = content.split('\n');

    // Find the idea's header line and the range to remove
    let startLine = -1;
    let endLine = lines.length;
    const headerPattern = new RegExp(`^###?\\s+#?0*${parseInt(targetId, 10)}\\s+[-|]`);

    for (let i = 0; i < lines.length; i++) {
      if (headerPattern.test(lines[i])) {
        startLine = i;
        // Find the end: next idea header, next date header, or end of file
        for (let j = i + 1; j < lines.length; j++) {
          if (/^###?\s+#?\d+\s+[-|]/.test(lines[j]) || /^##\s+\d{4}-\d{2}-\d{2}/.test(lines[j])) {
            endLine = j;
            break;
          }
        }
        break;
      }
    }

    if (startLine === -1) {
      return res.status(404).json({ error: 'Idea not found' });
    }

    // Remove the lines and any trailing blank lines / --- separators before the next section
    while (endLine > startLine && (lines[endLine - 1].trim() === '' || lines[endLine - 1].trim() === '---')) {
      endLine--;
    }
    // Include the separator line if present
    if (endLine < lines.length && lines[endLine]?.trim() === '---') endLine++;

    lines.splice(startLine, endLine - startLine);
    fs.writeFileSync(IDEAS_BANK, lines.join('\n'));
    cache.ideasBank = null;
    broadcast('ideas');

    console.log(`[Ideas] Deleted idea #${targetId}`);
    res.json({ success: true, id: targetId });
  } catch (error) {
    console.error('Error deleting idea:', error);
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

/**
 * Get idea submission stats
 */
app.get('/api/ideas/stats', (req, res) => {
  try {
    const ideas = parseIdeasBank();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Get start of current week (Monday)
    const startOfWeek = new Date(now);
    const day = now.getDay(); // 0=Sun, 1=Mon
    startOfWeek.setDate(now.getDate() - ((day + 6) % 7));
    startOfWeek.setHours(0, 0, 0, 0);
    const weekStart = startOfWeek.toISOString().split('T')[0];

    // Get start of current month
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // Get start of current year
    const yearStart = `${now.getFullYear()}-01-01`;

    // Count ideas by period
    const thisWeekIdeas = ideas.filter(i => i.date && i.date >= weekStart);
    const thisMonthIdeas = ideas.filter(i => i.date && i.date >= monthStart);
    const thisYearIdeas = ideas.filter(i => i.date && i.date >= yearStart);
    const todayIdeas = ideas.filter(i => i.date === today);

    // Group by date for charts (last 30 days)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const dailyCounts = {};
    ideas.forEach(idea => {
      if (idea.date && idea.date >= thirtyDaysAgoStr) {
        dailyCounts[idea.date] = (dailyCounts[idea.date] || 0) + 1;
      }
    });

    // Group by week for last 12 weeks
    const weeklyCounts = {};
    ideas.forEach(idea => {
      if (idea.date) {
        const d = new Date(idea.date);
        const weekNum = getWeekNumber(d);
        const weekKey = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
        weeklyCounts[weekKey] = (weeklyCounts[weekKey] || 0) + 1;
      }
    });

    // Group by month
    const monthlyCounts = {};
    ideas.forEach(idea => {
      if (idea.date) {
        const monthKey = idea.date.substring(0, 7); // YYYY-MM
        monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + 1;
      }
    });

    // Weekly goal tracking (read from task metadata if available)
    const mc = getMissionControl();
    const ideaTask = mc.tasks.find(t =>
      t.metadata?.recurring === 'weekly' &&
      t.title.toLowerCase().includes('idea')
    );
    const weeklyGoal = ideaTask?.metadata?.weeklyGoal || 4;
    const weeklyProgress = thisWeekIdeas.length;
    const needsMoreIdeas = weeklyProgress < weeklyGoal;

    // Calculate streak (consecutive weeks meeting goal)
    let streak = 0;
    const sortedWeeks = Object.entries(weeklyCounts).sort((a, b) => b[0].localeCompare(a[0]));
    for (const [week, count] of sortedWeeks) {
      if (count >= weeklyGoal) {
        streak++;
      } else {
        break;
      }
    }

    res.json({
      total: ideas.length,
      today: todayIdeas.length,
      thisWeek: weeklyProgress,
      thisMonth: thisMonthIdeas.length,
      thisYear: thisYearIdeas.length,
      weeklyGoal,
      weeklyProgress,
      needsMoreIdeas,
      streak,
      dailyCounts,
      weeklyCounts,
      monthlyCounts,
      byStatus: {
        captured: ideas.filter(i => i.status === 'captured').length,
        assigned: ideas.filter(i => i.status === 'assigned').length,
        drafted: ideas.filter(i => i.status === 'drafted').length,
        shipped: ideas.filter(i => i.status === 'shipped').length
      }
    });
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: Get ISO week number
function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ============================================================================
// CONTENT ENGAGEMENT TRACKING
// ============================================================================

const ENGAGEMENT_FILE = path.join(BASE_DIR, 'content/engagement.json');

/**
 * Get engagement data structure or create default
 */
function getEngagementData() {
  if (fs.existsSync(ENGAGEMENT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ENGAGEMENT_FILE, 'utf8'));
    } catch (e) {
      console.error('Error reading engagement file:', e);
    }
  }
  return {
    posts: [],
    metrics: {
      totalPosts: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      avgEngagementRate: 0
    },
    lastUpdated: null
  };
}

/**
 * Save engagement data
 */
function saveEngagementData(data) {
  data.lastUpdated = new Date().toISOString();
  const dir = path.dirname(ENGAGEMENT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(ENGAGEMENT_FILE, JSON.stringify(data, null, 2));
}

/**
 * GET /api/engagement-trends — Aggregate engagement activity over time
 * Sources: posting-queue posted, reply-queue posted, comment-queue posted, engagement-inbox items
 */
app.get('/api/engagement-trends', (req, res) => {
  try {
    const postingQueue = getPostingQueue();
    const replyQueue = getReplyQueue();
    const commentQueue = getCommentQueue();
    const inbox = getEngagementInbox();

    // Collect all activity items with { date, platform, direction }
    const items = [];

    // Outbound: posts published
    for (const p of (postingQueue.posted || [])) {
      if (!p.postedAt) continue;
      items.push({ date: p.postedAt.split('T')[0], platform: p.platform || 'unknown', direction: 'out', type: 'post' });
    }

    // Outbound: replies sent
    for (const r of (replyQueue.posted || [])) {
      const dt = r.postedAt || r.createdAt;
      if (!dt) continue;
      items.push({ date: dt.split('T')[0], platform: r.platform || 'unknown', direction: 'out', type: 'reply' });
    }

    // Outbound: comments posted
    for (const c of (commentQueue.posted || [])) {
      const dt = c.postedAt || c.createdAt;
      if (!dt) continue;
      items.push({ date: dt.split('T')[0], platform: c.platform || 'unknown', direction: 'out', type: 'comment' });
    }

    // Incoming: engagement inbox items (bluesky, twitter)
    for (const platform of ['bluesky', 'twitter']) {
      const section = inbox[platform];
      if (!section || !section.items) continue;
      for (const item of section.items) {
        const dt = item.indexedAt || item.scannedAt;
        if (!dt) continue;
        items.push({ date: dt.split('T')[0], platform, direction: 'in', type: 'incoming' });
      }
    }

    // Build daily buckets
    const dayMap = {};
    const platforms = ['bluesky', 'twitter', 'instagram', 'threads'];

    for (const item of items) {
      if (!dayMap[item.date]) {
        dayMap[item.date] = { date: item.date };
        for (const p of platforms) { dayMap[item.date][p + '_out'] = 0; dayMap[item.date][p + '_in'] = 0; }
        dayMap[item.date].total = 0;
      }
      const suffix = item.direction === 'out' ? '_out' : '_in';
      const key = item.platform + suffix;
      if (dayMap[item.date][key] !== undefined) dayMap[item.date][key]++;
      dayMap[item.date].total++;
    }

    const daily = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

    // Build weekly buckets (ISO weeks)
    const weekMap = {};
    for (const day of daily) {
      const d = new Date(day.date + 'T00:00:00Z');
      const dayOfWeek = d.getUTCDay();
      const mondayOffset = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() + mondayOffset);
      const weekStart = monday.toISOString().split('T')[0];

      // ISO week number
      const jan1 = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
      const weekNum = Math.ceil(((monday - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
      const weekLabel = 'W' + String(weekNum).padStart(2, '0');

      if (!weekMap[weekStart]) {
        weekMap[weekStart] = { week: weekLabel, weekStart };
        for (const p of platforms) { weekMap[weekStart][p + '_out'] = 0; weekMap[weekStart][p + '_in'] = 0; }
        weekMap[weekStart].total = 0;
      }
      for (const p of platforms) {
        weekMap[weekStart][p + '_out'] += day[p + '_out'] || 0;
        weekMap[weekStart][p + '_in'] += day[p + '_in'] || 0;
      }
      weekMap[weekStart].total += day.total;
    }

    const weekly = Object.values(weekMap).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    // Summary stats
    const byPlatform = {};
    const byType = { post: 0, reply: 0, comment: 0, incoming: 0 };
    for (const item of items) {
      byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
      if (byType[item.type] !== undefined) byType[item.type]++;
    }

    const dates = items.map(i => i.date).sort();
    const summary = {
      totalActivity: items.length,
      byPlatform,
      byType,
      activeDays: new Set(items.map(i => i.date)).size,
      dateRange: {
        first: dates[0] || null,
        last: dates[dates.length - 1] || null
      }
    };

    res.json({ daily, weekly, summary });
  } catch (err) {
    console.error('Error computing engagement trends:', err);
    res.status(500).json({ error: 'Failed to compute engagement trends' });
  }
});

/**
 * Get content engagement stats
 */
app.get('/api/content/engagement', (req, res) => {
  try {
    const data = getEngagementData();
    const { range = 'week' } = req.query;

    const now = new Date();
    let startDate;
    switch (range) {
      case 'day':
        startDate = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(0);
    }

    const filteredPosts = data.posts.filter(p => new Date(p.publishedAt) >= startDate);

    // Calculate metrics for period
    const periodMetrics = {
      posts: filteredPosts.length,
      likes: filteredPosts.reduce((sum, p) => sum + (p.likes || 0), 0),
      comments: filteredPosts.reduce((sum, p) => sum + (p.comments || 0), 0),
      shares: filteredPosts.reduce((sum, p) => sum + (p.shares || 0), 0),
      impressions: filteredPosts.reduce((sum, p) => sum + (p.impressions || 0), 0)
    };

    if (periodMetrics.impressions > 0) {
      periodMetrics.engagementRate = ((periodMetrics.likes + periodMetrics.comments + periodMetrics.shares) / periodMetrics.impressions * 100).toFixed(2);
    } else {
      periodMetrics.engagementRate = 0;
    }

    // Top performing posts
    const topPosts = [...filteredPosts]
      .sort((a, b) => ((b.likes || 0) + (b.comments || 0) + (b.shares || 0)) - ((a.likes || 0) + (a.comments || 0) + (a.shares || 0)))
      .slice(0, 5);

    // Performance by platform
    const byPlatform = {};
    filteredPosts.forEach(p => {
      if (!byPlatform[p.platform]) {
        byPlatform[p.platform] = { posts: 0, likes: 0, comments: 0, shares: 0, impressions: 0 };
      }
      byPlatform[p.platform].posts++;
      byPlatform[p.platform].likes += p.likes || 0;
      byPlatform[p.platform].comments += p.comments || 0;
      byPlatform[p.platform].shares += p.shares || 0;
      byPlatform[p.platform].impressions += p.impressions || 0;
    });

    // Performance by philosopher
    const byPhilosopher = {};
    filteredPosts.forEach(p => {
      if (!byPhilosopher[p.author]) {
        byPhilosopher[p.author] = { posts: 0, likes: 0, comments: 0, shares: 0 };
      }
      byPhilosopher[p.author].posts++;
      byPhilosopher[p.author].likes += p.likes || 0;
      byPhilosopher[p.author].comments += p.comments || 0;
      byPhilosopher[p.author].shares += p.shares || 0;
    });

    res.json({
      range,
      metrics: periodMetrics,
      allTimeMetrics: data.metrics,
      topPosts,
      byPlatform,
      byPhilosopher,
      lastUpdated: data.lastUpdated
    });
  } catch (error) {
    console.error('Error getting engagement data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Record a new post's engagement
 */
app.post('/api/content/engagement', (req, res) => {
  try {
    const { platform, author, postId, title, url, publishedAt, likes, comments, shares, impressions } = req.body;

    if (!platform || !author) {
      return res.status(400).json({ error: 'Platform and author are required' });
    }

    // Validate platform and author
    if (!VALID_PLATFORMS.includes(platform.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid platform' });
    }
    if (!VALID_PHILOSOPHERS.includes(author.toLowerCase()) && author !== 'human') {
      return res.status(400).json({ error: 'Invalid author' });
    }

    const data = getEngagementData();

    const post = {
      id: postId || `post-${Date.now()}`,
      platform: platform.toLowerCase(),
      author: author.toLowerCase(),
      title: title || 'Untitled',
      url: url || null,
      publishedAt: publishedAt || new Date().toISOString(),
      likes: parseInt(likes) || 0,
      comments: parseInt(comments) || 0,
      shares: parseInt(shares) || 0,
      impressions: parseInt(impressions) || 0,
      recordedAt: new Date().toISOString()
    };

    // Check if post already exists (update if so)
    const existingIndex = data.posts.findIndex(p => p.id === post.id);
    if (existingIndex >= 0) {
      data.posts[existingIndex] = { ...data.posts[existingIndex], ...post };
    } else {
      data.posts.unshift(post);
    }

    // Keep last 500 posts
    data.posts = data.posts.slice(0, 500);

    // Update all-time metrics
    data.metrics.totalPosts = data.posts.length;
    data.metrics.totalLikes = data.posts.reduce((sum, p) => sum + (p.likes || 0), 0);
    data.metrics.totalComments = data.posts.reduce((sum, p) => sum + (p.comments || 0), 0);
    data.metrics.totalShares = data.posts.reduce((sum, p) => sum + (p.shares || 0), 0);
    const totalImpressions = data.posts.reduce((sum, p) => sum + (p.impressions || 0), 0);
    if (totalImpressions > 0) {
      data.metrics.avgEngagementRate = ((data.metrics.totalLikes + data.metrics.totalComments + data.metrics.totalShares) / totalImpressions * 100).toFixed(2);
    }

    saveEngagementData(data);

    res.json({ success: true, post });
  } catch (error) {
    console.error('Error recording engagement:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Update engagement for existing post
 */
app.patch('/api/content/engagement/:postId', (req, res) => {
  try {
    const { postId } = req.params;
    const { likes, comments, shares, impressions } = req.body;

    if (!postId) {
      return res.status(400).json({ error: 'Post ID is required' });
    }

    const data = getEngagementData();
    const postIndex = data.posts.findIndex(p => p.id === postId);

    if (postIndex < 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Update metrics
    if (likes !== undefined) data.posts[postIndex].likes = parseInt(likes) || 0;
    if (comments !== undefined) data.posts[postIndex].comments = parseInt(comments) || 0;
    if (shares !== undefined) data.posts[postIndex].shares = parseInt(shares) || 0;
    if (impressions !== undefined) data.posts[postIndex].impressions = parseInt(impressions) || 0;
    data.posts[postIndex].updatedAt = new Date().toISOString();

    // Recalculate all-time metrics
    data.metrics.totalLikes = data.posts.reduce((sum, p) => sum + (p.likes || 0), 0);
    data.metrics.totalComments = data.posts.reduce((sum, p) => sum + (p.comments || 0), 0);
    data.metrics.totalShares = data.posts.reduce((sum, p) => sum + (p.shares || 0), 0);
    const totalImpressions = data.posts.reduce((sum, p) => sum + (p.impressions || 0), 0);
    if (totalImpressions > 0) {
      data.metrics.avgEngagementRate = ((data.metrics.totalLikes + data.metrics.totalComments + data.metrics.totalShares) / totalImpressions * 100).toFixed(2);
    }

    saveEngagementData(data);

    res.json({ success: true, post: data.posts[postIndex] });
  } catch (error) {
    console.error('Error updating engagement:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get all drafts
 */
// Valid platforms and philosophers for whitelist validation
const VALID_PLATFORMS = ['twitter', 'bluesky', 'threads', 'reddit', 'medium', 'instagram', 'newsletter', 'patreon'];
const VALID_PHILOSOPHERS = ['socrates', 'aristotle', 'nietzsche', 'marcus', 'heraclitus', 'hypatia', 'diogenes', 'leonardo', 'plato', 'tension'];

app.get('/api/drafts', (req, res) => {
  try {
    let drafts = getPhilosopherDrafts();

    // Filter by platform (with whitelist validation)
    if (req.query.platform) {
      if (!VALID_PLATFORMS.includes(req.query.platform.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid platform parameter' });
      }
      drafts = drafts.filter(d => d.platform === req.query.platform);
    }

    // Filter by philosopher (with whitelist validation)
    if (req.query.philosopher) {
      if (!VALID_PHILOSOPHERS.includes(req.query.philosopher.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid philosopher parameter' });
      }
      drafts = drafts.filter(d => d.philosopher === req.query.philosopher);
    }

    res.json(drafts);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get memory files
 */
app.get('/api/memory', (req, res) => {
  try {
    const files = getMemoryFiles();
    res.json(files);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get book progress
 */
app.get('/api/books', (req, res) => {
  try {
    const books = getBooksProgress();
    res.json(books);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get chapter details
 */
app.get('/api/books/:bookId/chapters/:chapterNum', (req, res) => {
  try {
    const { bookId, chapterNum } = req.params;
    const chapter = getChapterDetails(bookId, parseInt(chapterNum));
    res.json(chapter);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Print-friendly pages for book content
 */

function printPageHTML(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} — TensionLines</title>
<style>
  @page {
    margin: 1in 1.25in;
    @bottom-center { content: counter(page); }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 12pt;
    line-height: 1.7;
    color: #1a1a1a;
    max-width: 36em;
    margin: 0 auto;
    padding: 2em 1em;
  }
  h1 {
    font-size: 24pt;
    font-weight: normal;
    letter-spacing: 0.02em;
    margin-bottom: 0.5em;
    page-break-after: avoid;
  }
  h2 {
    font-size: 14pt;
    font-weight: bold;
    margin-top: 2em;
    margin-bottom: 0.75em;
    page-break-after: avoid;
  }
  h3 { font-size: 12pt; font-weight: bold; margin-top: 1.5em; margin-bottom: 0.5em; }
  p { margin-bottom: 0.8em; text-indent: 0; }
  blockquote {
    font-style: italic;
    margin: 1.5em 0;
    padding-left: 1.5em;
    border-left: 2px solid #999;
    color: #444;
  }
  blockquote p { margin-bottom: 0.3em; }
  hr {
    border: none;
    text-align: center;
    margin: 2em 0;
  }
  hr::after {
    content: '* * *';
    color: #999;
    letter-spacing: 0.5em;
    font-size: 10pt;
  }
  em { font-style: italic; }
  strong { font-weight: bold; }
  .book-title-page {
    text-align: center;
    padding-top: 30vh;
    page-break-after: always;
  }
  .book-title-page h1 { font-size: 36pt; margin-bottom: 0.3em; }
  .book-title-page .subtitle { font-size: 14pt; color: #666; font-style: italic; }
  .chapter-break { page-break-before: always; }
  .word-count {
    font-family: -apple-system, sans-serif;
    font-size: 9pt;
    color: #999;
    text-align: right;
    margin-bottom: 2em;
  }
  @media print {
    body { padding: 0; max-width: none; }
    .no-print { display: none; }
  }
  .print-bar {
    font-family: -apple-system, sans-serif;
    font-size: 11px;
    background: #f5f5f5;
    border-bottom: 1px solid #ddd;
    padding: 10px 20px;
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 100;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .print-bar a, .print-bar button {
    font-size: 11px;
    color: #333;
    text-decoration: none;
    background: white;
    border: 1px solid #ccc;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
  }
  .print-bar a:hover, .print-bar button:hover { background: #eee; }
  @media print { .print-bar { display: none; } }
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

function markdownToHTML(md) {
  // Phase 1: Extract blockquotes before any processing
  const lines = md.split('\n');
  const blocks = [];
  let currentBlock = [];
  let inBlockquote = false;

  for (const line of lines) {
    const quoteLine = line.match(/^>\s?(.*)/);
    if (quoteLine) {
      if (!inBlockquote) {
        if (currentBlock.length) { blocks.push({ type: 'text', lines: currentBlock }); currentBlock = []; }
        inBlockquote = true;
      }
      currentBlock.push(quoteLine[1]);
    } else {
      if (inBlockquote) {
        blocks.push({ type: 'blockquote', lines: currentBlock }); currentBlock = []; inBlockquote = false;
      }
      currentBlock.push(line);
    }
  }
  if (currentBlock.length) blocks.push({ type: inBlockquote ? 'blockquote' : 'text', lines: currentBlock });

  // Phase 2: Convert each block
  function inlineFormat(text) {
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return text;
  }

  let html = '';
  for (const block of blocks) {
    if (block.type === 'blockquote') {
      const content = block.lines.filter(l => l.trim() !== '').map(l => '<p>' + inlineFormat(l) + '</p>').join('\n');
      html += '<blockquote>\n' + content + '\n</blockquote>\n';
    } else {
      // Process text lines: split into paragraphs on blank lines, handle headers/hrs
      const text = block.lines.join('\n');
      const sections = text.split(/\n\n+/);
      for (const section of sections) {
        const trimmed = section.trim();
        if (!trimmed) continue;
        // Headers
        if (trimmed.match(/^###\s+/)) { html += '<h3>' + inlineFormat(trimmed.replace(/^###\s+/, '')) + '</h3>\n'; }
        else if (trimmed.match(/^##\s+/)) { html += '<h2>' + inlineFormat(trimmed.replace(/^##\s+/, '')) + '</h2>\n'; }
        else if (trimmed.match(/^#\s+/)) { html += '<h1>' + inlineFormat(trimmed.replace(/^#\s+/, '')) + '</h1>\n'; }
        // Horizontal rule
        else if (trimmed === '---') { html += '<hr>\n'; }
        // Regular paragraph
        else { html += '<p>' + inlineFormat(trimmed).replace(/\n/g, '<br>') + '</p>\n'; }
      }
    }
  }
  return html;
}

// Print single chapter
app.get('/print/:bookId/chapter/:chapterNum', (req, res) => {
  try {
    const { bookId, chapterNum } = req.params;
    if (!isValidBookId(bookId)) return res.status(400).send('Invalid book ID');

    const num = parseInt(chapterNum);
    const chapterPath = path.join(BOOKS_DIR, bookId, 'chapters', 'chapter-' + num + '.md');

    if (!fs.existsSync(chapterPath)) {
      return res.status(404).send('Chapter not found');
    }

    const raw = fs.readFileSync(chapterPath, 'utf8');
    const wordCount = raw.split(/\s+/).filter(w => w).length;
    const titles = parseChapterTitles(bookId);
    const title = titles[num] || 'Chapter ' + num;
    const wcStr = wordCount.toLocaleString();

    const body = '<div class="print-bar no-print">' +
      '<button onclick="window.print()">Print (Cmd+P)</button> ' +
      '<a href="/print/' + bookId + '">Full Book</a> ' +
      '<span style="color:#999">Chapter ' + num + ' &middot; ' + wcStr + ' words</span>' +
      '</div>' +
      '<div class="word-count no-print">' + wcStr + ' words</div>' +
      markdownToHTML(raw);

    res.send(printPageHTML(title, body));
  } catch (error) {
    console.error(error);
    res.status(500).send('Error rendering chapter');
  }
});

// Print full book
app.get('/print/:bookId', (req, res) => {
  try {
    const { bookId } = req.params;
    if (!isValidBookId(bookId)) return res.status(400).send('Invalid book ID');

    const bookDir = path.join(BOOKS_DIR, bookId);
    const chaptersDir = path.join(bookDir, 'chapters');

    if (!fs.existsSync(chaptersDir)) {
      return res.status(404).send('No chapters found');
    }

    const titles = parseChapterTitles(bookId);
    const books = getBooksProgress();
    const book = books.find(b => b.id === bookId);
    const bookName = book ? book.name : bookId;

    // Gather all chapter files in order
    const chapterFiles = fs.readdirSync(chaptersDir)
      .filter(f => f.match(/^chapter-\d+\.md$/))
      .sort((a, b) => {
        const numA = parseInt(a.match(/chapter-(\d+)/)[1]);
        const numB = parseInt(b.match(/chapter-(\d+)/)[1]);
        return numA - numB;
      });

    if (chapterFiles.length === 0) {
      return res.status(404).send('No chapters written yet');
    }

    let totalWords = 0;
    let chaptersHTML = '';
    const chapterLinks = [];

    for (const file of chapterFiles) {
      const num = parseInt(file.match(/chapter-(\d+)/)[1]);
      const raw = fs.readFileSync(path.join(chaptersDir, file), 'utf8');
      const wc = raw.split(/\s+/).filter(w => w).length;
      totalWords += wc;
      chapterLinks.push('<a href="/print/' + bookId + '/chapter/' + num + '">Ch ' + num + '</a>');

      const breakClass = chaptersHTML ? ' class="chapter-break"' : '';
      chaptersHTML += '<div' + breakClass + '>' + markdownToHTML(raw) + '</div>';
    }

    const twStr = totalWords.toLocaleString();
    const body = '<div class="print-bar no-print">' +
      '<button onclick="window.print()">Print All (Cmd+P)</button> ' +
      chapterLinks.join(' ') + ' ' +
      '<span style="color:#999">' + twStr + ' words total</span>' +
      '</div>' +
      '<div class="book-title-page">' +
      '<h1>' + bookName + '</h1>' +
      '<div class="subtitle">' + twStr + ' words &middot; Draft</div>' +
      '</div>' +
      chaptersHTML;

    res.send(printPageHTML(bookName, body));
  } catch (error) {
    console.error(error);
    res.status(500).send('Error rendering book');
  }
});

/**
 * Global search
 */
app.post('/api/search', (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.length < 2 || query.length > 200) {
      return res.json([]);
    }

    const results = searchContent(query);
    res.json(results);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get posting schedule
 */
app.get('/api/schedule', (req, res) => {
  try {
    if (cache.postingSchedule) {
      return res.json(cache.postingSchedule);
    }
    if (!fs.existsSync(POSTING_SCHEDULE)) {
      return res.json({ content: '', crons: [] });
    }

    const content = fs.readFileSync(POSTING_SCHEDULE, 'utf8');

    // Parse daily schedule from markdown
    const dailySchedule = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match lines like "- **9:00 AM:** Twitter post (Nietzsche)"
      const match = line.match(/^-\s+\*\*(\d+:\d+\s+[AP]M):\*\*\s+(.+)/);
      if (match) {
        const [_, time, description] = match;
        dailySchedule.push({ time, description });
      }
    }

    cache.postingSchedule = {
      content,
      dailySchedule,
      lastUpdated: fs.statSync(POSTING_SCHEDULE).mtime
    };
    res.json(cache.postingSchedule);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Recurring Tasks - operational tasks that repeat
 */
app.get('/api/recurring-tasks', (req, res) => {
  try {
    const recurringTasksPath = path.join(BASE_DIR, 'mission-control/recurring-tasks.json');

    if (!fs.existsSync(recurringTasksPath)) {
      return res.json({ recurringTasks: [] });
    }

    const parsed = JSON.parse(fs.readFileSync(recurringTasksPath, 'utf8'));
    const tasks = parsed.recurringTasks || [];

    // Enrich with live cron data (lastRun, nextDue)
    for (const task of tasks) {
      if (task.cronId && cronRegistry[task.cronId]) {
        const cron = cronRegistry[task.cronId];
        task.lastRun = cron.lastRun;
        task.runCount = cron.runCount;
        task.lastResult = cron.lastResult;
        task.lastError = cron.lastError;
        // Compute nextDue from cron schedule
        try {
          const interval = CronExpressionParser.parse(cron.schedule, { tz: 'America/Los_Angeles' });
          task.nextDue = interval.next().toISOString();
        } catch (e) { /* skip if parse fails */ }
      }
    }

    res.json({ recurringTasks: tasks });
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Cost tracking
 */
let costsCache = null;
let costsCacheTime = 0;
app.get('/api/costs', (req, res) => {
  try {
    // Cache costs for 30 seconds (changes less frequently than other data)
    if (costsCache && Date.now() - costsCacheTime < 30000) {
      return res.json(costsCache);
    }
    const costFilePath = path.join(BASE_DIR, 'cost-tracking/daily-costs.json');

    if (!fs.existsSync(costFilePath)) {
      const defaultCosts = {
        daily: {
          date: new Date().toISOString().split('T')[0],
          total: 0,
          budget: 2.00,
          requests: 0
        },
        models: [
          { name: 'Claude Sonnet 4.5', cost: 0, requests: 0, tokens: 0, total: 0 },
          { name: 'Ollama qwen2.5:3b', cost: 0, requests: 0, tokens: 0, total: 0 }
        ],
        elevations: [],
        weekly: [
          { date: 'Mon', label: 'M', cost: 0 },
          { date: 'Tue', label: 'T', cost: 0 },
          { date: 'Wed', label: 'W', cost: 0 },
          { date: 'Thu', label: 'T', cost: 0 },
          { date: 'Fri', label: 'F', cost: 0 },
          { date: 'Sat', label: 'S', cost: 0 },
          { date: 'Sun', label: 'S', cost: 0 }
        ]
      };
      fs.mkdirSync(path.dirname(costFilePath), { recursive: true });
      fs.writeFileSync(costFilePath, JSON.stringify(defaultCosts, null, 2));
      costsCache = defaultCosts;
      costsCacheTime = Date.now();
      res.json(defaultCosts);
    } else {
      const data = fs.readFileSync(costFilePath, 'utf8');
      costsCache = JSON.parse(data);
      costsCacheTime = Date.now();
      res.json(costsCache);
    }
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Cost details - drill down by model
 */
let detailsCache = null;
let detailsCacheTime = 0;
app.get('/api/costs/details', (req, res) => {
  try {
    // Cache for 30 seconds
    if (detailsCache && Date.now() - detailsCacheTime < 30000) {
      return res.json(detailsCache);
    }
    const detailsPath = path.join(BASE_DIR, 'cost-tracking/daily-details.json');

    if (!fs.existsSync(detailsPath)) {
      return res.json({ date: new Date().toISOString().split('T')[0], models: {} });
    }

    const data = fs.readFileSync(detailsPath, 'utf8');
    detailsCache = JSON.parse(data);
    detailsCacheTime = Date.now();
    res.json(detailsCache);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Cost forecasting - predict budget usage
 */
app.get('/api/costs/forecast', (req, res) => {
  try {
    const historyPath = path.join(BASE_DIR, 'cost-tracking/history.json');
    const costsPath = path.join(BASE_DIR, 'cost-tracking/daily-costs.json');

    // Get current costs and budget
    let currentCosts = { daily: { total: 0, budget: 15 }, monthly: { total: 0, budget: 300 } };
    if (fs.existsSync(costsPath)) {
      try {
        currentCosts = JSON.parse(fs.readFileSync(costsPath, 'utf8'));
      } catch (e) { /* use defaults */ }
    }

    // Get historical data if available
    let history = [];
    if (fs.existsSync(historyPath)) {
      try {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      } catch (e) { /* empty history */ }
    }

    // Calculate averages
    const last7Days = history.slice(-7);
    const last30Days = history.slice(-30);

    const avg7Day = last7Days.length > 0
      ? last7Days.reduce((sum, d) => sum + (d.total || 0), 0) / last7Days.length
      : currentCosts.daily?.total || 0;

    const avg30Day = last30Days.length > 0
      ? last30Days.reduce((sum, d) => sum + (d.total || 0), 0) / last30Days.length
      : currentCosts.daily?.total || 0;

    // Project to end of month
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const daysRemaining = daysInMonth - dayOfMonth;

    const projectedMonthly = (currentCosts.monthly?.total || 0) + (avg7Day * daysRemaining);
    const monthlyBudget = currentCosts.monthly?.budget || 300;
    const projectedOverage = Math.max(0, projectedMonthly - monthlyBudget);

    // Trend analysis
    let trend = 'stable';
    if (history.length >= 14) {
      const recentWeekAvg = last7Days.reduce((sum, d) => sum + (d.total || 0), 0) / 7;
      const prevWeekAvg = history.slice(-14, -7).reduce((sum, d) => sum + (d.total || 0), 0) / 7;
      if (recentWeekAvg > prevWeekAvg * 1.1) trend = 'increasing';
      else if (recentWeekAvg < prevWeekAvg * 0.9) trend = 'decreasing';
    }

    // Model cost efficiency recommendations
    const detailsPath = path.join(BASE_DIR, 'cost-tracking/daily-details.json');
    let modelRecommendations = [];
    if (fs.existsSync(detailsPath)) {
      try {
        const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
        if (details.models) {
          // Find expensive model usage for simple operations
          Object.entries(details.models).forEach(([model, data]) => {
            if (model.includes('opus') && data.operations) {
              // Flag simple operations on expensive models
              const simpleOps = ['status_check', 'list', 'simple_query', 'health_check'];
              const wastedCost = Object.entries(data.operations || {})
                .filter(([op]) => simpleOps.some(s => op.includes(s)))
                .reduce((sum, [, cost]) => sum + cost, 0);

              if (wastedCost > 0.1) {
                modelRecommendations.push({
                  type: 'model_routing',
                  severity: wastedCost > 1 ? 'high' : 'medium',
                  message: `Consider using Haiku for simple operations instead of ${model}`,
                  potentialSavings: `$${(wastedCost * 0.9).toFixed(2)}/day`,
                  currentCost: `$${wastedCost.toFixed(2)}`
                });
              }
            }
          });
        }
      } catch (e) { /* skip */ }
    }

    res.json({
      current: {
        dailySpend: currentCosts.daily?.total || 0,
        dailyBudget: currentCosts.daily?.budget || 15,
        monthlySpend: currentCosts.monthly?.total || 0,
        monthlyBudget
      },
      forecast: {
        avgDaily7Day: Math.round(avg7Day * 100) / 100,
        avgDaily30Day: Math.round(avg30Day * 100) / 100,
        projectedMonthly: Math.round(projectedMonthly * 100) / 100,
        projectedOverage: Math.round(projectedOverage * 100) / 100,
        daysRemaining,
        trend,
        onTrack: projectedMonthly <= monthlyBudget
      },
      recommendations: modelRecommendations,
      historyDays: history.length
    });
  } catch (error) {
    console.error('Error generating cost forecast:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Health check - Enhanced with system metrics
 */
app.get('/api/health', (req, res) => {
  // Get memory usage
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  // Get last backup time
  let lastBackup = null;
  if (fs.existsSync(BACKUPS_DIR)) {
    const backups = fs.readdirSync(BACKUPS_DIR)
      .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (backups.length > 0) {
      lastBackup = backups[0].mtime.toISOString();
    }
  }

  // Get last optimization run
  let lastOptimization = null;
  const optimizations = getOptimizations();
  if (optimizations.runs.length > 0) {
    lastOptimization = optimizations.runs[0].date;
  }

  // Get database stats
  const mc = getMissionControl();
  const dbStats = {
    tasks: mc.tasks.length,
    agents: mc.agents.length,
    notifications: mc.notifications.length,
    activeTasks: mc.tasks.filter(t => ['assigned', 'in_progress', 'review'].includes(t.status)).length
  };

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    uptimeHuman: formatDuration(process.uptime() * 1000),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      systemFree: Math.round(freeMem / 1024 / 1024),
      systemTotal: Math.round(totalMem / 1024 / 1024),
      systemUsedPercent: Math.round((1 - freeMem / totalMem) * 100)
    },
    backups: {
      lastBackup,
      backupCount: fs.existsSync(BACKUPS_DIR) ? fs.readdirSync(BACKUPS_DIR).length : 0
    },
    optimization: {
      lastRun: lastOptimization,
      pendingIssues: optimizations.stats.pendingIssues
    },
    database: dbStats
  });
});

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ============================================================================
// SQUAD LEAD ENDPOINTS
// ============================================================================

/**
 * Calculate due status for a task
 */
function calculateDueStatus(task) {
  const now = new Date();
  let dueDate = null;

  // Priority order for determining due date
  if (task.dueDate) {
    dueDate = new Date(task.dueDate);
  } else if (task.metadata?.deadline) {
    dueDate = new Date(task.metadata.deadline);
  } else if (task.startedAt && task.metadata?.estimatedMinutes) {
    dueDate = new Date(new Date(task.startedAt).getTime() + task.metadata.estimatedMinutes * 60000);
  }

  if (!dueDate) {
    return { dueDate: null, isOverdue: false, hoursRemaining: null, urgency: 'none' };
  }

  const msRemaining = dueDate - now;
  const hoursRemaining = msRemaining / (1000 * 60 * 60);
  const isOverdue = msRemaining < 0;

  let urgency = 'normal';
  if (isOverdue) urgency = 'overdue';
  else if (hoursRemaining <= 4) urgency = 'critical';
  else if (hoursRemaining <= 24) urgency = 'soon';

  return {
    dueDate: dueDate.toISOString(),
    isOverdue,
    hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    urgency
  };
}

/**
 * Calculate agent metrics
 */
function calculateAgentMetrics(agentId, allTasks) {
  const agentTasks = allTasks.filter(t => t.assigneeIds?.includes(agentId));
  const completedTasks = agentTasks.filter(t => ['completed', 'shipped'].includes(t.status));
  const activeTasks = agentTasks.filter(t => ['assigned', 'in_progress', 'review'].includes(t.status));

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const tasksCompletedLast7Days = completedTasks.filter(t =>
    t.completedAt && new Date(t.completedAt) >= weekAgo
  ).length;

  const tasksCompletedPreviousWeek = completedTasks.filter(t =>
    t.completedAt && new Date(t.completedAt) >= twoWeeksAgo && new Date(t.completedAt) < weekAgo
  ).length;

  // Calculate average completion time
  const completionTimes = completedTasks
    .filter(t => t.startedAt && t.completedAt)
    .map(t => (new Date(t.completedAt) - new Date(t.startedAt)) / 60000);

  const avgCompletionTimeMinutes = completionTimes.length > 0
    ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
    : 0;

  // Calculate workload score (0-100)
  const workloadScore = Math.min(100, activeTasks.length * 25);

  // Count stuck tasks
  const stuckTasks = activeTasks.filter(t => {
    const tracking = calculateTimeInStatus(t);
    return tracking.alertLevel === 'yellow' || tracking.alertLevel === 'red';
  }).length;

  // Calculate trend vs last week
  const tasksTrend = tasksCompletedPreviousWeek > 0
    ? Math.round(((tasksCompletedLast7Days - tasksCompletedPreviousWeek) / tasksCompletedPreviousWeek) * 100)
    : 0;

  return {
    totalTasks: agentTasks.length,
    activeTasks: activeTasks.length,
    completedTasks: completedTasks.length,
    tasksCompletedLast7Days,
    avgCompletionTimeMinutes: Math.round(avgCompletionTimeMinutes),
    workloadScore,
    stuckTasks,
    tasksTrend,
    completionRate: agentTasks.length > 0
      ? Math.round((completedTasks.length / agentTasks.length) * 100)
      : 0
  };
}

/**
 * Squad Lead Overview - all key data for the dashboard
 */
app.get('/api/squad-lead/overview', (req, res) => {
  try {
    const mc = getMissionControl();
    const now = new Date();

    // Calculate active tasks with time tracking
    const activeTasks = mc.tasks.filter(t =>
      ['assigned', 'in_progress', 'review'].includes(t.status)
    ).map(t => ({
      ...t,
      timeTracking: calculateTimeInStatus(t),
      dueStatus: calculateDueStatus(t)
    }));

    // Build alerts
    const alerts = [];

    // Overdue tasks
    activeTasks.forEach(task => {
      if (task.dueStatus.isOverdue) {
        alerts.push({
          id: `overdue-${task.id}`,
          type: 'overdue',
          priority: 'critical',
          task,
          timeInStatus: task.timeTracking.timeInStatusHuman
        });
      }
    });

    // Stuck tasks (yellow/red)
    activeTasks.forEach(task => {
      if (task.timeTracking.alertLevel === 'red') {
        alerts.push({
          id: `stuck-red-${task.id}`,
          type: 'stuck',
          priority: 'critical',
          task,
          timeInStatus: task.timeTracking.timeInStatusHuman
        });
      } else if (task.timeTracking.alertLevel === 'yellow') {
        alerts.push({
          id: `stuck-yellow-${task.id}`,
          type: 'stuck',
          priority: 'high',
          task,
          timeInStatus: task.timeTracking.timeInStatusHuman
        });
      }
    });

    // Blocked tasks (assigned to human or marked blocked)
    activeTasks.forEach(task => {
      if (task.status === 'blocked' || task.assigneeIds?.includes('human')) {
        if (!alerts.find(a => a.task.id === task.id)) {
          alerts.push({
            id: `blocked-${task.id}`,
            type: 'blocked',
            priority: 'medium',
            task,
            timeInStatus: task.timeTracking.timeInStatusHuman
          });
        }
      }
    });

    // Build agent workloads
    const agentWorkloads = mc.agents.map(agent => {
      const metrics = calculateAgentMetrics(agent.id, mc.tasks);
      const agentActiveTasks = activeTasks.filter(t => t.assigneeIds?.includes(agent.id));
      const currentTask = agentActiveTasks.find(t => t.status === 'in_progress') || agentActiveTasks[0];
      const queuedTasks = agentActiveTasks.filter(t => t.status === 'assigned').length;

      // Get avatar URL
      let avatarUrl = null;
      const avatarExtensions = ['png', 'jpg', 'svg'];
      for (const ext of avatarExtensions) {
        const avatarPath = path.join(__dirname, 'public', 'avatars', `${agent.id}.${ext}`);
        if (fs.existsSync(avatarPath)) {
          avatarUrl = `/avatars/${agent.id}.${ext}`;
          break;
        }
      }

      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        avatarUrl,
        workloadScore: metrics.workloadScore,
        activeTasks: metrics.activeTasks,
        queuedTasks,
        stuckTasks: metrics.stuckTasks,
        currentTask: currentTask ? {
          id: currentTask.id,
          title: currentTask.title,
          status: currentTask.status
        } : null
      };
    });

    // Tasks with upcoming due dates (next 7 days)
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingTasks = activeTasks
      .filter(t => t.dueStatus.dueDate)
      .map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.metadata?.priority || 'normal',
        dueDate: t.dueStatus.dueDate,
        assigneeIds: t.assigneeIds,
        isOverdue: t.dueStatus.isOverdue
      }))
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    // Summary stats
    const stuckTasks = activeTasks.filter(t =>
      t.timeTracking.alertLevel === 'yellow' || t.timeTracking.alertLevel === 'red'
    ).length;

    const criticalTasks = activeTasks.filter(t =>
      t.timeTracking.alertLevel === 'red' || t.dueStatus.isOverdue
    ).length;

    res.json({
      totalAgents: mc.agents.length,
      activeAgents: mc.agents.filter(a => a.status === 'active').length,
      tasksInProgress: activeTasks.length,
      stuckTasks,
      criticalTasks,
      alerts: alerts.sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
      }),
      agentWorkloads,
      upcomingTasks
    });
  } catch (error) {
    console.error('Error in squad-lead overview:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Squad Lead Agent Detail
 */
app.get('/api/squad-lead/agent/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid agent ID' });
    }

    const mc = getMissionControl();
    const agent = mc.agents.find(a => a.id === id);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const metrics = calculateAgentMetrics(id, mc.tasks);

    // Get agent's tasks
    const agentTasks = mc.tasks.filter(t => t.assigneeIds?.includes(id));
    const activeTasks = agentTasks
      .filter(t => ['assigned', 'in_progress', 'review'].includes(t.status))
      .map(t => ({
        ...t,
        timeTracking: calculateTimeInStatus(t),
        dueStatus: calculateDueStatus(t)
      }));

    const currentTask = activeTasks.find(t => t.status === 'in_progress');
    const queuedTasks = activeTasks
      .filter(t => t.status === 'assigned')
      .sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const aPriority = priorityOrder[a.metadata?.priority] ?? 1;
        const bPriority = priorityOrder[b.metadata?.priority] ?? 1;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return new Date(a.createdAt) - new Date(b.createdAt);
      })
      .map(t => ({
        id: t.id,
        title: t.title,
        priority: t.metadata?.priority || 'normal',
        dueDate: t.dueStatus.dueDate,
        description: t.description?.substring(0, 200)
      }));

    // Get completed tasks (last 10)
    const completedTasks = agentTasks
      .filter(t => ['completed', 'shipped'].includes(t.status))
      .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt))
      .slice(0, 10)
      .map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        completedAt: t.completedAt,
        priority: t.metadata?.priority || 'normal'
      }));

    // Get recent activities for this agent
    const recentActivities = mc.activities
      .filter(a => a.agentId === id)
      .slice(0, 10)
      .map(a => ({
        id: a.id,
        type: a.type,
        description: a.description,
        timestamp: a.timestamp
      }));

    // Get avatar URL
    let avatarUrl = null;
    const avatarExtensions = ['png', 'jpg', 'svg'];
    for (const ext of avatarExtensions) {
      const avatarPath = path.join(__dirname, 'public', 'avatars', `${id}.${ext}`);
      if (fs.existsSync(avatarPath)) {
        avatarUrl = `/avatars/${id}.${ext}`;
        break;
      }
    }

    res.json({
      agent: {
        ...agent,
        avatarUrl
      },
      metrics,
      currentTask: currentTask ? {
        id: currentTask.id,
        title: currentTask.title,
        description: currentTask.description?.substring(0, 300),
        status: currentTask.status,
        timeInStatus: currentTask.timeTracking.timeInStatusHuman,
        alertLevel: currentTask.timeTracking.alertLevel,
        startedAt: currentTask.startedAt,
        dueDate: currentTask.dueStatus.dueDate
      } : null,
      queuedTasks,
      completedTasks,
      recentActivities
    });
  } catch (error) {
    console.error('Error in squad-lead agent detail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Available agents for reassignment
 */
app.get('/api/squad-lead/available-agents', (req, res) => {
  try {
    const mc = getMissionControl();

    const agents = mc.agents.map(agent => {
      const metrics = calculateAgentMetrics(agent.id, mc.tasks);

      // Get avatar URL
      let avatarUrl = null;
      const avatarExtensions = ['png', 'jpg', 'svg'];
      for (const ext of avatarExtensions) {
        const avatarPath = path.join(__dirname, 'public', 'avatars', `${agent.id}.${ext}`);
        if (fs.existsSync(avatarPath)) {
          avatarUrl = `/avatars/${agent.id}.${ext}`;
          break;
        }
      }

      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        avatarUrl,
        workloadScore: metrics.workloadScore,
        activeTasks: metrics.activeTasks
      };
    });

    res.json(agents);
  } catch (error) {
    console.error('Error getting available agents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Reassign a task to a new agent
 */
app.post('/api/tasks/:id/reassign', (req, res) => {
  try {
    const { id } = req.params;
    const { newAssigneeId, reason } = req.body;

    // Validate task ID
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    // Validate new assignee ID
    if (!newAssigneeId || typeof newAssigneeId !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(newAssigneeId)) {
      return res.status(400).json({ error: 'Invalid assignee ID' });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const newAgent = data.agents.find(a => a.id === newAssigneeId);
    if (!newAgent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const oldAssignees = [...(task.assigneeIds || [])];

    // Update task
    task.assigneeIds = [newAssigneeId];
    task.metadata = task.metadata || {};
    task.metadata.reassignedAt = new Date().toISOString();
    task.metadata.reassignedFrom = oldAssignees;
    if (reason) {
      task.metadata.reassignReason = reason;
    }

    // Add activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'task_reassigned',
      agentId: 'tension',
      taskId: id,
      timestamp: new Date().toISOString(),
      description: `Reassigned "${task.title}" from ${oldAssignees.join(', ')} to ${newAssigneeId}`,
      metadata: {
        oldAssignees,
        newAssignee: newAssigneeId,
        reason: reason || null
      }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error reassigning task:', error);
    res.status(500).json({ error: 'Failed to reassign task' });
  }
});

/**
 * Set task due date
 */
app.post('/api/tasks/:id/due-date', (req, res) => {
  try {
    const { id } = req.params;
    const { dueDate } = req.body;

    // Validate task ID
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    // Validate due date
    if (!dueDate || isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ error: 'Invalid due date' });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    task.dueDate = new Date(dueDate).toISOString();

    // Add activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'due_date_set',
      agentId: 'tension',
      taskId: id,
      timestamp: new Date().toISOString(),
      description: `Set due date for "${task.title}" to ${new Date(dueDate).toLocaleDateString()}`,
      metadata: {
        dueDate: task.dueDate
      }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error setting due date:', error);
    res.status(500).json({ error: 'Failed to set due date' });
  }
});

// ============================================================================
// TASK DISPATCH & STEPS
// ============================================================================

/**
 * Dispatch an assigned task — sets it in motion
 */
app.post('/api/tasks/:id/dispatch', (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const now = new Date().toISOString();
    const isRetry = task.status === 'in_progress';

    // On retry, restore original agent if task was reassigned to human
    if (isRetry && task.assigneeIds?.includes('human') && task.metadata?.reassignedFrom?.length > 0) {
      task.assigneeIds = [...task.metadata.reassignedFrom];
      delete task.metadata.reassignedFrom;
      delete task.metadata.reassignedAt;
      delete task.metadata.reassignReason;
    }

    // Clear completion data when re-dispatching a completed/shipped task
    if (['completed', 'shipped'].includes(task.status)) {
      delete task.completedAt;
    }

    task.status = 'in_progress';
    if (!isRetry) task.startedAt = now;
    task.dispatchedAt = now;
    task.dispatchedBy = 'human';

    // Create dispatch/retry step
    if (!task.steps) task.steps = [];
    task.steps.push({
      id: `step-${Date.now()}`,
      description: isRetry ? 'Re-dispatched (retry)' : 'Dispatched',
      status: 'completed',
      startedAt: now,
      completedAt: now,
      agentId: 'human'
    });

    // Log activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: isRetry ? 'task_retried' : 'task_dispatched',
      agentId: 'human',
      taskId: id,
      timestamp: now,
      description: `${isRetry ? 'Retried' : 'Dispatched'}: ${task.title}`,
      metadata: { dispatchedBy: 'human' }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error dispatching task:', error);
    res.status(500).json({ error: 'Failed to dispatch task' });
  }
});

/**
 * Add a step to a task
 */
app.post('/api/tasks/:id/steps', (req, res) => {
  try {
    const { id } = req.params;
    const { description, status, agentId } = req.body;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    if (!description || typeof description !== 'string' || description.length > 500) {
      return res.status(400).json({ error: 'Description is required (max 500 chars)' });
    }

    const validStepStatuses = ['pending', 'in_progress', 'completed', 'failed', 'blocked'];
    const stepStatus = status && validStepStatuses.includes(status) ? status : 'in_progress';

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!task.steps) task.steps = [];

    const now = new Date().toISOString();

    // Auto-complete any previous in_progress step and record duration
    task.steps.forEach(s => {
      if (s.status === 'in_progress') {
        s.status = 'completed';
        s.completedAt = now;
        recordStepDuration(data, s, id);
      }
    });

    const newStep = {
      id: `step-${Date.now()}`,
      description: description.trim(),
      status: stepStatus,
      startedAt: now,
      completedAt: (stepStatus === 'completed' || stepStatus === 'failed') ? now : undefined,
      agentId: agentId || task.assigneeIds?.[0] || 'unknown'
    };

    task.steps.push(newStep);

    // Log activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'step_added',
      agentId: newStep.agentId,
      taskId: id,
      timestamp: now,
      description: `Step added to "${task.title}": ${newStep.description}`,
      metadata: { stepId: newStep.id, stepStatus }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, step: newStep, task });
  } catch (error) {
    console.error('Error adding step:', error);
    res.status(500).json({ error: 'Failed to add step' });
  }
});

/**
 * Update a step's status
 */
app.patch('/api/tasks/:id/steps/:stepId', (req, res) => {
  try {
    const { id, stepId } = req.params;
    const { status } = req.body;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    if (!stepId || typeof stepId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(stepId)) {
      return res.status(400).json({ error: 'Invalid step ID' });
    }

    const validStepStatuses = ['pending', 'in_progress', 'completed', 'failed', 'blocked'];
    if (!status || !validStepStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStepStatuses.join(', ')}` });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!task.steps) {
      return res.status(404).json({ error: 'Task has no steps' });
    }

    const step = task.steps.find(s => s.id === stepId);
    if (!step) {
      return res.status(404).json({ error: 'Step not found' });
    }

    step.status = status;
    if (status === 'completed' || status === 'failed') {
      step.completedAt = new Date().toISOString();
      recordStepDuration(data, step, id);
    }

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    res.json({ success: true, step, task });
  } catch (error) {
    console.error('Error updating step:', error);
    res.status(500).json({ error: 'Failed to update step' });
  }
});

/**
 * Analyze breakdowns for a task
 */
function analyzeBreakdowns(task) {
  const breakdowns = [];
  if (!task.steps || task.steps.length === 0) return breakdowns;

  const now = new Date();

  // Check for dispatch with no agent activity
  if (task.dispatchedAt && task.steps) {
    const onlyDispatched = task.steps.length === 1 && task.steps[0].description === 'Dispatched';
    if (onlyDispatched && task.status === 'in_progress') {
      const sinceDispatch = now - new Date(task.dispatchedAt);
      const dispatchThreshold = Math.min(
        (task.metadata?.estimatedMinutes || 30) * 60 * 1000 * 0.15,  // 15% of estimate
        5 * 60 * 1000  // cap at 5 minutes
      );
      if (sinceDispatch > dispatchThreshold) {
        breakdowns.push({
          type: 'dispatch_no_progress',
          duration: sinceDispatch,
          threshold: dispatchThreshold,
          suggestions: [
            'No agent activity since dispatch — check if the agent session is running',
            'Re-dispatch the task or assign to a different agent'
          ]
        });
      }
    }
  }

  // Thresholds in ms
  const defaultStepThreshold = 2 * 60 * 60 * 1000; // 2h
  const draftingStepThreshold = 3 * 60 * 60 * 1000; // 3h
  const reviewStepThreshold = 1 * 60 * 60 * 1000; // 1h
  const gapThreshold = 30 * 60 * 1000; // 30min
  const estimateMs = task.metadata?.estimatedMinutes
    ? task.metadata.estimatedMinutes * 60 * 1000
    : null;
  const silenceThreshold = estimateMs
    ? Math.max(10 * 60 * 1000, estimateMs * 0.5)  // 50% of estimate, min 10 min
    : 4 * 60 * 60 * 1000;  // default 4h

  // Check each step for step_too_long
  task.steps.forEach(step => {
    if (step.status !== 'in_progress') return;

    const started = new Date(step.startedAt);
    const elapsed = now - started;

    // Pick threshold based on step description
    const desc = (step.description || '').toLowerCase();
    let threshold = defaultStepThreshold;
    if (desc.includes('draft') || desc.includes('writing')) threshold = draftingStepThreshold;
    if (desc.includes('review') || desc.includes('final')) threshold = reviewStepThreshold;

    if (elapsed > threshold) {
      const suggestions = ['Break into smaller steps', 'Check if blocked'];
      if (elapsed > threshold * 2) suggestions.push('Consider reassigning');

      breakdowns.push({
        type: 'step_too_long',
        stepId: step.id,
        stepDescription: step.description,
        duration: elapsed,
        threshold,
        suggestions
      });
    }
  });

  // Check gaps between steps
  for (let i = 1; i < task.steps.length; i++) {
    const prev = task.steps[i - 1];
    const curr = task.steps[i];

    if (prev.completedAt && curr.startedAt) {
      const gap = new Date(curr.startedAt) - new Date(prev.completedAt);
      if (gap > gapThreshold) {
        breakdowns.push({
          type: 'gap_between_steps',
          afterStepId: prev.id,
          beforeStepId: curr.id,
          duration: gap,
          threshold: gapThreshold,
          suggestions: ['Nudge agent']
        });
      }
    }
  }

  // Check for no recent steps on active tasks
  if (task.status === 'in_progress' && task.steps.length > 0) {
    const lastStep = task.steps[task.steps.length - 1];
    const lastActivity = lastStep.completedAt || lastStep.startedAt;
    if (lastActivity) {
      const silence = now - new Date(lastActivity);
      if (silence > silenceThreshold) {
        const suggestions = ['Escalate to Tension', 'Reassign task'];
        if (silence > silenceThreshold * 2) suggestions.push('Mark as blocked');

        breakdowns.push({
          type: 'no_recent_steps',
          lastStepId: lastStep.id,
          duration: silence,
          threshold: silenceThreshold,
          suggestions
        });
      }
    }
  }

  return breakdowns;
}

/**
 * Auto-debug a stuck task using Claude (Sonnet for debug, Opus for super-debug)
 * Called automatically from checkStuckTasks() or manually via POST /api/tasks/:id/debug
 */
async function debugStuckTask(task, level = 'debug') {
  const isSuper = level === 'super-debug';
  const label = isSuper ? 'Super Debug (Opus)' : 'Debug (Sonnet)';
  const metaKey = isSuper ? 'superDebug' : 'debug';

  // Cost gate: reset daily tracker if date changed, then check cap
  const today = new Date().toISOString().slice(0, 10);
  if (debugCostToday.date !== today) {
    debugCostToday = { date: today, cost: 0.0 };
  }
  if (debugCostToday.cost >= 10.0) {
    console.log(`[Debug] Daily cost cap reached ($${debugCostToday.cost.toFixed(2)}), skipping ${label} for ${task.id}`);
    return { skipped: true, reason: 'daily_cost_cap' };
  }

  // Attempt count gate
  if (!task.metadata) task.metadata = {};
  const attemptCount = task.metadata[`${metaKey}AttemptCount`] || 0;
  const maxAttempts = isSuper ? 1 : 2;
  if (attemptCount >= maxAttempts) {
    console.log(`[Debug] Max ${label} attempts (${maxAttempts}) reached for ${task.id}`);
    return { skipped: true, reason: 'max_attempts' };
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    console.log('[Debug] No Anthropic API key configured');
    return { skipped: true, reason: 'no_api_key' };
  }

  // Gather context
  const breakdowns = analyzeBreakdowns(task);
  const mc = getMissionControl();
  const recentActivities = mc.activities
    .filter(a => a.taskId === task.id)
    .slice(0, 20);

  const stepsContext = (task.steps || []).map(s =>
    `- [${s.status}] ${s.description} (started: ${s.startedAt || 'N/A'}, completed: ${s.completedAt || 'N/A'}, agent: ${s.agentId || 'N/A'})`
  ).join('\n');

  const activitiesContext = recentActivities.map(a =>
    `- [${a.type}] ${a.description} (${a.timestamp})`
  ).join('\n');

  const breakdownContext = breakdowns.map(b =>
    `- ${b.type}: duration=${Math.round((b.duration || 0) / 60000)}min, suggestions=[${(b.suggestions || []).join(', ')}]`
  ).join('\n');

  // Truncate description to ~8000 chars to keep input under ~30K tokens
  const desc = (task.description || '').slice(0, 8000);

  const userMessage = `Task ID: ${task.id}
Title: ${task.title}
Status: ${task.status}
Assignees: ${(task.assigneeIds || []).join(', ')}
Priority: ${task.priority || 'normal'}
Created: ${task.createdAt}
Dispatched: ${task.dispatchedAt || 'N/A'}

Description:
${desc}

Steps:
${stepsContext || '(none)'}

Breakdowns:
${breakdownContext || '(none)'}

Recent Activity:
${activitiesContext || '(none)'}

Previous debug results: ${task.metadata.debugResult ? JSON.stringify(task.metadata.debugResult) : 'None'}

Analyze why this task keeps failing and provide actionable fixes. Respond with JSON:
{"diagnosis": "what went wrong", "suggestedFix": "concrete action", "canAutoFix": true/false, "fixType": "rewrite_description|break_into_subtasks|reassign|needs_human|code_fix"}`;

  try {
    const model = isSuper ? 'claude-opus-4-6' : 'claude-sonnet-4-5-20250929';
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      system: 'You are a task debugger for an AI agent system. Analyze why this task keeps failing and provide actionable fixes. Always respond with valid JSON matching the requested schema.',
      messages: [{ role: 'user', content: userMessage }]
    });

    // Estimate cost from usage
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const costPerInputToken = isSuper ? 15 / 1_000_000 : 3 / 1_000_000;
    const costPerOutputToken = isSuper ? 75 / 1_000_000 : 15 / 1_000_000;
    const callCost = (inputTokens * costPerInputToken) + (outputTokens * costPerOutputToken);
    debugCostToday.cost += callCost;
    console.log(`[Debug] ${label} for ${task.id} — cost: $${callCost.toFixed(4)} (daily total: $${debugCostToday.cost.toFixed(2)})`);

    // Parse response
    const text = response.content[0]?.text || '';
    let result;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { diagnosis: text, suggestedFix: 'See diagnosis', canAutoFix: false, fixType: 'needs_human' };
    } catch {
      result = { diagnosis: text, suggestedFix: 'See diagnosis', canAutoFix: false, fixType: 'needs_human' };
    }

    // Store result on task metadata
    const data = getMissionControl();
    const dbTask = data.tasks.find(t => t.id === task.id);
    if (!dbTask) return { error: 'Task disappeared' };
    if (!dbTask.metadata) dbTask.metadata = {};

    dbTask.metadata[`${metaKey}Attempted`] = true;
    dbTask.metadata[`${metaKey}AttemptCount`] = attemptCount + 1;
    dbTask.metadata[`${metaKey}Result`] = {
      ...result,
      model,
      cost: callCost,
      timestamp: new Date().toISOString()
    };

    // Add step
    if (!dbTask.steps) dbTask.steps = [];
    const now = new Date().toISOString();
    dbTask.steps.push({
      id: `step-${Date.now()}`,
      description: `${label}: ${(result.diagnosis || '').slice(0, 200)}`,
      status: 'completed',
      startedAt: now,
      completedAt: now,
      agentId: 'system'
    });

    // Create notification
    data.notifications.push({
      id: `notif-debug-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: isSuper ? 'task_super_debug' : 'task_debug',
      title: `🔍 ${label}: ${dbTask.title}`,
      message: `**Diagnosis:** ${result.diagnosis}\n\n**Suggested Fix:** ${result.suggestedFix}\n\n**Fix Type:** ${result.fixType} | **Auto-fixable:** ${result.canAutoFix ? 'Yes' : 'No'}`,
      from: 'system',
      to: ['tension', ...(dbTask.assigneeIds || [])],
      createdAt: now,
      read: false,
      priority: 'high',
      actionRequired: true,
      metadata: {
        taskId: dbTask.id,
        debugLevel: level,
        result
      }
    });

    // Log activity
    data.activities.unshift({
      id: `activity-${Date.now()}`,
      type: isSuper ? 'task_super_debug' : 'task_debug',
      agentId: 'system',
      taskId: dbTask.id,
      timestamp: now,
      description: `${label}: ${(result.diagnosis || '').slice(0, 150)}`,
      metadata: { level, fixType: result.fixType, canAutoFix: result.canAutoFix, cost: callCost }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
    cache.missionControl = null;

    console.log(`[Debug] ${label} completed for ${task.id}: fixType=${result.fixType}`);
    return result;
  } catch (err) {
    console.error(`[Debug] ${label} failed for ${task.id}:`, err.message);
    return { error: err.message };
  }
}

app.get('/api/tasks/:id/breakdown', (req, res) => {
  try {
    const { id } = req.params;

    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const breakdowns = analyzeBreakdowns(task);

    res.json({ taskId: id, breakdowns, stepCount: (task.steps || []).length });
  } catch (error) {
    console.error('Error analyzing breakdowns:', error);
    res.status(500).json({ error: 'Failed to analyze breakdowns' });
  }
});

/**
 * Manually trigger debug on a task
 * POST /api/tasks/:id/debug?level=debug|super-debug
 */
app.post('/api/tasks/:id/debug', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const level = req.query.level || req.body.level || 'debug';
    if (!['debug', 'super-debug'].includes(level)) {
      return res.status(400).json({ error: 'Level must be "debug" or "super-debug"' });
    }

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await debugStuckTask(task, level);
    res.json({ success: true, level, taskId: id, result });
  } catch (error) {
    console.error('Error in manual debug:', error);
    res.status(500).json({ error: 'Debug failed' });
  }
});

// ============================================================================
// ANALYTICS DASHBOARD
// ============================================================================

const VALID_ANALYTICS_PLATFORMS = ['substack', 'twitter', 'instagram', 'threads', 'bluesky', 'medium', 'reddit', 'patreon', 'website'];

const PLATFORM_PRIMARY_METRIC = {
  substack: 'subscribers',
  twitter: 'followers',
  instagram: 'followers',
  threads: 'followers',
  bluesky: 'followers',
  medium: 'followers',
  reddit: 'karma',
  patreon: 'patrons',
  website: 'monthlyVisitors'
};

function getAnalyticsData() {
  if (cache.analyticsData) return cache.analyticsData;
  if (fs.existsSync(ANALYTICS_DATA_FILE)) {
    try {
      const content = fs.readFileSync(ANALYTICS_DATA_FILE, 'utf8');
      cache.analyticsData = JSON.parse(content);
      return cache.analyticsData;
    } catch (e) {
      console.error('Error reading analytics data:', e);
    }
  }
  return {
    platforms: {},
    revenue: { monthlyTarget: 500, yearlyTarget: 6000, entries: [] },
    goals: [],
    lastUpdated: null
  };
}

function saveAnalyticsData(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(ANALYTICS_DATA_FILE, JSON.stringify(data, null, 2));
  cache.analyticsData = null;
}

/**
 * GET /api/analytics — Full dashboard data with computed summary
 */
app.get('/api/analytics', (req, res) => {
  try {
    const data = getAnalyticsData();
    const engagement = getEngagementData();

    // Compute totalAudience
    let totalAudience = 0;
    for (const [platform, info] of Object.entries(data.platforms || {})) {
      const primaryKey = PLATFORM_PRIMARY_METRIC[platform];
      if (primaryKey && info.current) {
        totalAudience += info.current[primaryKey] || 0;
      }
    }

    // Compute weeklyGrowth from history snapshots
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    let previousTotal = 0;
    for (const [platform, info] of Object.entries(data.platforms || {})) {
      const primaryKey = PLATFORM_PRIMARY_METRIC[platform];
      if (primaryKey && info.history && info.history.length > 0) {
        const oldSnapshot = info.history.find(h => h.date <= sevenDaysAgo);
        if (oldSnapshot) {
          previousTotal += oldSnapshot[primaryKey] || 0;
        }
      }
    }
    const weeklyGrowth = previousTotal > 0 ? ((totalAudience - previousTotal) / previousTotal * 100) : 0;

    // Compute monthlyRevenue
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentEntry = (data.revenue?.entries || []).find(e => e.month === currentMonth);
    let monthlyRevenue = 0;
    if (currentEntry) {
      monthlyRevenue = (currentEntry.substack || 0) + (currentEntry.gumroad || 0) +
        (currentEntry.patreon || 0) + (currentEntry.amazon || 0) + (currentEntry.other || 0);
    }

    // Previous month revenue for change calculation
    const prevMonth = now.getMonth() === 0
      ? `${now.getFullYear() - 1}-12`
      : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;
    const prevEntry = (data.revenue?.entries || []).find(e => e.month === prevMonth);
    let prevMonthlyRevenue = 0;
    if (prevEntry) {
      prevMonthlyRevenue = (prevEntry.substack || 0) + (prevEntry.gumroad || 0) +
        (prevEntry.patreon || 0) + (prevEntry.amazon || 0) + (prevEntry.other || 0);
    }

    // Compute contentThisWeek from engagement data
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentPosts = (engagement.posts || []).filter(p => new Date(p.publishedAt) >= weekAgo);
    const contentThisWeek = recentPosts.length;

    // Previous week content count
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const prevWeekPosts = (engagement.posts || []).filter(p => {
      const d = new Date(p.publishedAt);
      return d >= twoWeeksAgo && d < weekAgo;
    });

    // Substack subscribers specifically
    const substackSubs = data.platforms?.substack?.current?.subscribers || 0;

    const summary = {
      totalAudience,
      totalAudienceChange: previousTotal > 0 ? totalAudience - previousTotal : 0,
      substackSubscribers: substackSubs,
      weeklyGrowth: Math.round(weeklyGrowth * 100) / 100,
      weeklyGrowthChange: totalAudience - previousTotal,
      monthlyRevenue,
      monthlyRevenueChange: monthlyRevenue - prevMonthlyRevenue,
      contentThisWeek,
      contentThisWeekChange: contentThisWeek - prevWeekPosts.length
    };

    res.json({
      summary,
      platforms: data.platforms || {},
      revenue: data.revenue || { monthlyTarget: 500, yearlyTarget: 6000, entries: [] },
      goals: data.goals || [],
      lastUpdated: data.lastUpdated
    });
  } catch (error) {
    console.error('Error getting analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics data' });
  }
});

/**
 * PATCH /api/analytics/platforms/:platform — Update current metrics for a platform
 */
app.patch('/api/analytics/platforms/:platform', (req, res) => {
  try {
    const { platform } = req.params;
    if (!VALID_ANALYTICS_PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `Invalid platform. Must be one of: ${VALID_ANALYTICS_PLATFORMS.join(', ')}` });
    }

    const data = getAnalyticsData();
    if (!data.platforms) data.platforms = {};
    if (!data.platforms[platform]) {
      data.platforms[platform] = { current: {}, history: [] };
    }

    // Update current metrics
    const updates = req.body;
    data.platforms[platform].current = { ...data.platforms[platform].current, ...updates };

    // Auto-push daily snapshot to history (max 1 per day, 365 cap)
    const today = new Date().toISOString().split('T')[0];
    const history = data.platforms[platform].history || [];
    const todayIdx = history.findIndex(h => h.date === today);
    const snapshot = { date: today, ...data.platforms[platform].current };

    if (todayIdx >= 0) {
      history[todayIdx] = snapshot;
    } else {
      history.push(snapshot);
    }

    // Cap at 365 entries
    if (history.length > 365) {
      history.splice(0, history.length - 365);
    }
    data.platforms[platform].history = history;

    saveAnalyticsData(data);
    res.json({ success: true, platform, current: data.platforms[platform].current });
  } catch (error) {
    console.error('Error updating platform metrics:', error);
    res.status(500).json({ error: 'Failed to update platform metrics' });
  }
});

/**
 * PATCH /api/analytics/revenue/target — Update revenue targets
 */
app.patch('/api/analytics/revenue/target', (req, res) => {
  try {
    const data = getAnalyticsData();
    if (!data.revenue) data.revenue = { monthlyTarget: 500, yearlyTarget: 6000, entries: [] };

    const { monthlyTarget, yearlyTarget } = req.body;
    if (monthlyTarget !== undefined) data.revenue.monthlyTarget = monthlyTarget;
    if (yearlyTarget !== undefined) data.revenue.yearlyTarget = yearlyTarget;

    saveAnalyticsData(data);
    res.json({ success: true, revenue: data.revenue });
  } catch (error) {
    console.error('Error updating revenue target:', error);
    res.status(500).json({ error: 'Failed to update revenue target' });
  }
});

/**
 * POST /api/analytics/revenue — Upsert monthly revenue entry
 */
app.post('/api/analytics/revenue', (req, res) => {
  try {
    const data = getAnalyticsData();
    if (!data.revenue) data.revenue = { monthlyTarget: 500, yearlyTarget: 6000, entries: [] };
    if (!data.revenue.entries) data.revenue.entries = [];

    const { month, substack = 0, gumroad = 0, patreon = 0, amazon = 0, other = 0 } = req.body;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Month must be in YYYY-MM format' });
    }

    const existingIdx = data.revenue.entries.findIndex(e => e.month === month);
    const entry = { month, substack, gumroad, patreon, amazon, other };

    if (existingIdx >= 0) {
      data.revenue.entries[existingIdx] = entry;
    } else {
      data.revenue.entries.push(entry);
      data.revenue.entries.sort((a, b) => a.month.localeCompare(b.month));
    }

    saveAnalyticsData(data);
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Error recording revenue:', error);
    res.status(500).json({ error: 'Failed to record revenue' });
  }
});

/**
 * POST /api/analytics/goals — Create a new goal or milestone
 */
app.post('/api/analytics/goals', (req, res) => {
  try {
    const data = getAnalyticsData();
    if (!data.goals) data.goals = [];

    const { type, title, target, value } = req.body;
    if (!type || !title) {
      return res.status(400).json({ error: 'Type and title are required' });
    }
    if (!['progress', 'status', 'milestone'].includes(type)) {
      return res.status(400).json({ error: 'Type must be progress, status, or milestone' });
    }

    // Generate ID
    const prefix = type === 'milestone' ? 'ms' : 'goal';
    const existing = data.goals.filter(g => g.id.startsWith(prefix));
    const maxNum = existing.reduce((max, g) => {
      const num = parseInt(g.id.split('-')[1]) || 0;
      return num > max ? num : max;
    }, 0);
    const id = `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;

    const goal = {
      id,
      type,
      title,
      createdAt: new Date().toISOString()
    };

    if (type === 'progress') {
      goal.target = target || 0;
      goal.current = 0;
    } else if (type === 'status') {
      goal.value = value || '';
    } else if (type === 'milestone') {
      goal.achieved = false;
    }

    data.goals.push(goal);
    saveAnalyticsData(data);
    res.json({ success: true, goal });
  } catch (error) {
    console.error('Error creating goal:', error);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

/**
 * PATCH /api/analytics/goals/:id — Update a goal
 */
app.patch('/api/analytics/goals/:id', (req, res) => {
  try {
    const data = getAnalyticsData();
    if (!data.goals) data.goals = [];

    const { id } = req.params;
    const goalIdx = data.goals.findIndex(g => g.id === id);
    if (goalIdx < 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const updates = req.body;
    const goal = data.goals[goalIdx];

    // Only allow updating appropriate fields
    if (updates.title !== undefined) goal.title = updates.title;
    if (updates.current !== undefined) goal.current = updates.current;
    if (updates.target !== undefined) goal.target = updates.target;
    if (updates.value !== undefined) goal.value = updates.value;
    if (updates.achieved !== undefined) goal.achieved = updates.achieved;

    data.goals[goalIdx] = goal;
    saveAnalyticsData(data);
    res.json({ success: true, goal });
  } catch (error) {
    console.error('Error updating goal:', error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

/**
 * DELETE /api/analytics/goals/:id — Remove a goal
 */
app.delete('/api/analytics/goals/:id', (req, res) => {
  try {
    const data = getAnalyticsData();
    if (!data.goals) data.goals = [];

    const { id } = req.params;
    const goalIdx = data.goals.findIndex(g => g.id === id);
    if (goalIdx < 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    data.goals.splice(goalIdx, 1);
    saveAnalyticsData(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting goal:', error);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// ============================================================================
// FILE WATCHING (Real-time updates)
// ============================================================================

const watcher = chokidar.watch([
  MISSION_CONTROL_DB,
  path.join(BASE_DIR, 'mission-control/recurring-tasks.json'),
  IDEAS_BANK,
  POSTING_SCHEDULE,
  `${MEMORY_DIR}/*.md`,
  `${PHILOSOPHERS_DIR}/*/drafts/*.md`,
  `${BOOKS_DIR}/*/PROJECT_TRACKER.md`,
  `${BOOKS_DIR}/*/outline/MASTER_OUTLINE.md`,
  `${BOOKS_DIR}/*/chapters/*.md`,
  REPOST_CANDIDATES_FILE,
  FUTURE_NEEDS_FILE,
  ANALYTICS_DATA_FILE
], {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true
});

let watchDebounceTimer = null;
watcher.on('change', (filePath) => {
  // Debounce rapid file changes (e.g. multiple saves in quick succession)
  clearTimeout(watchDebounceTimer);
  watchDebounceTimer = setTimeout(() => {
    invalidateCache(filePath);
  }, 500);
});

// ============================================================================
// STUCK TASK MONITORING (Auto-notifications for red alerts)
// ============================================================================

// Track which tasks have been notified to avoid spam (in-memory cache, backed by DB check)
const notifiedStuckTasks = new Set();

// Track daily debug API spend to enforce $10/day cap
let debugCostToday = { date: new Date().toISOString().slice(0, 10), cost: 0.0 };

function checkStuckTasks() {
  try {
    const mc = getMissionControl();
    const activeTasks = mc.tasks.filter(t =>
      ['assigned', 'in_progress', 'review'].includes(t.status) &&
      t.metadata?.recurring !== 'weekly'  // Only skip weekly human tasks (e.g. idea batch)
    );

    const tasksWithTracking = activeTasks.map(t => ({
      ...t,
      timeTracking: calculateTimeInStatus(t)
    }));

    const redAlertTasks = tasksWithTracking.filter(t =>
      t.timeTracking.alertLevel === 'red'
    );

    // For each red alert task, check if we've already notified
    redAlertTasks.forEach(task => {
      const notifKey = `${task.id}-red`;

      // Skip if already in memory cache
      if (notifiedStuckTasks.has(notifKey)) {
        return;
      }

      // Also check database for recent notification (within 24 hours) to survive restarts
      const existingNotif = mc.notifications.find(n =>
        n.type === 'stuck_task' &&
        n.metadata?.taskId === task.id &&
        new Date(n.createdAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      );

      if (existingNotif) {
        // Add to memory cache and skip
        notifiedStuckTasks.add(notifKey);
        return;
      }

      // Get diagnostics before creating notification
      const breakdowns = analyzeBreakdowns(task);
      const diagnosticMessages = breakdowns.map(b => {
        if (b.type === 'dispatch_no_progress') return '⚠️ No agent activity since dispatch';
        if (b.type === 'step_too_long') return `⚠️ "${b.stepDescription}" running too long`;
        if (b.type === 'no_recent_steps') return '⚠️ No activity for extended period';
        return `⚠️ ${b.type}`;
      });
      const allSuggestions = [...new Set(breakdowns.flatMap(b => b.suggestions || []))];

      // Create notification
      const baseMessage = `Task #${task.id} has been in "${task.status}" status for ${task.timeTracking.timeInStatusHuman}. Assigned to: ${task.assigneeIds.join(', ')}.`;
      const diagSection = diagnosticMessages.length > 0
        ? `\n${diagnosticMessages.join('\n')}`
        : '';
      const suggestSection = allSuggestions.length > 0
        ? `\n\nSuggested actions:\n${allSuggestions.map(s => '• ' + s).join('\n')}`
        : '\nConsider intervention or reassignment.';

      const notification = {
        id: `notif-stuck-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'stuck_task',
        title: `🚨 Task Stuck: ${task.title}`,
        message: `${baseMessage}${diagSection}${suggestSection}`,
        from: 'system',
        to: ['tension', ...task.assigneeIds],
        createdAt: new Date().toISOString(),
        read: false,
        priority: 'critical',
        actionRequired: true,
        metadata: {
          taskId: task.id,
          timeInStatus: task.timeTracking.timeInStatusHuman,
          alertLevel: 'red',
          diagnostics: breakdowns,
          suggestions: allSuggestions
        }
      };

      // Write to database
      mc.notifications.push(notification);
      fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
      cache.missionControl = null;

      // Mark as notified
      notifiedStuckTasks.add(notifKey);

      console.log(`[Stuck Task Alert] Created notification for task ${task.id}`);

      // Auto-debug escalation: check retry count and trigger debug if appropriate
      const retryCount = mc.activities.filter(a =>
        a.taskId === task.id && a.type === 'task_retried'
      ).length;

      if (retryCount >= 1) {
        if (!task.metadata?.debugAttempted) {
          // First escalation: Sonnet debug
          debugStuckTask(task, 'debug').catch(err =>
            console.error(`[Debug] Auto-debug failed for ${task.id}:`, err.message)
          );
        } else if (!task.metadata?.superDebugAttempted) {
          // Second escalation: Opus super-debug
          debugStuckTask(task, 'super-debug').catch(err =>
            console.error(`[Debug] Auto-super-debug failed for ${task.id}:`, err.message)
          );
        }
      }
    });

    // Clean up notified tasks that are no longer stuck
    const activeRedTaskIds = new Set(redAlertTasks.map(t => `${t.id}-red`));
    for (const notifKey of notifiedStuckTasks) {
      if (!activeRedTaskIds.has(notifKey)) {
        notifiedStuckTasks.delete(notifKey);
      }
    }
  } catch (error) {
    console.error('[Stuck Task Monitor] Error:', error);
  }
}

// Check for stuck tasks every 5 minutes
setInterval(checkStuckTasks, 5 * 60 * 1000);

// Run initial check 30 seconds after startup
setTimeout(checkStuckTasks, 30 * 1000);

// ============================================================================
// AUTOMATIC BACKUP SYSTEM
// ============================================================================

/**
 * Create backup of critical files
 * Keeps: 7 daily backups + 4 weekly backups
 */
function createBackup() {
  console.log('[Backup] Starting automatic backup...');

  // Ensure backup directory exists
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const dayOfWeek = now.getDay(); // 0 = Sunday

  const filesToBackup = [
    { src: MISSION_CONTROL_DB, name: 'database' },
    { src: OPTIMIZATIONS_DB, name: 'optimizations' },
    { src: IDEAS_BANK, name: 'ideas-bank' }
  ];

  const backupResults = [];

  filesToBackup.forEach(file => {
    if (fs.existsSync(file.src)) {
      try {
        const content = fs.readFileSync(file.src);
        const ext = path.extname(file.src);

        // Daily backup
        const dailyBackup = path.join(BACKUPS_DIR, `${file.name}-daily-${dateStr}${ext}`);
        fs.writeFileSync(dailyBackup, content);
        backupResults.push({ file: file.name, type: 'daily', path: dailyBackup });

        // Weekly backup (on Sundays)
        if (dayOfWeek === 0) {
          const weekNum = getWeekNumber(now);
          const weeklyBackup = path.join(BACKUPS_DIR, `${file.name}-weekly-${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}${ext}`);
          fs.writeFileSync(weeklyBackup, content);
          backupResults.push({ file: file.name, type: 'weekly', path: weeklyBackup });
        }
      } catch (err) {
        console.error(`[Backup] Failed to backup ${file.name}:`, err.message);
      }
    }
  });

  // Cleanup old backups
  cleanupOldBackups();

  console.log(`[Backup] Completed. ${backupResults.length} files backed up.`);
  return backupResults;
}

/**
 * Remove backups older than retention period
 * Keep: 7 daily, 4 weekly
 */
function cleanupOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;

  const files = fs.readdirSync(BACKUPS_DIR);
  const now = Date.now();
  const dailyMaxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  const weeklyMaxAge = 28 * 24 * 60 * 60 * 1000; // 28 days

  files.forEach(file => {
    const filePath = path.join(BACKUPS_DIR, file);
    const stat = fs.statSync(filePath);
    const age = now - stat.mtime.getTime();

    if (file.includes('-daily-') && age > dailyMaxAge) {
      fs.unlinkSync(filePath);
      console.log(`[Backup] Removed old daily backup: ${file}`);
    } else if (file.includes('-weekly-') && age > weeklyMaxAge) {
      fs.unlinkSync(filePath);
      console.log(`[Backup] Removed old weekly backup: ${file}`);
    }
  });
}

/**
 * Get list of available backups
 */
function getBackupsList() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];

  return fs.readdirSync(BACKUPS_DIR)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const filePath = path.join(BACKUPS_DIR, f);
      const stat = fs.statSync(filePath);
      return {
        filename: f,
        size: stat.size,
        created: stat.mtime.toISOString(),
        type: f.includes('-weekly-') ? 'weekly' : 'daily'
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
}

/**
 * Restore from a backup file
 */
function restoreFromBackup(backupFilename) {
  // Validate filename: no path separators, no traversal
  if (!backupFilename || typeof backupFilename !== 'string' ||
      !/^[a-zA-Z0-9._-]+$/.test(backupFilename)) {
    throw new Error('Invalid backup filename');
  }
  const backupPath = path.join(BACKUPS_DIR, backupFilename);
  const resolved = path.resolve(backupPath);
  if (!resolved.startsWith(path.resolve(BACKUPS_DIR))) {
    throw new Error('Invalid backup filename');
  }
  if (!fs.existsSync(backupPath)) {
    throw new Error('Backup file not found');
  }

  // Determine target file
  let targetPath;
  if (backupFilename.includes('database')) {
    targetPath = MISSION_CONTROL_DB;
  } else if (backupFilename.includes('optimizations')) {
    targetPath = OPTIMIZATIONS_DB;
  } else if (backupFilename.includes('ideas-bank')) {
    targetPath = IDEAS_BANK;
  } else {
    throw new Error('Unknown backup type');
  }

  // Create backup of current state before restore
  const preRestoreBackup = targetPath + '.pre-restore';
  if (fs.existsSync(targetPath)) {
    fs.copyFileSync(targetPath, preRestoreBackup);
  }

  // Restore
  fs.copyFileSync(backupPath, targetPath);
  cache.missionControl = null; // Clear cache

  return { restored: backupFilename, target: targetPath };
}

// Schedule backup at 1:55 AM (before optimization at 2 AM)
cron.schedule('55 1 * * *', () => {
  console.log('[Cron] Running nightly backup...');
  try {
    createBackup();
    recordCronRun('backup');
    logSystemEvent('backup', 'Nightly backup completed');
  } catch (err) {
    console.error('[Cron] Backup failed:', err);
    recordCronRun('backup', null, err.message);
    logSystemEvent('error', `Backup failed: ${err.message}`);
  }
}, {
  timezone: 'America/Los_Angeles'
});

console.log('[Cron] Nightly backup scheduled for 1:55 AM PST');

// Backup API endpoints
app.get('/api/backups', (req, res) => {
  try {
    const backups = getBackupsList();
    res.json(backups);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/backups/create', (req, res) => {
  try {
    const results = createBackup();
    res.json({ success: true, backups: results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/backups/restore/:filename', (req, res) => {
  try {
    const result = restoreFromBackup(req.params.filename);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// OPTIMIZATION SYSTEM - Nightly Project Review by Tension
// ============================================================================

/**
 * Get or initialize optimizations database
 */
function getOptimizations() {
  if (!fs.existsSync(OPTIMIZATIONS_DB)) {
    const initial = { runs: [], findings: [], stats: { totalRuns: 0, issuesFound: 0, issuesResolved: 0, costSavings: 0 } };
    fs.writeFileSync(OPTIMIZATIONS_DB, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(OPTIMIZATIONS_DB, 'utf8'));
}

/**
 * Save optimizations database
 */
function saveOptimizations(data) {
  fs.writeFileSync(OPTIMIZATIONS_DB, JSON.stringify(data, null, 2));
}

/**
 * Run nightly optimization analysis
 */
function runOptimization() {
  console.log('[Optimization] Starting nightly optimization run...');
  const startTime = Date.now();
  const findings = [];
  const actions = [];
  const mc = getMissionControl();
  const ideas = parseIdeasBank();

  const runId = `opt-${Date.now()}`;
  const runDate = new Date().toISOString();

  // ============================================================================
  // 1. STUCK TASKS ANALYSIS (skip recurring tasks)
  // ============================================================================
  const activeTasks = mc.tasks.filter(t =>
    ['assigned', 'in_progress', 'review'].includes(t.status) &&
    !t.metadata?.recurring  // Recurring tasks are ongoing, not stuck
  );
  activeTasks.forEach(task => {
    const tracking = calculateTimeInStatus(task);
    if (tracking.alertLevel === 'red') {
      findings.push({
        id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        runId,
        type: 'stuck_task',
        severity: 'high',
        title: `Task stuck in ${task.status} for ${tracking.timeInStatusHuman}`,
        description: `Task "${task.title}" (${task.id}) has been in ${task.status} status for ${tracking.timeInStatusHuman}. Assigned to: ${task.assigneeIds?.join(', ') || 'unassigned'}`,
        taskId: task.id,
        assignee: task.assigneeIds?.[0],
        recommendation: 'Consider reassigning or breaking into smaller tasks',
        status: 'pending',
        createdAt: runDate
      });
    } else if (tracking.alertLevel === 'yellow') {
      findings.push({
        id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        runId,
        type: 'slow_task',
        severity: 'medium',
        title: `Task progressing slowly`,
        description: `Task "${task.title}" (${task.id}) has been in ${task.status} for ${tracking.timeInStatusHuman}.`,
        taskId: task.id,
        assignee: task.assigneeIds?.[0],
        recommendation: 'Monitor progress, may need intervention soon',
        status: 'monitoring',
        createdAt: runDate
      });
    }
  });

  // ============================================================================
  // 2. AGENT WORKLOAD ANALYSIS
  // ============================================================================
  const agentWorkloads = {};
  mc.agents.forEach(agent => {
    agentWorkloads[agent.id] = {
      active: activeTasks.filter(t => t.assigneeIds?.includes(agent.id)).length,
      completed7d: mc.tasks.filter(t => {
        if (!t.completedAt || !t.assigneeIds?.includes(agent.id)) return false;
        const completed = new Date(t.completedAt);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return completed >= weekAgo;
      }).length
    };
  });

  // Find overloaded agents (>5 active tasks)
  Object.entries(agentWorkloads).forEach(([agentId, workload]) => {
    if (workload.active > 5) {
      findings.push({
        id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        runId,
        type: 'agent_overload',
        severity: 'medium',
        title: `Agent ${agentId} is overloaded`,
        description: `${agentId} has ${workload.active} active tasks. Consider redistributing workload.`,
        assignee: agentId,
        recommendation: 'Reassign some tasks to idle agents',
        status: 'pending',
        createdAt: runDate
      });
    }
  });

  // Find idle agents (0 active tasks, completed <2 in 7 days)
  Object.entries(agentWorkloads).forEach(([agentId, workload]) => {
    if (agentId !== 'human' && workload.active === 0 && workload.completed7d < 2) {
      findings.push({
        id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        runId,
        type: 'agent_idle',
        severity: 'low',
        title: `Agent ${agentId} appears idle`,
        description: `${agentId} has no active tasks and only ${workload.completed7d} completions in 7 days.`,
        assignee: agentId,
        recommendation: 'Assign new tasks or check if agent is blocked',
        status: 'pending',
        createdAt: runDate
      });
    }
  });

  // ============================================================================
  // 3. IDEAS PIPELINE ANALYSIS
  // ============================================================================
  const capturedIdeas = ideas.filter(i => i.status === 'captured');
  if (capturedIdeas.length > 20) {
    findings.push({
      id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      runId,
      type: 'ideas_backlog',
      severity: 'low',
      title: `${capturedIdeas.length} ideas waiting to be processed`,
      description: `Ideas bank has ${capturedIdeas.length} captured ideas that haven't been organized yet.`,
      recommendation: 'Schedule idea processing session',
      status: 'pending',
      createdAt: runDate
    });
  }

  // ============================================================================
  // 4. COST ANALYSIS (if cost tracking exists)
  // ============================================================================
  const costFile = path.join(BASE_DIR, 'cost-tracking/daily-costs.json');
  if (fs.existsSync(costFile)) {
    try {
      const costs = JSON.parse(fs.readFileSync(costFile, 'utf8'));
      if (costs.daily && costs.daily.total > costs.daily.budget) {
        findings.push({
          id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          runId,
          type: 'cost_overrun',
          severity: 'high',
          title: `Daily cost exceeded budget`,
          description: `Spent $${costs.daily.total.toFixed(2)} vs budget of $${costs.daily.budget.toFixed(2)}`,
          recommendation: 'Review high-cost operations, consider using cheaper models for simple tasks',
          status: 'pending',
          forHuman: true,
          createdAt: runDate
        });
      }

      // Model cost routing analysis
      const detailsPath = path.join(BASE_DIR, 'cost-tracking/daily-details.json');
      if (fs.existsSync(detailsPath)) {
        try {
          const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
          if (details.models) {
            Object.entries(details.models).forEach(([model, data]) => {
              // Flag expensive model usage for simple operations
              if (model.includes('opus') && data.calls > 10) {
                const simpleOps = ['status', 'list', 'health', 'check', 'ping', 'get'];
                let wastedCalls = 0;
                let wastedCost = 0;

                if (data.operations) {
                  Object.entries(data.operations).forEach(([op, opData]) => {
                    if (simpleOps.some(s => op.toLowerCase().includes(s))) {
                      wastedCalls += opData.calls || 1;
                      wastedCost += opData.cost || 0;
                    }
                  });
                }

                if (wastedCost > 0.5) {
                  findings.push({
                    id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    runId,
                    type: 'model_routing',
                    severity: wastedCost > 2 ? 'high' : 'medium',
                    title: `Expensive model used for simple operations`,
                    description: `${model} was used for ${wastedCalls} simple operations, costing ~$${wastedCost.toFixed(2)}. Consider using Haiku for these.`,
                    recommendation: 'Route simple status checks and list operations to cheaper models like Haiku',
                    status: 'pending',
                    forHuman: true,
                    metadata: { model, wastedCalls, wastedCost },
                    createdAt: runDate
                  });
                }
              }
            });
          }
        } catch (e) {
          // Cost details parse error, skip
        }
      }
    } catch (e) {
      // Cost file parse error, skip
    }
  }

  // ============================================================================
  // 5. BLOCKED TASKS ANALYSIS
  // ============================================================================
  const blockedTasks = mc.tasks.filter(t => t.status === 'blocked');
  blockedTasks.forEach(task => {
    const blockedDays = task.statusChangedAt
      ? Math.floor((Date.now() - new Date(task.statusChangedAt).getTime()) / (24 * 60 * 60 * 1000))
      : 0;

    if (blockedDays > 3) {
      findings.push({
        id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        runId,
        type: 'blocked_task',
        severity: 'medium',
        title: `Task blocked for ${blockedDays} days`,
        description: `"${task.title}" has been blocked for ${blockedDays} days. Blocker: ${task.metadata?.blockedReason || 'Unknown'}`,
        taskId: task.id,
        recommendation: 'Review blocker, may need human intervention',
        status: 'pending',
        forHuman: true,
        createdAt: runDate
      });
    }
  });

  // ============================================================================
  // 6. DUPLICATE/SIMILAR TASKS CHECK
  // ============================================================================
  const taskTitles = mc.tasks.filter(t => !['completed', 'shipped'].includes(t.status)).map(t => ({ id: t.id, title: t.title.toLowerCase() }));
  for (let i = 0; i < taskTitles.length; i++) {
    for (let j = i + 1; j < taskTitles.length; j++) {
      if (taskTitles[i].title === taskTitles[j].title) {
        findings.push({
          id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          runId,
          type: 'duplicate_task',
          severity: 'low',
          title: `Possible duplicate tasks`,
          description: `Tasks ${taskTitles[i].id} and ${taskTitles[j].id} have identical titles`,
          recommendation: 'Review and consolidate if duplicates',
          status: 'pending',
          createdAt: runDate
        });
      }
    }
  }

  // ============================================================================
  // 7. UNREAD NOTIFICATIONS CHECK
  // ============================================================================
  const unreadNotifs = mc.notifications.filter(n => !n.read);
  if (unreadNotifs.length > 50) {
    findings.push({
      id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      runId,
      type: 'notification_backlog',
      severity: 'low',
      title: `${unreadNotifs.length} unread notifications`,
      description: `Notification inbox has ${unreadNotifs.length} unread items.`,
      recommendation: 'Review and clear notification backlog',
      status: 'pending',
      forHuman: true,
      createdAt: runDate
    });
  }

  // ============================================================================
  // 8. CONTENT ENGAGEMENT ANALYSIS
  // ============================================================================
  if (fs.existsSync(ENGAGEMENT_FILE)) {
    try {
      const engagement = JSON.parse(fs.readFileSync(ENGAGEMENT_FILE, 'utf8'));
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Check for declining engagement
      const recentPosts = engagement.posts.filter(p => new Date(p.publishedAt) >= weekAgo);
      if (recentPosts.length >= 3) {
        const avgEngagement = recentPosts.reduce((sum, p) =>
          sum + (p.likes || 0) + (p.comments || 0) + (p.shares || 0), 0) / recentPosts.length;

        // Compare to all-time average (if available)
        const allTimeAvg = (engagement.metrics.totalLikes + engagement.metrics.totalComments + engagement.metrics.totalShares) /
          Math.max(1, engagement.metrics.totalPosts);

        if (avgEngagement < allTimeAvg * 0.5 && allTimeAvg > 0) {
          findings.push({
            id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            runId,
            type: 'engagement_decline',
            severity: 'medium',
            title: `Content engagement declining`,
            description: `Recent posts averaging ${avgEngagement.toFixed(1)} engagement vs ${allTimeAvg.toFixed(1)} all-time average.`,
            recommendation: 'Review recent content strategy, analyze top performing posts for patterns',
            status: 'pending',
            forHuman: true,
            createdAt: runDate
          });
        }
      }

      // Check for platforms with no recent posts
      const activePlatforms = [...new Set(engagement.posts.slice(0, 50).map(p => p.platform))];
      const dormantPlatforms = VALID_PLATFORMS.filter(p =>
        !activePlatforms.includes(p) && ['twitter', 'bluesky', 'threads'].includes(p)
      );

      if (dormantPlatforms.length > 0) {
        findings.push({
          id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          runId,
          type: 'dormant_platform',
          severity: 'low',
          title: `No recent activity on ${dormantPlatforms.join(', ')}`,
          description: `These platforms haven't had posts tracked recently.`,
          recommendation: 'Check if content is being posted but not tracked, or schedule new content',
          status: 'pending',
          createdAt: runDate
        });
      }
    } catch (e) {
      // Engagement file parse error, skip
    }
  }

  // ============================================================================
  // SAVE OPTIMIZATION RUN
  // ============================================================================
  const durationMs = Date.now() - startTime;
  const optimizations = getOptimizations();

  const run = {
    id: runId,
    date: runDate,
    durationMs,
    findingsCount: findings.length,
    bySeverity: {
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length
    },
    byType: findings.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {}),
    forHuman: findings.filter(f => f.forHuman).length,
    forAgents: findings.filter(f => !f.forHuman && f.assignee).length
  };

  optimizations.runs.unshift(run);
  optimizations.runs = optimizations.runs.slice(0, 365); // Keep 1 year of runs
  optimizations.findings.push(...findings);
  optimizations.findings = optimizations.findings.slice(-1000); // Keep last 1000 findings
  optimizations.stats.totalRuns++;
  optimizations.stats.issuesFound += findings.length;

  saveOptimizations(optimizations);

  console.log(`[Optimization] Completed in ${durationMs}ms. Found ${findings.length} issues (${run.bySeverity.high} high, ${run.bySeverity.medium} medium, ${run.bySeverity.low} low)`);

  return { run, findings };
}

/**
 * Schedule nightly optimization at 2 AM
 */
cron.schedule('0 2 * * *', () => {
  console.log('[Cron] Running nightly optimization...');
  try {
    runOptimization();
    recordCronRun('optimization');
    logSystemEvent('cron', 'Nightly optimization completed');
  } catch (err) {
    console.error('[Cron] Optimization failed:', err);
    recordCronRun('optimization', null, err.message);
    logSystemEvent('error', `Optimization failed: ${err.message}`);
  }
}, {
  timezone: 'America/Los_Angeles'
});

console.log('[Cron] Nightly optimization scheduled for 2:00 AM PST');

/**
 * Generate daily summary notification for human
 */
function generateDailySummary(force = false) {
  console.log('[DailySummary] Generating morning briefing...');

  const mc = getMissionControl();
  const today = new Date().toISOString().split('T')[0];

  // Check if we already have a daily summary for today (unless forced)
  if (!force) {
    const existingSummary = mc.notifications.find(n =>
      n.type === 'daily_summary' &&
      n.createdAt?.startsWith(today)
    );

    if (existingSummary) {
      console.log('[DailySummary] Already generated for today, skipping');
      return existingSummary;
    }
  }

  const optimizations = getOptimizations();
  const ideas = parseIdeasBank();
  const now = new Date();
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);

  // Tasks completed yesterday
  const completedYesterdayTasks = mc.tasks.filter(t => {
    if (!t.completedAt) return false;
    const d = new Date(t.completedAt);
    return d >= yesterday && d < now;
  });
  const completedYesterday = completedYesterdayTasks.length;

  // Active tasks
  const activeTasks = mc.tasks.filter(t => ['assigned', 'in_progress', 'review'].includes(t.status));
  const stuckTasks = activeTasks.filter(t => {
    const tracking = calculateTimeInStatus(t);
    return tracking.alertLevel === 'red';
  });

  // Human tasks pending (with same logic as HumanTasks page)
  // Check if weekly idea goal is met
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const thisWeekIdeas = ideas.filter(i => i.date && i.date >= weekStartStr);
  const weeklyGoalMet = thisWeekIdeas.length >= 4;

  const humanTasks = mc.tasks.filter(t => {
    if (!t.assigneeIds?.includes('human')) return false;
    if (['completed', 'shipped', 'deferred', 'blocked'].includes(t.status)) return false;

    // Hide "Provide Weekly Idea Batch" if goal is met (matches HumanTasks page)
    const isIdeaTask = t.title.toLowerCase().includes('idea') &&
      (t.title.toLowerCase().includes('batch') || t.title.toLowerCase().includes('weekly'));
    if (isIdeaTask && weeklyGoalMet) return false;

    return true;
  });

  // Pending optimization issues
  const pendingIssues = optimizations.findings.filter(f => f.status === 'pending');
  const highPriorityIssues = pendingIssues.filter(f => f.severity === 'high');

  // Unread notifications
  const unreadCount = mc.notifications.filter(n => !n.read).length;

  // Cost status
  let costStatus = 'not tracked';
  const costFile = path.join(BASE_DIR, 'cost-tracking/daily-costs.json');
  if (fs.existsSync(costFile)) {
    try {
      const costs = JSON.parse(fs.readFileSync(costFile, 'utf8'));
      const monthlyTotal = costs.monthly?.total || 0;
      const monthlyBudget = costs.monthly?.budget || 300;
      const monthlyPercent = monthlyBudget > 0 ? Math.round((monthlyTotal / monthlyBudget) * 100) : 0;
      costStatus = `$${monthlyTotal.toFixed(2)}/$${monthlyBudget} (${monthlyPercent}%)`;
    } catch (e) { /* skip */ }
  }

  // Build summary message
  const summaryParts = [
    `**Daily Summary - ${now.toLocaleDateString()}**`,
    '',
    `📊 **Progress**: ${completedYesterday} tasks completed yesterday`,
    `📋 **Active**: ${activeTasks.length} tasks in progress${stuckTasks.length > 0 ? ` (⚠️ ${stuckTasks.length} stuck)` : ''}`,
    `👤 **Your Tasks**: ${humanTasks.length} awaiting your attention`,
    `🔔 **Notifications**: ${unreadCount} unread`,
    `💰 **Monthly Cost**: ${costStatus}`
  ];

  if (highPriorityIssues.length > 0) {
    summaryParts.push('');
    summaryParts.push(`⚠️ **${highPriorityIssues.length} high priority issues** need attention`);
    highPriorityIssues.slice(0, 3).forEach(issue => {
      summaryParts.push(`  • ${issue.title}`);
    });
  }

  const summaryContent = summaryParts.join('\n');

  // Create notification
  const notification = {
    id: `notif-${Date.now()}`,
    type: 'daily_summary',
    title: 'Morning Briefing',
    message: summaryContent,
    read: false,
    createdAt: now.toISOString(),
    metadata: {
      completedYesterday,
      completedDetails: completedYesterdayTasks.slice(0, 10).map(t => ({
        id: t.id, title: t.title, assignees: t.assigneeIds || []
      })),
      activeTasks: activeTasks.length,
      activeDetails: activeTasks.map(t => {
        const tracking = calculateTimeInStatus(t);
        return {
          id: t.id, title: t.title, status: t.status,
          assignees: t.assigneeIds || [],
          timeInStatus: tracking.timeInStatusHuman,
          alertLevel: tracking.alertLevel
        };
      }),
      stuckTasks: stuckTasks.length,
      humanTasks: humanTasks.length,
      humanDetails: humanTasks.slice(0, 10).map(t => ({
        id: t.id, title: t.title, status: t.status
      })),
      unreadCount,
      costStatus,
      highPriorityIssues: highPriorityIssues.length,
      highPriorityDetails: highPriorityIssues.slice(0, 5).map(issue => ({
        title: issue.title,
        description: issue.description,
        recommendation: issue.recommendation,
        taskId: issue.taskId || null,
        type: issue.type
      }))
    }
  };

  mc.notifications.unshift(notification);
  fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
  cache.missionControl = null; // Clear cache

  console.log(`[DailySummary] Morning briefing created: ${completedYesterday} completed, ${humanTasks.length} human tasks`);
  return notification;
}

/**
 * Schedule daily summary at 8 AM PST
 */
cron.schedule('0 8 * * *', () => {
  console.log('[Cron] Generating morning summary...');
  try {
    generateDailySummary();
    recordCronRun('daily-summary');
    logSystemEvent('cron', 'Daily summary generated');
  } catch (err) {
    console.error('[Cron] Daily summary failed:', err);
    recordCronRun('daily-summary', null, err.message);
    logSystemEvent('error', `Daily summary failed: ${err.message}`);
  }
}, {
  timezone: 'America/Los_Angeles'
});

console.log('[Cron] Daily summary scheduled for 8:00 AM PST');

/**
 * Schedule daily repost candidate conversion at 9 AM PST
 * Runs after the 8 AM summary so Shawn sees the briefing first
 */
cron.schedule('0 9 * * *', () => {
  console.log('[Cron] Converting repost candidates...');
  try {
    convertRepostCandidates();
    recordCronRun('repost-convert');
    logSystemEvent('cron', 'Repost candidate conversion completed');
  } catch (err) {
    console.error('[Cron] Repost conversion failed:', err);
    recordCronRun('repost-convert', null, err.message);
    logSystemEvent('error', `Repost conversion failed: ${err.message}`);
  }
}, {
  timezone: 'America/Los_Angeles'
});

console.log('[Cron] Repost candidate conversion scheduled for 9:00 AM PST');

/**
 * Weekly Monday reset: Set idea batch task back to assigned
 */
cron.schedule('0 0 * * 1', () => {
  console.log('[Cron] Weekly reset: Idea batch task');
  try {
    const data = getMissionControl();
    const task = data.tasks.find(t =>
      t.metadata?.recurring === 'weekly' &&
      t.title.toLowerCase().includes('idea')
    );
    if (task && task.status !== 'assigned') {
      task.status = 'assigned';
      delete task.completedAt;
      task.metadata.ideasThisWeek = 0;
      fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(data, null, 2));
      cache.missionControl = null;
      console.log('[Cron] Reset idea batch task to assigned');
    }
    recordCronRun('weekly-idea-reset');
    logSystemEvent('cron', 'Weekly idea batch task reset');
  } catch (err) {
    console.error('[Cron] Weekly reset error:', err);
    recordCronRun('weekly-idea-reset', null, err.message);
    logSystemEvent('error', `Weekly idea reset failed: ${err.message}`);
  }
}, {
  timezone: 'America/Los_Angeles'
});

console.log('[Cron] Weekly idea task reset scheduled for Monday 00:00 PST');

/**
 * Daily automated follower snapshot at 6 AM PST
 * Pulls Twitter metrics via Bird CLI and saves to analytics data
 */
const BIRD_CLI = '/opt/homebrew/bin/bird';

function snapshotTwitterMetrics() {
  try {
    if (!fs.existsSync(BIRD_CLI)) {
      console.log('[Cron] Bird CLI not found, skipping Twitter snapshot');
      return;
    }

    const opts = { timeout: 30000, encoding: 'utf8' };

    // Get follower count (--all wraps in { users: [...] })
    let followers = 0;
    try {
      const parsed = JSON.parse(execSync(`${BIRD_CLI} followers --all --json 2>/dev/null`, opts));
      followers = Array.isArray(parsed) ? parsed.length : (parsed.users || []).length;
    } catch (e) {
      console.error('[Cron] Failed to fetch followers:', e.message);
    }

    // Get following count
    let following = 0;
    try {
      const parsed = JSON.parse(execSync(`${BIRD_CLI} following --all --json 2>/dev/null`, opts));
      following = Array.isArray(parsed) ? parsed.length : (parsed.users || []).length;
    } catch (e) {
      console.error('[Cron] Failed to fetch following:', e.message);
    }

    // Get tweet count
    let tweets = 0;
    try {
      const parsed = JSON.parse(execSync(`${BIRD_CLI} user-tweets thetensionlines --json 2>/dev/null`, opts));
      tweets = Array.isArray(parsed) ? parsed.length : 0;
    } catch (e) {
      console.error('[Cron] Failed to fetch tweets:', e.message);
    }

    // Save to analytics
    const data = getAnalyticsData();
    if (!data.platforms) data.platforms = {};
    if (!data.platforms.twitter) data.platforms.twitter = { current: {}, history: [] };

    data.platforms.twitter.current = {
      ...data.platforms.twitter.current,
      followers,
      following,
      tweets
    };

    // Auto-push daily snapshot
    const today = new Date().toISOString().split('T')[0];
    const history = data.platforms.twitter.history || [];
    const todayIdx = history.findIndex(h => h.date === today);
    const snapshot = { date: today, ...data.platforms.twitter.current };

    if (todayIdx >= 0) {
      history[todayIdx] = snapshot;
    } else {
      history.push(snapshot);
    }
    if (history.length > 365) history.splice(0, history.length - 365);
    data.platforms.twitter.history = history;

    saveAnalyticsData(data);
    console.log(`[Cron] Twitter snapshot: ${followers} followers, ${following} following, ${tweets} tweets`);
  } catch (err) {
    console.error('[Cron] Twitter snapshot failed:', err);
  }
}

cron.schedule('15 6 * * *', () => {
  console.log('[Cron] Running daily Twitter metrics snapshot...');
  try {
    snapshotTwitterMetrics();
    recordCronRun('twitter-metrics');
    logSystemEvent('cron', 'Twitter metrics snapshot completed');
  } catch (err) {
    recordCronRun('twitter-metrics', null, err.message);
    logSystemEvent('error', `Twitter metrics failed: ${err.message}`);
  }
}, {
  timezone: 'America/Los_Angeles'
});

console.log('[Cron] Daily Twitter metrics snapshot scheduled for 6:15 AM PST');

// Weekly report generation — every Monday at 7 AM PST, generate previous week's report
cron.schedule('0 7 * * 1', () => {
  try {
    const prevWeekId = getPreviousWeekId(getISOWeekId(new Date()));
    const existing = readWeeklyReport(prevWeekId);
    if (existing) {
      console.log(`[Cron] Weekly report for ${prevWeekId} already exists, skipping.`);
      recordCronRun('weekly-report', 'skipped');
      return;
    }
    console.log(`[Cron] Generating weekly report for ${prevWeekId}...`);
    const report = generateWeeklyReport(prevWeekId);
    saveWeeklyReport(prevWeekId, report);
    console.log(`[Cron] Weekly report saved: ${report.content.postsPublished} posts, ${report.agents.totalCompleted} tasks completed, $${report.costs.totalSpent} spent`);
    recordCronRun('weekly-report');
    logSystemEvent('cron', `Weekly report generated for ${prevWeekId}`);
  } catch (err) {
    console.error('[Cron] Weekly report generation failed:', err);
    recordCronRun('weekly-report', null, err.message);
    logSystemEvent('error', `Weekly report failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Weekly report generation scheduled for Monday 7:00 AM PST');

// Weekly project review — every Sunday at 10 PM PST
// Tension reviews the entire project for security vulnerabilities and product enhancements,
// then adds ideas to the "Proposed" section of the Future Needs roadmap.
async function weeklyProjectReview() {
  console.log('[Cron] Starting weekly project review...');

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    console.log('[Cron] Weekly review skipped — no Anthropic API key');
    return;
  }

  // Cost gate (shares daily cap with debug system)
  const today = new Date().toISOString().slice(0, 10);
  if (debugCostToday.date !== today) {
    debugCostToday = { date: today, cost: 0.0 };
  }
  if (debugCostToday.cost >= 10.0) {
    console.log(`[Cron] Weekly review skipped — daily cost cap reached ($${debugCostToday.cost.toFixed(2)})`);
    return;
  }

  try {
    // Gather project context
    const mc = getMissionControl();
    const futureNeeds = getFutureNeeds();
    const pkg = JSON.parse(fs.readFileSync(path.join(BASE_DIR, 'cms/package.json'), 'utf8'));

    // Route summary — extract all endpoint definitions
    const serverCode = fs.readFileSync(path.join(BASE_DIR, 'cms/server.js'), 'utf8');
    const routeLines = serverCode.split('\n')
      .map((line, i) => ({ line: line.trim(), num: i + 1 }))
      .filter(({ line }) => /^app\.(get|post|put|patch|delete)\(/.test(line))
      .map(({ line, num }) => {
        const match = line.match(/app\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/);
        return match ? `${match[1].toUpperCase()} ${match[2]}` : null;
      })
      .filter(Boolean);

    // Agent summary
    const agents = (mc.agents || []).map(a => `${a.name} (${a.id}) — ${a.role || 'philosopher'}`).join('\n');

    // Task summary
    const tasksByStatus = {};
    (mc.tasks || []).forEach(t => {
      tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
    });
    const taskSummary = Object.entries(tasksByStatus).map(([s, c]) => `${s}: ${c}`).join(', ');

    // Existing future needs titles (for dedup)
    const existingTitles = (futureNeeds.needs || []).map(n => n.title);

    // File structure summary
    const dirs = ['cms/src/components', 'cms/src/lib', 'philosophers', 'mission-control', 'content', 'content/queue', 'books'];
    const fileStructure = dirs.map(d => {
      const fullPath = path.join(BASE_DIR, d);
      try {
        const files = fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
        return `${d}/: ${files.join(', ')}`;
      } catch { return `${d}/: (not found)`; }
    }).join('\n');

    // Dependencies
    const deps = Object.entries(pkg.dependencies || {}).map(([k, v]) => `${k}@${v}`).join(', ');

    const userMessage = `You are Tension, the AI orchestrator for TensionLines — a philosophy brand with 10 philosopher agents, a Node.js/React CMS, and multi-platform social media presence.

Review this project for:
1. **Security vulnerabilities** — authentication gaps, injection risks, data exposure, dependency issues, API security, file system risks
2. **Product/feature enhancements** — UX improvements, automation opportunities, new capabilities, performance optimizations, content pipeline improvements

PROJECT CONTEXT:

**Dependencies:** ${deps}

**API Endpoints (${routeLines.length} total):**
${routeLines.join('\n')}

**File Structure:**
${fileStructure}

**Agents:**
${agents}

**Tasks:** ${taskSummary}

**Existing Future Needs (DO NOT duplicate these):**
${existingTitles.map(t => `- ${t}`).join('\n') || '(none)'}

Respond with a JSON array of new proposed items. Each item should have:
- "title": concise title (max 80 chars)
- "description": 1-2 sentence explanation
- "category": one of [content, growth, analytics, infrastructure, monetization, governance]
- "priority": one of [high, medium, low]
- "effort": one of [small, medium, large]
- "type": "security" or "enhancement"

Rules:
- Return 3-8 items total (mix of security and enhancements)
- Do NOT duplicate any existing future needs
- Focus on actionable, specific improvements (not vague wishes)
- Prioritize security issues as "high" priority
- Return ONLY the JSON array, no other text`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: 'You are a senior security auditor and product strategist reviewing an AI-powered content management system. Respond only with valid JSON.',
      messages: [{ role: 'user', content: userMessage }]
    });

    // Track cost
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const callCost = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);
    debugCostToday.cost += callCost;
    console.log(`[Cron] Weekly review API call — cost: $${callCost.toFixed(4)} (daily total: $${debugCostToday.cost.toFixed(2)})`);

    // Parse response
    const text = response.content[0]?.text || '';
    let items;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      items = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      console.error('[Cron] Weekly review — failed to parse response:', text.slice(0, 200));
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      console.log('[Cron] Weekly review — no new items proposed');
      return;
    }

    // Dedup against existing titles (case-insensitive)
    const existingLower = existingTitles.map(t => t.toLowerCase());
    const newItems = items.filter(item =>
      item.title && !existingLower.includes(item.title.toLowerCase())
    );

    if (newItems.length === 0) {
      console.log('[Cron] Weekly review — all items already exist, nothing to add');
      return;
    }

    // Add to future needs
    const data = getFutureNeeds();
    const maxNum = data.needs.reduce((max, n) => {
      const num = parseInt(n.id.replace('need-', ''));
      return num > max ? num : max;
    }, 0);

    let addedCount = 0;
    newItems.forEach((item, i) => {
      // Validate fields
      const category = VALID_NEED_CATEGORIES.includes(item.category) ? item.category : 'infrastructure';
      const priority = VALID_NEED_PRIORITIES.includes(item.priority) ? item.priority : 'medium';
      const effort = VALID_NEED_EFFORTS.includes(item.effort) ? item.effort : 'medium';

      const newNeed = {
        id: `need-${String(maxNum + 1 + i).padStart(3, '0')}`,
        title: String(item.title).slice(0, 120),
        description: String(item.description || '').slice(0, 500),
        useCase: item.type === 'security' ? 'Security hardening identified by weekly automated review' : 'Enhancement identified by weekly automated review',
        category,
        priority,
        effort,
        status: 'proposed',
        proposedBy: 'tension',
        proposedAt: new Date().toISOString(),
        targetQuarter: '',
        agents: [],
        dependencies: [],
        acceptanceCriteria: [],
        votes: 0,
        voters: [],
        comments: [],
        updatedAt: new Date().toISOString()
      };

      data.needs.push(newNeed);
      addedCount++;
    });

    saveFutureNeeds(data);

    // Create notification
    const mcData = getMissionControl();
    const secCount = newItems.filter(i => i.type === 'security').length;
    const enhCount = newItems.filter(i => i.type === 'enhancement').length;
    mcData.notifications.push({
      id: `notif-review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'weekly_review',
      title: `Weekly Project Review: ${addedCount} new proposals`,
      message: `Tension's weekly review found ${secCount} security item${secCount !== 1 ? 's' : ''} and ${enhCount} enhancement${enhCount !== 1 ? 's' : ''}. Check the Future Needs roadmap for details.`,
      from: 'tension',
      to: ['shawn'],
      createdAt: new Date().toISOString(),
      read: false,
      priority: secCount > 0 ? 'high' : 'normal',
      actionRequired: false,
      metadata: { itemCount: addedCount, securityCount: secCount, enhancementCount: enhCount }
    });

    // Log activity
    mcData.activities.unshift({
      id: `activity-${Date.now()}`,
      type: 'weekly_review',
      agentId: 'tension',
      timestamp: new Date().toISOString(),
      description: `Weekly project review: added ${addedCount} proposed items (${secCount} security, ${enhCount} enhancements)`,
      metadata: { cost: callCost, itemCount: addedCount }
    });

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mcData, null, 2));
    cache.missionControl = null;

    console.log(`[Cron] Weekly review complete — added ${addedCount} items (${secCount} security, ${enhCount} enhancements), cost: $${callCost.toFixed(4)}`);
  } catch (err) {
    console.error('[Cron] Weekly project review failed:', err.message);
  }
}

// Sunday at 10 PM PST — after all daily jobs, well before Monday's midnight reset
cron.schedule('0 22 * * 0', async () => {
  try {
    await weeklyProjectReview();
    recordCronRun('weekly-review');
    logSystemEvent('cron', 'Weekly project review completed');
  } catch (err) {
    recordCronRun('weekly-review', null, err.message);
    logSystemEvent('error', `Weekly review failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Weekly project review scheduled for Sunday 10:00 PM PST');

/**
 * Daily auto-pipeline: generate drafts from captured ideas at 6 AM PST
 */
cron.schedule('0 6 * * *', async () => {
  try {
    const state = getAutoPipelineState();
    if (!state.config?.enabled) {
      console.log('[Cron] Auto-pipeline disabled, skipping.');
      recordCronRun('auto-pipeline', 'disabled');
      return;
    }
    await runAutoPipeline();
    recordCronRun('auto-pipeline');
    logSystemEvent('pipeline', 'Auto-pipeline completed');
  } catch (err) {
    console.error('[Cron] Auto-pipeline error:', err);
    recordCronRun('auto-pipeline', null, err.message);
    logSystemEvent('error', `Auto-pipeline failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Auto-pipeline scheduled for 6:00 AM PST (when enabled)');

/**
 * Auto Voice Check — Diogenes Quality Gate
 * Scores new drafts in the posting queue against their philosopher's voice at 6:30 AM PST
 */
async function runAutoVoiceCheck() {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[VoiceCheck] No Anthropic API key configured, skipping.');
    return { checked: 0, flagged: 0 };
  }

  const queue = getPostingQueue();
  const unchecked = queue.queue.filter(item =>
    (item.status === 'pending-review' || item.status === 'ready') && !item.voiceCheck
  );

  if (unchecked.length === 0) {
    console.log('[VoiceCheck] No unchecked items in queue.');
    return { checked: 0, flagged: 0 };
  }

  const toCheck = unchecked.slice(0, 5); // Limit to 5 per run
  let checked = 0;
  let flagged = 0;

  for (const item of toCheck) {
    try {
      const philosopher = PHILOSOPHER_BY_PLATFORM[item.platform] || item.createdBy || 'nietzsche';
      const content = item.content || item.caption || '';
      if (!content || content.length < 10) continue;

      const soulPath = path.join(PHILOSOPHERS_DIR, philosopher, 'SOUL.md');
      if (!fs.existsSync(soulPath)) {
        console.log(`[VoiceCheck] No SOUL.md for ${philosopher}, skipping item ${item.id}`);
        continue;
      }
      const soulRaw = fs.readFileSync(soulPath, 'utf8');
      const voiceDefinition = extractVoiceSections(soulRaw);

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: `You are a voice consistency checker for a philosophy brand called TensionLines. You evaluate whether content matches a philosopher's defined voice and style. Be concise and specific. Respond ONLY with valid JSON, no markdown wrapping.`,
        messages: [{
          role: 'user',
          content: `## Voice Definition for "${philosopher}"
${voiceDefinition}

## Content to Check (for ${item.platform || 'unknown'})
${content}

## Task
Analyze how well this content matches the voice definition above. Return JSON:
{
  "score": <0-100 integer>,
  "verdict": "<strong|good|weak|off-voice>",
  "issues": [{"type": "<tone|vocabulary|structure|length>", "description": "<specific issue>", "severity": "<low|medium|high>"}],
  "suggestions": ["<specific actionable suggestion>"],
  "strengths": ["<what matches the voice well>"]
}

Scoring: 80-100=strong (nails the voice), 60-79=good (mostly on voice), 40-59=weak (drifting), 0-39=off-voice (wrong voice entirely).
Keep issues, suggestions, and strengths to 1-3 items each. Be specific, not generic.`
        }]
      });

      const text = response.content[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`[VoiceCheck] Failed to parse response for item ${item.id}`);
        continue;
      }

      const result = JSON.parse(jsonMatch[0]);
      item.voiceCheck = {
        score: result.score,
        verdict: result.verdict,
        checkedAt: new Date().toISOString(),
        philosopher,
        issues: result.issues,
        suggestions: result.suggestions,
        strengths: result.strengths
      };
      checked++;

      if (result.score < 40) {
        item.status = 'needs-revision';
        flagged++;
        console.log(`[VoiceCheck] Item ${item.id} (${item.platform}) scored ${result.score} — flagged as needs-revision`);
      } else {
        console.log(`[VoiceCheck] Item ${item.id} (${item.platform}) scored ${result.score} — ${result.verdict}`);
      }
    } catch (err) {
      console.error(`[VoiceCheck] Error checking item ${item.id}:`, err.message);
    }
  }

  savePostingQueue(queue);
  broadcast('posting-queue');
  logSystemEvent('cron', `Voice check completed: ${checked} checked, ${flagged} flagged`, { checked, flagged });
  return { checked, flagged };
}

cron.schedule('30 6 * * *', async () => {
  try {
    const result = await runAutoVoiceCheck();
    recordCronRun('auto-voice-check', `checked:${result.checked},flagged:${result.flagged}`);
  } catch (err) {
    console.error('[Cron] Auto voice check error:', err);
    recordCronRun('auto-voice-check', null, err.message);
    logSystemEvent('error', `Auto voice check failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Auto voice check (Diogenes) scheduled for 6:30 AM PST');

/**
 * Queue Replenishment — auto-draft when platform queues run low at 4:00 PM PST
 */
async function runQueueReplenishment() {
  const queue = getPostingQueue();
  const counts = {};
  const thresholds = { twitter: 3, bluesky: 3, threads: 2, instagram: 2, reddit: 2, medium: 1, substack: 1 };

  // Count ready items per platform
  for (const platform of Object.keys(thresholds)) {
    counts[platform] = queue.queue.filter(item =>
      item.platform === platform && (item.status === 'ready' || item.status === 'pending-review')
    ).length;
  }

  const needyPlatforms = Object.keys(thresholds).filter(p => counts[p] < thresholds[p]);
  if (needyPlatforms.length === 0) {
    console.log('[Replenishment] All platform queues are above threshold.');
    logSystemEvent('cron', 'Queue replenishment: all queues healthy', { counts });
    return { drafted: 0, platforms: [] };
  }

  console.log(`[Replenishment] Low queues: ${needyPlatforms.map(p => `${p}(${counts[p]}/${thresholds[p]})`).join(', ')}`);

  // Get eligible ideas
  cache.ideasBank = null; // Force fresh parse
  const allIdeas = parseIdeasBank();
  const state = getAutoPipelineState();
  const processedSet = new Set(state.processedIds || []);
  const eligible = allIdeas.filter(i => i.status === 'captured' && !processedSet.has(i.id));

  if (eligible.length === 0) {
    console.log('[Replenishment] No ideas available for replenishment.');
    logSystemEvent('cron', 'Queue replenishment: no ideas available', { needyPlatforms });
    return { drafted: 0, platforms: needyPlatforms };
  }

  const idea = eligible[0];
  const parts = [];
  if (idea.quote) parts.push(`Quote: "${idea.quote}"`);
  if (idea.tension) parts.push(`Tension: ${idea.tension}`);
  if (idea.paradox) parts.push(`Paradox: ${idea.paradox}`);
  if (idea.notes) parts.push(`Notes: ${idea.notes}`);
  if (idea.text && !idea.quote) parts.push(idea.text);
  const sourceText = parts.join('\n\n');

  if (!sourceText.trim()) {
    console.log(`[Replenishment] Idea #${idea.id} has no text content, skipping.`);
    state.processedIds.push(idea.id);
    saveAutoPipelineState(state);
    return { drafted: 0, platforms: needyPlatforms };
  }

  console.log(`[Replenishment] Using idea #${idea.id} for platforms: ${needyPlatforms.join(', ')}`);

  const { drafts, validPlatforms } = await generatePlatformDrafts(
    sourceText,
    'nietzsche',
    needyPlatforms
  );

  let totalDraftsQueued = 0;
  const freshQueue = getPostingQueue();
  for (const platform of validPlatforms) {
    if (!drafts[platform]) continue;
    const draft = drafts[platform];
    const item = {
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      status: 'pending-review',
      platform,
      content: draft.content || draft.title || draft.cardText || '',
      caption: draft.caption || '',
      parts: [],
      createdBy: PHILOSOPHER_BY_PLATFORM[platform] || 'nietzsche',
      ideaId: idea.id,
      source: 'queue-replenishment'
    };
    if (platform === 'reddit' && draft.title && draft.body) {
      item.content = `${draft.title}\n\n${draft.body}`;
    }
    if (platform === 'medium') {
      if (draft.title) item.title = draft.title;
      if (draft.topics) item.topics = draft.topics;
    }
    if (platform === 'instagram' && draft.cardText) {
      item.content = draft.cardText;
      item.caption = draft.caption || '';
    }
    freshQueue.queue.push(item);
    totalDraftsQueued++;
  }
  savePostingQueue(freshQueue);

  // Mark idea as processed
  state.processedIds.push(idea.id);
  saveAutoPipelineState(state);

  broadcast('posting-queue');

  // Create notification
  try {
    const mc = getMissionControl();
    mc.notifications.unshift({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'queue_replenishment',
      title: 'Queue Replenishment',
      message: `Drafted ${totalDraftsQueued} posts for ${validPlatforms.join(', ')} from idea #${idea.id}`,
      from: 'queue-replenishment',
      read: false,
      createdAt: new Date().toISOString(),
      priority: 'medium',
      actionRequired: true,
      metadata: { ideaId: idea.id, platforms: validPlatforms, draftsQueued: totalDraftsQueued }
    });
    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
    cache.missionControl = null;
  } catch (notifErr) {
    console.error('[Replenishment] Failed to create notification:', notifErr.message);
  }

  logSystemEvent('cron', `Queue replenishment: drafted ${totalDraftsQueued} posts for ${validPlatforms.join(', ')} from idea #${idea.id}`, {
    ideaId: idea.id, platforms: validPlatforms, drafted: totalDraftsQueued
  });

  return { drafted: totalDraftsQueued, platforms: validPlatforms, ideaId: idea.id };
}

cron.schedule('0 16 * * *', async () => {
  try {
    const result = await runQueueReplenishment();
    recordCronRun('queue-replenishment', `drafted:${result.drafted}`);
  } catch (err) {
    console.error('[Cron] Queue replenishment error:', err);
    recordCronRun('queue-replenishment', null, err.message);
    logSystemEvent('error', `Queue replenishment failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Queue replenishment scheduled for 4:00 PM PST');

/**
 * Evening Performance Recap — daily stats notification at 8:00 PM PST
 */
async function generateEveningRecap() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD

  // Posts published today
  const queue = getPostingQueue();
  const postedToday = (queue.posted || []).filter(item =>
    item.postedAt && item.postedAt.startsWith(today)
  );
  const postsByPlatform = {};
  for (const item of postedToday) {
    postsByPlatform[item.platform] = (postsByPlatform[item.platform] || 0) + 1;
  }
  const totalPosted = postedToday.length;

  // Comments posted today
  const commentQueue = getCommentQueue();
  const commentsPostedToday = (commentQueue.posted || []).filter(item =>
    item.postedAt && item.postedAt.startsWith(today)
  ).length;

  // Replies posted today
  const replyQueue = getReplyQueue();
  const repliesPostedToday = (replyQueue.posted || []).filter(item =>
    item.postedAt && item.postedAt.startsWith(today)
  ).length;

  // Queue depth
  const queueDepth = {};
  let totalReady = 0;
  for (const item of queue.queue) {
    if (item.status === 'ready' || item.status === 'pending-review') {
      queueDepth[item.platform] = (queueDepth[item.platform] || 0) + 1;
      totalReady++;
    }
  }

  // Engagement received
  const engagementInbox = getEngagementInbox();
  const newMentions = (engagementInbox.items || []).filter(item =>
    item.discoveredAt && item.discoveredAt.startsWith(today)
  ).length;

  // Cost today
  let costToday = 0;
  try {
    const costFile = path.join(BASE_DIR, 'cost-tracking/daily-costs.json');
    if (fs.existsSync(costFile)) {
      const costs = JSON.parse(fs.readFileSync(costFile, 'utf8'));
      if (costs[today]) {
        costToday = costs[today].total || Object.values(costs[today]).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
      }
    }
  } catch (err) {
    console.error('[Recap] Error reading cost data:', err.message);
  }

  // Ideas captured today
  cache.ideasBank = null;
  const allIdeas = parseIdeasBank();
  const ideasToday = allIdeas.filter(i => i.date === today).length;

  // Cron runs today
  let cronRunsToday = 0;
  for (const [, entry] of Object.entries(cronRegistry)) {
    if (entry.lastRun && entry.lastRun.startsWith(today)) {
      cronRunsToday++;
    }
  }

  // Build summary
  const platformBreakdown = Object.entries(postsByPlatform).map(([p, n]) => `${p}: ${n}`).join(', ');
  const queueBreakdown = Object.entries(queueDepth).map(([p, n]) => `${p}: ${n}`).join(', ');
  const emptyQueues = ['twitter', 'bluesky', 'threads', 'instagram', 'reddit', 'medium', 'substack']
    .filter(p => !queueDepth[p] || queueDepth[p] === 0);

  let summary = `**Evening Recap - ${today}**\n\n`;
  summary += `📮 **Published**: ${totalPosted} posts${platformBreakdown ? ` (${platformBreakdown})` : ''}\n`;
  summary += `💬 **Engagement**: ${commentsPostedToday} comments posted, ${repliesPostedToday} replies posted\n`;
  summary += `📥 **Received**: ${newMentions} new mentions/replies\n`;
  summary += `📦 **Queue Depth**: ${totalReady} posts ready${queueBreakdown ? ` (${queueBreakdown})` : ''}\n`;
  summary += `💡 **Ideas**: ${ideasToday} captured today\n`;
  summary += `💰 **Cost**: $${costToday.toFixed(2)} today\n`;
  summary += `⚙️ **System**: ${cronRunsToday} cron jobs ran today`;

  if (emptyQueues.length > 0) {
    summary += `\n\n⚠️ **Empty queues**: ${emptyQueues.join(', ')} — consider adding content`;
  }

  console.log(`[Recap] ${summary}`);

  // Create notification
  try {
    const mc = getMissionControl();
    mc.notifications.unshift({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'evening_recap',
      title: `Evening Recap - ${today}`,
      message: summary,
      from: 'evening-recap',
      read: false,
      createdAt: new Date().toISOString(),
      priority: 'low',
      actionRequired: false,
      metadata: {
        totalPosted, postsByPlatform, commentsPostedToday, repliesPostedToday,
        newMentions, totalReady, queueDepth, ideasToday, costToday, cronRunsToday, emptyQueues
      }
    });
    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
    cache.missionControl = null;
  } catch (notifErr) {
    console.error('[Recap] Failed to create notification:', notifErr.message);
  }

  logSystemEvent('cron', `Evening recap generated: ${totalPosted} posted, ${totalReady} queued, $${costToday.toFixed(2)} cost`, {
    totalPosted, totalReady, costToday
  });

  return { totalPosted, commentsPostedToday, repliesPostedToday, newMentions, totalReady, ideasToday, costToday, cronRunsToday, emptyQueues };
}

cron.schedule('0 20 * * *', async () => {
  try {
    const result = await generateEveningRecap();
    recordCronRun('evening-recap', `posted:${result.totalPosted},queued:${result.totalReady}`);
  } catch (err) {
    console.error('[Cron] Evening recap error:', err);
    recordCronRun('evening-recap', null, err.message);
    logSystemEvent('error', `Evening recap failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Evening recap scheduled for 8:00 PM PST');

// ============================================================================
// SYSTEM 1: PEER REVIEW PIPELINE (7:00 AM daily)
// ============================================================================

/**
 * Call a reviewing agent via Claude API with their SOUL.md voice context.
 */
async function callReviewer(client, reviewerId, content, item, reviewType) {
  const soulPath = path.join(PHILOSOPHERS_DIR, reviewerId, 'SOUL.md');
  let voiceContext = '';
  if (fs.existsSync(soulPath)) {
    voiceContext = extractVoiceSections(fs.readFileSync(soulPath, 'utf8'));
  }

  const prompts = {
    'probing-questions': `You are ${reviewerId}, a philosophical reviewer. Your voice:\n${voiceContext}\n\nReview this content and ask 2-3 probing questions that expose weak arguments, unstated assumptions, or logical gaps. Be specific to the actual content.\n\nContent (${item.platform}):\n${content}\n\nRespond ONLY with valid JSON:\n{"verdict": "pass|minor-issues|needs-work|reject", "feedback": "your detailed review", "summary": "1-sentence summary"}`,
    'bs-check': `You are ${reviewerId}, a philosophical BS detector. Your voice:\n${voiceContext}\n\nCheck this content for hollow claims, performative depth, buzzwords, and pseudo-profundity. Is this saying something real or just sounding smart?\n\nContent (${item.platform}):\n${content}\n\nRespond ONLY with valid JSON:\n{"verdict": "pass|minor-issues|needs-work|reject", "feedback": "your detailed review", "summary": "1-sentence summary"}`,
    'fact-check': `You are ${reviewerId}, a scholarly fact-checker. Your voice:\n${voiceContext}\n\nFlag any factual claims, quotes, attributions, or historical references that need verification. Note if sources are cited correctly.\n\nContent (${item.platform}):\n${content}\n\nRespond ONLY with valid JSON:\n{"verdict": "pass|minor-issues|needs-work|reject", "feedback": "your detailed review", "summary": "1-sentence summary"}`
  };

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: 'You are a peer reviewer for a philosophy brand. Respond ONLY with valid JSON, no markdown wrapping.',
    messages: [{ role: 'user', content: prompts[reviewType] }]
  });

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Failed to parse ${reviewerId} response`);
  return JSON.parse(jsonMatch[0]);
}

/**
 * Run peer review on voice-checked drafts.
 * Items scoring 40-70: Socrates (probing) + Diogenes (BS check)
 * Items scoring 70+: Hypatia (fact-check) if claims present
 */
async function runPeerReview() {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[PeerReview] No Anthropic API key configured, skipping.');
    return { reviewed: 0, flagged: 0 };
  }

  const queue = getPostingQueue();
  const candidates = queue.queue.filter(item =>
    item.voiceCheck && !item.peerReview &&
    item.voiceCheck.score >= 40 &&
    !['needs-revision', 'posted', 'skipped'].includes(item.status)
  );

  if (candidates.length === 0) {
    console.log('[PeerReview] No candidates for peer review.');
    return { reviewed: 0, flagged: 0 };
  }

  const toReview = candidates.slice(0, 5);
  let reviewed = 0;
  let flagged = 0;

  for (const item of toReview) {
    try {
      const content = item.content || item.caption || '';
      if (!content || content.length < 10) continue;

      const score = item.voiceCheck.score;
      const reviewers = {};

      // Start a message thread for this review
      const threadMsg = sendAgentMessage({
        from: 'tension',
        to: ['socrates', 'diogenes', 'hypatia'],
        subject: `Peer Review: ${item.platform} draft (score: ${score})`,
        body: `A ${item.platform} draft scored ${score}/100 on voice check and needs peer review.\n\n**Content:**\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`,
        type: 'review',
        priority: score < 60 ? 'high' : 'medium',
        metadata: { queueItemId: item.id, voiceScore: score }
      });

      if (score >= 40 && score < 70) {
        // Mid-range: Socrates probes + Diogenes BS check
        const socResult = await callReviewer(client, 'socrates', content, item, 'probing-questions');
        reviewers.socrates = socResult;
        sendAgentMessage({
          from: 'socrates',
          to: ['tension', 'plato'],
          subject: `Re: Peer Review: ${item.platform} draft (score: ${score})`,
          body: `**Probing Questions:**\n\n${socResult.feedback}\n\n**Verdict:** ${socResult.verdict}`,
          type: 'review',
          threadId: threadMsg.threadId,
          parentId: threadMsg.id
        });

        const dioResult = await callReviewer(client, 'diogenes', content, item, 'bs-check');
        reviewers.diogenes = dioResult;
        sendAgentMessage({
          from: 'diogenes',
          to: ['tension', 'plato'],
          subject: `Re: Peer Review: ${item.platform} draft (score: ${score})`,
          body: `**BS Check:**\n\n${dioResult.feedback}\n\n**Verdict:** ${dioResult.verdict}`,
          type: 'review',
          threadId: threadMsg.threadId,
          parentId: threadMsg.id
        });
      }

      if (score >= 70) {
        // High-scoring: Hypatia fact-checks
        const hypResult = await callReviewer(client, 'hypatia', content, item, 'fact-check');
        reviewers.hypatia = hypResult;
        sendAgentMessage({
          from: 'hypatia',
          to: ['tension', 'plato'],
          subject: `Re: Peer Review: ${item.platform} draft (score: ${score})`,
          body: `**Fact Check:**\n\n${hypResult.feedback}\n\n**Verdict:** ${hypResult.verdict}`,
          type: 'review',
          threadId: threadMsg.threadId,
          parentId: threadMsg.id
        });
      }

      // Determine overall verdict
      const verdicts = Object.values(reviewers).map(r => r.verdict);
      let overallVerdict = 'pass';
      if (verdicts.includes('reject')) overallVerdict = 'reject';
      else if (verdicts.includes('needs-work')) overallVerdict = 'needs-work';
      else if (verdicts.includes('minor-issues')) overallVerdict = 'minor-issues';

      item.peerReview = {
        reviewedAt: new Date().toISOString(),
        threadId: threadMsg.threadId,
        reviewers,
        overallVerdict
      };

      if (overallVerdict === 'needs-work' || overallVerdict === 'reject') {
        item.status = 'needs-revision';
        flagged++;
      }

      reviewed++;
      console.log(`[PeerReview] Item ${item.id} (${item.platform}): ${overallVerdict} (reviewers: ${Object.keys(reviewers).join(', ')})`);
    } catch (err) {
      console.error(`[PeerReview] Error reviewing item ${item.id}:`, err.message);
    }
  }

  savePostingQueue(queue);
  broadcast('posting-queue');
  logSystemEvent('cron', `Peer review completed: ${reviewed} reviewed, ${flagged} flagged`, { reviewed, flagged });
  return { reviewed, flagged };
}

cron.schedule('0 7 * * *', async () => {
  try {
    const result = await runPeerReview();
    recordCronRun('peer-review', `reviewed:${result.reviewed},flagged:${result.flagged}`);
  } catch (err) {
    console.error('[Cron] Peer review error:', err);
    recordCronRun('peer-review', null, err.message);
    logSystemEvent('error', `Peer review failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Peer review pipeline scheduled for 7:00 AM PST');

// ============================================================================
// SYSTEM 2: TENSION DAILY STANDUP (7:30 AM daily)
// ============================================================================

/**
 * Tension analyzes system state and actively directs agents.
 */
async function runTensionStandup() {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[Standup] No Anthropic API key configured, skipping.');
    return { actions: 0 };
  }

  const mc = getMissionControl();
  const now = new Date();
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);

  // Gather context
  const recentActivities = (mc.activities || []).filter(a =>
    new Date(a.timestamp) >= yesterday
  );

  const activeTasks = mc.tasks.filter(t =>
    !['completed', 'shipped', 'deferred'].includes(t.status)
  );

  const stuckTasks = activeTasks.filter(t => {
    const time = calculateTimeInStatus(t);
    return time && time.hours > 48;
  });

  // Agent activity detection
  const agentActivity = {};
  for (const agent of mc.agents) {
    const agentTasks = activeTasks.filter(t => t.assigneeIds?.includes(agent.id));
    const agentMessages = (mc.messages || []).filter(m =>
      m.from === agent.id && new Date(m.createdAt) >= yesterday
    );
    const agentActivities = recentActivities.filter(a => a.agentId === agent.id);
    agentActivity[agent.id] = {
      name: agent.name,
      role: agent.role || '',
      activeTasks: agentTasks.length,
      taskNames: agentTasks.slice(0, 3).map(t => t.title),
      messagesSent: agentMessages.length,
      activitiesYesterday: agentActivities.length,
      idle: agentTasks.length === 0 && agentMessages.length === 0 && agentActivities.length === 0
    };
  }

  // Queue depths
  const queue = getPostingQueue();
  const queueDepths = {};
  for (const item of (queue.queue || [])) {
    if (item.status === 'ready' || item.status === 'pending-review') {
      queueDepths[item.platform] = (queueDepths[item.platform] || 0) + 1;
    }
  }

  const needsRevision = (queue.queue || []).filter(i => i.status === 'needs-revision').length;

  const unreadMessages = {};
  for (const msg of (mc.messages || [])) {
    if (msg.status === 'unread') {
      for (const recipient of msg.to) {
        unreadMessages[recipient] = (unreadMessages[recipient] || 0) + 1;
      }
    }
  }

  const idleAgents = Object.entries(agentActivity)
    .filter(([, info]) => info.idle)
    .map(([id]) => id);

  const contextDoc = `# System Status Report — ${now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })}

## Agent Activity (last 24h)
${Object.entries(agentActivity).map(([id, info]) =>
  `- **${id}** (${info.role}): ${info.idle ? 'IDLE' : `${info.activeTasks} tasks, ${info.messagesSent} messages`}${info.taskNames.length ? ` — working on: ${info.taskNames.join(', ')}` : ''}`
).join('\n')}

## Queue Depths
${Object.entries(queueDepths).map(([p, c]) => `- ${p}: ${c} ready`).join('\n') || '- All queues empty'}
- Items needing revision: ${needsRevision}

## Stuck Tasks (>48h in status)
${stuckTasks.map(t => `- ${t.id}: "${t.title}" — ${t.status} for ${calculateTimeInStatus(t)?.hours || '?'}h (assigned: ${t.assigneeIds?.join(', ') || 'none'})`).join('\n') || '- None'}

## Idle Agents
${idleAgents.length ? idleAgents.join(', ') : 'None'}

## Unread Messages
${Object.entries(unreadMessages).map(([id, c]) => `- ${id}: ${c} unread`).join('\n') || '- All caught up'}

## Available Agents & Roles
- tension: Director (you) — orchestrates all agents
- nietzsche: Twitter voice, provocative philosopher
- heraclitus: Bluesky/Threads/Instagram voice, change & flux
- diogenes: Reddit voice, BS detector, voice checker
- plato: Medium/Substack/Book author, systematic thinker
- socrates: Questioner, peer reviewer (probing questions)
- hypatia: Fact-checker, scholarly accuracy
- leonardo: Visual/creative director
- marcus: Stoic strategist, long-term planning
- aristotle: Structure/taxonomy, systematic organization`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: `You are Tension, the director of TensionLines — a philosophy brand run by AI philosopher agents. Your job is to review system state and direct agents. Be decisive, specific, and brief. Create max 3 task assignments. Only assign tasks that are actionable and relevant. Respond ONLY with valid JSON.`,
    messages: [{
      role: 'user',
      content: `${contextDoc}\n\nAnalyze the system state. Return JSON:\n{\n  "priorities": [{"agentId": "string", "message": "string", "urgency": "high|medium|low"}],\n  "taskAssignments": [{"agentId": "string", "taskTitle": "string", "taskDescription": "string", "rationale": "string"}],\n  "warnings": [{"type": "stuck|idle|depleted|cost", "message": "string"}],\n  "standupSummary": "2-3 sentence summary"\n}\n\nRules:\n- Only create tasks for idle agents or to address stuck/depleted issues\n- Max 3 task assignments\n- Priority messages should be specific directives, not vague encouragement\n- Warnings should flag real problems only`
    }]
  });

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Tension standup response');
  const plan = JSON.parse(jsonMatch[0]);

  let actions = 0;

  // Send priority messages
  for (const p of (plan.priorities || [])) {
    try {
      sendAgentMessage({
        from: 'tension',
        to: [p.agentId],
        subject: `Daily Directive: ${p.urgency} priority`,
        body: p.message,
        type: p.urgency === 'high' ? 'alert' : 'update',
        priority: p.urgency
      });
      actions++;
    } catch (err) {
      console.error(`[Standup] Failed to send priority to ${p.agentId}:`, err.message);
    }
  }

  // Create task assignments
  for (const ta of (plan.taskAssignments || []).slice(0, 3)) {
    try {
      const task = createInternalTask({
        title: ta.taskTitle,
        description: `${ta.taskDescription}\n\n*Rationale: ${ta.rationale}*`,
        assigneeIds: [ta.agentId],
        createdBy: 'tension',
        status: 'backlog',
        metadata: { source: 'tension-standup', priority: 'medium' }
      });
      // Notify the agent
      sendAgentMessage({
        from: 'tension',
        to: [ta.agentId],
        subject: `New Task: ${ta.taskTitle}`,
        body: `I've assigned you a new task: **${ta.taskTitle}**\n\n${ta.taskDescription}\n\n*${ta.rationale}*`,
        type: 'request',
        priority: 'medium',
        metadata: { taskId: task.id }
      });
      actions++;
    } catch (err) {
      console.error(`[Standup] Failed to create task for ${ta.agentId}:`, err.message);
    }
  }

  // Create standup notification for Shawn
  const warningText = (plan.warnings || []).length > 0
    ? '\n\n**Warnings:**\n' + plan.warnings.map(w => `- [${w.type}] ${w.message}`).join('\n')
    : '';

  const mc2 = getMissionControl();
  mc2.notifications.unshift({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'standup',
    title: 'Tension Daily Standup',
    message: `${plan.standupSummary || 'Standup completed.'}${warningText}\n\n${actions} actions taken.`,
    read: false,
    createdAt: new Date().toISOString(),
    priority: (plan.warnings || []).some(w => w.type === 'stuck' || w.type === 'depleted') ? 'high' : 'medium',
    metadata: {
      priorities: (plan.priorities || []).length,
      taskAssignments: (plan.taskAssignments || []).length,
      warnings: (plan.warnings || []).length,
      idleAgents
    }
  });
  fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc2, null, 2));
  cache.missionControl = null;
  broadcast('notifications');

  logSystemEvent('cron', `Tension standup: ${actions} actions, ${(plan.warnings || []).length} warnings`, {
    actions,
    priorities: (plan.priorities || []).length,
    taskAssignments: (plan.taskAssignments || []).length,
    warnings: plan.warnings || []
  });

  console.log(`[Standup] Tension standup complete: ${actions} actions, summary: ${plan.standupSummary || 'N/A'}`);
  return { actions, summary: plan.standupSummary, warnings: plan.warnings || [] };
}

cron.schedule('30 7 * * *', async () => {
  try {
    const result = await runTensionStandup();
    recordCronRun('tension-standup', `actions:${result.actions}`);
  } catch (err) {
    console.error('[Cron] Tension standup error:', err);
    recordCronRun('tension-standup', null, err.message);
    logSystemEvent('error', `Tension standup failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Tension daily standup scheduled for 7:30 AM PST');

// ============================================================================
// SYSTEM 3: BOOK PIPELINE (Wednesday 11:00 AM weekly)
// ============================================================================

function getBookPipelineState() {
  try {
    if (fs.existsSync(BOOK_PIPELINE_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(BOOK_PIPELINE_STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[BookPipeline] Error reading state:', err.message);
  }
  return {
    currentTarget: { chapter: 1, section: 2 },
    completedSections: [{ chapter: 1, section: 1, title: 'Opening Hook' }],
    runs: [],
    config: { enabled: true }
  };
}

function saveBookPipelineState(state) {
  const dir = path.dirname(BOOK_PIPELINE_STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BOOK_PIPELINE_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Parse MASTER_OUTLINE.md into structured chapters/sections.
 */
function parseBookOutline() {
  const outlinePath = path.join(BOOKS_DIR, 'book1-philosophy', 'outline', 'MASTER_OUTLINE.md');
  if (!fs.existsSync(outlinePath)) return [];

  const content = fs.readFileSync(outlinePath, 'utf8');
  const chapters = [];
  let currentChapter = null;

  for (const line of content.split('\n')) {
    const chapterMatch = line.match(/^####\s+Chapter\s+(\d+):\s+(.+)/);
    if (chapterMatch) {
      currentChapter = {
        number: parseInt(chapterMatch[1]),
        title: chapterMatch[2].trim(),
        sections: []
      };
      chapters.push(currentChapter);
      continue;
    }

    if (currentChapter) {
      const sectionMatch = line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
      if (sectionMatch) {
        currentChapter.sections.push({
          number: currentChapter.sections.length + 1,
          title: sectionMatch[1].trim()
        });
      }
    }
  }

  return chapters;
}

/**
 * Run the 4-stage book pipeline: Draft → Critique → Fact-check → Structure
 */
async function runBookPipeline() {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[BookPipeline] No Anthropic API key configured, skipping.');
    return { success: false, reason: 'no-api-key' };
  }

  const state = getBookPipelineState();
  if (!state.config?.enabled) {
    console.log('[BookPipeline] Pipeline disabled, skipping.');
    return { success: false, reason: 'disabled' };
  }

  const outline = parseBookOutline();
  if (outline.length === 0) {
    console.log('[BookPipeline] No outline found.');
    return { success: false, reason: 'no-outline' };
  }

  const { chapter: chapterNum, section: sectionNum } = state.currentTarget;
  const chapter = outline.find(c => c.number === chapterNum);
  if (!chapter) {
    console.log(`[BookPipeline] Chapter ${chapterNum} not found in outline.`);
    return { success: false, reason: 'chapter-not-found' };
  }

  const section = chapter.sections[sectionNum - 1];
  if (!section) {
    console.log(`[BookPipeline] Section ${sectionNum} not found in chapter ${chapterNum}.`);
    return { success: false, reason: 'section-not-found' };
  }

  console.log(`[BookPipeline] Starting: Chapter ${chapterNum} "${chapter.title}", Section ${sectionNum} "${section.title}"`);

  // Read existing chapter content for context
  const chapterPath = path.join(BOOKS_DIR, 'book1-philosophy', 'chapters', `chapter-${chapterNum}.md`);
  let existingContent = '';
  if (fs.existsSync(chapterPath)) {
    existingContent = fs.readFileSync(chapterPath, 'utf8');
  }

  // Read Plato's SOUL.md for voice
  const platoSoulPath = path.join(PHILOSOPHERS_DIR, 'plato', 'SOUL.md');
  let platoVoice = '';
  if (fs.existsSync(platoSoulPath)) {
    platoVoice = extractVoiceSections(fs.readFileSync(platoSoulPath, 'utf8'));
  }

  // Build outline context for this section
  const sectionOutlineLines = [];
  const outlineContent = fs.readFileSync(path.join(BOOKS_DIR, 'book1-philosophy', 'outline', 'MASTER_OUTLINE.md'), 'utf8');
  const lines = outlineContent.split('\n');
  let inChapter = false;
  for (const line of lines) {
    if (line.includes(`Chapter ${chapterNum}:`)) inChapter = true;
    if (inChapter && line.match(/^####\s+Chapter\s+\d+/) && !line.includes(`Chapter ${chapterNum}:`)) break;
    if (inChapter) sectionOutlineLines.push(line);
  }
  const sectionOutline = sectionOutlineLines.join('\n');

  // Stage 1: Plato drafts
  console.log('[BookPipeline] Stage 1: Plato drafting...');
  const draftResponse = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    system: `You are Plato, writing a section of the book "TensionLines". Your voice:\n${platoVoice}\n\nWrite in a literary, philosophical style. The book explores tension as generative force — contradictions are not problems but the hum of an alive life. Write for thoughtful generalists, not academics.`,
    messages: [{
      role: 'user',
      content: `Write Section ${sectionNum}: "${section.title}" for Chapter ${chapterNum}: "${chapter.title}".

## Chapter Outline
${sectionOutline}

## What's been written so far in this chapter
${existingContent ? existingContent.substring(0, 3000) : '(This is the first section of the chapter)'}

## Instructions
- Write 500-800 words
- Match the tone and depth of existing sections
- This section should flow naturally from what came before
- Focus on the specific content described in the outline for this section
- Do NOT include the section header — just write the prose
- End with a natural transition or pause (--- separator is fine)`
    }]
  });

  const draft = draftResponse.content[0]?.text || '';
  const wordCount = draft.split(/\s+/).length;
  console.log(`[BookPipeline] Draft complete: ${wordCount} words`);

  // Start message thread
  const threadMsg = sendAgentMessage({
    from: 'plato',
    to: ['socrates', 'hypatia', 'aristotle'],
    subject: `Book Draft: Ch.${chapterNum} S${sectionNum} — ${section.title}`,
    body: `I've drafted Section ${sectionNum} "${section.title}" for Chapter ${chapterNum} "${chapter.title}" (${wordCount} words).\n\n---\n\n${draft.substring(0, 1500)}${draft.length > 1500 ? '\n\n*(truncated for message — full draft in chapter file)*' : ''}`,
    type: 'review',
    priority: 'medium',
    metadata: { bookPipeline: true, chapter: chapterNum, section: sectionNum }
  });

  // Stage 2: Socrates critiques
  console.log('[BookPipeline] Stage 2: Socrates critiquing...');
  const socratesSoulPath = path.join(PHILOSOPHERS_DIR, 'socrates', 'SOUL.md');
  let socratesVoice = '';
  if (fs.existsSync(socratesSoulPath)) {
    socratesVoice = extractVoiceSections(fs.readFileSync(socratesSoulPath, 'utf8'));
  }

  const critiqueResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: `You are Socrates, the questioner. Your voice:\n${socratesVoice}\n\nAsk 2-3 probing questions about this book draft that expose weak arguments or unstated assumptions. Be specific and constructive.`,
    messages: [{
      role: 'user',
      content: `Review this draft for Section ${sectionNum} "${section.title}" of Chapter ${chapterNum} "${chapter.title}":\n\n${draft}`
    }]
  });

  const critique = critiqueResponse.content[0]?.text || '';
  sendAgentMessage({
    from: 'socrates',
    to: ['plato', 'tension'],
    subject: `Re: Book Draft: Ch.${chapterNum} S${sectionNum} — ${section.title}`,
    body: `**Probing Questions:**\n\n${critique}`,
    type: 'review',
    threadId: threadMsg.threadId,
    parentId: threadMsg.id
  });

  // Stage 3: Hypatia fact-checks
  console.log('[BookPipeline] Stage 3: Hypatia fact-checking...');
  const hypatiaSoulPath = path.join(PHILOSOPHERS_DIR, 'hypatia', 'SOUL.md');
  let hypatiaVoice = '';
  if (fs.existsSync(hypatiaSoulPath)) {
    hypatiaVoice = extractVoiceSections(fs.readFileSync(hypatiaSoulPath, 'utf8'));
  }

  const factCheckResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: `You are Hypatia, a scholarly fact-checker. Your voice:\n${hypatiaVoice}\n\nFlag any factual claims, quotes, attributions, or historical references that need verification.`,
    messages: [{
      role: 'user',
      content: `Fact-check this draft for Section ${sectionNum} "${section.title}" of Chapter ${chapterNum} "${chapter.title}":\n\n${draft}`
    }]
  });

  const factCheck = factCheckResponse.content[0]?.text || '';
  sendAgentMessage({
    from: 'hypatia',
    to: ['plato', 'tension'],
    subject: `Re: Book Draft: Ch.${chapterNum} S${sectionNum} — ${section.title}`,
    body: `**Fact Check:**\n\n${factCheck}`,
    type: 'review',
    threadId: threadMsg.threadId,
    parentId: threadMsg.id
  });

  // Stage 4: Aristotle checks structure
  console.log('[BookPipeline] Stage 4: Aristotle reviewing structure...');
  const aristotleSoulPath = path.join(PHILOSOPHERS_DIR, 'aristotle', 'SOUL.md');
  let aristotleVoice = '';
  if (fs.existsSync(aristotleSoulPath)) {
    aristotleVoice = extractVoiceSections(fs.readFileSync(aristotleSoulPath, 'utf8'));
  }

  const structureResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: `You are Aristotle, a structural reviewer. Your voice:\n${aristotleVoice}\n\nReview this draft against the outline and check if it flows well from previous sections.`,
    messages: [{
      role: 'user',
      content: `Review structure of Section ${sectionNum} "${section.title}" for Chapter ${chapterNum} "${chapter.title}".\n\n**Outline for this chapter:**\n${sectionOutline}\n\n**Previous content:**\n${existingContent ? existingContent.substring(existingContent.length - 1000) : '(first section)'}\n\n**New draft:**\n${draft}`
    }]
  });

  const structureReview = structureResponse.content[0]?.text || '';
  sendAgentMessage({
    from: 'aristotle',
    to: ['plato', 'tension'],
    subject: `Re: Book Draft: Ch.${chapterNum} S${sectionNum} — ${section.title}`,
    body: `**Structure Review:**\n\n${structureReview}`,
    type: 'review',
    threadId: threadMsg.threadId,
    parentId: threadMsg.id
  });

  // Append draft to chapter file
  const sectionHeader = `\n\n## Section ${sectionNum}: ${section.title}\n\n`;
  if (!fs.existsSync(chapterPath)) {
    fs.writeFileSync(chapterPath, `# Chapter ${chapterNum}: ${chapter.title}\n${sectionHeader}${draft}\n`);
  } else {
    fs.appendFileSync(chapterPath, `${sectionHeader}${draft}\n`);
  }
  console.log(`[BookPipeline] Draft appended to ${chapterPath}`);

  // Update pipeline state
  state.completedSections.push({
    chapter: chapterNum,
    section: sectionNum,
    title: section.title,
    wordCount,
    completedAt: new Date().toISOString(),
    threadId: threadMsg.threadId
  });

  // Auto-advance cursor
  if (sectionNum < chapter.sections.length) {
    state.currentTarget = { chapter: chapterNum, section: sectionNum + 1 };
  } else {
    // Move to next chapter
    const nextChapter = outline.find(c => c.number === chapterNum + 1);
    if (nextChapter) {
      state.currentTarget = { chapter: chapterNum + 1, section: 1 };
    } else {
      state.currentTarget = null; // Book complete!
    }
  }

  state.runs.push({
    date: new Date().toISOString(),
    chapter: chapterNum,
    section: sectionNum,
    title: section.title,
    wordCount,
    threadId: threadMsg.threadId
  });

  saveBookPipelineState(state);

  // Create notification
  const mc = getMissionControl();
  mc.notifications.unshift({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'book_pipeline',
    title: 'Book Pipeline Complete',
    message: `Plato drafted **${section.title}** (${wordCount} words) for Chapter ${chapterNum}. Reviewed by Socrates, Hypatia, Aristotle.${state.currentTarget ? `\n\nNext: Ch.${state.currentTarget.chapter} S${state.currentTarget.section}` : '\n\n**Book 1 outline complete!**'}`,
    read: false,
    createdAt: new Date().toISOString(),
    metadata: { chapter: chapterNum, section: sectionNum, wordCount, threadId: threadMsg.threadId }
  });
  fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
  cache.missionControl = null;
  broadcast('notifications');

  logSystemEvent('cron', `Book pipeline: Ch.${chapterNum} S${sectionNum} "${section.title}" (${wordCount} words)`, {
    chapter: chapterNum, section: sectionNum, wordCount
  });

  console.log(`[BookPipeline] Complete: Ch.${chapterNum} S${sectionNum} "${section.title}" — ${wordCount} words`);
  return { success: true, chapter: chapterNum, section: sectionNum, title: section.title, wordCount };
}

cron.schedule('0 11 * * 3', async () => {
  try {
    const result = await runBookPipeline();
    recordCronRun('book-pipeline', result.success ? `ch${result.chapter}s${result.section}:${result.wordCount}w` : result.reason);
  } catch (err) {
    console.error('[Cron] Book pipeline error:', err);
    recordCronRun('book-pipeline', null, err.message);
    logSystemEvent('error', `Book pipeline failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Book pipeline scheduled for Wednesday 11:00 AM PST');

// ============================================================================
// Weekly Newsletter (need-022 + need-049)
// Marcus Aurelius curates a weekly newsletter from top content
// ============================================================================

async function generateWeeklyNewsletter() {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[Newsletter] No Anthropic API key configured, skipping.');
    return { success: false, reason: 'no-api-key' };
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoISO = weekAgo.toISOString();

  // --- Gather data from the past 7 days ---

  // 1. Posts published
  const queue = getPostingQueue();
  const recentPosts = (queue.posted || []).filter(p => p.postedAt && p.postedAt >= weekAgoISO);
  const postsByPlatform = {};
  for (const p of recentPosts) {
    postsByPlatform[p.platform] = (postsByPlatform[p.platform] || 0) + 1;
  }
  const topPost = recentPosts.length > 0
    ? recentPosts.reduce((best, p) => {
        const platforms = Object.keys(postsByPlatform).length;
        return (!best || (p.content || '').length > (best.content || '').length) ? p : best;
      }, null)
    : null;

  // 2. Book pipeline status
  let bookUpdate = null;
  try {
    const bookState = getBookPipelineState();
    if (bookState.lastRun && bookState.lastRun >= weekAgoISO) {
      bookUpdate = {
        chapter: bookState.currentChapter,
        section: bookState.currentSection,
        completed: bookState.completedSections?.length || 0,
        total: 26
      };
    }
  } catch (e) { /* book pipeline may not exist yet */ }

  // 3. Peer review highlights
  const mc = getMissionControl();
  const recentReviews = (mc.messages || []).filter(m =>
    m.type === 'review' && m.createdAt >= weekAgoISO
  );
  const reviewHighlights = recentReviews.slice(0, 3).map(r => ({
    from: r.from,
    subject: r.subject,
    snippet: (r.body || '').substring(0, 150)
  }));

  // 4. Ideas captured
  let ideasCaptured = 0;
  try {
    const ideas = parseIdeasBank();
    ideasCaptured = ideas.filter(i => i.date && i.date >= weekAgoISO.split('T')[0]).length;
  } catch (e) { /* ideas bank may not exist */ }

  // 5. Agent message activity
  const recentMessages = (mc.messages || []).filter(m => m.createdAt >= weekAgoISO);
  const messagesByAgent = {};
  for (const m of recentMessages) {
    messagesByAgent[m.from] = (messagesByAgent[m.from] || 0) + 1;
  }

  // 6. Queue health
  const pendingByPlatform = {};
  for (const item of (queue.queue || [])) {
    if (item.status !== 'posted' && item.status !== 'skipped') {
      pendingByPlatform[item.platform] = (pendingByPlatform[item.platform] || 0) + 1;
    }
  }

  // --- Build AI prompt ---
  const marcusSoul = fs.readFileSync(path.join(__dirname, '..', 'philosophers', 'marcus', 'SOUL.md'), 'utf8');
  const voiceGuide = extractVoiceSections(marcusSoul);

  const weekSummary = `
WEEKLY DATA (${weekAgo.toLocaleDateString('en-US')} - ${now.toLocaleDateString('en-US')}):

Posts published: ${recentPosts.length} total
${Object.entries(postsByPlatform).map(([p, c]) => `  - ${p}: ${c}`).join('\n') || '  (none)'}

${topPost ? `Top post (${topPost.platform}): "${(topPost.content || topPost.caption || '').substring(0, 200)}..."` : 'No posts this week.'}

${bookUpdate ? `Book progress: Chapter ${bookUpdate.chapter}, Section ${bookUpdate.section} (${bookUpdate.completed}/${bookUpdate.total} sections complete)` : 'No book pipeline activity this week.'}

Peer reviews: ${recentReviews.length} conducted
${reviewHighlights.map(r => `  - ${r.from}: ${r.snippet}`).join('\n') || '  (none)'}

Ideas captured: ${ideasCaptured}

Agent activity (messages sent):
${Object.entries(messagesByAgent).map(([a, c]) => `  - ${a}: ${c}`).join('\n') || '  (quiet week)'}

Queue health (pending items):
${Object.entries(pendingByPlatform).map(([p, c]) => `  - ${p}: ${c}`).join('\n') || '  (all clear)'}
`.trim();

  const systemPrompt = `You are writing a weekly newsletter for TensionLines, a philosophy brand. Use this voice guide for tone:

${voiceGuide}

CRITICAL AUTHORSHIP RULE: The newsletter is written by Shawn. Never mention any agent names, AI, or automated systems. The work is reviewed by "friends" or "collaborators" — never name them individually. Sign off only as "Shawn". The audience should feel Shawn is the author with a group of friends workshopping the ideas.

Write a newsletter that feels like a personal letter from a wise friend. Grounded, practical, warm but not soft. Include a practical exercise readers can do this week.

Respond ONLY with valid JSON, no markdown wrapping:
{
  "title": "Newsletter title (compelling, under 60 chars)",
  "subtitle": "One-sentence subtitle that hooks the reader (under 120 chars)",
  "body": "Full newsletter body in markdown (500-800 words). Do NOT repeat the title or subtitle in the body.",
  "imagePrompt": "A description for generating a cover image. Describe a moody, philosophical, abstract scene — no text, no people's faces, no words. Think: textures, light, metaphorical objects, atmosphere. Under 200 chars.",
  "tags": ["3-5 Substack tags for discoverability. Use lowercase. Mix broad (philosophy, stoicism) with specific to the post's theme."]
}

The newsletter should have these sections (use ## headings):
- Opening (set the tone, reflect on the week)
- This Week's Tension (feature the best content or theme)
- From the Book (only if the book project had activity — otherwise skip this section entirely)
- Behind the Scenes (highlights from peer discussions among collaborators — no names)
- Practice (a practical exercise — grounded, actionable)
- Closing (brief sign-off as Shawn)`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: weekSummary }]
  });

  const responseText = response.content[0]?.text || '';
  const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const newsletter = JSON.parse(cleaned);

  if (!newsletter.title || !newsletter.body) {
    throw new Error('AI response missing title or body');
  }

  // --- Queue in posting queue as substack item ---
  const itemId = `post-${Date.now()}`;
  queue.queue.push({
    id: itemId,
    createdAt: now.toISOString(),
    status: 'pending-review',
    platform: 'substack',
    title: newsletter.title,
    subtitle: newsletter.subtitle || '',
    content: newsletter.body,
    imagePrompt: newsletter.imagePrompt || '',
    tags: newsletter.tags || [],
    caption: '',
    parts: [],
    canvaComplete: false,
    createdBy: 'marcus',
    source: 'newsletter-automation',
    metadata: {
      postsThisWeek: recentPosts.length,
      ideasCaptured,
      reviewsConducted: recentReviews.length,
      bookUpdate: bookUpdate || null
    }
  });
  savePostingQueue(queue);

  // --- Create notification for Shawn ---
  mc.notifications.push({
    id: `notif-newsletter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'newsletter',
    title: `Weekly Newsletter Ready: ${newsletter.title}`,
    message: `This week's newsletter is drafted. Review it in the posting queue and publish to Substack.\n\n**Subtitle:** ${newsletter.subtitle || '(none)'}\n**Image prompt:** ${newsletter.imagePrompt || '(none)'}`,
    from: 'marcus',
    to: ['shawn'],
    createdAt: now.toISOString(),
    read: false,
    priority: 'normal',
    actionRequired: true,
    metadata: { queueItemId: itemId, platform: 'substack' }
  });
  fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
  cache.missionControl = null;
  broadcast('notifications');

  // --- Log system event ---
  logSystemEvent('cron', `Weekly newsletter generated: "${newsletter.title}"`, {
    queueItemId: itemId,
    postsThisWeek: recentPosts.length,
    wordCount: newsletter.body.split(/\s+/).length
  });

  console.log(`[Newsletter] Generated: "${newsletter.title}" (${newsletter.body.split(/\s+/).length} words)`);

  return {
    success: true,
    title: newsletter.title,
    subtitle: newsletter.subtitle || '',
    imagePrompt: newsletter.imagePrompt || '',
    wordCount: newsletter.body.split(/\s+/).length,
    queueItemId: itemId
  };
}

cron.schedule('0 9 * * 1', async () => {
  try {
    const result = await generateWeeklyNewsletter();
    recordCronRun('weekly-newsletter', result.success ? `words:${result.wordCount}` : result.reason);
  } catch (err) {
    console.error('[Cron] Newsletter error:', err);
    recordCronRun('weekly-newsletter', null, err.message);
    logSystemEvent('error', `Weekly newsletter failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Weekly newsletter scheduled for Monday 9:00 AM PST');

// Manual trigger endpoints for new cron jobs

app.post('/api/newsletter/run', async (req, res) => {
  try {
    const result = await generateWeeklyNewsletter();
    recordCronRun('weekly-newsletter', result.success ? `words:${result.wordCount}` : result.reason);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Newsletter generation error:', error);
    res.status(500).json({ error: 'Newsletter generation failed' });
  }
});

// ============================================================================
// Weekly Podcast Pipeline (The Tension Lines)
// Plato writes script → agents review → Athena edits → ElevenLabs audio → queue
// ============================================================================

const PODCAST_DIR = path.join(BASE_DIR, 'content', 'podcast');
const PODCAST_LEDGER = path.join(PODCAST_DIR, 'episode-ledger.json');
const PODCAST_BANK = path.join(PODCAST_DIR, 'podcast-bank.json');
const PODCAST_TRIALS = path.join(PODCAST_DIR, 'trial-reviews.json');

// --- Podcast Audio (ElevenLabs) ---
const PODCAST_AUDIO_DIR = path.join(PODCAST_DIR, 'audio');
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const DIALOGUE_CHAR_LIMIT = 4500;

// Create audio directory if missing
if (!fs.existsSync(PODCAST_AUDIO_DIR)) {
  fs.mkdirSync(PODCAST_AUDIO_DIR, { recursive: true });
  console.log('[Podcast Audio] Created audio directory');
}

// Check ffmpeg availability at startup
let ffmpegAvailable = false;
try {
  execSync('which ffmpeg', { encoding: 'utf-8', timeout: 3000 });
  ffmpegAvailable = true;
  console.log('[Podcast Audio] ffmpeg available');
} catch {
  console.warn('[Podcast Audio] ffmpeg not found — audio concatenation will not work. Install with: brew install ffmpeg');
}

function getPodcastLedger() {
  try {
    if (fs.existsSync(PODCAST_LEDGER)) return JSON.parse(fs.readFileSync(PODCAST_LEDGER, 'utf8'));
  } catch (e) { console.error('Error reading podcast ledger:', e); }
  return { episodes: [], recurringThreads: [], totalEpisodes: 0, trialPhase: true, currentTrial: 1, standardFormat: null, trialSchedule: [], formatStats: {} };
}

function savePodcastLedger(data) {
  fs.writeFileSync(PODCAST_LEDGER, JSON.stringify(data, null, 2));
}

function getPodcastBank() {
  try {
    if (fs.existsSync(PODCAST_BANK)) return JSON.parse(fs.readFileSync(PODCAST_BANK, 'utf8'));
  } catch (e) { console.error('Error reading podcast bank:', e); }
  return { salvaged: [], killed: [] };
}

function savePodcastBank(data) {
  fs.writeFileSync(PODCAST_BANK, JSON.stringify(data, null, 2));
}

function getTrialReviews() {
  try {
    if (fs.existsSync(PODCAST_TRIALS)) return JSON.parse(fs.readFileSync(PODCAST_TRIALS, 'utf8'));
  } catch (e) { console.error('Error reading trial reviews:', e); }
  return { reviews: [], standardizedAt: null, chosenFormat: null, notes: '' };
}

function saveTrialReviews(data) {
  fs.writeFileSync(PODCAST_TRIALS, JSON.stringify(data, null, 2));
}

const PODCAST_FORMATS = {
  debate: {
    name: 'The Debate',
    duration: '25-30 min',
    description: 'Shawn and Anne disagree. Heat, pushback, no resolution.',
    instruction: 'Write a confrontational dialogue between Shawn and Anne. Both have strong, opposing positions. The tension stays unresolved. High energy, fast exchanges, genuine disagreement. They know each other deeply — use that intimacy to make the pushback sharper and more personal. Speakers are always "shawn" and "anne".'
  },
  'deep-dive': {
    name: 'The Deep Dive',
    duration: '30-35 min',
    description: 'Shawn walks through one concept. Anne asks clarifying questions.',
    instruction: 'Write an educational dialogue between Shawn and Anne. Shawn explains a concept in depth. Anne asks genuine questions, offers counter-examples, pushes for clarity. She brings her own perspective and life experience. Medium energy, longer turns, contemplative. Speakers are always "shawn" and "anne".'
  },
  'quick-hit': {
    name: 'The Quick Hit',
    duration: '12-15 min',
    description: 'One tension, explored fast. Minimal setup.',
    instruction: 'Write a compressed, punchy dialogue between Shawn and Anne. Get to the tension immediately. No long setup. Fast exchanges, high energy. Short episode — every line must earn its place. Speakers are always "shawn" and "anne".'
  },
  story: {
    name: 'The Story',
    duration: '25-30 min',
    description: 'Narrative-driven. Shawn tells a story, Anne reacts in real-time.',
    instruction: 'Write a narrative dialogue between Shawn and Anne. Shawn tells a story (historical, personal, or hypothetical) and Anne interrupts with reactions, questions, challenges. She can call out when he\'s embellishing. Slow build, emotional peaks, varied energy. Speakers are always "shawn" and "anne".'
  },
  'tension-line': {
    name: 'The Tension Line',
    duration: '20-25 min',
    description: 'Takes one polarity and holds both poles without collapsing.',
    instruction: 'Write a structured dialogue between Shawn and Anne around one polarity (e.g., security vs liberty, kindness vs truth). They each champion one pole at times, then switch. Neither wins. The tension is the point. They have shorthand and inside references from years together. Medium-high energy, intellectual but accessible. Speakers are always "shawn" and "anne".'
  }
};

async function generatePodcastScript(options = {}) {
  const client = getAnthropicClient();
  if (!client) {
    console.log('[Podcast] No Anthropic API key configured, skipping.');
    return { success: false, reason: 'no-api-key' };
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoISO = weekAgo.toISOString();
  const ledger = getPodcastLedger();
  const bank = getPodcastBank();

  // --- Determine format ---
  let format;
  if (options.format) {
    format = options.format;
  } else if (ledger.trialPhase && ledger.currentTrial <= 8) {
    const trial = (ledger.trialSchedule || [])[ledger.currentTrial - 1];
    format = trial?.format || 'debate';
    // For trials 6-8, format gets resolved later based on reviews
    if (ledger.currentTrial >= 6 && format === 'best-of') {
      const reviews = getTrialReviews();
      const best = reviews.reviews.sort((a, b) => (b.soundReal + b.interesting) - (a.soundReal + a.interesting))[0];
      format = best?.format || 'debate';
    } else if (ledger.currentTrial >= 7 && format === 'runner-up') {
      const reviews = getTrialReviews();
      const sorted = reviews.reviews.sort((a, b) => (b.soundReal + b.interesting) - (a.soundReal + a.interesting));
      format = sorted[1]?.format || 'debate';
    } else if (format === 'final') {
      const reviews = getTrialReviews();
      const best = reviews.reviews.sort((a, b) => (b.soundReal + b.interesting) - (a.soundReal + a.interesting))[0];
      format = best?.format || 'debate';
    }
  } else {
    format = ledger.standardFormat || 'debate';
    // Variety rule: don't use same format 2x in a row
    const lastEp = ledger.episodes[ledger.episodes.length - 1];
    if (lastEp?.format === format && ledger.episodes.length % 4 === 0) {
      const altFormats = Object.keys(PODCAST_FORMATS).filter(f => f !== format);
      format = altFormats[Math.floor(Math.random() * altFormats.length)];
    }
  }

  const formatInfo = PODCAST_FORMATS[format] || PODCAST_FORMATS.debate;

  // --- Gather content sources ---
  const queue = getPostingQueue();
  const recentPosts = (queue.posted || []).filter(p => p.postedAt && p.postedAt >= weekAgoISO);

  // Top post (longest content as proxy for engagement)
  const topPost = recentPosts.length > 0
    ? recentPosts.reduce((best, p) => (!best || (p.content || '').length > (best.content || '').length) ? p : best, null)
    : null;

  // Peer review debates
  const mc = getMissionControl();
  const recentReviews = (mc.messages || []).filter(m =>
    m.type === 'review' && m.createdAt >= weekAgoISO
  ).slice(0, 5);

  const reviewDebates = recentReviews.map(r => ({
    from: r.from,
    subject: r.subject,
    snippet: (r.body || '').substring(0, 300)
  }));

  // Newsletter content (from this week's queue)
  const newsletter = (queue.queue || []).find(i => i.platform === 'substack' && i.source === 'newsletter-automation');

  // Book pipeline
  let bookUpdate = null;
  try {
    const bookState = getBookPipelineState();
    if (bookState.lastRun && bookState.lastRun >= weekAgoISO) {
      bookUpdate = { chapter: bookState.currentChapter, section: bookState.currentSection };
    }
  } catch (e) { /* skip */ }

  // Salvage bank — reusable content from rejected episodes
  const salvageable = bank.salvaged.filter(s => !s.reusedIn).slice(0, 2);

  // Episode history for continuity
  const recentEpisodes = ledger.episodes.slice(-5);
  const openThreads = (ledger.recurringThreads || []).filter(t => t.status === 'open');

  // Past practices (to avoid repeats)
  const pastPractices = ledger.episodes.map(e => e.practiceGiven).filter(Boolean);

  // Killed topics (to avoid)
  const killedTopics = bank.killed || [];

  // --- Build the system prompt ---
  const platoSoul = fs.readFileSync(path.join(__dirname, '..', 'philosophers', 'plato', 'SOUL.md'), 'utf8');
  const platoVoice = extractVoiceSections(platoSoul);

  const systemPrompt = `You are Plato, writing a podcast script for "The Tension Lines" — a philosophy podcast hosted by Shawn and Anne (they are married).

${platoVoice}

CRITICAL AUTHORSHIP RULE: Shawn and Anne are the two hosts. Never mention agents, AI, or automated systems. Never use philosopher agent names. This must sound like a real couple talking — they have history, shorthand, inside jokes, and genuine knowledge of each other's blind spots. The two speakers are ALWAYS "shawn" and "anne" in the script JSON — never "wife", "friend", "host", or any other label.

## FORMAT: ${formatInfo.name} (${formatInfo.duration})
${formatInfo.instruction}

## EPISODE STRUCTURE
- COLD OPEN (0:00-0:45): Mid-conversation hook. No intro, no "welcome." Shawn and Anne already talking about something compelling.
- BRIEF INTRO (0:45-1:15): Shawn: "This is The Tension Lines. I'm Shawn, this is Anne. Let's get into it." (Under 30 seconds.)
- THE SETUP (1:15-5:00): Introduce the tension. Anne reacts in real-time. NOT a monologue.
- THE TENSION (5:00-20:00): Core conversation. Push and pull. Anne disagrees, challenges, steelmans the other side. They can reference shared life experiences.
- THE PRACTICE (20:00-27:00): Shawn gives a concrete exercise. Warmer tone. Anne reacts — she might volunteer to try it or push back on whether it's realistic.
- THE CLOSE (27:00-30:00): Casual wind-down. "All right, that's it for this week." No formal sign-off.

## AUTHENTICITY RULES (CRITICAL — follow these exactly)

MANDATORY SPEECH PATTERNS — include all of these:
- Interruptions (8-12 per episode): "[interrupting]" tag, mid-sentence cuts
- False starts and self-corrections (6-10): "actually, let me come at this differently"
- Filler words throughout: "I mean...", "you know?", "right, right", "the thing is..."
- Backchannel responses (15-20): "mm-hmm", "uh-huh", "right", "yeah", "huh", "[laughs]"
- Trailing off and picking back up (4-6): "And I think that's where most people just... [pause]"
- Genuine disagreement (2-4): Real pushback with heat, not polite agreement
- Moments of genuine connection (1-2): "That actually just changed how I think about this."
- Laughter (3-5): Natural, at unexpected honesty or self-awareness
- Comfortable silences (2+): "[pause]" for 2-3 seconds of genuine thinking
- At least one tangent that goes off-topic then pulls back: "Sorry, that's a whole other episode."

FORBIDDEN PATTERNS — never do these:
- Both speakers agreeing for more than 3 consecutive exchanges
- Perfectly balanced turn lengths
- "That's a great point, and building on that..."
- "So what you're saying is..." (summarizing the other person)
- "That's a great question"
- Numbered lists in speech
- Neat resolution or "key takeaway" at the end
- Corporate/therapy language ("unpack that", "safe space", "lean into", "at the end of the day")
- "As I mentioned earlier"
- Both speakers using the same speech rhythm or sentence length patterns

PACE AND RHYTHM:
- Vary sentence length wildly. Some lines 3 words, some 40.
- Anne talks FASTER than Shawn. Different default paces.
- Opening 5 minutes should feel looser than the middle.
- Anne's lines should average shorter than Shawn's.
- They finish each other's sentences sometimes — they're married, they know the rhythm.

## ElevenLabs AUDIO TAGS (use these in the script)
- [interrupting] — cutting someone off mid-sentence
- [overlapping] — speaking simultaneously
- [laughs] — natural laughter
- [pause] — explicit silence (2-3 seconds)
- [drawn out] — elongated delivery

## OUTPUT FORMAT
Respond ONLY with valid JSON, no markdown wrapping:
{
  "title": "Episode title (compelling, under 60 chars)",
  "subtitle": "One-sentence subtitle (under 120 chars)",
  "format": "${format}",
  "topic": "The core tension explored (one sentence)",
  "tensions": ["tension-1", "tension-2"],
  "script": [
    { "speaker": "shawn", "text": "Line of dialogue with [tags] as needed" },
    { "speaker": "anne", "text": "Line of dialogue with [tags] as needed" }
  ],
  "practiceExercise": "Name of the practice given",
  "unresolvedThreads": ["Thread that was raised but not fully resolved"],
  "clipMoments": [
    { "startLine": 45, "endLine": 52, "reason": "Sharp disagreement about X" }
  ],
  "callbackLines": ["Any memorable/quotable lines worth referencing in future episodes"]
}

The script array should contain 120-200 exchanges for a 25-30 min episode, fewer for quick-hit format.

CRITICAL: The "speaker" field MUST be exactly "shawn" or "anne" (lowercase). Never use "friend", "wife", "host", or any other label. Always "shawn" or "anne".`;

  let contentContext = `
## THIS WEEK'S CONTENT (use as source material)

${topPost ? `TOP POST (${topPost.platform}): "${(topPost.content || '').substring(0, 500)}"` : 'No posts this week.'}

${reviewDebates.length > 0 ? `PEER REVIEW DEBATES:\n${reviewDebates.map(r => `- ${r.from}: ${r.snippet}`).join('\n')}` : 'No peer review debates this week.'}

${newsletter ? `NEWSLETTER PRACTICE: "${(newsletter.content || '').substring(0, 300)}"` : ''}

${bookUpdate ? `BOOK PROGRESS: Chapter ${bookUpdate.chapter}, Section ${bookUpdate.section}` : ''}

${salvageable.length > 0 ? `SALVAGED FROM REJECTED EPISODES (reuse if relevant):\n${salvageable.map(s => `- Topic: ${s.topic}\n  Good lines: ${(s.usableParts?.goodLines || []).join('; ')}\n  Unresolved: ${s.usableParts?.unresolvedTension || 'none'}`).join('\n')}` : ''}

## CONTINUITY CONTEXT

${recentEpisodes.length > 0 ? `RECENT EPISODES:\n${recentEpisodes.map(e => `- "${e.title}" (${e.format}): ${e.topic}`).join('\n')}` : 'No previous episodes yet. This is a fresh start.'}

${openThreads.length > 0 ? `OPEN THREADS (revisit if natural, never force):\n${openThreads.map(t => `- ${t.thread} (first in: ${t.firstMentioned})`).join('\n')}` : ''}

${pastPractices.length > 0 ? `PAST PRACTICES (don't repeat):\n${pastPractices.map(p => `- ${p}`).join('\n')}` : ''}

${killedTopics.length > 0 ? `KILLED TOPICS (avoid these):\n${killedTopics.join(', ')}` : ''}
`.trim();

  // --- Quality feedback injection (from ratings) ---
  const qualityFeedback = (() => {
    const trialData = getTrialReviews();
    const recentRatings = trialData.reviews.slice(-5);
    if (recentRatings.length === 0) return '';
    const dims = ['naturalness', 'anneVoice', 'coupleChemistry', 'hookStrength', 'tensionQuality', 'pacing'];
    const dimLabels = { naturalness: 'Naturalness', anneVoice: 'Anne voice quality', coupleChemistry: 'Couple chemistry', hookStrength: 'Hook strength', tensionQuality: 'Tension quality', pacing: 'Pacing' };
    const avgs = {};
    for (const d of dims) {
      const vals = recentRatings.map(r => r.ratings?.[d]).filter(v => v != null);
      if (vals.length > 0) avgs[d] = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
    }
    if (Object.keys(avgs).length === 0) return '';
    const lines = Object.entries(avgs).map(([k, v]) => {
      const label = dimLabels[k] || k;
      const advice = Number(v) < 3 ? ' (NEEDS IMPROVEMENT)' : Number(v) >= 4 ? ' (strong)' : '';
      return '- ' + label + ': ' + v + '/5' + advice;
    });
    return '\n\n## QUALITY FEEDBACK (from recent episode ratings)\n' + lines.join('\n') + '\n\nFocus on improving any dimension marked NEEDS IMPROVEMENT.';
  })();
  contentContext += qualityFeedback;

  // --- Generate script (Plato writes) ---
  console.log(`[Podcast] Generating script — format: ${format}, trial: ${ledger.trialPhase ? ledger.currentTrial : 'standard'}`);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: contentContext }]
  });

  const responseText = response.content[0]?.text || '';
  const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const episode = JSON.parse(cleaned);

  if (!episode.title || !episode.script || episode.script.length === 0) {
    throw new Error('Script generation failed — missing title or script');
  }

  // --- Agent reviews (parallel simulation via single Sonnet call) ---
  const scriptPreview = episode.script.slice(0, 30).map(l => `${l.speaker}: ${l.text}`).join('\n');
  const scriptFull = episode.script.map(l => `${l.speaker}: ${l.text}`).join('\n');

  const reviewPrompt = `Review this podcast script for "The Tension Lines." You are reviewing as FOUR agents simultaneously. Be concise and direct.

SCRIPT (${episode.script.length} exchanges):
${scriptFull.substring(0, 6000)}${scriptFull.length > 6000 ? '\n[...truncated...]' : ''}

Respond ONLY with valid JSON:
{
  "diogenes": {
    "verdict": "pass|needs-work|reject",
    "note": "One sentence on authenticity. Does it sound real?"
  },
  "aristotle": {
    "verdict": "pass|needs-work|reject",
    "note": "One sentence on structure. Does the arc hold for ${formatInfo.duration}?"
  },
  "socrates": {
    "verdict": "pass|needs-work|reject",
    "note": "One sentence on Anne's lines. Does Anne actually challenge Shawn?"
  },
  "marcus": {
    "verdict": "pass|needs-work|reject",
    "note": "One sentence on the practice. Is it concrete, doable, and fresh?"
  }
}`;

  let reviews = {};
  try {
    const reviewResponse = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 512,
      system: 'You are a multi-agent review system. Be harsh, concise, and honest. One sentence per agent.',
      messages: [{ role: 'user', content: reviewPrompt }]
    });
    const reviewText = reviewResponse.content[0]?.text || '';
    const reviewCleaned = reviewText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    reviews = JSON.parse(reviewCleaned);
  } catch (e) {
    console.error('[Podcast] Review round failed:', e.message);
    reviews = { error: 'Review round failed: ' + e.message };
  }

  // --- Athena final edit pass ---
  let athenaNote = '';
  try {
    const athenaSoul = fs.readFileSync(path.join(__dirname, '..', 'philosophers', 'athena', 'SOUL.md'), 'utf8');
    const athenaVoice = extractVoiceSections(athenaSoul);
    const athenaResponse = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 256,
      system: `You are Athena, Podcast Editor-in-Chief.\n\n${athenaVoice}\n\nGive a brief production note: hook strength (first 10 seconds), dead stretches, energy dips, pacing issues. 2-3 sentences max. Also mark which exchanges would make good 30-60 second social clips (give line numbers).`,
      messages: [{ role: 'user', content: `Episode: "${episode.title}" (${format}, ${episode.script.length} exchanges)\n\nFirst 10 lines:\n${episode.script.slice(0, 10).map((l, i) => `${i}: ${l.speaker}: ${l.text}`).join('\n')}\n\nMiddle sample (lines 50-60):\n${episode.script.slice(50, 60).map((l, i) => `${i + 50}: ${l.speaker}: ${l.text}`).join('\n')}\n\nLast 10 lines:\n${episode.script.slice(-10).map((l, i) => `${i + episode.script.length - 10}: ${l.speaker}: ${l.text}`).join('\n')}` }]
    });
    athenaNote = athenaResponse.content[0]?.text?.trim() || '';
  } catch (e) {
    console.error('[Podcast] Athena review failed:', e.message);
    athenaNote = 'Athena review unavailable: ' + e.message;
  }

  // --- Queue in posting queue ---
  const itemId = `podcast-${Date.now()}`;
  const wordCount = episode.script.reduce((sum, l) => sum + l.text.split(/\s+/).length, 0);
  const estDuration = Math.round(wordCount / 140); // ~140 wpm for conversational speech

  queue.queue.push({
    id: itemId,
    createdAt: now.toISOString(),
    status: 'pending-review',
    platform: 'podcast',
    title: episode.title,
    subtitle: episode.subtitle || '',
    content: `**${episode.title}**\n\n_${episode.subtitle || ''}_\n\nTopic: ${episode.topic}\nFormat: ${formatInfo.name} (${format})\nExchanges: ${episode.script.length}\nEst. duration: ~${estDuration} min\nWord count: ${wordCount}`,
    caption: '',
    parts: [],
    canvaComplete: false,
    createdBy: 'athena',
    source: 'podcast-pipeline',
    metadata: {
      format,
      formatName: formatInfo.name,
      topic: episode.topic,
      tensions: episode.tensions || [],
      script: episode.script,
      practiceExercise: episode.practiceExercise || '',
      unresolvedThreads: episode.unresolvedThreads || [],
      clipMoments: episode.clipMoments || [],
      callbackLines: episode.callbackLines || [],
      reviews,
      athenaNote,
      wordCount,
      estDuration,
      exchangeCount: episode.script.length,
      trialNumber: ledger.trialPhase ? ledger.currentTrial : null,
      audioFile: null,
      audioGenerated: false
    }
  });
  savePostingQueue(queue);

  // --- Notification ---
  mc.notifications.push({
    id: `notif-podcast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'podcast',
    title: `Podcast Episode Ready: ${episode.title}`,
    message: `New ${formatInfo.name} episode (${format}) generated. ~${estDuration} min, ${episode.script.length} exchanges. Review in the posting queue.${ledger.trialPhase ? ` Trial #${ledger.currentTrial} of 8.` : ''}`,
    from: 'athena',
    to: ['shawn'],
    createdAt: now.toISOString(),
    read: false,
    priority: 'normal',
    actionRequired: true,
    metadata: { queueItemId: itemId, platform: 'podcast', format }
  });
  fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
  cache.missionControl = null;
  broadcast('notifications');

  logSystemEvent('cron', `Podcast script generated: "${episode.title}" (${format}, ~${estDuration}min)`, {
    queueItemId: itemId, format, exchanges: episode.script.length, wordCount
  });

  console.log(`[Podcast] Generated: "${episode.title}" (${format}, ${episode.script.length} exchanges, ~${estDuration}min)`);

  return {
    success: true,
    title: episode.title,
    format,
    formatName: formatInfo.name,
    exchanges: episode.script.length,
    wordCount,
    estDuration,
    queueItemId: itemId,
    trialNumber: ledger.trialPhase ? ledger.currentTrial : null,
    reviews
  };
}

// --- Podcast rejection handlers ---

function podcastSalvage(queueItem, reason, ratings) {
  const bank = getPodcastBank();
  const meta = queueItem.metadata || {};
  bank.salvaged.push({
    id: `salv-${Date.now()}`,
    sourceEpisode: queueItem.id,
    rejectedAt: new Date().toISOString(),
    reason: reason || '',
    topic: meta.topic || queueItem.title,
    usableParts: {
      goodLines: (meta.callbackLines || []).slice(0, 5),
      unresolvedTension: (meta.unresolvedThreads || [])[0] || '',
      practiceExercise: meta.practiceExercise || '',
      tensions: meta.tensions || []
    },
    reusedIn: null
  });
  savePodcastBank(bank);

  // Track decision in ledger
  const ledger = getPodcastLedger();
  if (!ledger.decisions) ledger.decisions = [];
  ledger.decisions.push({
    episodeTitle: queueItem.title,
    sourceId: queueItem.id,
    decision: 'salvaged',
    reason: reason || '',
    ratings: ratings || null,
    format: meta.format || 'debate',
    decidedAt: new Date().toISOString()
  });
  savePodcastLedger(ledger);
  return true;
}

function podcastKill(queueItem, reason, ratings) {
  const bank = getPodcastBank();
  const meta = queueItem.metadata || {};
  const topic = meta.topic || queueItem.title;
  if (!bank.killed.includes(topic)) {
    bank.killed.push(topic);
  }
  savePodcastBank(bank);

  // Track decision in ledger
  const ledger = getPodcastLedger();
  if (!ledger.decisions) ledger.decisions = [];
  ledger.decisions.push({
    episodeTitle: queueItem.title,
    sourceId: queueItem.id,
    decision: 'killed',
    reason: reason || '',
    ratings: ratings || null,
    format: meta.format || 'debate',
    decidedAt: new Date().toISOString()
  });
  savePodcastLedger(ledger);
  return true;
}

function podcastApprove(queueItem, reason, ratings) {
  const ledger = getPodcastLedger();
  const meta = queueItem.metadata || {};

  const epId = `ep-${String(ledger.totalEpisodes + 1).padStart(3, '0')}`;
  const episode = {
    id: epId,
    title: queueItem.title,
    publishedAt: new Date().toISOString(),
    format: meta.format || 'debate',
    duration: meta.estDuration ? `~${meta.estDuration}min` : 'unknown',
    topic: meta.topic || '',
    tensions: meta.tensions || [],
    unresolvedThreads: meta.unresolvedThreads || [],
    callbackLines: meta.callbackLines || [],
    practiceGiven: meta.practiceExercise || '',
    relatedEpisodes: [],
    bookChapterRef: null,
    socialPostSource: null,
    audienceSignals: null,
    trialNumber: meta.trialNumber || null,
    decision: 'approved',
    decisionReason: reason || '',
    ratings: ratings || null
  };

  // Track decision permanently
  if (!ledger.decisions) ledger.decisions = [];
  ledger.decisions.push({
    episodeTitle: queueItem.title,
    episodeId: epId,
    decision: 'approved',
    reason: reason || '',
    ratings: ratings || null,
    format: meta.format || 'debate',
    decidedAt: new Date().toISOString()
  });

  ledger.episodes.push(episode);
  ledger.totalEpisodes++;

  // Update recurring threads
  for (const thread of (meta.unresolvedThreads || [])) {
    const existing = ledger.recurringThreads.find(t => t.thread === thread);
    if (existing) {
      existing.mentions.push(epId);
    } else {
      ledger.recurringThreads.push({
        thread,
        firstMentioned: epId,
        mentions: [epId],
        status: 'open'
      });
    }
  }

  // Update format stats
  const fmt = meta.format || 'debate';
  if (ledger.formatStats[fmt]) {
    ledger.formatStats[fmt].used++;
  }

  // Advance trial phase
  if (ledger.trialPhase && ledger.currentTrial <= 8) {
    if (ledger.trialSchedule[ledger.currentTrial - 1]) {
      ledger.trialSchedule[ledger.currentTrial - 1].status = 'completed';
    }
    ledger.currentTrial++;
    if (ledger.currentTrial > 8) {
      // Trial phase complete — check if a format was chosen
      const reviews = getTrialReviews();
      if (reviews.chosenFormat) {
        ledger.standardFormat = reviews.chosenFormat;
        ledger.trialPhase = false;
      }
    }
  }

  // Mark salvaged content as reused if topic overlaps
  const bank = getPodcastBank();
  for (const s of bank.salvaged) {
    if (!s.reusedIn && meta.tensions?.some(t => s.usableParts?.tensions?.includes(t))) {
      s.reusedIn = epId;
    }
  }
  savePodcastBank(bank);
  savePodcastLedger(ledger);
  return episode;
}

// --- Podcast Audio Generation (ElevenLabs Text to Dialogue) ---

function chunkScriptForDialogue(script, maxChars = DIALOGUE_CHAR_LIMIT) {
  const chunks = [];
  let current = [];
  let currentChars = 0;

  for (let i = 0; i < script.length; i++) {
    const exchange = script[i];
    const charCount = exchange.text.length + 20; // overhead for speaker/formatting

    if (currentChars + charCount > maxChars && current.length > 0) {
      // Try to split at a [pause] tag within the last 8 exchanges
      let splitIdx = -1;
      const searchStart = Math.max(0, current.length - 8);
      for (let j = current.length - 1; j >= searchStart; j--) {
        if (current[j].text.includes('[pause]')) {
          splitIdx = j + 1;
          break;
        }
      }

      if (splitIdx > 0 && splitIdx < current.length) {
        // Split at [pause] — push up to splitIdx, keep the rest
        chunks.push(current.slice(0, splitIdx));
        const remainder = current.slice(splitIdx);
        current = [...remainder, exchange];
        currentChars = current.reduce((sum, e) => sum + e.text.length + 20, 0);
      } else {
        // No good [pause] split point — flush the whole batch
        chunks.push(current);
        current = [exchange];
        currentChars = charCount;
      }
    } else {
      current.push(exchange);
      currentChars += charCount;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function callElevenLabsDialogue(inputs, outputPath, retries = 2) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');

  const body = {
    model_id: 'eleven_v3',
    inputs,
    output_format: 'mp3_44100_128',
    settings: { stability: 0.0 }
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(`${ELEVENLABS_API_BASE}/text-to-dialogue`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (response.status === 429 && attempt < retries) {
      const delay = attempt === 0 ? 5000 : 15000;
      console.warn(`[Podcast Audio] Rate limited, retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown');
      throw new Error(`ElevenLabs API error ${response.status}: ${errText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }
}

function concatenateAudioChunks(chunkPaths, outputPath) {
  if (chunkPaths.length === 0) throw new Error('No audio chunks to concatenate');

  if (chunkPaths.length === 1) {
    fs.copyFileSync(chunkPaths[0], outputPath);
    return outputPath;
  }

  if (!ffmpegAvailable) throw new Error('ffmpeg not available for concatenation');

  // Write ffmpeg concat file list
  const listPath = outputPath + '.list.txt';
  const listContent = chunkPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  try {
    execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`, {
      timeout: 60000,
      encoding: 'utf-8',
      stdio: 'pipe'
    });
  } finally {
    // Clean up list file
    try { fs.unlinkSync(listPath); } catch {}
  }

  return outputPath;
}

async function generatePodcastAudio(queueItemId) {
  const queue = getPostingQueue();
  const item = queue.queue.find(i => i.id === queueItemId && i.platform === 'podcast');
  if (!item) {
    console.error(`[Podcast Audio] Queue item ${queueItemId} not found`);
    return;
  }

  const script = item.metadata?.script;
  if (!script || script.length === 0) {
    console.error(`[Podcast Audio] No script found for ${queueItemId}`);
    return;
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('[Podcast Audio] ELEVENLABS_API_KEY not set, skipping audio generation');
    return;
  }

  if (!ffmpegAvailable && script.length > 50) {
    // Likely needs multiple chunks — warn but try anyway (single chunk might work)
    console.warn('[Podcast Audio] ffmpeg not available — multi-chunk concatenation may fail');
  }

  const voiceShawn = process.env.ELEVENLABS_VOICE_SHAWN;
  const voiceAnne = process.env.ELEVENLABS_VOICE_ANNE;
  if (!voiceShawn || !voiceAnne) {
    console.error('[Podcast Audio] Voice IDs not set (ELEVENLABS_VOICE_SHAWN / ELEVENLABS_VOICE_ANNE)');
    return;
  }

  // Prevent concurrent runs
  if (item.metadata.audioGenerating) {
    console.warn(`[Podcast Audio] Already generating for ${queueItemId}`);
    return;
  }

  // Mark as generating
  item.metadata.audioGenerating = true;
  item.metadata.audioError = null;
  savePostingQueue(queue);
  broadcast('posting-queue');

  const timestamp = Date.now();
  const chunkPaths = [];

  try {
    // Chunk the script
    const chunks = chunkScriptForDialogue(script);
    const totalChars = script.reduce((sum, e) => sum + e.text.length, 0);
    console.log(`[Podcast Audio] Starting generation for "${item.title}" — ${chunks.length} batch(es), ${totalChars} chars`);

    // Generate each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const inputs = chunk.map(exchange => ({
        text: exchange.text.replace(/\[pause\]/gi, '...'),
        voice_id: exchange.speaker === 'anne' ? voiceAnne : voiceShawn
      }));

      const chunkPath = path.join(PODCAST_AUDIO_DIR, `${queueItemId}-chunk-${i}-${timestamp}.mp3`);
      const chunkChars = chunk.reduce((sum, e) => sum + e.text.length, 0);

      await callElevenLabsDialogue(inputs, chunkPath);
      chunkPaths.push(chunkPath);
      console.log(`[Podcast Audio] Batch ${i + 1}/${chunks.length} complete (${chunkChars} chars)`);
    }

    // Concatenate
    const finalPath = path.join(PODCAST_AUDIO_DIR, `${queueItemId}.mp3`);
    concatenateAudioChunks(chunkPaths, finalPath);

    // Update metadata
    const freshQueue = getPostingQueue();
    const freshItem = freshQueue.queue.find(i => i.id === queueItemId);
    if (freshItem) {
      freshItem.metadata.audioFile = `${queueItemId}.mp3`;
      freshItem.metadata.audioGenerated = true;
      freshItem.metadata.audioGeneratedAt = new Date().toISOString();
      freshItem.metadata.audioGenerating = false;
      freshItem.metadata.audioError = null;
      freshItem.metadata.audioChunks = chunks.length;
      freshItem.metadata.audioCharacters = totalChars;
      savePostingQueue(freshQueue);
    }

    console.log(`[Podcast Audio] Complete: ${finalPath} (${chunks.length} chunks, ${totalChars} chars)`);
    broadcast('posting-queue');
    broadcast('podcast');

  } catch (error) {
    console.error(`[Podcast Audio] Failed for ${queueItemId}:`, error.message);

    // Update metadata with error
    const freshQueue = getPostingQueue();
    const freshItem = freshQueue.queue.find(i => i.id === queueItemId);
    if (freshItem) {
      freshItem.metadata.audioGenerating = false;
      freshItem.metadata.audioError = error.message;
      savePostingQueue(freshQueue);
    }

    broadcast('posting-queue');

  } finally {
    // Clean up chunk files (keep final MP3)
    for (const p of chunkPaths) {
      try { fs.unlinkSync(p); } catch {}
    }
  }
}

// --- Manual trigger ---
app.post('/api/podcast/run', async (req, res) => {
  try {
    const result = await generatePodcastScript({ format: req.body?.format });
    recordCronRun('weekly-podcast', result.success ? `${result.format}:${result.exchanges}x` : result.reason);
    broadcast('podcast');
    broadcast('posting-queue');
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Podcast generation error:', error);
    res.status(500).json({ error: 'Podcast generation failed: ' + error.message });
  }
});

// --- Podcast action endpoints ---
app.post('/api/podcast/:id/approve', (req, res) => {
  try {
    const queue = getPostingQueue();
    const item = queue.queue.find(i => i.id === req.params.id && i.platform === 'podcast');
    if (!item) return res.status(404).json({ error: 'Podcast episode not found in queue' });

    const episode = podcastApprove(item, req.body?.reason, req.body?.ratings);
    item.status = 'ready';
    item.approvedAt = new Date().toISOString();
    savePostingQueue(queue);

    logSystemEvent('podcast', `Episode approved: "${item.title}" → ${episode.id}`, { episodeId: episode.id });
    broadcast('podcast');
    broadcast('posting-queue');

    // Fire-and-forget audio generation
    if (process.env.ELEVENLABS_API_KEY) {
      generatePodcastAudio(req.params.id).catch(err =>
        console.error('[Podcast Audio] Auto-generate after approve failed:', err.message)
      );
    }

    res.json({ success: true, episode });
  } catch (error) {
    console.error('Podcast approve error:', error);
    res.status(500).json({ error: 'Approval failed' });
  }
});

app.post('/api/podcast/:id/rework', async (req, res) => {
  try {
    const queue = getPostingQueue();
    const idx = queue.queue.findIndex(i => i.id === req.params.id && i.platform === 'podcast');
    if (idx === -1) return res.status(404).json({ error: 'Podcast episode not found' });

    const oldItem = queue.queue[idx];
    const notes = req.body?.notes || 'Rework requested';

    // Remove old item
    queue.queue.splice(idx, 1);
    savePostingQueue(queue);

    logSystemEvent('podcast', `Episode reworked: "${oldItem.title}" — ${notes}`, { oldId: oldItem.id });

    // Track decision in ledger
    const ledger = getPodcastLedger();
    if (!ledger.decisions) ledger.decisions = [];
    ledger.decisions.push({
      episodeTitle: oldItem.title,
      sourceId: oldItem.id,
      decision: 'reworked',
      reason: notes,
      format: oldItem.metadata?.format || 'debate',
      decidedAt: new Date().toISOString()
    });
    savePodcastLedger(ledger);

    broadcast('podcast');
    broadcast('posting-queue');

    // Regenerate with same format
    const result = await generatePodcastScript({ format: oldItem.metadata?.format });
    broadcast('podcast');
    broadcast('posting-queue');
    res.json({ success: true, reworked: true, ...result });
  } catch (error) {
    console.error('Podcast rework error:', error);
    res.status(500).json({ error: 'Rework failed' });
  }
});

app.post('/api/podcast/:id/salvage', (req, res) => {
  try {
    const queue = getPostingQueue();
    const idx = queue.queue.findIndex(i => i.id === req.params.id && i.platform === 'podcast');
    if (idx === -1) return res.status(404).json({ error: 'Podcast episode not found' });

    const item = queue.queue[idx];
    podcastSalvage(item, req.body?.reason || '', req.body?.ratings);

    queue.queue.splice(idx, 1);
    savePostingQueue(queue);

    logSystemEvent('podcast', `Episode salvaged: "${item.title}"`, { topic: item.metadata?.topic });
    broadcast('podcast');
    broadcast('posting-queue');
    res.json({ success: true, salvaged: true });
  } catch (error) {
    console.error('Podcast salvage error:', error);
    res.status(500).json({ error: 'Salvage failed' });
  }
});

app.post('/api/podcast/:id/kill', (req, res) => {
  try {
    const queue = getPostingQueue();
    const idx = queue.queue.findIndex(i => i.id === req.params.id && i.platform === 'podcast');
    if (idx === -1) return res.status(404).json({ error: 'Podcast episode not found' });

    const item = queue.queue[idx];
    podcastKill(item, req.body?.reason || '', req.body?.ratings);

    queue.queue.splice(idx, 1);
    savePostingQueue(queue);

    logSystemEvent('podcast', `Episode killed: "${item.title}"`, { topic: item.metadata?.topic });
    broadcast('podcast');
    broadcast('posting-queue');
    res.json({ success: true, killed: true });
  } catch (error) {
    console.error('Podcast kill error:', error);
    res.status(500).json({ error: 'Kill failed' });
  }
});

// --- Trial review endpoint ---
app.post('/api/podcast/trial-review', (req, res) => {
  try {
    const { episodeId, format, ratings, soundReal, interesting, wouldShare, whatWorked, whatDidnt, notes, decisionReason } = req.body;
    if (!format) {
      return res.status(400).json({ error: 'format is required' });
    }

    // Support both old (soundReal/interesting) and new (ratings object) formats
    const newRatings = ratings || {};
    const effectiveSoundReal = newRatings.naturalness || soundReal;
    const effectiveInteresting = newRatings.tensionQuality || interesting;

    if (effectiveSoundReal == null || effectiveInteresting == null) {
      return res.status(400).json({ error: 'ratings are required (either ratings object or soundReal/interesting)' });
    }

    const reviews = getTrialReviews();
    reviews.reviews.push({
      episodeId,
      format,
      // Legacy fields (backward compat)
      soundReal: Number(effectiveSoundReal),
      interesting: Number(effectiveInteresting),
      // New multi-dimension ratings
      ratings: {
        naturalness: Number(newRatings.naturalness || effectiveSoundReal),
        anneVoice: Number(newRatings.anneVoice || 3),
        coupleChemistry: Number(newRatings.coupleChemistry || 3),
        hookStrength: Number(newRatings.hookStrength || 3),
        tensionQuality: Number(newRatings.tensionQuality || effectiveInteresting),
        pacing: Number(newRatings.pacing || 3),
        wouldShare: newRatings.wouldShare != null ? !!newRatings.wouldShare : !!wouldShare
      },
      wouldShare: newRatings.wouldShare != null ? !!newRatings.wouldShare : !!wouldShare,
      whatWorked: whatWorked || '',
      whatDidnt: whatDidnt || '',
      notes: notes || '',
      decisionReason: decisionReason || '',
      reviewedAt: new Date().toISOString()
    });

    // Update format stats in ledger
    const ledger = getPodcastLedger();
    if (ledger.formatStats[format]) {
      const fmtReviews = reviews.reviews.filter(r => r.format === format);
      const dims = ['naturalness', 'anneVoice', 'coupleChemistry', 'hookStrength', 'tensionQuality', 'pacing'];
      let totalAvg = 0;
      let dimCount = 0;
      for (const d of dims) {
        const vals = fmtReviews.map(r => r.ratings?.[d]).filter(v => v != null);
        if (vals.length > 0) {
          totalAvg += vals.reduce((a, b) => a + b, 0) / vals.length;
          dimCount++;
        }
      }
      ledger.formatStats[format].avgRating = dimCount > 0 ? Number((totalAvg / dimCount).toFixed(2)) : null;
    }
    savePodcastLedger(ledger);
    saveTrialReviews(reviews);

    broadcast('podcast');
    res.json({ success: true, totalReviews: reviews.reviews.length });
  } catch (error) {
    console.error('Trial review error:', error);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

// --- Lock in format after trials ---
app.post('/api/podcast/standardize', (req, res) => {
  try {
    const { format } = req.body;
    if (!format || !PODCAST_FORMATS[format]) {
      return res.status(400).json({ error: 'Valid format required' });
    }

    const ledger = getPodcastLedger();
    ledger.standardFormat = format;
    ledger.trialPhase = false;
    savePodcastLedger(ledger);

    const reviews = getTrialReviews();
    reviews.chosenFormat = format;
    reviews.standardizedAt = new Date().toISOString();
    saveTrialReviews(reviews);

    logSystemEvent('podcast', `Podcast format standardized: ${PODCAST_FORMATS[format].name} (${format})`);
    broadcast('podcast');
    res.json({ success: true, format, name: PODCAST_FORMATS[format].name });
  } catch (error) {
    console.error('Standardize error:', error);
    res.status(500).json({ error: 'Failed to standardize' });
  }
});

// --- Podcast state endpoints ---
app.get('/api/podcast/ledger', (req, res) => {
  try { res.json(getPodcastLedger()); }
  catch (error) { res.status(500).json({ error: 'Failed to read ledger' }); }
});

app.get('/api/podcast/bank', (req, res) => {
  try { res.json(getPodcastBank()); }
  catch (error) { res.status(500).json({ error: 'Failed to read bank' }); }
});

app.get('/api/podcast/trials', (req, res) => {
  try { res.json(getTrialReviews()); }
  catch (error) { res.status(500).json({ error: 'Failed to read trials' }); }
});

app.get('/api/podcast/formats', (req, res) => {
  res.json({ formats: PODCAST_FORMATS });
});

// --- Podcast Management Page endpoints ---

app.get('/api/podcast/overview', (req, res) => {
  try {
    const ledger = getPodcastLedger();
    const bank = getPodcastBank();
    const trials = getTrialReviews();
    const queue = getPostingQueue();

    // Find pending podcast episode in queue
    const pendingEpisode = queue.queue.find(i => i.platform === 'podcast' && i.status === 'pending-review');

    // Count decisions
    const decisions = ledger.decisions || [];
    const approved = decisions.filter(d => d.decision === 'approved').length + ledger.episodes.length;
    const salvaged = decisions.filter(d => d.decision === 'salvaged').length;
    const killed = decisions.filter(d => d.decision === 'killed').length;

    // Quality trend (average of last 3 reviews vs previous 3)
    const allReviews = trials.reviews || [];
    const dims = ['naturalness', 'anneVoice', 'coupleChemistry', 'hookStrength', 'tensionQuality', 'pacing'];
    let currentAvg = null;
    let previousAvg = null;
    if (allReviews.length >= 1) {
      const recent = allReviews.slice(-3);
      const rVals = recent.flatMap(r => dims.map(d => r.ratings?.[d]).filter(v => v != null));
      currentAvg = rVals.length > 0 ? Number((rVals.reduce((a, b) => a + b, 0) / rVals.length).toFixed(2)) : null;
    }
    if (allReviews.length >= 4) {
      const prev = allReviews.slice(-6, -3);
      const pVals = prev.flatMap(r => dims.map(d => r.ratings?.[d]).filter(v => v != null));
      previousAvg = pVals.length > 0 ? Number((pVals.reduce((a, b) => a + b, 0) / pVals.length).toFixed(2)) : null;
    }

    // Next scheduled Monday 9:30 AM PST
    const now = new Date();
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
    nextMonday.setHours(9, 30, 0, 0);
    if (now.getDay() === 1 && now.getHours() < 10) {
      nextMonday.setDate(now.getDate());
    }

    res.json({
      trialPhase: ledger.trialPhase,
      currentTrial: ledger.currentTrial,
      trialSchedule: ledger.trialSchedule || [],
      standardFormat: ledger.standardFormat,
      totalEpisodes: ledger.totalEpisodes,
      approved,
      salvaged,
      killed,
      qualityTrend: { current: currentAvg, previous: previousAvg },
      nextScheduled: nextMonday.toISOString(),
      pendingEpisode: pendingEpisode || null,
      formatStats: ledger.formatStats || {},
      formats: PODCAST_FORMATS
    });
  } catch (error) {
    console.error('Podcast overview error:', error);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

app.get('/api/podcast/quality-trends', (req, res) => {
  try {
    const trials = getTrialReviews();
    const ledger = getPodcastLedger();
    const allReviews = trials.reviews || [];
    const dims = ['naturalness', 'anneVoice', 'coupleChemistry', 'hookStrength', 'tensionQuality', 'pacing'];

    // Overall averages per dimension
    const overall = {};
    for (const d of dims) {
      const vals = allReviews.map(r => r.ratings?.[d]).filter(v => v != null);
      overall[d] = vals.length > 0 ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
    }
    const shareRate = allReviews.length > 0
      ? Number((allReviews.filter(r => r.ratings?.wouldShare || r.wouldShare).length / allReviews.length * 100).toFixed(0))
      : null;

    // Per-format averages
    const formats = Object.keys(PODCAST_FORMATS);
    const byFormat = {};
    for (const fmt of formats) {
      const fmtReviews = allReviews.filter(r => r.format === fmt);
      if (fmtReviews.length === 0) {
        byFormat[fmt] = { count: 0, averages: {}, shareRate: null };
        continue;
      }
      const avgs = {};
      for (const d of dims) {
        const vals = fmtReviews.map(r => r.ratings?.[d]).filter(v => v != null);
        avgs[d] = vals.length > 0 ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
      }
      byFormat[fmt] = {
        count: fmtReviews.length,
        averages: avgs,
        shareRate: Number((fmtReviews.filter(r => r.ratings?.wouldShare || r.wouldShare).length / fmtReviews.length * 100).toFixed(0))
      };
    }

    res.json({ overall, shareRate, byFormat, totalReviews: allReviews.length });
  } catch (error) {
    console.error('Quality trends error:', error);
    res.status(500).json({ error: 'Failed to load quality trends' });
  }
});

app.get('/api/podcast/history', (req, res) => {
  try {
    const ledger = getPodcastLedger();
    const trials = getTrialReviews();
    const decisions = ledger.decisions || [];

    // Merge episodes with their decisions and ratings
    const history = ledger.episodes.map(ep => {
      const decision = decisions.find(d => d.episodeId === ep.id) || {};
      const review = (trials.reviews || []).find(r => r.episodeId === ep.id);
      return {
        ...ep,
        decision: ep.decision || decision.decision || 'approved',
        decisionReason: ep.decisionReason || decision.reason || '',
        ratings: ep.ratings || decision.ratings || review?.ratings || null
      };
    });

    // Add salvaged/killed decisions that don't have episode entries
    const nonApproved = decisions.filter(d => d.decision !== 'approved' && d.decision !== 'reworked');
    for (const d of nonApproved) {
      if (!history.find(h => h.id === d.episodeId || h.id === d.sourceId)) {
        history.push({
          id: d.sourceId || d.episodeId,
          title: d.episodeTitle,
          format: d.format,
          decision: d.decision,
          decisionReason: d.reason,
          ratings: d.ratings,
          publishedAt: d.decidedAt,
          decidedAt: d.decidedAt
        });
      }
    }

    // Sort by date descending
    history.sort((a, b) => new Date(b.publishedAt || b.decidedAt || 0) - new Date(a.publishedAt || a.decidedAt || 0));

    res.json({ episodes: history });
  } catch (error) {
    console.error('Podcast history error:', error);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

app.patch('/api/podcast/bank/:id', (req, res) => {
  try {
    const bank = getPodcastBank();
    const item = bank.salvaged.find(s => s.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Salvaged item not found' });

    if (req.body.markedForReuse != null) item.markedForReuse = !!req.body.markedForReuse;
    savePodcastBank(bank);
    broadcast('podcast');
    res.json({ success: true, item });
  } catch (error) {
    console.error('Podcast bank patch error:', error);
    res.status(500).json({ error: 'Failed to update bank item' });
  }
});

// --- Podcast Audio Endpoints ---

app.post('/api/podcast/:id/generate-audio', (req, res) => {
  try {
    const queue = getPostingQueue();
    const item = queue.queue.find(i => i.id === req.params.id && i.platform === 'podcast');
    if (!item) return res.status(404).json({ error: 'Podcast episode not found' });
    if (!item.metadata?.script?.length) return res.status(400).json({ error: 'No script found on this episode' });
    if (item.metadata.audioGenerating) return res.status(409).json({ error: 'Audio generation already in progress' });
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
    if (!process.env.ELEVENLABS_VOICE_SHAWN || !process.env.ELEVENLABS_VOICE_ANNE) {
      return res.status(500).json({ error: 'Voice IDs not configured' });
    }

    // Fire-and-forget
    generatePodcastAudio(req.params.id).catch(err =>
      console.error('[Podcast Audio] Manual generate failed:', err.message)
    );

    res.json({ success: true, message: 'Audio generation started' });
  } catch (error) {
    console.error('Podcast generate-audio error:', error);
    res.status(500).json({ error: 'Failed to start audio generation' });
  }
});

app.get('/api/podcast/:id/audio-status', (req, res) => {
  try {
    const queue = getPostingQueue();
    const item = queue.queue.find(i => i.id === req.params.id && i.platform === 'podcast');
    if (!item) return res.status(404).json({ error: 'Podcast episode not found' });

    res.json({
      audioGenerated: item.metadata?.audioGenerated || false,
      audioGenerating: item.metadata?.audioGenerating || false,
      audioFile: item.metadata?.audioFile || null,
      audioError: item.metadata?.audioError || null,
      audioGeneratedAt: item.metadata?.audioGeneratedAt || null,
      audioChunks: item.metadata?.audioChunks || null,
      audioCharacters: item.metadata?.audioCharacters || null
    });
  } catch (error) {
    console.error('Podcast audio-status error:', error);
    res.status(500).json({ error: 'Failed to get audio status' });
  }
});

// Serve generated audio files
app.use('/api/podcast/audio', express.static(PODCAST_AUDIO_DIR));

// --- Cron schedule ---
cron.schedule('30 9 * * 1', async () => {
  try {
    const result = await generatePodcastScript();
    recordCronRun('weekly-podcast', result.success ? `${result.format}:${result.exchanges}x` : result.reason);
  } catch (err) {
    console.error('[Cron] Podcast error:', err);
    recordCronRun('weekly-podcast', null, err.message);
    logSystemEvent('error', `Weekly podcast failed: ${err.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[Cron] Weekly podcast scheduled for Monday 9:30 AM PST');

app.post('/api/peer-review/run', async (req, res) => {
  try {
    const result = await runPeerReview();
    recordCronRun('peer-review', `reviewed:${result.reviewed},flagged:${result.flagged}`);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Peer review error:', error);
    res.status(500).json({ error: 'Peer review failed' });
  }
});

app.post('/api/tension-standup/run', async (req, res) => {
  try {
    const result = await runTensionStandup();
    recordCronRun('tension-standup', `actions:${result.actions}`);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Tension standup error:', error);
    res.status(500).json({ error: 'Tension standup failed' });
  }
});

app.post('/api/book-pipeline/run', async (req, res) => {
  try {
    const result = await runBookPipeline();
    recordCronRun('book-pipeline', result.success ? `ch${result.chapter}s${result.section}` : result.reason);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Book pipeline error:', error);
    res.status(500).json({ error: 'Book pipeline failed' });
  }
});

app.get('/api/book-pipeline/state', (req, res) => {
  try {
    const state = getBookPipelineState();
    const outline = parseBookOutline();
    const totalSections = outline.reduce((sum, ch) => sum + ch.sections.length, 0);
    res.json({
      ...state,
      outline: outline.map(ch => ({ number: ch.number, title: ch.title, sectionCount: ch.sections.length })),
      progress: { completed: state.completedSections.length, total: totalSections }
    });
  } catch (error) {
    console.error('Book pipeline state error:', error);
    res.status(500).json({ error: 'Failed to read pipeline state' });
  }
});

// Manual trigger endpoints for new cron jobs
app.post('/api/auto-voice-check/run', async (req, res) => {
  try {
    const result = await runAutoVoiceCheck();
    recordCronRun('auto-voice-check', `checked:${result.checked},flagged:${result.flagged}`);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Auto voice check error:', error);
    res.status(500).json({ error: 'Auto voice check failed' });
  }
});

app.post('/api/queue-replenishment/run', async (req, res) => {
  try {
    const result = await runQueueReplenishment();
    recordCronRun('queue-replenishment', `drafted:${result.drafted}`);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Queue replenishment error:', error);
    res.status(500).json({ error: 'Queue replenishment failed' });
  }
});

app.post('/api/evening-recap/run', async (req, res) => {
  try {
    const result = await generateEveningRecap();
    recordCronRun('evening-recap', `posted:${result.totalPosted},queued:${result.totalReady}`);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Evening recap error:', error);
    res.status(500).json({ error: 'Evening recap failed' });
  }
});

// Manual trigger endpoint
app.post('/api/weekly-review', async (req, res) => {
  try {
    const result = await weeklyProjectReview();
    res.json({ success: true, message: 'Weekly review triggered' });
  } catch (error) {
    console.error('Weekly review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// OPTIMIZATION API ENDPOINTS
// ============================================================================

/**
 * Get optimization runs with filtering
 */
app.get('/api/optimizations', (req, res) => {
  try {
    const optimizations = getOptimizations();
    let runs = optimizations.runs;

    // Filter by date range
    if (req.query.range) {
      const now = new Date();
      let startDate;
      switch (req.query.range) {
        case 'day':
          startDate = new Date(now.setDate(now.getDate() - 1));
          break;
        case 'week':
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case 'year':
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
      }
      if (startDate) {
        runs = runs.filter(r => new Date(r.date) >= startDate);
      }
    }

    res.json({
      runs,
      stats: optimizations.stats,
      lastRun: runs[0] || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get optimization findings with filtering
 */
app.get('/api/optimizations/findings', (req, res) => {
  try {
    const optimizations = getOptimizations();
    let findings = optimizations.findings;

    // Filter by status
    if (req.query.status) {
      findings = findings.filter(f => f.status === req.query.status);
    }

    // Filter by severity
    if (req.query.severity) {
      findings = findings.filter(f => f.severity === req.query.severity);
    }

    // Filter by type
    if (req.query.type) {
      findings = findings.filter(f => f.type === req.query.type);
    }

    // Filter by forHuman
    if (req.query.forHuman === 'true') {
      findings = findings.filter(f => f.forHuman);
    }

    // Filter by date range
    if (req.query.range) {
      const now = new Date();
      let startDate;
      switch (req.query.range) {
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
      }
      if (startDate) {
        findings = findings.filter(f => new Date(f.createdAt) >= startDate);
      }
    }

    // Sort by date (newest first)
    findings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(findings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Update finding status (resolve, dismiss, etc.)
 */
app.patch('/api/optimizations/findings/:id', (req, res) => {
  try {
    const { status, resolution } = req.body;

    const validFindingStatuses = ['pending', 'resolved', 'dismissed', 'in_progress'];
    if (!status || !validFindingStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validFindingStatuses.join(', ')}` });
    }

    const optimizations = getOptimizations();

    const findingIndex = optimizations.findings.findIndex(f => f.id === req.params.id);
    if (findingIndex === -1) {
      return res.status(404).json({ error: 'Finding not found' });
    }

    optimizations.findings[findingIndex].status = status;
    if (resolution) {
      optimizations.findings[findingIndex].resolution = resolution;
    }
    optimizations.findings[findingIndex].resolvedAt = new Date().toISOString();

    if (status === 'resolved') {
      optimizations.stats.issuesResolved++;
    }

    saveOptimizations(optimizations);

    res.json({ success: true, finding: optimizations.findings[findingIndex] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Manually trigger optimization run
 */
app.post('/api/optimizations/run', (req, res) => {
  try {
    const result = runOptimization();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Manually trigger daily summary
 * Pass { "force": true } in body to override duplicate check
 */
app.post('/api/daily-summary/generate', (req, res) => {
  try {
    const force = req.body?.force === true;
    const notification = generateDailySummary(force);
    res.json({ success: true, notification, skipped: !force && notification.createdAt?.startsWith(new Date().toISOString().split('T')[0]) === false });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get optimization stats/summary
 */
app.get('/api/optimizations/stats', (req, res) => {
  try {
    const optimizations = getOptimizations();
    const recentRuns = optimizations.runs.slice(0, 7);
    const pendingFindings = optimizations.findings.filter(f => f.status === 'pending');

    res.json({
      ...optimizations.stats,
      recentRuns: recentRuns.length,
      pendingIssues: pendingFindings.length,
      pendingByPriority: {
        high: pendingFindings.filter(f => f.severity === 'high').length,
        medium: pendingFindings.filter(f => f.severity === 'medium').length,
        low: pendingFindings.filter(f => f.severity === 'low').length
      },
      lastRunDate: optimizations.runs[0]?.date || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// FUTURE NEEDS
// ============================================================================

const VALID_NEED_STATUSES = ['proposed', 'planned', 'in_progress', 'completed', 'deferred'];
const VALID_NEED_PRIORITIES = ['high', 'medium', 'low'];
const VALID_NEED_EFFORTS = ['small', 'medium', 'large'];
const VALID_NEED_CATEGORIES = ['content', 'growth', 'analytics', 'infrastructure', 'monetization', 'governance'];

function getFutureNeeds() {
  if (cache.futureNeeds) return cache.futureNeeds;
  try {
    if (fs.existsSync(FUTURE_NEEDS_FILE)) {
      cache.futureNeeds = JSON.parse(fs.readFileSync(FUTURE_NEEDS_FILE, 'utf8'));
      return cache.futureNeeds;
    }
  } catch (err) {
    console.error('Error reading future needs:', err);
  }
  return { needs: [], categories: {}, stats: { total: 0, byStatus: {}, byPriority: {}, lastUpdated: new Date().toISOString() } };
}

function saveFutureNeeds(data) {
  // Recalculate stats
  const needs = data.needs || [];
  data.stats = {
    total: needs.length,
    byStatus: {
      proposed: needs.filter(n => n.status === 'proposed').length,
      planned: needs.filter(n => n.status === 'planned').length,
      in_progress: needs.filter(n => n.status === 'in_progress').length,
      completed: needs.filter(n => n.status === 'completed').length,
      deferred: needs.filter(n => n.status === 'deferred').length
    },
    byPriority: {
      high: needs.filter(n => n.priority === 'high').length,
      medium: needs.filter(n => n.priority === 'medium').length,
      low: needs.filter(n => n.priority === 'low').length
    },
    lastUpdated: new Date().toISOString()
  };
  fs.writeFileSync(FUTURE_NEEDS_FILE, JSON.stringify(data, null, 2));
  cache.futureNeeds = null;
}

/**
 * List all future needs with optional filters
 */
app.get('/api/future-needs', (req, res) => {
  try {
    const data = getFutureNeeds();
    let needs = [...data.needs];

    // Filter by category
    if (req.query.category) {
      needs = needs.filter(n => n.category === req.query.category);
    }
    // Filter by priority
    if (req.query.priority) {
      needs = needs.filter(n => n.priority === req.query.priority);
    }
    // Filter by status
    if (req.query.status) {
      needs = needs.filter(n => n.status === req.query.status);
    }
    // Filter by effort
    if (req.query.effort) {
      needs = needs.filter(n => n.effort === req.query.effort);
    }

    // Sort
    const sortBy = req.query.sort || 'priority';
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const effortOrder = { small: 0, medium: 1, large: 2 };

    if (sortBy === 'priority') {
      needs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    } else if (sortBy === 'votes') {
      needs.sort((a, b) => b.votes - a.votes);
    } else if (sortBy === 'effort') {
      needs.sort((a, b) => effortOrder[a.effort] - effortOrder[b.effort]);
    } else if (sortBy === 'newest') {
      needs.sort((a, b) => new Date(b.proposedAt) - new Date(a.proposedAt));
    }

    res.json({ needs, categories: data.categories, total: needs.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get future needs stats
 */
app.get('/api/future-needs/stats', (req, res) => {
  try {
    const data = getFutureNeeds();
    const byCategory = {};
    for (const cat of VALID_NEED_CATEGORIES) {
      byCategory[cat] = data.needs.filter(n => n.category === cat).length;
    }
    res.json({
      ...data.stats,
      byCategory,
      categories: data.categories
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get single future need
 */
app.get('/api/future-needs/:id', (req, res) => {
  try {
    const data = getFutureNeeds();
    const need = data.needs.find(n => n.id === req.params.id);
    if (!need) {
      return res.status(404).json({ error: 'Need not found' });
    }
    res.json(need);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create new future need
 */
app.post('/api/future-needs', (req, res) => {
  try {
    const data = getFutureNeeds();
    const { title, description, useCase, category, priority, effort, agents, dependencies, acceptanceCriteria, targetQuarter } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'title and description are required' });
    }
    if (category && !VALID_NEED_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Valid: ${VALID_NEED_CATEGORIES.join(', ')}` });
    }
    if (priority && !VALID_NEED_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority. Valid: ${VALID_NEED_PRIORITIES.join(', ')}` });
    }
    if (effort && !VALID_NEED_EFFORTS.includes(effort)) {
      return res.status(400).json({ error: `Invalid effort. Valid: ${VALID_NEED_EFFORTS.join(', ')}` });
    }

    // Generate next ID
    const maxNum = data.needs.reduce((max, n) => {
      const num = parseInt(n.id.replace('need-', ''));
      return num > max ? num : max;
    }, 0);
    const newId = `need-${String(maxNum + 1).padStart(3, '0')}`;

    const newNeed = {
      id: newId,
      title,
      description,
      useCase: useCase || '',
      category: category || 'infrastructure',
      priority: priority || 'medium',
      effort: effort || 'medium',
      status: 'proposed',
      proposedBy: req.body.proposedBy || 'shawn',
      proposedAt: new Date().toISOString(),
      targetQuarter: targetQuarter || '',
      agents: agents || [],
      dependencies: dependencies || [],
      acceptanceCriteria: acceptanceCriteria || [],
      votes: 0,
      voters: [],
      comments: [],
      updatedAt: new Date().toISOString()
    };

    data.needs.push(newNeed);
    saveFutureNeeds(data);
    res.status(201).json(newNeed);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Update a future need
 */
app.patch('/api/future-needs/:id', (req, res) => {
  try {
    const data = getFutureNeeds();
    const idx = data.needs.findIndex(n => n.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Need not found' });
    }

    const updates = req.body;
    const need = data.needs[idx];

    // Validate status if provided
    if (updates.status && !VALID_NEED_STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${VALID_NEED_STATUSES.join(', ')}` });
    }
    if (updates.priority && !VALID_NEED_PRIORITIES.includes(updates.priority)) {
      return res.status(400).json({ error: `Invalid priority. Valid: ${VALID_NEED_PRIORITIES.join(', ')}` });
    }
    if (updates.effort && !VALID_NEED_EFFORTS.includes(updates.effort)) {
      return res.status(400).json({ error: `Invalid effort. Valid: ${VALID_NEED_EFFORTS.join(', ')}` });
    }
    if (updates.category && !VALID_NEED_CATEGORIES.includes(updates.category)) {
      return res.status(400).json({ error: `Invalid category. Valid: ${VALID_NEED_CATEGORIES.join(', ')}` });
    }

    // Apply allowed updates
    const allowedFields = ['title', 'description', 'useCase', 'category', 'priority', 'effort', 'status', 'targetQuarter', 'agents', 'dependencies', 'acceptanceCriteria'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        need[field] = updates[field];
      }
    }
    need.updatedAt = new Date().toISOString();

    // Set completedAt when marking as completed, clear it when reopening
    if (updates.status === 'completed' && !need.completedAt) {
      need.completedAt = new Date().toISOString();
    } else if (updates.status && updates.status !== 'completed') {
      delete need.completedAt;
    }

    data.needs[idx] = need;
    saveFutureNeeds(data);
    res.json(need);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Toggle vote on a need
 */
app.post('/api/future-needs/:id/vote', (req, res) => {
  try {
    const data = getFutureNeeds();
    const need = data.needs.find(n => n.id === req.params.id);
    if (!need) {
      return res.status(404).json({ error: 'Need not found' });
    }

    const voter = req.body.voter || 'anonymous';
    const voterIdx = need.voters.indexOf(voter);

    if (voterIdx >= 0) {
      // Unvote
      need.voters.splice(voterIdx, 1);
      need.votes = Math.max(0, need.votes - 1);
    } else {
      // Vote
      need.voters.push(voter);
      need.votes += 1;
    }
    need.updatedAt = new Date().toISOString();

    saveFutureNeeds(data);
    res.json({ votes: need.votes, voters: need.voters });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Add comment to a need
 */
app.post('/api/future-needs/:id/comments', (req, res) => {
  try {
    const data = getFutureNeeds();
    const need = data.needs.find(n => n.id === req.params.id);
    if (!need) {
      return res.status(404).json({ error: 'Need not found' });
    }

    const { text, author } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const comment = {
      id: `comment-${Date.now()}`,
      text,
      author: author || 'shawn',
      createdAt: new Date().toISOString()
    };

    need.comments.push(comment);
    need.updatedAt = new Date().toISOString();

    saveFutureNeeds(data);
    res.status(201).json(comment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Delete a future need
 */
app.delete('/api/future-needs/:id', (req, res) => {
  try {
    const data = getFutureNeeds();
    const idx = data.needs.findIndex(n => n.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Need not found' });
    }

    data.needs.splice(idx, 1);
    saveFutureNeeds(data);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// AGENT MESSAGING
// ============================================================================

const VALID_MESSAGE_TYPES = ['alert', 'request', 'update', 'question', 'review'];
const VALID_MESSAGE_PRIORITIES = ['high', 'medium', 'low'];
const VALID_MESSAGE_STATUSES = ['unread', 'read', 'archived'];

function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function createMessageNotification(message, mc) {
  if (message.priority !== 'high') return;
  const actionRequired = ['alert', 'request'].includes(message.type);
  mc.notifications.unshift({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'agent_message',
    title: `${message.type === 'alert' ? 'Alert' : 'Message'} from ${message.from}`,
    message: `**${message.subject}**\n\n${message.body.substring(0, 200)}${message.body.length > 200 ? '...' : ''}`,
    from: message.from,
    read: false,
    createdAt: message.createdAt,
    priority: 'high',
    actionRequired,
    metadata: {
      messageId: message.id,
      threadId: message.threadId,
      to: message.to,
      messageType: message.type
    }
  });
}

function logMessageActivity(message, mc) {
  mc.activities.unshift({
    id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'message_sent',
    agentId: message.from,
    timestamp: message.createdAt,
    description: `Sent ${message.type} to ${message.to.join(', ')}: ${message.subject}`,
    metadata: {
      messageId: message.id,
      threadId: message.threadId,
      to: message.to,
      messageType: message.type,
      priority: message.priority
    }
  });
}

/**
 * Internal helper: send a message programmatically (used by cron jobs).
 * Mirrors POST /api/messages logic but callable from code.
 */
function sendAgentMessage({ from, to, subject, body, type = 'update', priority = 'medium', threadId, parentId, metadata = {} }) {
  const mc = getMissionControl();
  if (!mc.messages) mc.messages = [];

  const id = generateMessageId();
  const now = new Date().toISOString();

  const message = {
    id,
    threadId: threadId || id,
    parentId: parentId || null,
    from,
    to: Array.isArray(to) ? to : [to],
    type,
    subject,
    body,
    priority,
    status: 'unread',
    createdAt: now,
    readAt: null,
    archivedAt: null,
    metadata
  };

  mc.messages.unshift(message);
  createMessageNotification(message, mc);
  logMessageActivity(message, mc);

  fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
  cache.missionControl = null;
  broadcast('messages');

  return message;
}

/**
 * Internal helper: create a task programmatically (used by Tension standup).
 */
function createInternalTask({ title, description, assigneeIds = [], createdBy = 'system', status = 'backlog', metadata = {} }) {
  const mc = getMissionControl();

  // Generate next task ID
  let maxNum = 0;
  for (const t of mc.tasks) {
    const match = t.id.match(/^task-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  const newId = `task-${String(maxNum + 1).padStart(3, '0')}`;
  const now = new Date().toISOString();

  const task = {
    id: newId,
    title: title.trim(),
    description: (description || '').trim(),
    status,
    assigneeIds,
    createdBy,
    createdAt: now,
    llm: null,
    rationale: '',
    reviewerIds: [],
    metadata
  };

  mc.tasks.push(task);

  mc.activities.unshift({
    id: `activity-${Date.now()}`,
    type: 'task_created',
    agentId: createdBy,
    taskId: newId,
    timestamp: now,
    description: `Created task: ${task.title}`,
    metadata: { assigneeIds, status, priority: metadata?.priority || null }
  });

  mc.notifications.unshift({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'task_assigned',
    title: 'New Task Assigned',
    message: `**${task.title}**\n\nAssigned to: ${assigneeIds.join(', ') || 'unassigned'}\n\n${(description || '').substring(0, 200)}`,
    read: false,
    createdAt: now,
    metadata: { taskId: newId, assigneeIds, createdBy }
  });

  fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
  cache.missionControl = null;
  broadcast('tasks');

  return task;
}

/**
 * GET /api/messages - List messages with filters
 */
app.get('/api/messages', (req, res) => {
  try {
    const mc = getMissionControl();
    const messages = mc.messages || [];
    const { agent, type, status, thread, from, to, limit = '100' } = req.query;

    let filtered = [...messages];

    if (agent) {
      filtered = filtered.filter(m => m.from === agent || m.to.includes(agent));
    }
    if (type) {
      filtered = filtered.filter(m => m.type === type);
    }
    if (status && status !== 'all') {
      filtered = filtered.filter(m => m.status === status);
    }
    if (thread) {
      filtered = filtered.filter(m => m.threadId === thread);
    }
    if (from) {
      filtered = filtered.filter(m => m.from === from);
    }
    if (to) {
      filtered = filtered.filter(m => m.to.includes(to));
    }

    // Sort newest first (unless thread view, then oldest first)
    if (thread) {
      filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else {
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const limitNum = Math.min(parseInt(limit) || 100, 500);
    const total = filtered.length;
    filtered = filtered.slice(0, limitNum);

    res.json({ messages: filtered, total });
  } catch (error) {
    console.error('[Messages] GET error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/messages/stats - Message statistics
 */
app.get('/api/messages/stats', (req, res) => {
  try {
    const mc = getMissionControl();
    const messages = mc.messages || [];

    const stats = {
      total: messages.length,
      unread: messages.filter(m => m.status === 'unread').length,
      byType: {},
      byAgent: {},
      threads: new Set(messages.map(m => m.threadId)).size
    };

    for (const m of messages) {
      stats.byType[m.type] = (stats.byType[m.type] || 0) + 1;

      // Track sender
      if (!stats.byAgent[m.from]) {
        stats.byAgent[m.from] = { sent: 0, received: 0, unread: 0 };
      }
      stats.byAgent[m.from].sent++;

      // Track recipients
      for (const recipient of m.to) {
        if (!stats.byAgent[recipient]) {
          stats.byAgent[recipient] = { sent: 0, received: 0, unread: 0 };
        }
        stats.byAgent[recipient].received++;
        if (m.status === 'unread') {
          stats.byAgent[recipient].unread++;
        }
      }
    }

    res.json(stats);
  } catch (error) {
    console.error('[Messages] Stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/messages - Send a new message
 */
app.post('/api/messages', (req, res) => {
  try {
    const { from, to, type, subject, body, priority = 'medium', metadata = {} } = req.body;

    // Validate required fields
    if (!from || !to || !type || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields: from, to, type, subject, body' });
    }
    if (!Array.isArray(to) || to.length === 0) {
      return res.status(400).json({ error: '"to" must be a non-empty array of agent IDs' });
    }
    if (!VALID_MESSAGE_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_MESSAGE_TYPES.join(', ')}` });
    }
    if (!VALID_MESSAGE_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_MESSAGE_PRIORITIES.join(', ')}` });
    }

    const mc = getMissionControl();
    const agentIds = mc.agents.map(a => a.id);

    if (!agentIds.includes(from)) {
      return res.status(400).json({ error: `Unknown sender: ${from}` });
    }
    for (const recipient of to) {
      if (!agentIds.includes(recipient)) {
        return res.status(400).json({ error: `Unknown recipient: ${recipient}` });
      }
    }

    const message = sendAgentMessage({ from, to, type, subject, body, priority, metadata });
    res.status(201).json(message);
  } catch (error) {
    console.error('[Messages] POST error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/messages/:id - Update message status
 */
app.patch('/api/messages/:id', (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !VALID_MESSAGE_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_MESSAGE_STATUSES.join(', ')}` });
    }

    const mc = getMissionControl();
    if (!mc.messages) mc.messages = [];

    const message = mc.messages.find(m => m.id === req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const now = new Date().toISOString();
    message.status = status;
    if (status === 'read' && !message.readAt) message.readAt = now;
    if (status === 'archived') message.archivedAt = now;

    fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
    cache.missionControl = null;

    res.json(message);
  } catch (error) {
    console.error('[Messages] PATCH error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/messages/:id/reply - Reply to a message
 */
app.post('/api/messages/:id/reply', (req, res) => {
  try {
    const { from, body, type, priority } = req.body;

    if (!from || !body) {
      return res.status(400).json({ error: 'Missing required fields: from, body' });
    }

    const mc = getMissionControl();
    if (!mc.messages) mc.messages = [];

    const parent = mc.messages.find(m => m.id === req.params.id);
    if (!parent) {
      return res.status(404).json({ error: 'Parent message not found' });
    }

    const agentIds = mc.agents.map(a => a.id);
    if (!agentIds.includes(from)) {
      return res.status(400).json({ error: `Unknown sender: ${from}` });
    }

    const replyType = type || parent.type;
    const replyPriority = priority || parent.priority;

    if (type && !VALID_MESSAGE_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_MESSAGE_TYPES.join(', ')}` });
    }
    if (priority && !VALID_MESSAGE_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_MESSAGE_PRIORITIES.join(', ')}` });
    }

    // Auto-set recipients: original sender + recipients, minus the replier
    const recipients = new Set([parent.from, ...parent.to]);
    recipients.delete(from);
    const to = Array.from(recipients);

    const reply = sendAgentMessage({
      from,
      to,
      type: replyType,
      subject: parent.subject.startsWith('Re: ') ? parent.subject : `Re: ${parent.subject}`,
      body,
      priority: replyPriority,
      threadId: parent.threadId,
      parentId: parent.id,
      metadata: parent.metadata || {}
    });

    res.status(201).json(reply);
  } catch (error) {
    console.error('[Messages] Reply error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// ONE-TIME MIGRATION: Human tasks → Queues
// ============================================================================

app.post('/api/migrate-tasks-to-queues', (req, res) => {
  try {
    const mc = getMissionControl();
    const replyQueue = getReplyQueue();
    const postingQueue = getPostingQueue();

    const migrated = { replies: [], posts: [] };

    // Find active human tasks that match queue patterns
    const humanTasks = mc.tasks.filter(t =>
      t.assigneeIds?.includes('human') &&
      !['completed', 'shipped', 'deferred'].includes(t.status) &&
      !t.metadata?.migratedToQueue
    );

    for (const task of humanTasks) {
      const actionItems = task.metadata?.actionItems || [];
      const hasReplyAction = actionItems.some(a => a.suggestedComment && a.url);
      const isPostingTask = task.title.toLowerCase().startsWith('post original tweet') ||
        task.metadata?.repostCandidate;

      if (hasReplyAction) {
        // Migrate to Reply Queue
        const action = actionItems[0];
        // Extract @handle from URL
        const urlParts = (action.url || '').split('/');
        const domainIdx = urlParts.findIndex(p => p.includes('x.com') || p.includes('twitter.com'));
        const handle = domainIdx >= 0 ? urlParts[domainIdx + 1] : '';

        // Extract "They wrote" text from description
        let targetText = '';
        const wroteMatch = task.description?.match(/\*\*(?:They|He|She) wrote:\*\*\s*"([^"]+)"/);
        if (wroteMatch) targetText = wroteMatch[1];

        const item = {
          id: `reply-${Date.now()}-${task.id}`,
          createdAt: task.createdAt,
          status: 'ready',
          platform: 'twitter',
          targetUrl: action.url,
          targetAuthor: handle,
          targetText,
          replyText: addRelevantHashtags(addConversationalHook(action.suggestedComment)),
          taskId: task.id,
          targetUri: null,
          targetCid: null
        };

        replyQueue.queue.push(item);
        task.status = 'shipped';
        task.metadata.migratedToQueue = true;
        task.completedAt = new Date().toISOString();
        task.completedBy = 'migration';
        migrated.replies.push({ taskId: task.id, queueItemId: item.id });

      } else if (isPostingTask) {
        // Migrate to Posting Queue — extract options from description
        // Assign a different philosopher voice to each option
        const POSTING_PHILOSOPHERS = ['nietzsche', 'marcus', 'socrates', 'heraclitus', 'plato'];
        const rawOptions = [];
        const optionRegex = /\*\*Option ([A-C])[^*]*\*\*[^>]*>\s*(.+?)(?=\n\n\*\*Option|\n\nhttps?:|$)/gs;
        let match;
        while ((match = optionRegex.exec(task.description)) !== null) {
          rawOptions.push(match[2].trim());
        }

        const options = rawOptions.map((text, i) => ({
          text,
          philosopher: POSTING_PHILOSOPHERS[i % POSTING_PHILOSOPHERS.length]
        }));

        const item = {
          id: `post-${Date.now()}-${task.id}`,
          createdAt: task.createdAt,
          status: 'ready',
          platform: 'twitter',
          content: options[0]?.text || '',
          caption: '',
          parts: [],
          canvaRequired: false,
          canvaComplete: false,
          createdBy: task.createdBy || 'migration',
          postUrl: 'https://x.com/compose/post',
          taskId: task.id,
          metadata: options.length > 0 ? { options } : {}
        };

        postingQueue.queue.push(item);
        task.status = 'shipped';
        task.metadata.migratedToQueue = true;
        task.completedAt = new Date().toISOString();
        task.completedBy = 'migration';
        migrated.posts.push({ taskId: task.id, queueItemId: item.id });
      }
    }

    // Save all changes
    if (migrated.replies.length > 0) saveReplyQueue(replyQueue);
    if (migrated.posts.length > 0) savePostingQueue(postingQueue);
    if (migrated.replies.length + migrated.posts.length > 0) {
      fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
      cache.missionControl = null;
    }

    res.json({
      success: true,
      migrated: {
        replies: migrated.replies.length,
        posts: migrated.posts.length,
        total: migrated.replies.length + migrated.posts.length,
        details: migrated
      }
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: 'Migration failed' });
  }
});

/**
 * Generate follow-outreach items: for each target, Claude writes an engagement
 * comment based on their bio/post, then queues it as a reply with followTarget=true.
 *
 * Body: { targets: [{ handle, profileUrl, platform, context?, contextType? }], philosopher? }
 * contextType: "bio" | "post" | "pinned" (helps Claude tailor the comment)
 */
app.post('/api/follow-outreach', async (req, res) => {
  try {
    const client = getAnthropicClient();
    if (!client) {
      return res.status(501).json({ error: 'Anthropic API key not configured' });
    }

    const { targets, philosopher: requestedPhilosopher } = req.body;
    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'targets array is required' });
    }

    // Rotate philosophers across targets for variety
    const OUTREACH_PHILOSOPHERS = ['nietzsche', 'marcus', 'socrates', 'heraclitus', 'plato'];
    const replyData = getReplyQueue();
    const results = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const { handle, profileUrl, platform = 'twitter', context, contextType = 'post' } = target;

      if (!handle) continue;

      const philosopher = requestedPhilosopher || OUTREACH_PHILOSOPHERS[i % OUTREACH_PHILOSOPHERS.length];
      if (!isValidPhilosopher(philosopher)) continue;

      // Read philosopher voice
      let soulContent = '';
      const soulPath = path.join(PHILOSOPHERS_DIR, philosopher, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        soulContent = fs.readFileSync(soulPath, 'utf8');
        if (soulContent.length > 1500) soulContent = soulContent.substring(0, 1500) + '\n...(truncated)';
      }

      const contextLabel = contextType === 'bio' ? 'bio' : contextType === 'pinned' ? 'pinned post' : 'recent post';

      const systemPrompt = `You are a philosopher writing a brief, genuine reply to someone's ${contextLabel} on ${platform === 'bluesky' ? 'Bluesky' : 'Twitter/X'}. You write as ${philosopher} — through the TensionLines brand.

${soulContent ? `## Voice:\n${soulContent}\n` : ''}
## Rules:
- Write a short, authentic reply that engages with what they said. This is outreach — you're starting a relationship.
- Start or end with a conversational hook: "I'm with you —", "This resonates —", "Spot on.", "Needed to read this.", "Real talk —", etc. Vary them.
- Be genuinely engaging — NOT self-promotional. Don't mention TensionLines.
- Be concise: 1-2 sentences max. This is a reply, not an essay.
- Match their energy. If they're casual, be casual. If they're deep, go deeper.
- Never use generic motivational filler. Be specific to what THEY said.
- ${platform === 'bluesky' ? 'Must be ≤300 characters.' : 'Keep under 280 characters.'}
- Return ONLY the reply text. No quotes, labels, or explanation.`;

      const userPrompt = context
        ? `Write a reply to @${handle}'s ${contextLabel}:\n\n"${context}"\n\nWrite one genuine reply.`
        : `Write a brief, engaging reply to @${handle} on ${platform}. You're reaching out to start a conversation. Keep it warm, specific, and curious. Write one reply.`;

      const message = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      let replyText = (message.content[0]?.text || '').trim();
      if (!replyText) continue;

      // Add hashtags
      replyText = addRelevantHashtags(replyText);

      const targetUrl = profileUrl || `https://x.com/${handle}`;
      const item = {
        id: `reply-${Date.now()}-follow-${handle}`,
        createdAt: new Date().toISOString(),
        status: 'ready',
        platform,
        targetUrl: target.postUrl || targetUrl,
        targetAuthor: handle.replace(/^@/, ''),
        targetText: context || '',
        replyText,
        taskId: target.taskId || null,
        targetUri: null,
        targetCid: null,
        followTarget: true,
        followUrl: targetUrl,
        philosopher,
        contextType
      };

      replyData.queue.push(item);
      results.push({ handle, philosopher, replyText: replyText.substring(0, 80) + '...', itemId: item.id });
    }

    saveReplyQueue(replyData);

    res.json({
      success: true,
      generated: results.length,
      items: results
    });
  } catch (error) {
    console.error('Follow outreach error:', error);
    res.status(500).json({ error: 'Failed to generate outreach' });
  }
});

/**
 * Apply conversational hooks to existing reply/comment queue items that don't have one yet.
 */
app.post('/api/apply-hooks', (req, res) => {
  try {
    const replyData = getReplyQueue();
    const commentData = getCommentQueue();
    let replyHookCount = 0;
    let replyTagCount = 0;
    let commentHookCount = 0;
    let commentTagCount = 0;

    for (const item of replyData.queue) {
      if (item.replyText && !item.hookApplied) {
        item.replyText = addConversationalHook(item.replyText);
        item.hookApplied = true;
        replyHookCount++;
      }
      if (item.replyText && !item.hashtagsApplied) {
        item.replyText = addRelevantHashtags(item.replyText);
        item.hashtagsApplied = true;
        replyTagCount++;
      }
    }

    for (const item of commentData.queue) {
      if (item.commentText && !item.hookApplied) {
        item.commentText = addConversationalHook(item.commentText);
        item.hookApplied = true;
        commentHookCount++;
      }
      if (item.commentText && !item.hashtagsApplied) {
        item.commentText = addRelevantHashtags(item.commentText);
        item.hashtagsApplied = true;
        commentTagCount++;
      }
    }

    if (replyHookCount > 0 || replyTagCount > 0) saveReplyQueue(replyData);
    if (commentHookCount > 0 || commentTagCount > 0) saveCommentQueue(commentData);

    res.json({
      success: true,
      updated: {
        replies: { hooks: replyHookCount, hashtags: replyTagCount },
        comments: { hooks: commentHookCount, hashtags: commentTagCount }
      }
    });
  } catch (error) {
    console.error('Hook application error:', error);
    res.status(500).json({ error: 'Failed to apply hooks' });
  }
});

// ============================================================================
// FOLLOWS TRACKER
// ============================================================================

function getFollowsTracker() {
  try {
    if (fs.existsSync(FOLLOWS_TRACKER_FILE)) {
      return JSON.parse(fs.readFileSync(FOLLOWS_TRACKER_FILE, 'utf8'));
    }
  } catch (e) { console.error('Error reading follows tracker:', e); }
  return { follows: [] };
}

function saveFollowsTracker(data) {
  fs.writeFileSync(FOLLOWS_TRACKER_FILE, JSON.stringify(data, null, 2));
}

// GET /api/follows - list all tracked follows
app.get('/api/follows', (req, res) => {
  try {
    const data = getFollowsTracker();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read follows tracker' });
  }
});

// POST /api/follows - log a new follow
app.post('/api/follows', (req, res) => {
  try {
    const { handle, platform = 'twitter', source = 'manual', context = '', replyQueueItemId = null } = req.body;
    if (!handle) return res.status(400).json({ error: 'handle is required' });

    const data = getFollowsTracker();

    // Check for duplicate (same handle + platform)
    const cleanHandle = handle.replace(/^@/, '');
    const existing = data.follows.find(f => f.handle.toLowerCase() === cleanHandle.toLowerCase() && f.platform === platform);
    if (existing) {
      return res.json({ success: true, duplicate: true, follow: existing });
    }

    const follow = {
      handle: cleanHandle,
      platform,
      followedAt: new Date().toISOString(),
      source, // 'manual', 'outreach', 'organic'
      context
    };

    if (replyQueueItemId) {
      follow.replyQueueItemId = replyQueueItemId;
    }

    data.follows.push(follow);
    saveFollowsTracker(data);

    res.json({ success: true, follow });
  } catch (error) {
    console.error('Follow tracking error:', error);
    res.status(500).json({ error: 'Failed to track follow' });
  }
});

// ============================================================================
// ENGAGEMENT ACTIONS QUEUE (repost, like, follow)
// ============================================================================

function getEngagementActions() {
  try {
    if (fs.existsSync(ENGAGEMENT_ACTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(ENGAGEMENT_ACTIONS_FILE, 'utf8'));
    }
  } catch (e) { console.error('Error reading engagement actions:', e); }
  return { queue: [], completed: [], settings: { platforms: { twitter: { enabled: true, maxActionsPerDay: 25 }, bluesky: { enabled: true, maxActionsPerDay: 25 } } } };
}

function saveEngagementActions(data) {
  fs.writeFileSync(ENGAGEMENT_ACTIONS_FILE, JSON.stringify(data, null, 2));
}

// GET /api/engagement-actions
app.get('/api/engagement-actions', (req, res) => {
  try {
    const data = getEngagementActions();
    // Count today's completed actions per platform
    const today = new Date().toISOString().slice(0, 10);
    const todayCounts = { twitter: { repost: 0, like: 0, follow: 0 }, bluesky: { repost: 0, like: 0, follow: 0 } };
    for (const item of data.completed) {
      if (item.completedAt && item.completedAt.startsWith(today)) {
        const p = item.platform || 'twitter';
        const t = item.type || 'like';
        if (todayCounts[p]) todayCounts[p][t] = (todayCounts[p][t] || 0) + 1;
      }
    }
    res.json({ ...data, todayCounts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read engagement actions' });
  }
});

// POST /api/engagement-actions - add one or more items
app.post('/api/engagement-actions', (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    const data = getEngagementActions();
    const created = [];

    for (const item of items) {
      const { type, platform = 'twitter', targetUrl, targetAuthor, targetText = '', context = '', source = 'manual' } = item;
      if (!type || !['repost', 'like', 'follow'].includes(type)) {
        continue; // skip invalid
      }
      if (!targetUrl && type !== 'follow') continue;
      if (!targetAuthor && type === 'follow') continue;

      const newItem = {
        id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        platform,
        targetUrl: targetUrl || `https://x.com/${(targetAuthor || '').replace(/^@/, '')}`,
        targetAuthor: (targetAuthor || '').replace(/^@/, ''),
        targetText,
        context,
        source,
        status: 'ready',
        createdAt: new Date().toISOString()
      };

      data.queue.push(newItem);
      created.push(newItem);
    }

    saveEngagementActions(data);
    res.json({ success: true, created: created.length, items: created });
  } catch (error) {
    console.error('Engagement action create error:', error);
    res.status(500).json({ error: 'Failed to create engagement action' });
  }
});

// POST /api/engagement-actions/scan - manual trigger (must be before :id routes)
app.post('/api/engagement-actions/scan', async (req, res) => {
  try {
    const result = await scanForEngagementTargets();
    res.json(result);
  } catch (error) {
    console.error('[EngagementScan] Manual scan error:', error);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// POST /api/engagement-actions/execute - manual trigger (must be before :id routes)
app.post('/api/engagement-actions/execute', async (req, res) => {
  try {
    const result = await executeEngagementActions();
    res.json(result);
  } catch (error) {
    console.error('[EngagementExec] Manual execute error:', error);
    res.status(500).json({ error: 'Execution failed' });
  }
});

// POST /api/engagement-actions/:id/done - mark completed
app.post('/api/engagement-actions/:id/done', (req, res) => {
  try {
    const data = getEngagementActions();
    const idx = data.queue.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });

    const item = data.queue.splice(idx, 1)[0];
    item.status = 'completed';
    item.completedAt = new Date().toISOString();
    data.completed.unshift(item);

    // If it's a follow, also log to follows tracker
    if (item.type === 'follow') {
      const followsData = getFollowsTracker();
      const cleanHandle = (item.targetAuthor || '').replace(/^@/, '');
      const exists = followsData.follows.find(f => f.handle.toLowerCase() === cleanHandle.toLowerCase() && f.platform === item.platform);
      if (!exists) {
        followsData.follows.push({
          handle: cleanHandle,
          platform: item.platform,
          followedAt: item.completedAt,
          source: item.source || 'engagement-queue',
          context: item.context || item.targetText || ''
        });
        saveFollowsTracker(followsData);
      }
    }

    saveEngagementActions(data);
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete action' });
  }
});

// DELETE /api/engagement-actions/:id
app.delete('/api/engagement-actions/:id', (req, res) => {
  try {
    const data = getEngagementActions();
    const idx = data.queue.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Item not found' });
    data.queue.splice(idx, 1);
    saveEngagementActions(data);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete action' });
  }
});

// ============================================================================
// ENGAGEMENT SCANNER (auto-find posts to repost, like, and accounts to follow)
// ============================================================================

const ENGAGEMENT_SCAN_KEYWORDS = [
  'philosophy of life', 'self-knowledge', 'emotional intelligence',
  'personal growth wisdom', 'stoic wisdom', 'existential truth',
  'paradox of life', 'know thyself', 'inner work'
];

async function scanForEngagementTargets() {
  console.log('[EngagementScan] Starting scan for engagement targets...');
  const data = getEngagementActions();
  const followsData = getFollowsTracker();

  // Build dedup sets from queue + completed + follows
  const existingUrls = new Set([
    ...data.queue.map(i => i.targetUrl),
    ...data.completed.map(i => i.targetUrl)
  ]);
  const existingFollows = new Set(
    followsData.follows.map(f => f.handle.toLowerCase())
  );
  // Also check reply queue and comment queue to avoid overlap
  const replyData = getReplyQueue();
  const commentData = getCommentQueue();
  for (const item of [...replyData.queue, ...replyData.posted]) {
    if (item.targetUrl) existingUrls.add(item.targetUrl);
  }
  for (const item of [...commentData.queue, ...commentData.posted]) {
    if (item.targetUrl) existingUrls.add(item.targetUrl);
  }

  const candidates = [];
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // --- Bluesky scan ---
  try {
    const agent = await getBskyAgent();
    const bskyKeywords = ENGAGEMENT_SCAN_KEYWORDS.slice(0, 4);
    for (const keyword of bskyKeywords) {
      try {
        const searchRes = await agent.app.bsky.feed.searchPosts({
          q: keyword,
          limit: 20,
          sort: 'top'
        });
        for (const post of (searchRes.data?.posts || [])) {
          const rkey = post.uri.split('/').pop();
          const postUrl = `https://bsky.app/profile/${post.author.handle}/post/${rkey}`;
          if (post.author.handle === process.env.BLUESKY_HANDLE) continue;
          if (existingUrls.has(postUrl)) continue;
          const postDate = new Date(post.record?.createdAt || post.indexedAt);
          if (postDate < twoDaysAgo) continue;

          const score = (post.likeCount || 0) + ((post.replyCount || 0) * 2) + (post.repostCount || 0);
          candidates.push({
            platform: 'bluesky',
            url: postUrl,
            author: post.author.handle,
            authorFollowers: post.author.followersCount || 0,
            text: (post.record?.text || '').slice(0, 300),
            score,
            likes: post.likeCount || 0,
            reposts: post.repostCount || 0,
            uri: post.uri,
            cid: post.cid
          });
          existingUrls.add(postUrl);
        }
      } catch (err) {
        console.error(`[EngagementScan] Bluesky search "${keyword}" failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('[EngagementScan] Bluesky agent error:', err.message);
  }

  // --- Twitter scan via Bird CLI ---
  try {
    const twitterQueries = ENGAGEMENT_SCAN_KEYWORDS.slice(0, 3);
    for (const query of twitterQueries) {
      try {
        const raw = execFileSync(BIRD_CLI, ['search', query, '-n', '10', '--json'], {
          timeout: 15000,
          encoding: 'utf-8'
        });
        const tweets = JSON.parse(raw);
        for (const tweet of tweets) {
          const tweetUrl = `https://x.com/${tweet.author?.username}/status/${tweet.id}`;
          if (existingUrls.has(tweetUrl)) continue;
          // Skip replies and our own tweets
          if (tweet.inReplyToStatusId) continue;
          if (tweet.author?.username?.toLowerCase() === 'thetensionlines') continue;

          const score = (tweet.likeCount || 0) + ((tweet.replyCount || 0) * 2) + (tweet.retweetCount || 0);
          candidates.push({
            platform: 'twitter',
            url: tweetUrl,
            author: tweet.author?.username || '',
            authorFollowers: 0,
            text: (tweet.text || '').slice(0, 300),
            score,
            likes: tweet.likeCount || 0,
            reposts: tweet.retweetCount || 0
          });
          existingUrls.add(tweetUrl);
        }
      } catch (err) {
        console.error(`[EngagementScan] Twitter search "${query}" failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('[EngagementScan] Bird CLI error:', err.message);
  }

  if (candidates.length === 0) {
    console.log('[EngagementScan] No candidates found');
    return { success: true, added: 0 };
  }

  // Sort by score and take top 20 for Claude to evaluate
  candidates.sort((a, b) => b.score - a.score);
  const topCandidates = candidates.slice(0, 20);

  // --- Use Claude to pick the best engagement actions ---
  let picks = [];
  try {
    const anthropic = getAnthropicClient();
    const candidateList = topCandidates.map((c, i) =>
      `[${i}] @${c.author} (${c.platform}) — score:${c.score}, likes:${c.likes}\n"${c.text}"`
    ).join('\n\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1000,
      system: `You are the engagement strategist for TensionLines, a philosophy-meets-real-life brand. Your job is to pick posts worth engaging with.

Criteria:
- REPOST: High-quality, original thought that aligns with our themes (tension, paradox, self-knowledge, emotional intelligence, growth). Must be something our audience would value. Pick 1-2 max.
- LIKE: Good content, relevant to our space, shows the author we notice them. Pick 3-5.
- FOLLOW: Author creates consistently interesting content in our niche. Only recommend if they seem like a genuine voice (not a bot, not a mega-influencer). Pick 1-2 max.

Skip anything low-effort, spammy, overly promotional, or off-brand. Quality over quantity.`,
      messages: [{
        role: 'user',
        content: `Here are today's candidate posts. For each one you recommend, respond with a JSON array of objects:
{"index": 0, "action": "repost|like|follow", "reason": "brief reason"}

Only include posts worth engaging with. Be selective.

${candidateList}`
      }]
    });

    const text = response.content[0]?.text || '';
    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      picks = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error('[EngagementScan] Claude evaluation failed:', err.message);
    // Fallback: simple heuristic — top 3 by score get liked
    picks = topCandidates.slice(0, 3).map((_, i) => ({ index: i, action: 'like', reason: 'High engagement score' }));
  }

  // --- Add picks to the engagement actions queue ---
  let added = 0;
  const today = new Date().toISOString().slice(0, 10);
  const todayCompleted = data.completed.filter(i => i.completedAt?.startsWith(today)).length;
  const todayQueued = data.queue.length;
  const maxNew = Math.max(0, 15 - todayQueued - todayCompleted); // Cap total at 15/day

  for (const pick of picks.slice(0, maxNew)) {
    const candidate = topCandidates[pick.index];
    if (!candidate) continue;

    // Skip follows for people we already follow
    if (pick.action === 'follow' && existingFollows.has(candidate.author.toLowerCase())) continue;

    const item = {
      id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: pick.action,
      platform: candidate.platform,
      targetUrl: pick.action === 'follow'
        ? (candidate.platform === 'twitter'
          ? `https://x.com/${candidate.author}`
          : `https://bsky.app/profile/${candidate.author}`)
        : candidate.url,
      targetAuthor: candidate.author,
      targetText: candidate.text,
      targetUri: candidate.uri || null,
      targetCid: candidate.cid || null,
      context: pick.reason || '',
      source: 'auto-scan',
      status: 'ready',
      createdAt: new Date().toISOString()
    };

    data.queue.push(item);
    added++;
  }

  if (added > 0) {
    saveEngagementActions(data);
    broadcast('engagement-actions');
  }

  console.log(`[EngagementScan] Done: evaluated ${topCandidates.length} candidates, queued ${added} actions`);
  return { success: true, evaluated: topCandidates.length, added };
}

// Cron: 3x daily at 11 AM, 3 PM, 7 PM PST (offset from comment scan)
cron.schedule('0 11,15,19 * * *', async () => {
  try {
    await scanForEngagementTargets();
    recordCronRun('engagement-scan');
    logSystemEvent('cron', 'Engagement target scan completed');
  } catch (e) {
    console.error('[EngagementScan] Scheduled scan failed:', e.message);
    recordCronRun('engagement-scan', null, e.message);
    logSystemEvent('error', `Engagement scan failed: ${e.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[EngagementScan] Scheduled: 11 AM, 3 PM, 7 PM PST daily');

// ============================================================================
// ENGAGEMENT ACTION EXECUTOR (auto-execute queued likes, reposts, follows)
// ============================================================================

async function executeEngagementActions() {
  console.log('[EngagementExec] Starting execution of queued engagement actions...');
  const data = getEngagementActions();
  const settings = data.settings?.platforms?.bluesky || { enabled: true, maxActionsPerDay: 25 };

  // Count today's completed actions for bluesky
  const today = new Date().toISOString().slice(0, 10);
  const todayCompleted = data.completed.filter(
    i => i.platform === 'bluesky' && i.completedAt?.startsWith(today)
  ).length;
  const remaining = Math.max(0, (settings.maxActionsPerDay || 25) - todayCompleted);

  if (remaining === 0) {
    console.log('[EngagementExec] Daily limit reached for bluesky, skipping');
    return { success: true, executed: 0, reason: 'daily limit reached' };
  }

  // Filter ready bluesky actions
  const readyActions = data.queue.filter(i => i.status === 'ready' && i.platform === 'bluesky');
  if (readyActions.length === 0) {
    console.log('[EngagementExec] No ready bluesky actions in queue');
    return { success: true, executed: 0, reason: 'no ready actions' };
  }

  const toExecute = readyActions.slice(0, remaining);
  let executed = 0;
  let failed = 0;

  let agent;
  try {
    agent = await getBskyAgent();
  } catch (err) {
    console.error('[EngagementExec] Failed to get Bluesky agent:', err.message);
    return { success: false, error: 'Bluesky auth failed' };
  }

  for (const action of toExecute) {
    try {
      if (action.type === 'like') {
        if (!action.targetUri || !action.targetCid) {
          throw new Error('Missing targetUri or targetCid for like action');
        }
        await agent.like(action.targetUri, action.targetCid);
      } else if (action.type === 'repost') {
        if (!action.targetUri || !action.targetCid) {
          throw new Error('Missing targetUri or targetCid for repost action');
        }
        await agent.repost(action.targetUri, action.targetCid);
      } else if (action.type === 'follow') {
        const handle = (action.targetAuthor || '').replace(/^@/, '');
        if (!handle) throw new Error('Missing targetAuthor for follow action');
        const resolved = await agent.resolveHandle({ handle });
        await agent.follow(resolved.data.did);
      } else {
        console.log(`[EngagementExec] Unknown action type: ${action.type}, skipping`);
        continue;
      }

      // Success: move to completed
      const idx = data.queue.findIndex(i => i.id === action.id);
      if (idx !== -1) {
        const item = data.queue.splice(idx, 1)[0];
        item.status = 'completed';
        item.completedAt = new Date().toISOString();
        item.executedBy = 'auto';
        data.completed.unshift(item);

        // Log follows to follows-tracker
        if (item.type === 'follow') {
          const followsData = getFollowsTracker();
          const cleanHandle = (item.targetAuthor || '').replace(/^@/, '');
          const exists = followsData.follows.find(
            f => f.handle.toLowerCase() === cleanHandle.toLowerCase() && f.platform === 'bluesky'
          );
          if (!exists) {
            followsData.follows.push({
              handle: cleanHandle,
              platform: 'bluesky',
              followedAt: item.completedAt,
              source: 'auto-engagement',
              context: item.context || item.targetText || ''
            });
            saveFollowsTracker(followsData);
          }
        }

        executed++;
        console.log(`[EngagementExec] ${action.type} OK: @${action.targetAuthor} (${action.targetUrl})`);
      }
    } catch (err) {
      console.error(`[EngagementExec] ${action.type} FAILED for @${action.targetAuthor}:`, err.message);
      action.status = 'failed';
      action.error = err.message;
      action.failedAt = new Date().toISOString();
      failed++;
    }

    // Delay 3-5 seconds between actions to avoid rate limits
    if (toExecute.indexOf(action) < toExecute.length - 1) {
      const delay = 3000 + Math.random() * 2000;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  saveEngagementActions(data);
  if (executed > 0) broadcast('engagement-actions');

  console.log(`[EngagementExec] Done: ${executed} executed, ${failed} failed`);
  return { success: true, executed, failed };
}

// Cron: 15 min after each scan (11:15 AM, 3:15 PM, 7:15 PM PST)
cron.schedule('15 11,15,19 * * *', async () => {
  try {
    await executeEngagementActions();
    recordCronRun('engagement-execute');
    logSystemEvent('cron', 'Engagement actions executed');
  } catch (e) {
    console.error('[EngagementExec] Scheduled execution failed:', e.message);
    recordCronRun('engagement-execute', null, e.message);
    logSystemEvent('error', `Engagement execution failed: ${e.message}`);
  }
}, { timezone: 'America/Los_Angeles' });
console.log('[EngagementExec] Scheduled: 11:15 AM, 3:15 PM, 7:15 PM PST daily');

// ============================================================================
// SYSTEM API ENDPOINTS (Mission Control Dashboard)
// ============================================================================

app.get('/api/system/events', (req, res) => {
  try {
    const typeFilter = req.query.type;
    let events = systemEventLog.slice().reverse();
    if (typeFilter) {
      events = events.filter(e => e.type === typeFilter);
    }
    res.json({ events: events.slice(0, 50) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/system/crons', (req, res) => {
  try {
    const crons = Object.values(cronRegistry);
    res.json({ crons });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function getApprovalQueue() {
  try {
    if (fs.existsSync(APPROVAL_QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(APPROVAL_QUEUE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading approval queue:', e);
  }
  return { approvals: [] };
}

function saveApprovalQueue(data) {
  fs.writeFileSync(APPROVAL_QUEUE_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/system/approvals', (req, res) => {
  try {
    const data = getApprovalQueue();
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/system/approvals/:id/decide', (req, res) => {
  try {
    const { id } = req.params;
    const { decision } = req.body;
    if (!['approved', 'denied'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be "approved" or "denied"' });
    }

    const data = getApprovalQueue();
    const approval = data.approvals.find(a => a.id === id);
    if (!approval) {
      return res.status(404).json({ error: 'Approval not found' });
    }

    approval.decision = decision;
    approval.decidedAt = new Date().toISOString();
    saveApprovalQueue(data);

    logSystemEvent('debug', `Approval ${id} ${decision}: ${approval.description || approval.taskId}`, { approvalId: id, decision });

    res.json({ success: true, approval });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

async function start() {
  // Create Vite dev server in middleware mode
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  // Block access to backup files and other sensitive patterns
  app.use('/mission-control', (req, res, next) => {
    const blockedPatterns = ['.backup', '.bak', '.old', '.orig', '.tmp', '~'];
    const requestPath = req.path.toLowerCase();
    if (blockedPatterns.some(p => requestPath.includes(p))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  });

  // Serve Mission Control data files (JSON, etc.) but NOT index.html
  // The React SPA now handles /mission-control route via Vite
  const MISSION_CONTROL_DIR = path.join(BASE_DIR, 'mission-control');
  app.use('/mission-control', (req, res, next) => {
    // Skip index.html — let Vite serve the React SPA for /mission-control
    if (req.path === '/' || req.path === '/index.html') return next();
    return express.static(MISSION_CONTROL_DIR, {
      dotfiles: 'ignore',
      index: false,
      extensions: ['json', 'md'],
      setHeaders: (res, filePath) => {
        res.set('X-Content-Type-Options', 'nosniff');
        if (filePath.endsWith('.json')) {
          res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
      }
    })(req, res, next);
  });

  // Vite dev middleware (handles React HMR, module serving, etc.)
  app.use(vite.middlewares);

  server.listen(PORT, 'localhost', () => {
    console.log(`\nTensionLines CMS (unified server)`);
    console.log(`  App:             http://localhost:${PORT}/`);
    console.log(`  API:             http://localhost:${PORT}/api/health`);
    console.log(`  WebSocket:       ws://localhost:${PORT}/ws`);
    console.log(`  Mission Control: http://localhost:${PORT}/mission-control/`);
    console.log(`  Bound to localhost only (not accessible from network)`);
    console.log(`  Watching files for changes...\n`);

    // Initialize Telegram bot if token is configured
    initTelegramBot();
  });
}

// ============================================================================
// TELEGRAM BOT - Idea Capture
// ============================================================================

function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('  Telegram bot: disabled (no TELEGRAM_BOT_TOKEN in .env)');
    return;
  }

  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  const bot = new TelegramBot(token, { polling: true });

  bot.on('polling_error', (err) => {
    console.error('[Telegram] Polling error:', err.message);
  });

  bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);

    // Security: only accept messages from allowed chat
    if (allowedChatId && chatId !== allowedChatId) {
      console.log(`[Telegram] Ignored message from unauthorized chat: ${chatId}`);
      return;
    }

    const text = msg.text?.trim();
    if (!text) return;

    // Check if message starts with "Idea" (case-insensitive)
    const ideaMatch = text.match(/^idea[:\s]+(.+)/is);
    if (!ideaMatch) {
      // If no TELEGRAM_CHAT_ID set yet, help them configure it
      if (!allowedChatId) {
        bot.sendMessage(chatId, `Your chat ID is: ${chatId}\nAdd TELEGRAM_CHAT_ID=${chatId} to your .env file.`);
        return;
      }

      // Non-idea messages become directives/notes in the CMS
      try {
        const mc = getMissionControl();
        mc.notifications.push({
          id: `notif-tg-${Date.now()}`,
          type: 'telegram_directive',
          title: 'Telegram from Shawn',
          message: text,
          from: 'human',
          to: ['tension'],
          createdAt: new Date().toISOString(),
          read: false,
          priority: 'medium',
          actionRequired: true,
          metadata: { source: 'telegram' }
        });
        fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
        cache.missionControl = null;
        broadcast('notifications');
        broadcast('tasks');
        console.log(`[Telegram] Directive received: "${text.substring(0, 60)}..."`);
        bot.sendMessage(chatId, `Got it. Added as a directive in the CMS.`);
      } catch (err) {
        console.error('[Telegram] Error saving directive:', err);
        bot.sendMessage(chatId, 'Failed to save. Check server logs.');
      }
      return;
    }

    const ideaText = ideaMatch[1].trim();
    if (!ideaText) {
      bot.sendMessage(chatId, 'Please include your idea after "Idea". Example:\nIdea: The tension between knowing and doing');
      return;
    }

    try {
      // Use the same logic as POST /api/ideas
      const ideas = parseIdeasBank();
      const maxId = ideas.reduce((max, idea) => {
        const num = parseInt(idea.id, 10);
        return num > max ? num : max;
      }, 0);
      const nextId = String(maxId + 1).padStart(3, '0');

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles'
      }) + ' PST';
      const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

      const content = fs.readFileSync(IDEAS_BANK, 'utf8');
      const dateSectionExists = content.includes(`## ${dateStr}`);

      let entry = '';
      if (!dateSectionExists) {
        entry += `\n## ${dateStr}\n`;
      }
      entry += `\n### #${nextId} - ${timeStr}\n`;
      entry += `**Quote:** "${ideaText}"\n`;
      entry += `**Tags:** \n`;
      entry += `**Status:** 🔵 New\n`;
      entry += `**Source:** telegram\n`;
      entry += '\n---\n';

      fs.appendFileSync(IDEAS_BANK, entry);
      cache.ideasBank = null;
      broadcast('ideas');

      console.log(`[Telegram] Idea #${nextId} captured: "${ideaText.substring(0, 60)}..."`);
      bot.sendMessage(chatId, `Captured as idea #${nextId}\n"${ideaText.substring(0, 100)}${ideaText.length > 100 ? '...' : ''}"`);
      logSystemEvent('pipeline', `Idea #${nextId} captured via Telegram`, { ideaId: nextId });

      // Fire-and-forget: auto-tag + agent takes
      processNewIdea(nextId, ideaText).catch(err =>
        console.error('[Ideas] Background processing failed:', err.message)
      );

      // Auto-complete the weekly idea task if goal is now met
      try {
        const mc = getMissionControl();
        if (syncWeeklyIdeaTask(mc)) {
          fs.writeFileSync(MISSION_CONTROL_DB, JSON.stringify(mc, null, 2));
          cache.missionControl = null;
          broadcast('tasks');
        }
      } catch (e) { /* non-critical */ }
    } catch (err) {
      console.error('[Telegram] Error capturing idea:', err);
      bot.sendMessage(chatId, 'Failed to capture idea. Check server logs.');
    }
  });

  console.log('  Telegram bot: active (listening for ideas)');
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
