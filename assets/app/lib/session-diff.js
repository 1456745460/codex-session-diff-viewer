const path = require('path');
const Diff = require('diff');
const {
  loadSession,
  listSessions,
  getLatestSessionId,
  readBaselineText,
  readCurrentText,
  trackFiles,
  normalizeRel,
  deriveProjectName,
  updateSessionMeta,
} = require('./session-store');

function guessLanguage(filePath) {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  const special = {
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    'cmakelists.txt': 'cmake',
    'nginx.conf': 'nginx',
    gemfile: 'ruby',
    rakefile: 'ruby',
    podfile: 'ruby',
    brewfile: 'ruby',
    vagrantfile: 'ruby',
  };
  if (special[base]) return special[base];
  if (base.endsWith('.gradle')) return 'gradle';
  if (base.endsWith('.cmake')) return 'cmake';

  const map = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.tsx': 'typescript',
    '.vue': 'xml',
    '.svelte': 'xml',
    '.astro': 'xml',
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python',
    '.ipynb': 'json',
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.scala': 'scala',
    '.groovy': 'groovy',
    '.gradle': 'gradle',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.erb': 'erb',
    '.php': 'php',
    '.phtml': 'php',
    '.cs': 'csharp',
    '.fs': 'fsharp',
    '.fsx': 'fsharp',
    '.vb': 'vbnet',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hh': 'cpp',
    '.hxx': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.m': 'objectivec',
    '.mm': 'objectivec',
    '.swift': 'swift',
    '.dart': 'dart',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'scss',
    '.less': 'less',
    '.styl': 'stylus',
    '.html': 'xml',
    '.htm': 'xml',
    '.xhtml': 'xml',
    '.xml': 'xml',
    '.xsl': 'xml',
    '.svg': 'xml',
    '.json': 'json',
    '.jsonc': 'json',
    '.json5': 'json',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.mdx': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.toml': 'ini',
    '.ini': 'ini',
    '.cfg': 'ini',
    '.conf': 'nginx',
    '.properties': 'properties',
    '.env': 'bash',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.fish': 'bash',
    '.ps1': 'powershell',
    '.psm1': 'powershell',
    '.bat': 'dos',
    '.cmd': 'dos',
    '.sql': 'sql',
    '.r': 'r',
    '.rmd': 'r',
    '.jl': 'julia',
    '.lua': 'lua',
    '.pl': 'perl',
    '.pm': 'perl',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.erl': 'erlang',
    '.hrl': 'erlang',
    '.hs': 'haskell',
    '.clj': 'clojure',
    '.cljs': 'clojure',
    '.edn': 'clojure',
    '.lisp': 'lisp',
    '.el': 'lisp',
    '.scm': 'scheme',
    '.rkt': 'lisp',
    '.ml': 'ocaml',
    '.mli': 'ocaml',
    '.nim': 'nim',
    '.zig': 'zig',
    '.d': 'd',
    '.pas': 'delphi',
    '.pp': 'delphi',
    '.proto': 'protobuf',
    '.graphql': 'graphql',
    '.gql': 'graphql',
    '.tf': 'terraform',
    '.hcl': 'hcl',
    '.nginx': 'nginx',
    '.dockerfile': 'dockerfile',
    '.makefile': 'makefile',
    '.mk': 'makefile',
    '.cmake': 'cmake',
    '.diff': 'diff',
    '.patch': 'diff',
    '.log': 'accesslog',
    '.txt': 'plaintext',
  };
  return map[ext] || 'plaintext';
}

function pairSideBySide(rows) {
  const result = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.type === 'del') {
      const dels = [];
      const adds = [];
      while (i < rows.length && rows[i].type === 'del') {
        dels.push(rows[i]);
        i += 1;
      }
      while (i < rows.length && rows[i].type === 'add') {
        adds.push(rows[i]);
        i += 1;
      }
      const max = Math.max(dels.length, adds.length);
      for (let k = 0; k < max; k += 1) {
        const left = dels[k] ? dels[k].left : { line: null, text: '', type: 'empty' };
        const right = adds[k] ? adds[k].right : { line: null, text: '', type: 'empty' };
        let type = 'ctx';
        if (dels[k] && adds[k]) type = 'mod';
        else if (dels[k]) type = 'del';
        else type = 'add';
        result.push({ type, left, right });
      }
    } else {
      result.push(row);
      i += 1;
    }
  }
  return result;
}

