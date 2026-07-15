#!/usr/bin/env node
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const open = require('open');
const {
  createSession,
  loadSession,
  listSessions,
  getLatestSessionId,
  trackFiles,
} = require('../lib/session-store');
const {
  getSessionSummary,
  resolveSessionId,
  finalizeSessionInsights,
  listSessionCards,
} = require('../lib/session-diff');

function printHelp() {
  console.log(`
codex-session-diff

命令:
  begin --workspace <dir> --files f1,f2 [--title t]
      在修改前捕获文件基线，返回 sessionId

  track --session <id> --files f1,f2
      补充跟踪新文件（若文件已存在则抓当前内容为基线；用于“刚创建前”应先 track 再写）

  open [--session latest|<id>] [--port 3847] [--no-open]
      启动/复用查看器；默认会先生成/刷新本会话改动概括
      单实例固定端口；若浏览器标签已打开则 SSE 切到最新会话，不新开标签

  summarize [--session latest|<id>] [--summary "手动概括"] [--json]
      基于本次会话 diff 生成智能改动概括并写入 meta

  status [--session latest|<id>]
      输出会话摘要 JSON

  list
      列出最近会话（含时间/项目名/概括/文件数）

  url [--session latest|<id>] [--port 3847]
      仅打印查看地址（不保证服务已启动）
`);
}

function parseKv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--workspace' || a === '-w') out.workspace = argv[++i];
    else if (a === '--files' || a === '-f') out.files = argv[++i];
    else if (a === '--file') {
      out.files = out.files ? `${out.files},${argv[++i]}` : argv[++i];
    } else if (a === '--session' || a === '-s') out.session = argv[++i];
    else if (a === '--title' || a === '-t') out.title = argv[++i];
    else if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--no-open') out.noOpen = true;
    else if (a === '--open') out.open = true;
    else if (a === '--json') out.json = true;
    else if (a === '--summary') out.summary = argv[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else out._.push(a);
  }
  return out;
}

function parseFiles(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function cmdBegin(args) {
  const workspace = path.resolve(args.workspace || process.cwd());
  const files = parseFiles(args.files);
  // also accept positional files
  for (const p of args._) files.push(p);
  if (!files.length) {
    console.error('begin 需要 --files 列出即将修改/创建的文件（相对工作区）');
    process.exit(2);
  }
  const meta = await createSession({
    workspace,
    title: args.title || '',
    files,
  });
  if (args.json) {
    console.log(JSON.stringify(meta, null, 2));
  } else {
    console.log(meta.sessionId);
    console.error(`session created: ${meta.sessionId}`);
    console.error(`workspace: ${meta.workspaceRoot}`);
    console.error(`tracked files: ${meta.files.length}`);
  }
}

async function cmdTrack(args) {
  const sessionId = await resolveSessionId(args.session || 'latest');
  const files = parseFiles(args.files);
  for (const p of args._) files.push(p);
  if (!files.length) {
    console.error('track 需要 --files');
    process.exit(2);
  }
  const meta = await trackFiles(sessionId, files);
  if (args.json) console.log(JSON.stringify(meta, null, 2));
  else {
    console.log(sessionId);
    console.error(`tracked now: ${meta.files.length} files`);
  }
}

async function cmdStatus(args) {
  const sessionId = await resolveSessionId(args.session || 'latest');
  const summary = await getSessionSummary(sessionId);
  console.log(JSON.stringify(summary, null, 2));
}

async function cmdList() {
  const sessions = await listSessionCards(50, { refreshMissing: true });
  console.log(JSON.stringify(sessions, null, 2));
}

async function cmdSummarize(args) {
  const sessionId = await resolveSessionId(args.session || 'latest');
  const insight = await finalizeSessionInsights(sessionId, {
    summary: args.summary || '',
    force: !!args.force || !args.summary,
  });
  if (args.json) {
    console.log(JSON.stringify(insight, null, 2));
  } else {
    console.log(insight.changeSummary);
    console.error(`session=${insight.sessionId}`);
    console.error(`project=${insight.projectName}`);
    console.error(`files=${insight.changedFileCount}`);
    console.error(`source=${insight.summarySource}`);
  }
}

function httpJson(method, url, body, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const u = new URL(url);
      const payload = body == null ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port,
          path: `${u.pathname}${u.search}`,
          method,
          timeout: timeoutMs,
          headers: {
            Accept: 'application/json',
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': payload.length,
                }
              : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let data = null;
            try {
              data = raw ? JSON.parse(raw) : null;
            } catch {
              data = { raw };
            }
            done({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode || 0,
              data,
            });
          });
        },
      );
      req.on('error', () => done(null));
      req.on('timeout', () => {
        req.destroy();
        done(null);
      });
      if (payload) req.write(payload);
      req.end();
    } catch {
      done(null);
    }
  });
}

