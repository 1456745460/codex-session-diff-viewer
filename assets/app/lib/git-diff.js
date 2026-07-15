const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs/promises');
const Diff = require('diff');

const execFileAsync = promisify(execFile);

async function runGit(cwd, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf8',
      ...options,
    });
    return { stdout: stdout || '', stderr: stderr || '', code: 0 };
  } catch (error) {
    if (error.stdout !== undefined || error.stderr !== undefined) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        code: typeof error.code === 'number' ? error.code : 1,
      };
    }
    throw error;
  }
}

async function resolveRepoRoot(startDir) {
  const result = await runGit(startDir, ['rev-parse', '--show-toplevel']);
  if (result.code !== 0) {
    const err = new Error(`当前目录不是 Git 仓库：${startDir}`);
    err.code = 'NOT_GIT_REPO';
    throw err;
  }
  return result.stdout.trim();
}

function parseNameStatus(stdout) {
  const files = [];
  const lines = stdout.split('\n').filter(Boolean);
  for (const line of lines) {
    // Format: STATUS\tpath  or  STATUS\told\tnew (renames)
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const statusRaw = parts[0].trim();
    const statusCode = statusRaw[0];
    let status = 'modified';
    if (statusCode === 'A') status = 'added';
    else if (statusCode === 'D') status = 'deleted';
    else if (statusCode === 'M') status = 'modified';
    else if (statusCode === 'R') status = 'renamed';
    else if (statusCode === 'C') status = 'copied';
    else if (statusCode === 'T') status = 'modified';
    else if (statusCode === 'U') status = 'modified';
    else if (statusCode === '?') status = 'added';

    if (parts.length >= 3 && (statusCode === 'R' || statusCode === 'C')) {
      files.push({
        status,
        path: parts[2],
        oldPath: parts[1],
        statusCode: statusRaw,
      });
    } else {
      files.push({
        status,
        path: parts[1],
        oldPath: parts[1],
        statusCode: statusRaw,
      });
    }
  }
  return files;
}

