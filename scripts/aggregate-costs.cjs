#!/usr/bin/env node
/**
 * Aggregate OpenClaw API costs from session files
 * Reads session .jsonl files and updates daily-costs.json
 *
 * Run: node scripts/aggregate-costs.js
 * Or set up as cron: openclaw cron add --schedule "0 * * * *" --command "node /Users/admin/clawd/scripts/aggregate-costs.js"
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw/agents/main/sessions');
const COSTS_FILE = path.join('/Users/admin/clawd/cost-tracking/daily-costs.json');

async function parseSessionFile(filePath) {
  const costs = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'message' && entry.message?.usage?.cost) {
        const ts = new Date(entry.timestamp);
        costs.push({
          timestamp: ts,
          date: ts.toISOString().split('T')[0],
          provider: entry.message.provider || 'unknown',
          model: entry.message.model || 'unknown',
          tokens: {
            input: entry.message.usage.input || 0,
            output: entry.message.usage.output || 0,
            cacheRead: entry.message.usage.cacheRead || 0,
            cacheWrite: entry.message.usage.cacheWrite || 0,
            total: entry.message.usage.totalTokens || 0
          },
          cost: entry.message.usage.cost.total || 0
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
    const costs = await parseSessionFile(file.path);
    const todayCosts = costs.filter(c => c.date === today);
    allCosts.push(...todayCosts);
  }

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
        tokens: 0
      };
    }
    byModel[modelKey].cost += cost.cost;
    byModel[modelKey].requests += 1;
    byModel[modelKey].tokens += cost.tokens.total;
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

  // Update daily data
  existingData.daily = {
    date: today,
    total: Math.round(totalCost * 100) / 100,
    budget: existingData.daily?.budget || 2,
    requests: totalRequests
  };

  // Update models
  existingData.models = Object.values(byModel).map(m => ({
    name: m.name === 'claude-sonnet-4-5' ? 'Claude Sonnet 4.5' :
          m.name === 'claude-opus-4-5' ? 'Claude Opus 4.5' :
          m.name === 'claude-3-5-haiku-20241022' ? 'Claude Haiku 3.5' :
          m.name.includes('qwen') ? `Ollama ${m.name}` : m.name,
    cost: Math.round(m.cost * 100) / 100,
    requests: m.requests,
    tokens: m.tokens,
    total: Math.round(m.cost * 100) / 100
  }));

  // Ensure Ollama shows up even with 0 cost
  const hasOllama = existingData.models.some(m => m.name.includes('Ollama'));
  if (!hasOllama) {
    existingData.models.push({
      name: 'Ollama qwen2.5:3b',
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

  // Write updated costs
  fs.writeFileSync(COSTS_FILE, JSON.stringify(existingData, null, 2));

  console.log('\n=== Cost Summary ===');
  console.log(`Date: ${today}`);
  console.log(`Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`Total Requests: ${totalRequests}`);
  console.log('\nBy Model:');
  for (const [key, model] of Object.entries(byModel)) {
    console.log(`  ${key}: $${model.cost.toFixed(4)} (${model.requests} requests, ${model.tokens} tokens)`);
  }
  console.log(`\nUpdated: ${COSTS_FILE}`);
}

aggregateCosts().catch(console.error);
