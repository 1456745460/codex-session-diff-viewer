const path = require('path');
const fsp = require('fs/promises');

const DEFAULT_IGNORE_TEXT = `.git/
.svn/
.hg/
.jj/
node_modules/
bower_components/
dist/
build/
out/
target/
coverage/
.next/
.nuxt/
.cache/
.turbo/
.output/
.gradle/
__pycache__/
.venv/
venv/
.tox/
.mypy_cache/
.pytest_cache/
.idea/
.vscode/
.thinkrail/context/
`;

const DEFAULT_DIR_NAMES = new Set(
  DEFAULT_IGNORE_TEXT.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/\/$/, '').replace(/^\//, ''))
    .filter((line) => line && !line.includes('/')),
);

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

function defaultIgnoreFile() {
  if (process.env.CODEX_SESSION_DIFF_IGNORE_FILE) {
    return process.env.CODEX_SESSION_DIFF_IGNORE_FILE;
  }
  return path.resolve(__dirname, '..', '..', '..', 'ignore-dirs.txt');
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

async function readFileOrNull(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function loadIgnore(workspaceRoot, extraPrefixes = [], options = {}) {
  const root = path.resolve(workspaceRoot);
  const ignoreFile = options.ignoreFile || defaultIgnoreFile();
  const skillRaw = await readFileOrNull(ignoreFile);
  const skillText = skillRaw == null ? DEFAULT_IGNORE_TEXT : skillRaw;
  const gitignore = await readMaybe(path.join(root, '.gitignore'));
  const exclude = await readMaybe(path.join(root, '.git', 'info', 'exclude'));
  const rules = [
    ...compileGitignore(skillText),
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
    if (!isDir && isJunkFileName(rel)) return true;
    for (const prefix of prefixes) {
      if (rel === prefix || rel.startsWith(`${prefix}/`)) return true;
    }
    if (rules.length && lastMatch(rules, rel)) return true;
    return false;
  }

  return { shouldIgnore, ignoreFile };
}

module.exports = {
  DEFAULT_DIR_NAMES,
  DEFAULT_IGNORE_TEXT,
  defaultIgnoreFile,
  loadIgnore,
  toPosix,
};
