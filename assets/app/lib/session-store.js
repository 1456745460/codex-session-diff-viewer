const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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
  await fsp.copyFile(src, dest);
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

async function createSession({ workspace, title = '', files = [], note = '' }) {
  const workspaceRoot = path.resolve(workspace || process.cwd());
  if (!(await isDirectory(workspaceRoot))) {
    const err = new Error(`工作区不存在: ${workspaceRoot}`);
    err.code = 'WORKSPACE_MISSING';
    throw err;
  }

  const sessionId = nowId();
  const dir = sessionDir(sessionId);
  ensureDirSync(baselineDir(sessionId));

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
    let binary = false;
    if (exists) {
      const st = await fsp.stat(abs);
      if (st.isDirectory()) continue;
      const sample = await fsp.readFile(abs).catch(() => null);
      binary = !!(sample && sample.includes(0));
      if (!binary) {
        await copyFilePreserve(abs, path.join(baselineDir(sessionId), rel));
      } else {
        // still mark baseline existence for binary
        await writeJson(path.join(baselineDir(sessionId), `${rel}.__binary_meta.json`), {
          binary: true,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    }
    tracked.push({
      path: rel,
      baselineExists: exists,
      binary,
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
    changeSummary: '',
    changedFileCount: 0,
    stats: { added: 0, modified: 0, deleted: 0, additions: 0, deletions: 0 },
    summarySource: '',
    summaryUpdatedAt: null,
  };
  await writeJson(metaPath(sessionId), meta);
  await writeJson(path.join(SESSIONS_ROOT, 'latest.json'), {
    sessionId,
    workspaceRoot,
    createdAt: meta.createdAt,
  });
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
    let binary = false;
    if (exists) {
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
    const item = { path: rel, baselineExists: exists, binary };
    existing.set(rel, item);
    meta.files.push(item);
  }
  meta.updatedAt = new Date().toISOString();
  await writeJson(metaPath(sessionId), meta);
  return meta;
}

async function captureCurrentTree(sessionId, extraFiles = []) {
  // Optionally track additional files discovered late (as new files baseline=missing)
  if (extraFiles.length) {
    await trackFiles(sessionId, extraFiles);
  }
  return loadSession(sessionId);
}

async function readBaselineText(sessionId, relPath) {
  const baseFile = path.join(baselineDir(sessionId), relPath);
  if (await pathExists(baseFile)) {
    return readTextMaybe(baseFile);
  }
  const binMeta = path.join(baselineDir(sessionId), `${relPath}.__binary_meta.json`);
  if (await pathExists(binMeta)) {
    return { exists: true, binary: true, text: '' };
  }
  return { exists: false, binary: false, text: '' };
}

async function readCurrentText(workspaceRoot, relPath) {
  const abs = resolveUnderRoot(workspaceRoot, relPath);
  return readTextMaybe(abs);
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
  captureCurrentTree,
  readBaselineText,
  readCurrentText,
  revertFile,
  revertFiles,
  updateSessionMeta,
  normalizeRel,
  deriveProjectName,
  resolveUnderRoot,
  sessionDir,
  metaPath,
  baselineDir,
};
