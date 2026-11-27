const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { loadIgnore, toPosix } = require('./ignore-files');
const { pathPrefix, prefixedRel } = require('./workspace-scope');

const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
const WALK_CONCURRENCY = 8;
const COPY_FLAGS = fs.constants.COPYFILE_FICLONE ? fs.constants.COPYFILE_FICLONE : 0;

function inventoryPath(sessionDir) {
  return path.join(sessionDir, 'inventory.json');
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function mapLimit(items, limit, fn) {
  const ret = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(Math.max(limit, 1), Math.max(items.length, 1));
  await Promise.all(Array.from({ length: items.length ? n : 0 }, () => worker()));
  return ret;
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

async function isBinaryFile(abs) {
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

async function walkFiles(root, shouldIgnore) {
  const out = [];
  async function walk(relDir) {
    const absDir = relDir ? path.join(root, relDir) : root;
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const posix = toPosix(rel);
      let isDir = false;
      try {
        if (ent.isSymbolicLink()) continue;
        isDir = ent.isDirectory();
      } catch {
        continue;
      }
      if (shouldIgnore(posix, isDir)) continue;
      if (isDir) {
        await walk(posix);
        continue;
      }
      if (ent.isFile()) out.push(posix);
    }
  }
  await walk('');
  return out;
}

async function snapshotOne(workspaceRoot, baselineRoot, rel) {
  const abs = resolveUnderRoot(workspaceRoot, rel);
  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  if (st.size > MAX_FILE_BYTES) {
    return { path: rel, size: st.size, mtimeMs: st.mtimeMs, skipped: 'too-large', binary: false };
  }
  let binary = false;
  try {
    binary = await isBinaryFile(abs);
  } catch {
    return null;
  }
  const dest = path.join(baselineRoot, rel);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (binary) {
    await writeJson(`${dest}.__binary_meta.json`, {
      binary: true,
      size: st.size,
      mtimeMs: st.mtimeMs,
    });
  } else {
    await fsp.copyFile(abs, dest, COPY_FLAGS);
  }
  return {
    path: rel,
    size: st.size,
    mtimeMs: st.mtimeMs,
    binary,
  };
}

async function snapshotWorkspaceBaseline(workspaceRoot, baselineRoot, shouldIgnore, options = {}) {
  const prefix = toPosix(options.pathPrefix || '');
  const resolveRoot = options.resolveRoot || workspaceRoot;
  const files = await walkFiles(workspaceRoot, shouldIgnore);
  const inventory = {};
  let snapshotted = 0;
  let skipped = 0;
  await mapLimit(files, WALK_CONCURRENCY, async (rel) => {
    const lcaRel = prefixedRel(prefix, rel);
    const rec = await snapshotOne(resolveRoot, baselineRoot, lcaRel);
    if (!rec) return;
    inventory[lcaRel] = {
      size: rec.size,
      mtimeMs: rec.mtimeMs,
      binary: !!rec.binary,
      skipped: rec.skipped || null,
    };
    if (rec.skipped) skipped += 1;
    else snapshotted += 1;
  });
  return {
    capturedAt: new Date().toISOString(),
    fileCount: Object.keys(inventory).length,
    snapshotted,
    skipped,
    files: inventory,
  };
}

async function snapshotWorkspaceRoots({ pathRoot, workspaceRoots, baselineRoot, extraPrefixForRoot }) {
  const roots = (workspaceRoots && workspaceRoots.length) ? workspaceRoots : [pathRoot];
  const merged = {
    capturedAt: new Date().toISOString(),
    fileCount: 0,
    snapshotted: 0,
    skipped: 0,
    files: {},
  };
  for (const root of roots) {
    const extra = typeof extraPrefixForRoot === 'function' ? extraPrefixForRoot(root) : [];
    const ignore = await loadIgnore(root, extra);
    const part = await snapshotWorkspaceBaseline(root, baselineRoot, ignore.shouldIgnore, {
      pathPrefix: pathPrefix(pathRoot, root),
      resolveRoot: pathRoot,
    });
    Object.assign(merged.files, part.files);
    merged.snapshotted += part.snapshotted;
    merged.skipped += part.skipped;
  }
  merged.fileCount = Object.keys(merged.files).length;
  merged.capturedAt = new Date().toISOString();
  return merged;
}

async function writeInventory(sessionDir, inventory) {
  await writeJson(inventoryPath(sessionDir), inventory);
  return inventory;
}

async function readInventory(sessionDir) {
  return readJson(inventoryPath(sessionDir), {
    capturedAt: null,
    fileCount: 0,
    snapshotted: 0,
    skipped: 0,
    files: {},
  });
}

function mtimeChanged(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(a - b) > 1.5;
}

function workspaceRootList(workspaceRoot, workspaceRoots) {
  if (Array.isArray(workspaceRoots) && workspaceRoots.length) return workspaceRoots;
  return workspaceRoot ? [workspaceRoot] : [];
}

async function discoverChangedPaths({
  workspaceRoot,
  workspaceRoots,
  sessionDir,
  extraPaths = [],
  dirtyPaths = [],
  extraPrefixes = [],
  extraPrefixForRoot,
}) {
  const pathRoot = path.resolve(workspaceRoot);
  const roots = workspaceRootList(pathRoot, workspaceRoots).map((r) => path.resolve(r));
  const inventory = await readInventory(sessionDir);
  const invFiles = inventory.files || {};
  const changed = new Set();

  function consider(rel) {
    const posix = toPosix(rel);
    if (!posix) return;
    changed.add(posix);
  }

  for (const rel of extraPaths) consider(rel);
  for (const rel of dirtyPaths) {
    const posix = toPosix(rel);
    if (!posix) continue;
    try {
      const st = await fsp.stat(resolveUnderRoot(pathRoot, posix));
      if (st.isDirectory()) continue;
    } catch {
      // 路径已消失：按删除文件处理
    }
    consider(rel);
  }

  if (!inventory.capturedAt) {
    return [...changed].sort();
  }

  const seen = new Set();
  for (const root of roots) {
    const extra = typeof extraPrefixForRoot === 'function'
      ? extraPrefixForRoot(root)
      : extraPrefixes;
    const ignore = await loadIgnore(root, extra);
    const prefix = pathPrefix(pathRoot, root);
    const current = await walkFiles(root, ignore.shouldIgnore);
    await mapLimit(current, WALK_CONCURRENCY, async (rel) => {
      const lcaRel = prefixedRel(prefix, rel);
      seen.add(lcaRel);
      const rec = invFiles[lcaRel];
      if (!rec) {
        consider(lcaRel);
        return;
      }
      if (rec.skipped) return;
      const abs = resolveUnderRoot(pathRoot, lcaRel);
      let st;
      try {
        st = await fsp.stat(abs);
      } catch {
        consider(lcaRel);
        return;
      }
      if (st.size !== rec.size || mtimeChanged(st.mtimeMs, rec.mtimeMs)) consider(lcaRel);
    });
  }

  for (const rel of Object.keys(invFiles)) {
    if (invFiles[rel]?.skipped) continue;
    if (!seen.has(rel)) consider(rel);
  }

  return [...changed].sort();
}

async function makeWorkspaceIgnore(workspaceRoot, extraPrefixes = []) {
  return loadIgnore(workspaceRoot, extraPrefixes);
}

module.exports = {
  MAX_FILE_BYTES,
  inventoryPath,
  snapshotWorkspaceBaseline,
  snapshotWorkspaceRoots,
  writeInventory,
  readInventory,
  discoverChangedPaths,
  makeWorkspaceIgnore,
  walkFiles,
  toPosix,
};