async function isBinaryPath(repoRoot, filePath) {
  // Check working tree first, then HEAD version
  const abs = path.join(repoRoot, filePath);
  try {
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) return true;
  } catch {
    // deleted or missing in working tree
  }
  const head = await runGit(repoRoot, ['show', `HEAD:${filePath}`], {
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (head.code === 0 && Buffer.isBuffer(head.stdout) && head.stdout.includes(0)) {
    return true;
  }
  // If we used string encoding fallback:
  if (head.code === 0 && typeof head.stdout === 'string' && head.stdout.includes('\u0000')) {
    return true;
  }
  return false;
}

async function readWorkingFile(repoRoot, filePath) {
  try {
    return await fs.readFile(path.join(repoRoot, filePath), 'utf8');
  } catch {
    return '';
  }
}

async function readHeadFile(repoRoot, filePath) {
  const result = await runGit(repoRoot, ['show', `HEAD:${filePath}`]);
  if (result.code !== 0) return '';
  return result.stdout;
}

async function listChangedFiles(repoRoot) {
  // Unstaged + staged tracked changes
  const nameStatus = await runGit(repoRoot, [
    'diff',
    '--name-status',
    '--find-renames',
    'HEAD',
  ]);
  // Untracked files
  const untracked = await runGit(repoRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);

  const map = new Map();

  for (const f of parseNameStatus(nameStatus.stdout)) {
    map.set(f.path, f);
  }

  for (const p of untracked.stdout.split('\n').filter(Boolean)) {
    if (!map.has(p)) {
      map.set(p, {
        status: 'added',
        path: p,
        oldPath: p,
        statusCode: '?',
      });
    }
  }

  const files = Array.from(map.values()).sort((a, b) =>
    a.path.localeCompare(b.path, 'zh')
  );

  // Enrich with stats
  const enriched = [];
  for (const f of files) {
    const binary = await isBinaryFileQuick(repoRoot, f);
    let additions = 0;
    let deletions = 0;
    if (!binary) {
      const oldText =
        f.status === 'added' ? '' : await readHeadFile(repoRoot, f.oldPath || f.path);
      const newText =
        f.status === 'deleted' ? '' : await readWorkingFile(repoRoot, f.path);
      const parts = Diff.diffLines(oldText, newText);
      for (const part of parts) {
        const count = part.count || (part.value ? part.value.split('\n').length - (part.value.endsWith('\n') ? 1 : 0) : 0);
        if (part.added) additions += count;
        if (part.removed) deletions += count;
      }
    }
    enriched.push({
      ...f,
      binary,
      additions,
      deletions,
    });
  }
  return enriched;
}

async function isBinaryFileQuick(repoRoot, file) {
  try {
    // Prefer git's binary detection via numstat
    const target = file.path;
    const numstat = await runGit(repoRoot, ['diff', '--numstat', 'HEAD', '--', target]);
    const line = numstat.stdout.trim().split('\n')[0] || '';
    if (line.startsWith('-\t-\t')) return true;

    if (file.status === 'added' || file.statusCode === '?') {
      const abs = path.join(repoRoot, file.path);
      const buf = await fs.readFile(abs).catch(() => null);
      if (buf && buf.includes(0)) return true;
      // size guard: treat very large non-text-ish as binary for viewer
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

function buildLineDiff(oldText, newText) {
  const parts = Diff.diffLines(oldText, newText);
  const unified = [];
  const sideBySide = [];

  let oldLine = 1;
  let newLine = 1;

  for (const part of parts) {
    const rawLines = part.value.split('\n');
    // diffLines keeps trailing newline as empty last item when ends with \n
    if (rawLines.length && rawLines[rawLines.length - 1] === '') {
      rawLines.pop();
    }

    if (part.added) {
      for (const text of rawLines) {
        unified.push({
          type: 'add',
          oldLine: null,
          newLine: newLine,
          text,
        });
        sideBySide.push({
          type: 'add',
          left: { line: null, text: '', type: 'empty' },
          right: { line: newLine, text, type: 'add' },
        });
        newLine += 1;
      }
    } else if (part.removed) {
      for (const text of rawLines) {
        unified.push({
          type: 'del',
          oldLine: oldLine,
          newLine: null,
          text,
        });
        sideBySide.push({
          type: 'del',
          left: { line: oldLine, text, type: 'del' },
          right: { line: null, text: '', type: 'empty' },
        });
        oldLine += 1;
      }
    } else {
      for (const text of rawLines) {
        unified.push({
          type: 'ctx',
          oldLine: oldLine,
          newLine: newLine,
          text,
        });
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

  // Pair adjacent del+add into "modify" rows for nicer side-by-side
  const paired = pairSideBySide(sideBySide);

  return {
    unified,
    sideBySide: paired,
    stats: {
      additions: unified.filter((r) => r.type === 'add').length,
      deletions: unified.filter((r) => r.type === 'del').length,
    },
  };
}

function pairSideBySide(rows) {
  const result = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.type === 'del') {
      // Collect consecutive dels then adds
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
        const left = dels[k]
          ? dels[k].left
          : { line: null, text: '', type: 'empty' };
        const right = adds[k]
          ? adds[k].right
          : { line: null, text: '', type: 'empty' };
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

async function getFileDiff(repoRoot, filePath) {
  const files = await listChangedFiles(repoRoot);
  const meta =
    files.find((f) => f.path === filePath) ||
    files.find((f) => f.oldPath === filePath);

  if (!meta) {
    const err = new Error(`未找到变更文件：${filePath}`);
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  if (meta.binary) {
    return {
      ...meta,
      oldText: '',
      newText: '',
      binary: true,
      unified: [],
      sideBySide: [],
      stats: { additions: 0, deletions: 0 },
    };
  }

  const oldPath = meta.oldPath || meta.path;
  const oldText =
    meta.status === 'added' ? '' : await readHeadFile(repoRoot, oldPath);
  const newText =
    meta.status === 'deleted' ? '' : await readWorkingFile(repoRoot, meta.path);

  const built = buildLineDiff(oldText, newText);
  return {
    ...meta,
    oldText,
    newText,
    language: guessLanguage(meta.path),
    ...built,
  };
}

function guessLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.css': 'css',
    '.scss': 'scss',
    '.html': 'html',
    '.vue': 'vue',
    '.json': 'json',
    '.md': 'markdown',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.xml': 'xml',
    '.sh': 'bash',
    '.sql': 'sql',
  };
  return map[ext] || 'plaintext';
}

async function getRepoSummary(startDir) {
  const repoRoot = await resolveRepoRoot(startDir);
  const branch = await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = await runGit(repoRoot, ['rev-parse', '--short', 'HEAD']);
  const files = await listChangedFiles(repoRoot);
  return {
    repoRoot,
    branch: branch.stdout.trim() || 'HEAD',
    head: head.stdout.trim() || '',
    files,
    total: files.length,
    added: files.filter((f) => f.status === 'added').length,
    modified: files.filter((f) => f.status === 'modified' || f.status === 'renamed' || f.status === 'copied').length,
    deleted: files.filter((f) => f.status === 'deleted').length,
  };
}

module.exports = {
  resolveRepoRoot,
  listChangedFiles,
  getFileDiff,
  getRepoSummary,
};
