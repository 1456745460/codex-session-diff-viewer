const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { loadIgnore } = require('../lib/ignore-files');
const {
  watchWorkspace,
  addDirtyPaths,
  readDirty,
} = require('../lib/workspace-watch');

async function mkdirp(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function write(p, content) {
  await mkdirp(path.dirname(p));
  await fsp.writeFile(p, content);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-diff-test-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('loadIgnore honors skill ignore-dirs including .thinkrail/context/', async () => {
  await withTempDir(async (root) => {
    const ignoreFile = path.join(root, 'ignore-dirs.txt');
    await write(ignoreFile, 'node_modules/\n.thinkrail/context/\n');
    await write(path.join(root, 'ws', 'src', 'a.js'), 'a');
    await write(path.join(root, 'ws', '.thinkrail', 'context', 'TASK.md'), 'x');
    await write(path.join(root, 'ws', 'node_modules', 'pkg', 'index.js'), 'z');
    const { shouldIgnore } = await loadIgnore(path.join(root, 'ws'), [], { ignoreFile });
    assert.equal(shouldIgnore('src/a.js', false), false);
    assert.equal(shouldIgnore('.thinkrail/context', true), true);
    assert.equal(shouldIgnore('.thinkrail/context/TASK.md', false), true);
    assert.equal(shouldIgnore('node_modules/pkg/index.js', false), true);
  });
});

test('watch records simultaneous writes in two directories', async () => {
  await withTempDir(async (root) => {
    await write(path.join(root, 'dirA', 'a.txt'), 'a0');
    await write(path.join(root, 'dirB', 'b.txt'), 'b0');
    const { shouldIgnore } = await loadIgnore(root, [], {
      ignoreFile: path.join(root, 'missing-ignore.txt'),
    });
    const batches = [];
    const watcher = await watchWorkspace(root, {
      shouldIgnore,
      debounceMs: 40,
      onBatch: (paths) => {
        batches.push(paths);
      },
    });
    try {
      await sleep(120);
      await Promise.all([
        write(path.join(root, 'dirA', 'a.txt'), 'a1'),
        write(path.join(root, 'dirB', 'b.txt'), 'b1'),
      ]);
      await sleep(250);
      const noted = new Set(batches.flat());
      assert.equal(noted.has('dirA/a.txt'), true, `missing dirA/a.txt in ${[...noted]}`);
      assert.equal(noted.has('dirB/b.txt'), true, `missing dirB/b.txt in ${[...noted]}`);
    } finally {
      watcher.close();
    }
  });
});

test('watch skips ignored directories and still sees other dirs', async () => {
  await withTempDir(async (root) => {
    await write(path.join(root, 'src', 'app.js'), '1');
    await write(path.join(root, 'lib', 'util.js'), '2');
    await write(path.join(root, 'node_modules', 'leftpad', 'index.js'), '3');
    await write(path.join(root, '.thinkrail', 'context', 'TASK.md'), 'draft');
    const ignoreFile = path.join(root, 'ignore-dirs.txt');
    await write(ignoreFile, 'node_modules/\n.thinkrail/context/\n');
    const { shouldIgnore } = await loadIgnore(root, [], { ignoreFile });
    const noted = new Set();
    const watcher = await watchWorkspace(root, {
      shouldIgnore,
      debounceMs: 40,
      onBatch: (paths) => {
        for (const p of paths) noted.add(p);
      },
    });
    try {
      await sleep(120);
      await Promise.all([
        write(path.join(root, 'src', 'app.js'), '11'),
        write(path.join(root, 'lib', 'util.js'), '22'),
        write(path.join(root, 'node_modules', 'leftpad', 'index.js'), '33'),
        write(path.join(root, '.thinkrail', 'context', 'TASK.md'), 'changed'),
      ]);
      await sleep(250);
      assert.equal(noted.has('src/app.js'), true, `missing src/app.js in ${[...noted]}`);
      assert.equal(noted.has('lib/util.js'), true, `missing lib/util.js in ${[...noted]}`);
      assert.equal(noted.has('node_modules/leftpad/index.js'), false);
      assert.equal(
        [...noted].some((p) => p.startsWith('.thinkrail/context')),
        false,
        `ignored context leaked: ${[...noted]}`,
      );
    } finally {
      watcher.close();
    }
  });
});

test('concurrent addDirtyPaths does not drop either directory', async () => {
  await withTempDir(async (sessionDir) => {
    await Promise.all([
      addDirtyPaths(sessionDir, 's1', ['dirA/a.txt']),
      addDirtyPaths(sessionDir, 's1', ['dirB/b.txt']),
    ]);
    const dirty = await readDirty(sessionDir);
    assert.deepEqual(dirty.paths, ['dirA/a.txt', 'dirB/b.txt']);
  });
});