function buildLineDiff(oldText, newText) {
  const parts = Diff.diffLines(oldText, newText);
  const unified = [];
  const sideBySide = [];
  let oldLine = 1;
  let newLine = 1;

  for (const part of parts) {
    const rawLines = part.value.split('\n');
    if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();

    if (part.added) {
      for (const text of rawLines) {
        unified.push({ type: 'add', oldLine: null, newLine, text });
        sideBySide.push({
          type: 'add',
          left: { line: null, text: '', type: 'empty' },
          right: { line: newLine, text, type: 'add' },
        });
        newLine += 1;
      }
    } else if (part.removed) {
      for (const text of rawLines) {
        unified.push({ type: 'del', oldLine, newLine: null, text });
        sideBySide.push({
          type: 'del',
          left: { line: oldLine, text, type: 'del' },
          right: { line: null, text: '', type: 'empty' },
        });
        oldLine += 1;
      }
    } else {
      for (const text of rawLines) {
        unified.push({ type: 'ctx', oldLine, newLine, text });
        sideBySide.push({
          type: 'ctx',
          left: { line: oldLine, text, type: 'ctx' },
          right: { line: newLine, text, type: 'ctx' },
        });
        oldLine += 1;
        newLine += 1;
      }
    }
  }

  return {
    unified,
    sideBySide: pairSideBySide(sideBySide),
    stats: {
      additions: unified.filter((r) => r.type === 'add').length,
      deletions: unified.filter((r) => r.type === 'del').length,
    },
  };
}

function classifyStatus(baselineExists, currentExists, changed) {
  if (!baselineExists && currentExists) return 'added';
  if (baselineExists && !currentExists) return 'deleted';
  if (baselineExists && currentExists && changed) return 'modified';
  return 'unchanged';
}

async function buildFileEntry(session, relPath, opts = { includeUnchanged: false }) {
  const baseline = await readBaselineText(session.sessionId, relPath);
  const current = await readCurrentText(session.workspaceRoot, relPath);

  if (baseline.binary || current.binary) {
    const status = classifyStatus(baseline.exists, current.exists, true);
    if (status === 'unchanged' && !opts.includeUnchanged) return null;
    return {
      status: status === 'unchanged' ? 'modified' : status,
      path: relPath,
      oldPath: relPath,
      binary: true,
      additions: 0,
      deletions: 0,
    };
  }

  const oldText = baseline.exists ? baseline.text : '';
  const newText = current.exists ? current.text : '';
  const changed = oldText !== newText || baseline.exists !== current.exists;
  const status = classifyStatus(baseline.exists, current.exists, changed);
  if (!changed && !opts.includeUnchanged) return null;

  const built = buildLineDiff(oldText, newText);
  return {
    status,
    path: relPath,
    oldPath: relPath,
    binary: false,
    additions: built.stats.additions,
    deletions: built.stats.deletions,
  };
}


function basenameNoExt(filePath) {
  const base = path.basename(filePath || '');
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(0, idx) : base;
}

