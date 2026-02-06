#!/usr/bin/env node
/**
 * Aggregate OpenClaw API costs from session files
 * Reads session .jsonl files and updates daily-costs.json
 * Also saves detailed request data for drill-down views
 *
 * Run: node scripts/aggregate-costs.cjs
 * Cron: 5 * * * * (runs hourly at :05)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw/agents/main/sessions');
const COSTS_FILE = path.join('/Users/admin/clawd/cost-tracking/daily-costs.json');
const DETAILS_FILE = path.join('/Users/admin/clawd/cost-tracking/daily-details.json');

async function parseSessionFile(filePath, sessionId) {
  const costs = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let sessionInfo = {};

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);

      // Capture session info
      if (entry.type === 'session') {
        sessionInfo = {
          sessionId: entry.id,
          cwd: entry.cwd
        };
      }

      // Capture message channel (telegram, etc)
      if (entry.customType === 'openclaw.message-channel') {
        sessionInfo.channel = entry.data?.channel;
      }

      if (entry.type === 'message' && entry.message?.usage?.cost) {
        const ts = new Date(entry.timestamp);

        // Try to extract context from thinking or content
        let context = '';
        const content = entry.message.content || [];
        for (const item of content) {
          if (item.type === 'thinking' && item.thinking) {
            // Get first 100 chars of thinking
            context = item.thinking.substring(0, 150).replace(/\n/g, ' ');
            break;
          }
          if (item.type === 'text' && item.text) {
            context = item.text.substring(0, 150).replace(/\n/g, ' ');
            break;
          }
          if (item.type === 'toolCall') {
            context = `Tool: ${item.name}`;
            if (item.arguments?.path) context += ` - ${item.arguments.path}`;
            break;
          }
        }

        costs.push({
          id: entry.id,
          timestamp: ts.toISOString(),
          date: ts.toISOString().split('T')[0],
          time: ts.toTimeString().split(' ')[0],
          provider: entry.message.provider || 'unknown',
          model: entry.message.model || 'unknown',
          sessionId: sessionInfo.sessionId || sessionId,
          channel: sessionInfo.channel || 'unknown',
          tokens: {
            input: entry.message.usage.input || 0,
            output: entry.message.usage.output || 0,
            cacheRead: entry.message.usage.cacheRead || 0,
            cacheWrite: entry.message.usage.cacheWrite || 0,
            total: entry.message.usage.totalTokens || 0
          },
          cost: entry.message.usage.cost.total || 0,
          stopReason: entry.message.stopReason || 'unknown',
          context: context || 'No context'
        });
      }
    } catch (e) {
      // Skip malformed lines
    }
  }
  return costs;
}

async function aggregateCosts() {
  const today = new Date().toISOString().split('T')[0];
  const todayStart = new Date(today + 'T00:00:00Z');

  console.log(`Aggregating costs for ${today}...`);

  // Get all session files modified today
  const files = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      name: f,
      path: path.join(SESSIONS_DIR, f),
      mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtime
    }))
    .filter(f => f.mtime >= todayStart);

  console.log(`Found ${files.length} session files from today`);

  // Parse all session files
  const allCosts = [];
  for (const file of files) {
    const sessionId = file.name.replace('.jsonl', '');
    const costs = await parseSessionFile(file.path, sessionId);
    const todayCosts = costs.filter(c => c.date === today);
    allCosts.push(...todayCosts);
  }

  // Sort by timestamp
  allCosts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  console.log(`Found ${allCosts.length} API calls with cost data`);

  // Aggregate by model
  const byModel = {};
  for (const cost of allCosts) {
    const modelKey = `${cost.provider}/${cost.model}`;
    if (!byModel[modelKey]) {
      byModel[modelKey] = {
        name: cost.model,
        provider: cost.provider,
        cost: 0,
        requests: 0,
        tokens: 0,
        details: []
      };
    }
    byModel[modelKey].cost += cost.cost;
    byModel[modelKey].requests += 1;
    byModel[modelKey].tokens += cost.tokens.total;
    byModel[modelKey].details.push({
      id: cost.id,
      time: cost.time,
      timestamp: cost.timestamp,
      cost: cost.cost,
      tokens: cost.tokens.total,
      input: cost.tokens.input,
      output: cost.tokens.output,
      cacheRead: cost.tokens.cacheRead,
      context: cost.context,
      channel: cost.channel,
      stopReason: cost.stopReason
    });
  }

  // Calculate totals
  const totalCost = allCosts.reduce((sum, c) => sum + c.cost, 0);
  const totalRequests = allCosts.length;

  // Read existing costs file
  let existingData = {
    daily: { date: today, total: 0, budget: 2, requests: 0 },
    models: [],
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

  if (fs.existsSync(COSTS_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(COSTS_FILE, 'utf8'));
    } catch (e) {
      console.warn('Could not parse existing costs file, using defaults');
    }
  }

  // Helper to get display name
  const getDisplayName = (model) => {
    if (model === 'claude-sonnet-4-5') return 'Claude Sonnet 4.5';
    if (model === 'claude-opus-4-5') return 'Claude Opus 4.5';
    if (model === 'claude-3-5-haiku-20241022') return 'Claude Haiku 3.5';
    if (model.includes('qwen')) return `Ollama ${model}`;
    return model;
  };

  // Update daily data
  existingData.daily = {
    date: today,
    total: Math.round(totalCost * 100) / 100,
    budget: existingData.daily?.budget || 2,
    requests: totalRequests
  };

  // Update models (without details - details go in separate file)
  existingData.models = Object.values(byModel).map(m => ({
    name: getDisplayName(m.name),
    modelId: m.name,
    provider: m.provider,
    cost: Math.round(m.cost * 10000) / 10000,
    requests: m.requests,
    tokens: m.tokens,
    total: Math.round(m.cost * 10000) / 10000
  }));

  // Ensure Ollama shows up even with 0 cost
  const hasOllama = existingData.models.some(m => m.name.includes('Ollama'));
  if (!hasOllama) {
    existingData.models.push({
      name: 'Ollama qwen2.5:3b',
      modelId: 'qwen2.5:3b',
      provider: 'ollama',
      cost: 0,
      requests: 0,
      tokens: 0,
      total: 0
    });
  }

  // Update weekly (today's day)
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, etc
  const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Mon=0
  existingData.weekly[dayIndex].cost = Math.round(totalCost * 100) / 100;

  // Write updated costs (summary)
  fs.writeFileSync(COSTS_FILE, JSON.stringify(existingData, null, 2));

  // Write detailed data (for drill-down)
  const detailsData = {
    date: today,
    updatedAt: new Date().toISOString(),
    totalRequests: totalRequests,
    totalCost: Math.round(totalCost * 10000) / 10000,
    models: Object.fromEntries(
      Object.entries(byModel).map(([key, m]) => [
        getDisplayName(m.name),
        {
          modelId: m.name,
          provider: m.provider,
          cost: Math.round(m.cost * 10000) / 10000,
          requests: m.requests,
          tokens: m.tokens,
          details: m.details.map(d => ({
            ...d,
            cost: Math.round(d.cost * 10000) / 10000
          }))
        }
      ])
    )
  };
  fs.writeFileSync(DETAILS_FILE, JSON.stringify(detailsData, null, 2));

  console.log('\n=== Cost Summary ===');
  console.log(`Date: ${today}`);
  console.log(`Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`Total Requests: ${totalRequests}`);
  console.log('\nBy Model:');
  for (const [key, model] of Object.entries(byModel)) {
    console.log(`  ${key}: $${model.cost.toFixed(4)} (${model.requests} requests, ${model.tokens} tokens)`);
  }
  console.log(`\nUpdated: ${COSTS_FILE}`);
  console.log(`Details: ${DETAILS_FILE}`);
}

aggregateCosts().catch(console.error);
