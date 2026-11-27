const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { toPosix } = require('./ignore-files');

function dirtyPath(sessionDir) {
  return path.join(sessionDir, 'dirty.json');
}

function pidPath(sessionDir) {
  return path.join(sessionDir, 'watch.pid');
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

async function readDirty(sessionDir) {
  const data = await readJson(dirtyPath(sessionDir), null);
  const paths = Array.isArray(data?.paths) ? data.paths.map(toPosix).filter(Boolean) : [];
  return {
    sessionId: data?.sessionId || null,
    paths: [...new Set(paths)],
    updatedAt: data?.updatedAt || null,
  };
}

const dirtyWriteTail = new Map();

function enqueueDirtyWrite(sessionDir, fn) {
  const key = sessionDir;
  const tail = dirtyWriteTail.get(key) || Promise.resolve();
  const next = tail.then(fn, fn);
  dirtyWriteTail.set(key, next.catch(() => {}));
  return next;
}

async function addDirtyPathsNow(sessionDir, sessionId, paths) {
  const incoming = (paths || []).map(toPosix).filter(Boolean);
  if (!incoming.length) return readDirty(sessionDir);
  const current = await readDirty(sessionDir);
  const set = new Set(current.paths);
  for (const rel of incoming) set.add(rel);
  const next = {
    sessionId,
    paths: [...set].sort(),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(dirtyPath(sessionDir), next);
  return next;
}

async function addDirtyPaths(sessionDir, sessionId, paths) {
  return enqueueDirtyWrite(sessionDir, () => addDirtyPathsNow(sessionDir, sessionId, paths));
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid(sessionDir) {
  try {
    const raw = (await fsp.readFile(pidPath(sessionDir), 'utf8')).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function writePid(sessionDir, pid) {
  await fsp.mkdir(sessionDir, { recursive: true });
  await fsp.writeFile(pidPath(sessionDir), String(pid), 'utf8');
}

async function clearPid(sessionDir) {
  try {
    await fsp.unlink(pidPath(sessionDir));
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ignoredBy(shouldIgnore, rel) {
  if (!shouldIgnore) return false;
  return shouldIgnore(rel, false) || shouldIgnore(rel, true);
}

async function watchWorkspace(workspaceRoot, { shouldIgnore, onBatch, debounceMs = 180 } = {}) {
  const root = path.resolve(workspaceRoot);
  let timer = null;
  const pending = new Set();
  let closed = false;
  const watchers = [];
  const watched = new Set();
  const pendingNewDirs = new Set();

  const flush = () => {
    timer = null;
    if (!pending.size || closed) return;
    const batch = [...pending];
    pending.clear();
    if (typeof onBatch === 'function') {
      Promise.resolve(onBatch(batch)).catch(() => {});
    }
  };

  const note = (filename) => {
    if (filename == null) return;
    const rel = toPosix(filename);
    if (!rel || rel === '.') return;
    if (ignoredBy(shouldIgnore, rel)) return;
    pending.add(rel);
    clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  async function walkAndWatch(absDir, relDir) {
    if (closed) return;
    if (relDir && ignoredBy(shouldIgnore, relDir)) return;
    if (watched.has(relDir)) return;
    watched.add(relDir);

    try {
      const watcher = fs.watch(absDir, { recursive: false }, (_event, filename) => {
        if (closed) return;
        if (!filename) {
          if (relDir) note(relDir);
          return;
        }
        const rel = relDir ? `${relDir}/${toPosix(filename)}` : toPosix(filename);
        note(rel);
        queueNewDir(rel);
      });
      watcher.on('error', () => {
        // keep process alive; summarize 会走 inventory 扫描兜底
      });
      watchers.push(watcher);
    } catch {
      return;
    }

    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (closed) return;
      try {
        if (ent.isSymbolicLink() || !ent.isDirectory()) continue;
      } catch {
        continue;
      }
      const childRel = relDir ? `${relDir}/${ent.name}` : ent.name;
      await walkAndWatch(path.join(absDir, ent.name), childRel);
    }
  }

  function queueNewDir(rel) {
    const posix = toPosix(rel);
    if (!posix || posix === '.' || pendingNewDirs.has(posix) || watched.has(posix)) return;
    if (ignoredBy(shouldIgnore, posix)) return;
    pendingNewDirs.add(posix);
    Promise.resolve()
      .then(async () => {
        if (closed) return;
        const abs = path.join(root, posix);
        const st = await fsp.lstat(abs);
        if (!st.isDirectory()) return;
        await walkAndWatch(abs, posix);
      })
      .catch(() => {})
      .finally(() => {
        pendingNewDirs.delete(posix);
      });
  }

  await walkAndWatch(root, '');

  return {
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // already closed
        }
      }
      watchers.length = 0;
    },
  };
}

async function runWatchLoop({ sessionId, sessionDir, workspaceRoot, shouldIgnore }) {
  await writePid(sessionDir, process.pid);
  const watcher = await watchWorkspace(workspaceRoot, {
    shouldIgnore,
    onBatch: (paths) => addDirtyPaths(sessionDir, sessionId, paths),
  });

  const shutdown = async () => {
    watcher.close();
    await sleep(20);
    await clearPid(sessionDir);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await new Promise(() => {});
}

function spawnWatchDaemon(sessionId) {
  const daemonJs = path.join(__dirname, '..', 'bin', 'watch-daemon.js');
  const child = spawn(process.execPath, [daemonJs, sessionId], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  return child.pid;
}

async function stopWatchDaemon(sessionDir) {
  const pid = await readPid(sessionDir);
  if (!pid) return { stopped: false, reason: 'no-pid' };
  if (!isPidAlive(pid)) {
    await clearPid(sessionDir);
    return { stopped: false, reason: 'dead', pid };
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    await clearPid(sessionDir);
    return { stopped: false, reason: 'kill-failed', pid };
  }
  for (let i = 0; i < 10; i += 1) {
    if (!isPidAlive(pid)) {
      await clearPid(sessionDir);
      return { stopped: true, reason: 'terminated', pid };
    }
    await sleep(50);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore
  }
  await sleep(30);
  await clearPid(sessionDir);
  return { stopped: true, reason: 'killed', pid };
}

function sessionsRoot() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(home, 'session-diffs');
}

module.exports = {
  dirtyPath,
  pidPath,
  readDirty,
  addDirtyPaths,
  watchWorkspace,
  runWatchLoop,
  spawnWatchDaemon,
  stopWatchDaemon,
  readPid,
  isPidAlive,
  sessionsRoot,
};
