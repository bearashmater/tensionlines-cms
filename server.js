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
import matter from 'gray-matter';
import chokidar from 'chokidar';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5173;
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
const IDEAS_BANK = path.join(BASE_DIR, 'content/ideas-bank.md');
const MEMORY_DIR = path.join(BASE_DIR, 'memory');
const PHILOSOPHERS_DIR = path.join(BASE_DIR, 'philosophers');
const BOOKS_DIR = path.join(BASE_DIR, 'books');
const POSTING_SCHEDULE = path.join(BASE_DIR, 'POSTING_SCHEDULE.md');

// Cache for frequently accessed data - invalidated by chokidar watcher
let cache = {
  missionControl: null,
  ideasBank: null,
  memoryFiles: null,
  drafts: null,
  booksProgress: null,
  postingSchedule: null,
  recurringTasks: null,
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
  
  // Thresholds (in hours)
  const thresholds = {
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

// Valid filter values
const VALID_STATUSES = ['assigned', 'in_progress', 'review', 'completed', 'shipped', 'blocked'];
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
    
    // Add time-in-status calculation to each task
    tasks = tasks.map(task => ({
      ...task,
      timeTracking: calculateTimeInStatus(task)
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
    
    // Add time-in-status calculation
    const taskWithTracking = {
      ...task,
      timeTracking: calculateTimeInStatus(task)
    };
    
    res.json(taskWithTracking);
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
      threads: posted.filter(p => p.postedAt?.startsWith(today) && p.platform === 'threads').length
    };

    // Check rate limits
    const instagramSettings = settings.platforms?.instagram || { maxPostsPerDay: 2 };
    const threadsSettings = settings.platforms?.threads || { maxPostsPerDay: 3 };

    res.json({
      ...queue,
      postsToday,
      canPostInstagram: postsToday.instagram < instagramSettings.maxPostsPerDay,
      canPostThreads: postsToday.threads < threadsSettings.maxPostsPerDay
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
    const item = {
      id: `post-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'ready',
      ...req.body
    };

    // Validate required fields
    if (!item.platform || !['instagram', 'threads'].includes(item.platform)) {
      return res.status(400).json({ error: 'Invalid platform' });
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

    // Get start of current week (Sunday)
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
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

    // Weekly goal tracking
    const weeklyGoal = 4;
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
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

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
  `${BOOKS_DIR}/*/chapters/*.md`
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

// Track which tasks have been notified to avoid spam
const notifiedStuckTasks = new Set();

function checkStuckTasks() {
  try {
    const mc = getMissionControl();
    const activeTasks = mc.tasks.filter(t => 
      ['assigned', 'in_progress', 'review'].includes(t.status)
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
      
      // Skip if already notified
      if (notifiedStuckTasks.has(notifKey)) {
        return;
      }
      
      // Create notification
      const notification = {
        id: `notif-stuck-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'stuck_task',
        title: `🚨 Task Stuck: ${task.title}`,
        message: `Task #${task.id} has been in "${task.status}" status for ${task.timeTracking.timeInStatusHuman}. Assigned to: ${task.assigneeIds.join(', ')}. Consider intervention or reassignment.`,
        from: 'system',
        to: ['tension', ...task.assigneeIds],
        createdAt: new Date().toISOString(),
        read: false,
        priority: 'critical',
        actionRequired: true,
        metadata: {
          taskId: task.id,
          timeInStatus: task.timeTracking.timeInStatusHuman,
          alertLevel: 'red'
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
