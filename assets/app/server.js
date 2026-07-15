#!/usr/bin/env node
const path = require('path');
const { execSync } = require('child_process');
const express = require('express');
const open = require('open');
const { getSessionSummary, getSessionFileDiff, resolveSessionId, listSessionCards, finalizeSessionInsights } = require('./lib/session-diff');
const { loadSession, revertFiles, revertFile } = require('./lib/session-store');

function parseArgs(argv) {
  const args = {
    port: Number(process.env.PORT) || 3847,
    host: process.env.HOST || '127.0.0.1',
    open: false,
    session: process.env.CODEX_DIFF_SESSION || 'latest',
    help: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--open' || a === '-o') args.open = true;
    else if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a === '--host') args.host = argv[++i];
    else if (a === '--session' || a === '-s') args.session = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) args.session = a;
  }
  return args;
}

function printHelp() {
  console.log(`
Codex Session Diff Viewer

用法:
  node server.js [--session <id|latest>] [--port 3847] [--open]

说明:
  仅展示“本次会话”相对 begin 基线的变更，不是 git working tree diff。
  前端可通过 /api/sessions 切换历史会话。
  默认单实例：若端口被占用，会结束旧进程后复用同一端口（不递增端口）。
`);
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findListenerPids(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(
      out
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid),
    )];
  } catch {
    return [];
  }
}

function killPids(pids, signal = 'SIGTERM') {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

function findExistingViewerPids() {
  try {
    // 结束所有本项目 server.js 实例（含历史递增端口残留）
    const out = execSync("pgrep -f 'codex-session-diff-viewer/assets/app/server.js' || true", {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(
      out
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid),
    )];
  } catch {
    return [];
  }
}

async function freePort(port, { rounds = 8, waitMs = 120 } = {}) {
  for (let i = 0; i < rounds; i += 1) {
    const portPids = findListenerPids(port);
    const viewerPids = findExistingViewerPids();
    const pids = [...new Set([...portPids, ...viewerPids])];
    if (!pids.length) return { freed: true, pids: [] };
    if (i === 0) {
      console.warn(`检测到旧查看器进程 (pid: ${pids.join(', ')})，结束并复用端口 ${port}...`);
    }
    killPids(pids, i < 4 ? 'SIGTERM' : 'SIGKILL');
    await sleep(waitMs);
  }
  const still = findListenerPids(port);
  return { freed: still.length === 0, pids: still };
}

async function createApp(defaultSessionId) {
  const app = express();
  const publicDir = path.join(__dirname, 'public');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(publicDir));

  async function pickSessionId(req) {
    const q = req.query.session || req.body?.session || defaultSessionId || 'latest';
    return resolveSessionId(q);
  }

  app.get('/api/health', async (_req, res) => {
    try {
      const sessionId = await resolveSessionId(defaultSessionId || 'latest');
      res.json({ ok: true, mode: 'session', sessionId, defaultSessionId: sessionId });
    } catch (error) {
      res.json({ ok: true, mode: 'session', sessionId: null, error: error.message });
    }
  });

  app.get('/api/sessions', async (req, res) => {
    try {
      const refreshMissing = req.query.refresh !== '0';
      const sessions = await listSessionCards(100, { refreshMissing });
      let current = null;
      try {
        current = await pickSessionId(req);
      } catch {
        current = sessions[0]?.sessionId || null;
      }
      res.json({
        sessions,
        current,
        sessionsRoot: require('./lib/session-store').SESSIONS_ROOT,
      });
    } catch (error) {
      res.status(400).json({ error: error.message, code: error.code || 'ERROR' });
    }
  });

  app.post('/api/summarize', async (req, res) => {
    try {
      const sessionId = await pickSessionId(req);
      const insight = await finalizeSessionInsights(sessionId, {
        summary: req.body?.summary || '',
        force: req.body?.force !== false,
      });
      res.json(insight);
    } catch (error) {
      res.status(400).json({ error: error.message, code: error.code || 'ERROR' });
    }
  });

  app.get('/api/summary', async (req, res) => {
    try {
      const sessionId = await pickSessionId(req);
      const summary = await getSessionSummary(sessionId);
      res.json(summary);
    } catch (error) {
      res.status(400).json({ error: error.message, code: error.code || 'ERROR' });
    }
  });

  app.get('/api/file', async (req, res) => {
    try {
      const sessionId = await pickSessionId(req);
      const filePath = req.query.path;
      if (!filePath || typeof filePath !== 'string') {
        res.status(400).json({ error: '缺少 path 参数' });
        return;
      }
      const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
      if (normalized.includes('..')) {
        res.status(400).json({ error: '非法路径' });
        return;
      }
      const diff = await getSessionFileDiff(sessionId, normalized);
      res.json(diff);
    } catch (error) {
      const status = error.code === 'FILE_NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: error.message, code: error.code || 'ERROR' });
    }
  });

  app.post('/api/revert', async (req, res) => {
    try {
      const sessionId = await pickSessionId(req);
      const files = Array.isArray(req.body?.files) ? req.body.files : null;
      const single = req.body?.path;
      let result;
      if (single && typeof single === 'string') {
        const one = await revertFile(sessionId, single);
        result = {
          sessionId,
          workspaceRoot: (await loadSession(sessionId)).workspaceRoot,
          reverted: [one],
          errors: [],
        };
      } else {
        result = await revertFiles(sessionId, files);
      }
      const summary = await getSessionSummary(sessionId);
      res.json({ ...result, summary });
    } catch (error) {
      const status = error.code === 'FILE_NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: error.message, code: error.code || 'ERROR' });
    }
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let sessionId = null;
  let meta = null;
  try {
    sessionId = await resolveSessionId(args.session);
    meta = await loadSession(sessionId);
  } catch (error) {
    console.warn(`提示: ${error.message}`);
    console.warn('将启动查看器，可在界面中选择已有会话。');
  }

  const app = await createApp(sessionId);
  const preferredPort = args.port;
  let attempts = 0;

  const listen = async (port) => {
    attempts += 1;
    const server = app.listen(port, args.host, async () => {
      const url = `http://${args.host}:${port}`;
      console.log('Codex Session Diff Viewer');
      if (sessionId) console.log(`  默认会话: ${sessionId}`);
      if (meta) console.log(`  工作区: ${meta.workspaceRoot}`);
      console.log(`  地址: ${url}`);
      console.log('  模式: 本次会话变更（相对 begin 基线，非 git HEAD diff）');
      console.log('  单实例: 端口占用时会结束旧进程并复用同一端口');
      if (args.open) {
        try {
          await open(url);
          console.log('  已打开浏览器');
        } catch (e) {
          console.warn(`  自动打开浏览器失败: ${e.message}`);
        }
      }
    });

    server.on('error', async (err) => {
      if (err.code === 'EADDRINUSE' && port === preferredPort && attempts <= 3) {
        const result = await freePort(port);
        if (!result.freed) {
          console.error(`端口 ${port} 仍被占用，无法启动: pid=${result.pids.join(',') || 'unknown'}`);
          process.exit(1);
          return;
        }
        // 重新监听同一端口，不递增端口，保证始终只有一个实例
        setTimeout(() => listen(port), 80);
        return;
      }
      console.error(err.message || err);
      process.exit(1);
    });
  };

  // 启动前主动清理旧实例，避免多开浪费资源
  await freePort(preferredPort);
  await listen(preferredPort);
}

if (require.main === module) {
  main();
}

module.exports = { createApp, parseArgs };
