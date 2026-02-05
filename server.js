#!/usr/bin/env node

/**
 * TensionLines CMS - API Server
 * 
 * Lightweight Express server that reads from existing files
 * and provides REST API for the React frontend.
 */

import express from 'express';
import cors from 'cors';
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

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

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
  
  for (const line of lines) {
    // Match idea headers like "### #001 - 06:42 AM PST" or "## 001 | 2026-02-02 14:30 PST"
    const headerMatch = line.match(/^###?\s+#?(\d+)\s+[-|]\s+(.+)/);
    if (headerMatch) {
      if (currentIdea) ideas.push(currentIdea);
      currentIdea = {
        id: headerMatch[1],
        capturedAt: headerMatch[2].trim(),
        text: '',
        quote: '',
        tags: [],
        status: 'captured'
      };
      continue;
    }
    
    // Match quote like "**Quote:** ..." or "**Quote (original):** ..." or "**Quote (refined):** ..."
    const quoteMatch = line.match(/\*\*Quote.*?:\*\*\s+(.+)/);
    if (quoteMatch && currentIdea) {
      // Use refined quote if available, otherwise use original
      if (line.includes('(refined)') || !currentIdea.quote) {
        currentIdea.quote = quoteMatch[1].replace(/^"|"$/g, '');
        currentIdea.text = currentIdea.quote; // Use quote as text
      }
      continue;
    }
    
    // Match tags like "**Tags:** #balance #movement"
    const tagsMatch = line.match(/\*\*Tags:\*\*\s+(.+)/);
    if (tagsMatch && currentIdea) {
      currentIdea.tags = tagsMatch[1].split(/\s+/).filter(t => t.startsWith('#')).map(t => t.substring(1));
      continue;
    }
    
    // Match status like "**Status:** 🔵 New" or "**Status:** Captured → Assigned"
    const statusMatch = line.match(/\*\*Status:\*\*\s+(.+)/);
    if (statusMatch && currentIdea) {
      const status = statusMatch[1].toLowerCase();
      if (status.includes('🟢') || status.includes('used') || status.includes('shipped')) {
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
  }
  
  if (currentIdea) ideas.push(currentIdea);

  cache.ideasBank = ideas;
  return ideas;
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
        path: fullPath,
        content: content,
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
        path: fullPath,
        platform: platform,
        content: parsed.content,
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
        url: `/tasks/${task.id}`
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
    chapter.content = fs.readFileSync(chapterPath, 'utf8');
    chapter.wordCount = chapter.content.split(/\s+/).filter(w => w).length;
  }
  
  // Get chapter outline from MASTER_OUTLINE.md
  const outlinePath = path.join(bookDir, 'outline/MASTER_OUTLINE.md');
  if (fs.existsSync(outlinePath)) {
    const content = fs.readFileSync(outlinePath, 'utf8');
    const lines = content.split('\n');
    
    let inChapter = false;
    let outlineLines = [];
    
    for (const line of lines) {
      if (line.match(new RegExp(`^####\\s+Chapter\\s+${chapterNum}:`))) {
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
    res.json(mc.agents);
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Internal server error' });
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

/**
 * Get tasks (with optional filters)
 */
app.get('/api/tasks', (req, res) => {
  try {
    const mc = getMissionControl();
    let tasks = mc.tasks;
    
    // Filter by status
    if (req.query.status) {
      tasks = tasks.filter(t => t.status === req.query.status);
    }
    
    // Filter by assignee
    if (req.query.assignee) {
      tasks = tasks.filter(t => t.assigneeIds.includes(req.query.assignee));
    }
    
    // Filter by reviewer
    if (req.query.reviewer) {
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
 * Complete a task (for human tasks)
 */
app.post('/api/tasks/:id/complete', (req, res) => {
  try {
    const { id } = req.params;
    const { completedBy } = req.body;

    const data = getMissionControl();
    const task = data.tasks.find(t => t.id === id);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Update task status
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.completedBy = completedBy || 'human';

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
 * Get all drafts
 */
app.get('/api/drafts', (req, res) => {
  try {
    let drafts = getPhilosopherDrafts();
    
    // Filter by platform
    if (req.query.platform) {
      drafts = drafts.filter(d => d.platform === req.query.platform);
    }
    
    // Filter by philosopher
    if (req.query.philosopher) {
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
    
    if (!query || query.length < 2) {
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
// START SERVER
// ============================================================================

async function start() {
  // Create Vite dev server in middleware mode
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  // Serve Mission Control static files
  const MISSION_CONTROL_DIR = path.join(BASE_DIR, 'mission-control');
  app.use('/mission-control', express.static(MISSION_CONTROL_DIR));

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