function uniqueKeepOrder(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function detectThemes(files) {
  const text = files.map((f) => f.path.toLowerCase()).join(' ');
  const themes = [];
  const rules = [
    [/session|会话/, '会话管理'],
    [/diff|变更|对比/, 'Diff 对比'],
    [/undo|revert|撤销|回滚/, '撤销回滚'],
    [/dropdown|select|下拉/, '下拉选择'],
    [/toolbar|topbar|工具栏/, '工具栏布局'],
    [/highlight|syntax|高亮/, '语法高亮'],
    [/connector|连线/, '差异连线'],
    [/sidebar|侧边|resize|拖拽/, '侧栏布局'],
    [/font|字体|字号/, '字体字号'],
    [/api|server|route/, '服务接口'],
    [/skill|agents|workflow/, 'Skill 工作流'],
    [/style|css|theme/, '样式主题'],
    [/ui|frontend|public\//, '前端界面'],
  ];
  for (const [re, name] of rules) {
    if (re.test(text)) themes.push(name);
  }
  return uniqueKeepOrder(themes);
}

function generateChangeSummary(files, options = {}) {
  const list = Array.isArray(files) ? files : [];
  const projectName = options.projectName || '项目';
  if (!list.length) {
    return options.fallback || `${projectName}：暂无有效代码变更`;
  }

  const added = list.filter((f) => f.status === 'added');
  const deleted = list.filter((f) => f.status === 'deleted');
  const modified = list.filter((f) => f.status === 'modified' || f.status === 'renamed' || f.status === 'copied');
  const themes = detectThemes(list);

  const pickNames = (arr, n = 2) => arr.slice(0, n).map((f) => path.basename(f.path));
  const parts = [];

  if (themes.length) {
    parts.push(`围绕${themes.slice(0, 3).join('、')}`);
  }

  const actionBits = [];
  if (modified.length) {
    const names = pickNames(modified, 2).join('、');
    actionBits.push(modified.length > 2 ? `修改 ${names} 等 ${modified.length} 个文件` : `修改 ${names}`);
  }
  if (added.length) {
    const names = pickNames(added, 2).join('、');
    actionBits.push(added.length > 2 ? `新增 ${names} 等 ${added.length} 个文件` : `新增 ${names}`);
  }
  if (deleted.length) {
    const names = pickNames(deleted, 2).join('、');
    actionBits.push(deleted.length > 2 ? `删除 ${names} 等 ${deleted.length} 个文件` : `删除 ${names}`);
  }
  if (actionBits.length) parts.push(actionBits.join('，'));

  // line-level hint
  const addLines = list.reduce((s, f) => s + (f.additions || 0), 0);
  const delLines = list.reduce((s, f) => s + (f.deletions || 0), 0);
  if (addLines || delLines) {
    parts.push(`合计 +${addLines}/-${delLines}`);
  }

  let summary = parts.join('，');
  if (!summary) summary = `更新 ${list.length} 个文件`;
  // normalize punctuation
  summary = summary.replace(/，+/g, '，').replace(/^，|，$/g, '');
  if (summary.length > 72) summary = `${summary.slice(0, 70)}…`;
  return summary;
}

async function collectChangedFiles(sessionId) {
  const latest = await loadSession(sessionId);
  const files = [];
  for (const f of latest.files) {
    const entry = await buildFileEntry(latest, f.path, { includeUnchanged: false });
    if (entry) files.push(entry);
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  return { session: latest, files };
}

async function finalizeSessionInsights(sessionId, options = {}) {
  const { session, files } = await collectChangedFiles(sessionId);
  const projectName = deriveProjectName(session.workspaceRoot) || session.projectName || 'project';
  const stats = {
    added: files.filter((f) => f.status === 'added').length,
    modified: files.filter((f) => f.status === 'modified' || f.status === 'renamed' || f.status === 'copied').length,
    deleted: files.filter((f) => f.status === 'deleted').length,
    additions: files.reduce((s, f) => s + (f.additions || 0), 0),
    deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
  };

  const manual = typeof options.summary === 'string' ? options.summary.trim() : '';
  const force = !!options.force;
  let changeSummary = manual;
  let summarySource = manual ? 'manual' : session.summarySource || '';

  if (!changeSummary) {
    if (!force && session.changeSummary && session.summarySource === 'manual') {
      changeSummary = session.changeSummary;
      summarySource = 'manual';
    } else if (!force && session.changeSummary && session.changedFileCount === files.length) {
      changeSummary = session.changeSummary;
      summarySource = session.summarySource || 'auto';
    } else {
      changeSummary = generateChangeSummary(files, { projectName, title: session.title });
      summarySource = 'auto';
    }
  }

  const meta = await updateSessionMeta(sessionId, {
    projectName,
    changeSummary,
    changedFileCount: files.length,
    stats,
    summarySource,
    summaryUpdatedAt: new Date().toISOString(),
  });

  return {
    sessionId,
    projectName,
    changeSummary,
    changedFileCount: files.length,
    stats,
    summarySource,
    files,
    meta,
  };
}

async function listSessionCards(limit = 100, options = {}) {
  const sessions = await listSessions(limit);
  const cards = [];
  for (const s of sessions) {
    let card = s;
    const need = options.refreshMissing && (!s.changeSummary || s.changedFileCount == null);
    if (need) {
      try {
        const insight = await finalizeSessionInsights(s.sessionId, { force: false });
        card = insight.meta;
      } catch {
        card = s;
      }
    }
    const projectName = deriveProjectName(card.workspaceRoot) || card.projectName || 'project';
    const changedFileCount = typeof card.changedFileCount === 'number'
      ? card.changedFileCount
      : (Array.isArray(card.files) ? card.files.length : 0);
    cards.push({
      sessionId: card.sessionId,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      workspaceRoot: card.workspaceRoot,
      projectName,
      title: card.title || projectName,
      changeSummary: card.changeSummary || '',
      changedFileCount,
      fileCount: Array.isArray(card.files) ? card.files.length : changedFileCount,
      stats: card.stats || null,
      summarySource: card.summarySource || '',
      note: card.note || '',
    });
  }
  return cards;
}


async function getSessionSummary(sessionId, options = {}) {
  const session = await loadSession(sessionId);
  // Optionally register late-known files as added (baseline missing)
  if (options.extraFiles?.length) {
    await trackFiles(sessionId, options.extraFiles);
  }
  const latest = await loadSession(sessionId);
  const files = [];
  for (const f of latest.files) {
    const entry = await buildFileEntry(latest, f.path, { includeUnchanged: false });
    if (entry) files.push(entry);
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'zh'));

  const projectName = deriveProjectName(latest.workspaceRoot) || latest.projectName || 'project';
  let changeSummary = latest.changeSummary || '';
  if (options.finalize) {
    const insight = await finalizeSessionInsights(sessionId, {
      summary: options.summary,
      force: !!options.forceSummary,
    });
    changeSummary = insight.changeSummary;
  } else if (!changeSummary) {
    changeSummary = generateChangeSummary(files, { projectName, title: latest.title });
  }

  return {
    mode: 'session',
    sessionId: latest.sessionId,
    repoRoot: latest.workspaceRoot,
    workspaceRoot: latest.workspaceRoot,
    projectName,
    title: latest.title,
    changeSummary,
    changedFileCount: files.length,
    createdAt: latest.createdAt,
    updatedAt: latest.updatedAt,
    branch: 'session',
    head: latest.sessionId.slice(0, 12),
    files,
    total: files.length,
    added: files.filter((f) => f.status === 'added').length,
    modified: files.filter((f) => f.status === 'modified').length,
    deleted: files.filter((f) => f.status === 'deleted').length,
    stats: {
      added: files.filter((f) => f.status === 'added').length,
      modified: files.filter((f) => f.status === 'modified').length,
      deleted: files.filter((f) => f.status === 'deleted').length,
      additions: files.reduce((s, f) => s + (f.additions || 0), 0),
      deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
    },
  };
}

async function getSessionFileDiff(sessionId, filePath) {
  const session = await loadSession(sessionId);
  const rel = normalizeRel(filePath);
  const known = session.files.some((f) => f.path === rel);
  if (!known) {
    // If file is not tracked, treat as potential new file in this session only when requested via track.
    const err = new Error(`会话未跟踪该文件: ${rel}`);
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  const baseline = await readBaselineText(sessionId, rel);
  const current = await readCurrentText(session.workspaceRoot, rel);

  if (baseline.binary || current.binary) {
    return {
      status: classifyStatus(baseline.exists, current.exists, true),
      path: rel,
      oldPath: rel,
      binary: true,
      oldText: '',
      newText: '',
      unified: [],
      sideBySide: [],
      stats: { additions: 0, deletions: 0 },
      language: guessLanguage(rel),
    };
  }

  const oldText = baseline.exists ? baseline.text : '';
  const newText = current.exists ? current.text : '';
  const status = classifyStatus(baseline.exists, current.exists, oldText !== newText);
  const built = buildLineDiff(oldText, newText);
  return {
    status,
    path: rel,
    oldPath: rel,
    binary: false,
    oldText,
    newText,
    language: guessLanguage(rel),
    ...built,
  };
}

async function resolveSessionId(input) {
  if (input && input !== 'latest') return input;
  const latest = await getLatestSessionId();
  if (!latest) {
    const err = new Error('没有可用的会话快照。请先运行 begin 捕获基线。');
    err.code = 'NO_SESSION';
    throw err;
  }
  return latest;
}

module.exports = {
  getSessionSummary,
  getSessionFileDiff,
  resolveSessionId,
  listSessions,
  listSessionCards,
  finalizeSessionInsights,
  generateChangeSummary,
  buildLineDiff,
};
