const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { snapshotWorkspaceBaseline, writeInventory, discoverChangedPaths, makeWorkspaceIgnore } = require('./workspace-scan');
const { spawnWatchDaemon, stopWatchDaemon, readDirty } = require('./workspace-watch');

const HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const SESSIONS_ROOT = path.join(HOME, 'session-diffs');

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowId() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex');
  return `${stamp}-${rand}`;
}

function sessionDir(sessionId) {
  return path.join(SESSIONS_ROOT, sessionId);
}

function metaPath(sessionId) {
  return path.join(sessionDir(sessionId), 'meta.json');
}

function baselineDir(sessionId) {
  return path.join(sessionDir(sessionId), 'baseline');
}

function afterDir(sessionId) {
  return path.join(sessionDir(sessionId), 'after');
}

function normalizeRel(filePath) {
  const normalized = path.normalize(String(filePath || '')).replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || path.isAbsolute(normalized)) {
    const err = new Error(`非法路径: ${filePath}`);
    err.code = 'INVALID_PATH';
    throw err;
  }
  return normalized.replace(/^\.\//, '');
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  ensureDirSync(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p) {
  try {
    const st = await fsp.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function copyFilePreserve(src, dest) {
  ensureDirSync(path.dirname(dest));
  const flags = fs.constants.COPYFILE_FICLONE || 0;
  await fsp.copyFile(src, dest, flags);
}

async function readTextMaybe(filePath) {
  try {
    const buf = await fsp.readFile(filePath);
    if (buf.includes(0)) {
      return { exists: true, binary: true, text: '' };
    }
    return { exists: true, binary: false, text: buf.toString('utf8') };
  } catch {
    return { exists: false, binary: false, text: '' };
  }
}


function deriveProjectName(workspaceRoot) {
  if (!workspaceRoot) return 'project';
  const abs = path.resolve(String(workspaceRoot)).replace(/\\/g, '/');
  const home = path.resolve(os.homedir()).replace(/\\/g, '/');
  if (abs === home) {
    return '/';
  }
  // 去掉用户主目录前缀，保留路径形态：/javaProject/traceback/backend
  if (abs.startsWith(`${home}/`)) {
    const rest = abs.slice(home.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  // 非家目录：统一成以 / 开头的路径展示
  const cleaned = abs.replace(/^[A-Za-z]:/, '');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function resolveUnderRoot(root, relPath) {
  const abs = path.resolve(root, relPath);
  const rootAbs = path.resolve(root) + path.sep;
  if (abs !== path.resolve(root) && !abs.startsWith(rootAbs)) {
    const err = new Error(`路径越界: ${relPath}`);
    err.code = 'PATH_ESCAPE';
    throw err;
  }
  return abs;
}

function sessionsRootIgnorePrefix(workspaceRoot) {
  const extra = [];
  const ws = path.resolve(workspaceRoot);
  const sessions = path.resolve(SESSIONS_ROOT);
  if (sessions === ws || sessions.startsWith(ws + path.sep)) {
    extra.push(path.relative(ws, sessions).replace(/\\/g, '/'));
  }
  const home = path.resolve(os.homedir());
  if (ws === home) {
    extra.push(
      'Library',
      'Pictures',
      'Movies',
      'Music',
      'Downloads',
      'Desktop',
      'Applications',
      'Public',
      '.Trash',
      '.npm',
      '.local',
    );
  }
  return extra;
}

async function baselineMarkerExists(sessionId, rel) {
  const baseFile = path.join(baselineDir(sessionId), rel);
  const binMeta = path.join(baselineDir(sessionId), `${rel}.__binary_meta.json`);
  return (await pathExists(baseFile)) || (await pathExists(binMeta));
}

async function baselineIsBinary(sessionId, rel) {
  return pathExists(path.join(baselineDir(sessionId), `${rel}.__binary_meta.json`));
}

async function createSession({ workspace, title = '', files = [], note = '', watch = true }) {
  const workspaceRoot = path.resolve(workspace || process.cwd());
  if (!(await isDirectory(workspaceRoot))) {
    const err = new Error(`工作区不存在: ${workspaceRoot}`);
    err.code = 'WORKSPACE_MISSING';
    throw err;
  }

  const previousSessionId = await getLatestSessionId();
  if (previousSessionId) {
    try {
      await stopWatchDaemon(sessionDir(previousSessionId));
    } catch {
      // 停旧监听失败不阻断新 session
    }
  }

  const sessionId = nowId();
  ensureDirSync(baselineDir(sessionId));

  const extraPrefixes = sessionsRootIgnorePrefix(workspaceRoot);
  const ignore = await makeWorkspaceIgnore(workspaceRoot, extraPrefixes);
  const inventory = await snapshotWorkspaceBaseline(
    workspaceRoot,
    baselineDir(sessionId),
    ignore.shouldIgnore,
  );
  await writeInventory(sessionDir(sessionId), inventory);

  const uniqueFiles = [];
  const seen = new Set();
  for (const f of files || []) {
    const rel = normalizeRel(f);
    if (seen.has(rel)) continue;
    seen.add(rel);
    uniqueFiles.push(rel);
  }

  const tracked = [];
  for (const rel of uniqueFiles) {
    const abs = resolveUnderRoot(workspaceRoot, rel);
    const exists = await pathExists(abs);
    let binary = await baselineIsBinary(sessionId, rel);
    if (exists && !(await baselineMarkerExists(sessionId, rel))) {
      const st = await fsp.stat(abs);
      if (st.isDirectory()) continue;
      const sample = await fsp.readFile(abs).catch(() => null);
      binary = !!(sample && sample.includes(0));
      if (!binary) {
        await copyFilePreserve(abs, path.join(baselineDir(sessionId), rel));
      } else {
        await writeJson(path.join(baselineDir(sessionId), `${rel}.__binary_meta.json`), {
          binary: true,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    }
    tracked.push({
      path: rel,
      baselineExists: exists || await baselineMarkerExists(sessionId, rel),
      binary,
      source: 'explicit',
    });
  }

  const projectName = deriveProjectName(workspaceRoot);
  const meta = {
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspaceRoot,
    projectName,
    title: title || projectName,
    note,
    mode: 'session',
    files: tracked,
    closed: false,
    afterCapturedAt: null,
    changeSummary: '',
    changedFileCount: 0,
    stats: { added: 0, modified: 0, deleted: 0, additions: 0, deletions: 0 },
    summarySource: '',
    summaryUpdatedAt: null,
    watch: {
      enabled: false,
      pid: null,
      snapshotted: inventory.snapshotted,
      skipped: inventory.skipped,
      fileCount: inventory.fileCount,
    },
  };
  await writeJson(metaPath(sessionId), meta);
  if (previousSessionId && previousSessionId !== sessionId) {
    try {
      await captureAfterSnapshot(previousSessionId, { refresh: false });
    } catch {
      // 冻结上一轮失败不应阻断新 session
    }
  }
  await writeJson(path.join(SESSIONS_ROOT, 'latest.json'), {
    sessionId,
    workspaceRoot,
    createdAt: meta.createdAt,
  });

  if (watch !== false) {
    try {
      const pid = spawnWatchDaemon(sessionId);
      meta.watch = {
        ...meta.watch,
        enabled: true,
        pid,
      };
      meta.updatedAt = new Date().toISOString();
      await writeJson(metaPath(sessionId), meta);
    } catch (error) {
      meta.watch = {
        ...meta.watch,
        enabled: false,
        error: error.message,
      };
      await writeJson(metaPath(sessionId), meta);
    }
  }
  return meta;
}

async function loadSession(sessionId) {
  const meta = await readJson(metaPath(sessionId));
  if (!meta) {
    const err = new Error(`会话不存在: ${sessionId}`);
    err.code = 'SESSION_NOT_FOUND';
    throw err;
  }
  return meta;
}

async function listSessions(limit = 20) {
  ensureDirSync(SESSIONS_ROOT);
  const names = await fsp.readdir(SESSIONS_ROOT);
  const items = [];
  for (const name of names) {
    if (name === 'latest.json') continue;
    const meta = await readJson(metaPath(name));
    if (meta) items.push(meta);
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return items.slice(0, limit);
}

async function getLatestSessionId() {
  const latest = await readJson(path.join(SESSIONS_ROOT, 'latest.json'));
  return latest?.sessionId || null;
}

async function trackFiles(sessionId, files = []) {
  const meta = await loadSession(sessionId);
  const existing = new Map(meta.files.map((f) => [f.path, f]));
  for (const f of files || []) {
    const rel = normalizeRel(f);
    if (existing.has(rel)) continue;
    const abs = resolveUnderRoot(meta.workspaceRoot, rel);
    const exists = await pathExists(abs);
    const alreadyBaseline = await baselineMarkerExists(sessionId, rel);
    let binary = alreadyBaseline ? await baselineIsBinary(sessionId, rel) : false;
    if (exists && !alreadyBaseline) {
      const st = await fsp.stat(abs);
      if (st.isDirectory()) continue;
      const sample = await fsp.readFile(abs).catch(() => null);
      binary = !!(sample && sample.includes(0));
      if (!binary) {
        await copyFilePreserve(abs, path.join(baselineDir(sessionId), rel));
      } else {
        await writeJson(path.join(baselineDir(sessionId), `${rel}.__binary_meta.json`), {
          binary: true,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    }
    const item = {
      path: rel,
      baselineExists: alreadyBaseline || exists,
      binary,
      source: 'explicit',
    };
    existing.set(rel, item);
    meta.files.push(item);
  }
  meta.updatedAt = new Date().toISOString();
  await writeJson(metaPath(sessionId), meta);
  return meta;
}

async function syncDiscoveredFiles(sessionId) {
  const meta = await loadSession(sessionId);
  const extraPrefixes = sessionsRootIgnorePrefix(meta.workspaceRoot);
  const dirty = await readDirty(sessionDir(sessionId));
  const discovered = await discoverChangedPaths({
    workspaceRoot: meta.workspaceRoot,
    sessionDir: sessionDir(sessionId),
    extraPaths: (meta.files || []).map((f) => f.path),
    dirtyPaths: dirty.paths,
    extraPrefixes,
  });
  const existing = new Map((meta.files || []).map((f) => [f.path, f]));
  let changed = false;
  for (const rel of discovered) {
    if (existing.has(rel)) continue;
    const baselineExists = await baselineMarkerExists(sessionId, rel);
    const item = {
      path: rel,
      baselineExists,
      binary: await baselineIsBinary(sessionId, rel),
      source: 'watch',
    };
    existing.set(rel, item);
    meta.files.push(item);
    changed = true;
  }
  if (changed) {
    meta.updatedAt = new Date().toISOString();
    meta.watch = {
      ...(meta.watch || {}),
      dirtyCount: dirty.paths.length,
    };
    await writeJson(metaPath(sessionId), meta);
  }
  return meta;
}

async function captureCurrentTree(sessionId, extraFiles = []) {
  // Optionally track additional files discovered late (as new files baseline=missing)
  if (extraFiles.length) {
    await trackFiles(sessionId, extraFiles);
  }
  return loadSession(sessionId);
}

async function readSnapshotText(snapshotRoot, relPath) {
  const baseFile = path.join(snapshotRoot, relPath);
  if (await pathExists(baseFile)) {
    return readTextMaybe(baseFile);
  }
  const binMeta = path.join(snapshotRoot, `${relPath}.__binary_meta.json`);
  if (await pathExists(binMeta)) {
    return { exists: true, binary: true, text: '' };
  }
  return { exists: false, binary: false, text: '' };
}

async function snapshotWorkspaceFile(workspaceRoot, snapshotRoot, rel) {
  const abs = resolveUnderRoot(workspaceRoot, rel);
  const dest = path.join(snapshotRoot, rel);
  const exists = await pathExists(abs);
  if (!exists) {
    return { path: rel, exists: false, binary: false };
  }
  const st = await fsp.stat(abs);
  if (st.isDirectory()) return null;
  const sample = await fsp.readFile(abs).catch(() => null);
  const binary = !!(sample && sample.includes(0));
  if (binary) {
    await writeJson(path.join(snapshotRoot, `${rel}.__binary_meta.json`), {
      binary: true,
      size: st.size,
      mtimeMs: st.mtimeMs,
    });
  } else {
    await copyFilePreserve(abs, dest);
  }
  return { path: rel, exists: true, binary };
}

async function captureAfterSnapshot(sessionId, options = {}) {
  await syncDiscoveredFiles(sessionId);
  const meta = await loadSession(sessionId);
  const latestId = await getLatestSessionId();
  const isLatest = latestId === sessionId;
  const already = Boolean(meta.afterCapturedAt);
  const refresh = options.refresh !== false;
  const force = !!options.force;

  // 非当前会话：工作区已经不是该回合结束态，禁止用「现在」冒充「当时改完后」
  if (!isLatest && !force) {
    return { captured: false, reason: already ? 'frozen' : 'not-latest', session: meta };
  }
  if (already && !refresh && !force) {
    return { captured: false, reason: 'already', session: meta };
  }

  const root = afterDir(sessionId);
  if (already) {
    await fsp.rm(root, { recursive: true, force: true });
  }
  ensureDirSync(root);

  for (const f of meta.files || []) {
    await snapshotWorkspaceFile(meta.workspaceRoot, root, f.path);
  }

  const next = await updateSessionMeta(sessionId, {
    afterCapturedAt: new Date().toISOString(),
  });
  return {
    captured: true,
    reason: already ? 'refreshed' : 'created',
    session: next,
  };
}

async function readBaselineText(sessionId, relPath) {
  return readSnapshotText(baselineDir(sessionId), relPath);
}

async function readAfterText(sessionId, relPath) {
  return readSnapshotText(afterDir(sessionId), relPath);
}

async function readCurrentText(workspaceRoot, relPath) {
  const abs = resolveUnderRoot(workspaceRoot, relPath);
  return readTextMaybe(abs);
}

async function readSessionNewText(session, relPath) {
  if (session.afterCapturedAt) {
    return readAfterText(session.sessionId, relPath);
  }
  return readCurrentText(session.workspaceRoot, relPath);
}


async function revertFile(sessionId, relPath) {
  const session = await loadSession(sessionId);
  const rel = normalizeRel(relPath);
  const tracked = session.files.find((f) => f.path === rel);
  if (!tracked) {
    const err = new Error(`会话未跟踪该文件: ${rel}`);
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  const workspaceAbs = resolveUnderRoot(session.workspaceRoot, rel);
  const baseFile = path.join(baselineDir(sessionId), rel);
  const binMeta = path.join(baselineDir(sessionId), `${rel}.__binary_meta.json`);
  const baselineExists = await pathExists(baseFile) || await pathExists(binMeta);

  if (!baselineExists) {
    // was added in session -> remove current file
    try {
      await fsp.unlink(workspaceAbs);
    } catch (e) {
      if (e && e.code !== 'ENOENT') throw e;
    }
    // clean empty dirs up to workspace root (best effort)
    let dir = path.dirname(workspaceAbs);
    const root = path.resolve(session.workspaceRoot);
    while (dir.startsWith(root) && dir !== root) {
      try {
        await fsp.rmdir(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
    return { path: rel, action: 'deleted_added_file' };
  }

  if (await pathExists(binMeta)) {
    const err = new Error(`二进制文件暂不支持自动回滚: ${rel}`);
    err.code = 'BINARY_UNSUPPORTED';
    throw err;
  }

  ensureDirSync(path.dirname(workspaceAbs));
  await fsp.copyFile(baseFile, workspaceAbs);
  return { path: rel, action: 'restored_baseline' };
}

async function revertFiles(sessionId, files = null) {
  const session = await loadSession(sessionId);
  const targets = Array.isArray(files) && files.length
    ? files.map(normalizeRel)
    : session.files.map((f) => f.path);

  const results = [];
  const errors = [];
  for (const rel of targets) {
    try {
      results.push(await revertFile(sessionId, rel));
    } catch (error) {
      errors.push({ path: rel, error: error.message, code: error.code || 'ERROR' });
    }
  }
  return {
    sessionId,
    workspaceRoot: session.workspaceRoot,
    reverted: results,
    errors,
  };
}


async function updateSessionMeta(sessionId, patch = {}) {
  const meta = await loadSession(sessionId);
  const next = {
    ...meta,
    ...patch,
    sessionId: meta.sessionId,
    workspaceRoot: meta.workspaceRoot,
    files: Array.isArray(patch.files) ? patch.files : meta.files,
    updatedAt: new Date().toISOString(),
  };
  if (!next.projectName || patch.workspaceRoot) {
    next.projectName = deriveProjectName(next.workspaceRoot) || next.title || 'project';
  }
  await writeJson(metaPath(sessionId), next);
  return next;
}

module.exports = {
  SESSIONS_ROOT,
  createSession,
  loadSession,
  listSessions,
  getLatestSessionId,
  trackFiles,
  syncDiscoveredFiles,
  captureCurrentTree,
  captureAfterSnapshot,
  readBaselineText,
  readAfterText,
  readCurrentText,
  readSessionNewText,
  revertFile,
  revertFiles,
  updateSessionMeta,
  normalizeRel,
  deriveProjectName,
  resolveUnderRoot,
  sessionsRootIgnorePrefix,
  sessionDir,
  metaPath,
  baselineDir,
  afterDir,
};
