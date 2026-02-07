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
import matter from 'gray-matter';
import chokidar from 'chokidar';
import cron from 'node-cron';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createServer as createViteServer } from 'vite';
import { BskyAgent, RichText } from '@atproto/api';

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
  }
  cache.lastUpdate = new Date().toISOString();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

    // Match tags
    const tagsMatch = line.match(/\*\*Tags:\*\*\s+(.+)/);
    if (tagsMatch) {
      saveSection();
      currentIdea.tags = tagsMatch[1].split(/\s+/).filter(t => t.startsWith('#')).map(t => t.substring(1));
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
      'human': 'human'
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

  if (progress >= goal && task.status === 'in_progress') {
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
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
      bluesky: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'bluesky').length
    };

    // Check rate limits
    const instagramSettings = settings.platforms?.instagram || { maxPostsPerDay: 2 };
    const threadsSettings = settings.platforms?.threads || { maxPostsPerDay: 3 };
    const blueskySettings = settings.platforms?.bluesky || { maxPostsPerDay: 5 };

    res.json({
      ...queue,
      postsToday,
      canPostInstagram: postsToday.instagram < instagramSettings.maxPostsPerDay,
      canPostThreads: postsToday.threads < threadsSettings.maxPostsPerDay,
      canPostBluesky: postsToday.bluesky < blueskySettings.maxPostsPerDay
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
    const { platform, content, caption, parts, canvaComplete } = req.body;

    // Validate required fields
    if (!platform || !['instagram', 'threads', 'bluesky'].includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
    }

    const item = {
      id: `post-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'ready',
      platform,
      content: content || '',
      caption: caption || '',
      parts: Array.isArray(parts) ? parts : [],
      canvaComplete: canvaComplete === true
    };

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
    const allowedFields = ['canvaComplete', 'status', 'content', 'caption', 'parts'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        item[field] = req.body[field];
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
    if (item.platform !== 'bluesky') {
      return res.status(400).json({ error: 'Only Bluesky posts can be auto-published' });
    }

    // Server-side rate limit enforcement
    const settings = queue.settings?.platforms?.bluesky || {};
    const maxPerDay = settings.maxPostsPerDay || 3;
    const minHours = settings.minHoursBetweenPosts || 2;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const posted = queue.posted || [];
    const bskyPostedToday = posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'bluesky');

    if (bskyPostedToday.length >= maxPerDay) {
      return res.status(429).json({ error: `Daily limit reached (${maxPerDay} posts/day)` });
    }

    if (bskyPostedToday.length > 0) {
      const lastPostedAt = new Date(bskyPostedToday[0].postedAt);
      const hoursSinceLast = (now - lastPostedAt) / (1000 * 60 * 60);
      if (hoursSinceLast < minHours) {
        const waitMins = Math.ceil((minHours * 60) - (hoursSinceLast * 60));
        return res.status(429).json({ error: `Too soon — wait ${waitMins} more minutes (${minHours}h minimum between posts)` });
      }
    }

    const result = await postToBluesky(item.content);

    item.status = 'posted';
    item.postedAt = new Date().toISOString();
    item.postUrl = result.postUrl;
    item.bskyUri = result.uri;

    queue.queue.splice(idx, 1);
    if (!queue.posted) queue.posted = [];
    queue.posted.unshift(item);
    savePostingQueue(queue);

    console.log(`[Bluesky] Published: ${result.postUrl}`);
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
    console.error('[Bluesky] Publish failed:', error.message);
    res.status(500).json({ error: 'Failed to publish', message: error.message });
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
    res.json(ideas);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
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
    if (cache.recurringTasks) {
      return res.json(cache.recurringTasks);
    }
    const recurringTasksPath = path.join(BASE_DIR, 'mission-control/recurring-tasks.json');

    if (!fs.existsSync(recurringTasksPath)) {
      return res.json({ recurringTasks: [] });
    }

    const data = fs.readFileSync(recurringTasksPath, 'utf8');
    cache.recurringTasks = JSON.parse(data);
    res.json(cache.recurringTasks);
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

    if (task.status !== 'assigned' && task.status !== 'in_progress') {
      return res.status(400).json({ error: 'Only assigned or in-progress tasks can be dispatched' });
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
  } catch (err) {
    console.error('[Cron] Backup failed:', err);
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
    res.status(500).json({ error: error.message });
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
  } catch (err) {
    console.error('[Cron] Optimization failed:', err);
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
  } catch (err) {
    console.error('[Cron] Daily summary failed:', err);
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
  } catch (err) {
    console.error('[Cron] Repost conversion failed:', err);
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
  } catch (err) {
    console.error('[Cron] Weekly reset error:', err);
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

cron.schedule('0 6 * * *', () => {
  console.log('[Cron] Running daily Twitter metrics snapshot...');
  snapshotTwitterMetrics();
}, {
  timezone: 'America/Los_Angeles'
});

console.log('[Cron] Daily Twitter metrics snapshot scheduled for 6:00 AM PST');

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

  // Serve Mission Control static files with security options
  const MISSION_CONTROL_DIR = path.join(BASE_DIR, 'mission-control');
  app.use('/mission-control', express.static(MISSION_CONTROL_DIR, {
    dotfiles: 'ignore',
    index: 'index.html',
    extensions: ['html', 'json', 'md', 'css', 'js'],
    setHeaders: (res, filePath) => {
      res.set('X-Content-Type-Options', 'nosniff');
      if (filePath.endsWith('.json')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    }
  }));

  // Vite dev middleware (handles React HMR, module serving, etc.)
  app.use(vite.middlewares);

  app.listen(PORT, 'localhost', () => {
    console.log(`\nTensionLines CMS (unified server)`);
    console.log(`  App:             http://localhost:${PORT}/`);
    console.log(`  API:             http://localhost:${PORT}/api/health`);
    console.log(`  Mission Control: http://localhost:${PORT}/mission-control/`);
    console.log(`  Bound to localhost only (not accessible from network)`);
    console.log(`  Watching files for changes...\n`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
