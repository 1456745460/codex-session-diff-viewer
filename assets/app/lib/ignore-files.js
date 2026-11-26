const path = require('path');
const fsp = require('fs/promises');

const DEFAULT_DIR_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  '.jj',
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.output',
  '.gradle',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.idea',
  '.vscode',
]);

const DEFAULT_FILE_RES = [
  /^\.DS_Store$/i,
  /^Thumbs\.db$/i,
  /~$/,
  /\.(swp|swo|tmp|pyc|pyo|class|jar|war|min\.js|map)$/i,
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|7z|woff2?|ttf|eot|mp4|mov|wav|mp3)$/i,
];

function toPosix(rel) {
  return String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function globToRegExp(glob, { dirOnly, anchored }) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      source += '.*';
      i += 1;
      if (glob[i + 1] === '/') i += 1;
    } else if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else if ('+()[]^$|.{}\''.includes(ch)) {
      source += `\\${ch}`;
    } else {
      source += ch;
    }
  }
  const suffix = dirOnly ? '(?:/|$)' : '$';
  if (anchored) return new RegExp(`^${source}${suffix}`);
  return new RegExp(`(?:^|/)${source}${suffix}`);
}

function compileGitignore(text) {
  const rules = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let body = trimmed;
    const negated = body.startsWith('!');
    if (negated) body = body.slice(1);
    const dirOnly = body.endsWith('/');
    if (dirOnly) body = body.slice(0, -1);
    const anchored = body.startsWith('/');
    if (anchored) body = body.slice(1);
    if (!body) continue;
    rules.push({
      negated,
      dirOnly,
      re: globToRegExp(body, { dirOnly, anchored }),
    });
  }
  return rules;
}

function lastMatch(rules, rel) {
  let ignored = false;
  for (const rule of rules) {
    if (!rule.re.test(rel)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

function hasIgnoredDirPart(rel) {
  const parts = toPosix(rel).split('/').filter(Boolean);
  return parts.some((part) => DEFAULT_DIR_NAMES.has(part));
}

function isJunkFileName(rel) {
  const base = path.posix.basename(toPosix(rel));
  return DEFAULT_FILE_RES.some((re) => re.test(base));
}

async function readMaybe(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function loadIgnore(workspaceRoot, extraPrefixes = []) {
  const root = path.resolve(workspaceRoot);
  const gitignore = await readMaybe(path.join(root, '.gitignore'));
  const exclude = await readMaybe(path.join(root, '.git', 'info', 'exclude'));
  const rules = [
    ...compileGitignore(gitignore),
    ...compileGitignore(exclude),
  ];
  const prefixes = extraPrefixes
    .map(toPosix)
    .filter(Boolean)
    .map((p) => p.replace(/\/$/, ''));

  function shouldIgnore(relPath, isDir = false) {
    const rel = toPosix(relPath);
    if (!rel || rel === '.') return true;
    if (rel === '.git' || rel.startsWith('.git/')) return true;
    if (hasIgnoredDirPart(rel)) return true;
    if (!isDir && isJunkFileName(rel)) return true;
    for (const prefix of prefixes) {
      if (rel === prefix || rel.startsWith(`${prefix}/`)) return true;
    }
    if (rules.length && lastMatch(rules, rel)) return true;
    return false;
  }

  return { shouldIgnore };
}

module.exports = {
  DEFAULT_DIR_NAMES,
  loadIgnore,
  toPosix,
};
