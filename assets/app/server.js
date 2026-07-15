#!/usr/bin/env node
const path = require('path');
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
`);
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
  const listen = (port) => {
    const server = app.listen(port, args.host, async () => {
      const url = `http://${args.host}:${port}`;
      console.log('Codex Session Diff Viewer');
      if (sessionId) console.log(`  默认会话: ${sessionId}`);
      if (meta) console.log(`  工作区: ${meta.workspaceRoot}`);
      console.log(`  地址: ${url}`);
      console.log('  模式: 本次会话变更（相对 begin 基线，非 git HEAD diff）');
      if (args.open) {
        try {
          await open(url);
          console.log('  已打开浏览器');
        } catch (e) {
          console.warn(`  自动打开浏览器失败: ${e.message}`);
        }
      }
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < args.port + 20) {
        console.warn(`端口 ${port} 占用，尝试 ${port + 1}...`);
        listen(port + 1);
      } else {
        console.error(err.message || err);
        process.exit(1);
      }
    });
  };
  listen(args.port);
}

if (require.main === module) {
  main();
}

module.exports = { createApp, parseArgs };