async function focusExistingServer(port, sessionId) {
  const base = `http://127.0.0.1:${port}`;
  const health = await httpJson('GET', `${base}/api/health`, null, 900);
  if (!health || !health.ok || !health.data || health.data.ok !== true) {
    return null;
  }
  const focused = await httpJson(
    'POST',
    `${base}/api/focus`,
    { sessionId, reason: 'cli-open' },
    1500,
  );
  if (!focused || !focused.ok || !focused.data || focused.data.ok !== true) {
    // 旧服务可能没有 focus API
    return {
      url: base,
      live: !!(health.data.live || (health.data.clients || 0) > 0),
      clients: health.data.clients || 0,
      sessionId,
      legacy: true,
    };
  }
  return {
    url: base,
    live: !!focused.data.live,
    clients: focused.data.clients || 0,
    sessionId: focused.data.sessionId || sessionId,
    legacy: false,
  };
}

async function cmdOpen(args) {
  const sessionId = await resolveSessionId(args.session || 'latest');
  try {
    const insight = await finalizeSessionInsights(sessionId, {
      summary: args.summary || '',
      force: !!args.force,
    });
    console.error(`changeSummary: ${insight.changeSummary}`);
  } catch (e) {
    console.error(`生成改动概括失败（继续打开）: ${e.message}`);
  }

  const port = args.port || 3847;
  const url = `http://127.0.0.1:${port}`;
  const shouldOpenBrowser = !args.noOpen;

  // 1) 优先复用已运行服务 + 已打开浏览器标签（SSE）
  const existing = await focusExistingServer(port, sessionId);
  if (existing && !existing.legacy) {
    console.log(existing.url);
    if (existing.live) {
      console.error(
        `已复用浏览器标签：切换到会话 ${existing.sessionId}（clients=${existing.clients}，未新开标签）`,
      );
      return;
    }
    if (shouldOpenBrowser) {
      try {
        await open(existing.url);
        console.error('服务已在运行，但未检测到打开中的页面，已打开浏览器');
      } catch (e) {
        console.error(`打开浏览器失败: ${e.message}`);
      }
    } else {
      console.error('服务已在运行；--no-open 跳过打开浏览器');
    }
    return;
  }
  if (existing && existing.legacy) {
    console.error('检测到旧版查看器（无标签复用能力），将重启为新版单实例服务...');
  }

  // 2) 没有可用服务：启动单实例（仅此时才清理脏端口/旧进程）
  const serverJs = path.join(__dirname, '..', 'server.js');
  // 不把 --open 传给 server，避免 CLI/server 双重打开标签
  const nodeArgs = [serverJs, '--session', sessionId, '--port', String(port)];

  const child = spawn(process.execPath, nodeArgs, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let settled = false;
  const finish = async (readyUrl) => {
    if (settled) return;
    settled = true;
    console.log(readyUrl);
    if (shouldOpenBrowser) {
      try {
        await open(readyUrl);
        console.error('已打开浏览器');
      } catch (e) {
        console.error(`打开浏览器失败: ${e.message}`);
      }
    }
    child.unref();
    setTimeout(() => process.exit(0), 150);
  };

  const onData = async (buf) => {
    const text = buf.toString();
    process.stderr.write(text);
    const m = text.match(/地址:\s*(http:\/\/\S+)/);
    if (m) finish(m[1]);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    if (!settled) process.exit(code || 1);
  });

  // 兜底：若日志解析失败，轮询 health
  for (let i = 0; i < 30 && !settled; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const health = await httpJson('GET', `${url}/api/health`, null, 400);
    if (health && health.ok) {
      // 通知默认会话
      await httpJson('POST', `${url}/api/focus`, { sessionId, reason: 'cli-open-start' }, 800);
      await finish(url);
      break;
    }
  }
}

async function cmdUrl(args) {
  const port = args.port || 3847;
  const sessionId = await resolveSessionId(args.session || 'latest');
  // URL itself does not embed session when server started with that session; print advisory
  console.log(`http://127.0.0.1:${port}`);
  console.error(`session=${sessionId} (确保 server 以该 session 启动)`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'help';
  const args = parseKv(argv.slice(1));
  if (cmd === 'help' || args.help) {
    printHelp();
    return;
  }
  try {
    if (cmd === 'begin') await cmdBegin(args);
    else if (cmd === 'track') await cmdTrack(args);
    else if (cmd === 'open') await cmdOpen(args);
    else if (cmd === 'summarize') await cmdSummarize(args);
    else if (cmd === 'status') await cmdStatus(args);
    else if (cmd === 'list') await cmdList();
    else if (cmd === 'url') await cmdUrl(args);
    else {
      console.error(`未知命令: ${cmd}`);
      printHelp();
      process.exit(2);
    }
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}

main();
