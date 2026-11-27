const fsp = require('fs/promises');
const path = require('path');

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pom.xml',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'Cargo.toml',
  'go.mod',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'CMakeLists.txt',
];

function toPosix(rel) {
  return String(rel || '').replace(/\\/g, '/');
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

async function hasProjectMarker(dir) {
  for (const marker of PROJECT_MARKERS) {
    if (await pathExists(path.join(dir, marker))) return true;
  }
  return false;
}

async function listProjectChildren(dir, { limit = 8 } = {}) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    if (await hasProjectMarker(path.join(dir, ent.name))) {
      names.push(ent.name);
      if (names.length >= limit) break;
    }
  }
  return names;
}

function lowestCommonAncestor(dirs) {
  const resolved = (dirs || []).map((d) => path.resolve(d));
  if (!resolved.length) return path.resolve(process.cwd());
  if (resolved.length === 1) return resolved[0];
  const partsList = resolved.map((d) => d.split(path.sep));
  let i = 0;
  while (i < partsList[0].length && partsList.every((p) => p[i] === partsList[0][i])) {
    i += 1;
  }
  const ancestor = partsList[0].slice(0, i).join(path.sep);
  return ancestor || path.sep;
}

function pathPrefix(pathRoot, root) {
  const rel = toPosix(path.relative(path.resolve(pathRoot), path.resolve(root)));
  if (!rel || rel === '.') return '';
  if (rel.startsWith('../') || rel === '..') {
    const err = new Error(`工作区不在共同父目录下: ${root}`);
    err.code = 'WORKSPACE_ESCAPE';
    throw err;
  }
  return rel;
}

function prefixedRel(prefix, rel) {
  const posix = toPosix(rel);
  if (!posix) return prefix || '';
  return prefix ? `${prefix}/${posix}` : posix;
}

async function assertNotMultiProjectBasket(dir) {
  const abs = path.resolve(dir);
  if (await hasProjectMarker(abs)) return null;
  const children = await listProjectChildren(abs, { limit: 8 });
  if (children.length < 2) return null;
  const examples = children.slice(0, 2)
    .map((name) => `--workspace ${path.join(abs, name)}`)
    .join(' ');
  const err = new Error(
    `工作区 ${abs} 看起来是多个项目的父目录（例如 ${children.slice(0, 5).join(', ')}）。`
    + `请改传实际项目根，可重复 --workspace。例如:\n  begin ${examples}`,
  );
  err.code = 'WORKSPACE_MULTI_PROJECT';
  err.childProjects = children;
  throw err;
}

async function resolveWorkspaceRoots({ workspace, workspaces } = {}) {
  const raw = [];
  if (Array.isArray(workspaces) && workspaces.length) raw.push(...workspaces);
  else if (workspace) raw.push(workspace);
  else raw.push(process.cwd());

  const resolved = [];
  const seen = new Set();
  for (const item of raw) {
    const abs = path.resolve(item);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!(await isDirectory(abs))) {
      const err = new Error(`工作区不存在: ${abs}`);
      err.code = 'WORKSPACE_MISSING';
      throw err;
    }
    await assertNotMultiProjectBasket(abs);
    resolved.push(abs);
  }
  if (!resolved.length) {
    const err = new Error('未指定工作区');
    err.code = 'WORKSPACE_MISSING';
    throw err;
  }
  return resolved;
}

module.exports = {
  PROJECT_MARKERS,
  hasProjectMarker,
  listProjectChildren,
  lowestCommonAncestor,
  pathPrefix,
  prefixedRel,
  assertNotMultiProjectBasket,
  resolveWorkspaceRoots,
};
