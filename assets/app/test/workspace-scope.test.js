const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const {
  hasProjectMarker,
  lowestCommonAncestor,
  pathPrefix,
  prefixedRel,
  assertNotMultiProjectBasket,
  resolveWorkspaceRoots,
} = require('../lib/workspace-scope');

async function mkdirp(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function write(p, content = 'x') {
  await mkdirp(path.dirname(p));
  await fsp.writeFile(p, content);
}

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-scope-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test('lowestCommonAncestor of sibling projects is the parent', () => {
  const parent = path.join(os.tmpdir(), 'PycharmProjects');
  const a = path.join(parent, 'test');
  const b = path.join(parent, 'test2');
  assert.equal(lowestCommonAncestor([a, b]), parent);
  assert.equal(lowestCommonAncestor([a]), a);
});

test('pathPrefix is relative to the display root', () => {
  const parent = path.join(os.tmpdir(), 'PycharmProjects');
  const a = path.join(parent, 'test');
  assert.equal(pathPrefix(parent, a), 'test');
  assert.equal(pathPrefix(a, a), '');
  assert.equal(prefixedRel('test', 'test.txt'), 'test/test.txt');
  assert.equal(prefixedRel('', 'test.txt'), 'test.txt');
});

test('hasProjectMarker recognizes git and package.json', async () => {
  await withTempDir(async (dir) => {
    assert.equal(await hasProjectMarker(dir), false);
    await mkdirp(path.join(dir, '.git'));
    assert.equal(await hasProjectMarker(dir), true);
  });
  await withTempDir(async (dir) => {
    await write(path.join(dir, 'package.json'), '{}');
    assert.equal(await hasProjectMarker(dir), true);
  });
});

test('assertNotMultiProjectBasket refuses a folder of independent projects', async () => {
  await withTempDir(async (basket) => {
    await mkdirp(path.join(basket, 'projA', '.git'));
    await mkdirp(path.join(basket, 'projB', '.git'));
    await write(path.join(basket, 'projA', 'a.txt'));
    await write(path.join(basket, 'projB', 'b.txt'));
    await write(path.join(basket, 'loose', 'c.txt'));
    await assert.rejects(
      () => assertNotMultiProjectBasket(basket),
      (err) => err.code === 'WORKSPACE_MULTI_PROJECT' && /projA/.test(err.message),
    );
  });
});

test('assertNotMultiProjectBasket allows a git monorepo', async () => {
  await withTempDir(async (repo) => {
    await mkdirp(path.join(repo, '.git'));
    await mkdirp(path.join(repo, 'packages', 'a', '.git'));
    await mkdirp(path.join(repo, 'packages', 'b', '.git'));
    await assertNotMultiProjectBasket(repo);
  });
});

test('assertNotMultiProjectBasket allows a single unmarked folder', async () => {
  await withTempDir(async (dir) => {
    await write(path.join(dir, 'test.txt'), 'hi');
    await assertNotMultiProjectBasket(dir);
  });
});

test('resolveWorkspaceRoots dedupes and returns absolute paths', async () => {
  await withTempDir(async (dir) => {
    await write(path.join(dir, 'a.txt'));
    const roots = await resolveWorkspaceRoots({ workspaces: [dir, dir] });
    assert.deepEqual(roots, [path.resolve(dir)]);
  });
});

describe('createSession workspace scope', { concurrency: false }, () => {
  async function withCodexHome(fn) {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      return await fn(home);
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
      await fsp.rm(home, { recursive: true, force: true });
    }
  }

  async function listRelFiles(root) {
    const out = [];
    async function walk(rel) {
      const abs = rel ? path.join(root, rel) : root;
      let entries;
      try {
        entries = await fsp.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const child = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) await walk(child);
        else out.push(child);
      }
    }
    await walk('');
    return out.sort();
  }

  test('refuses begin on a multi-project parent', async () => {
    const { createSession } = require('../lib/session-store');
    await withCodexHome(async () => {
      await withTempDir(async (basket) => {
        await mkdirp(path.join(basket, 'projA', '.git'));
        await mkdirp(path.join(basket, 'projB', '.git'));
        await write(path.join(basket, 'projA', 'a.txt'));
        await write(path.join(basket, 'projB', 'b.txt'));
        await assert.rejects(
          () => createSession({ workspace: basket, watch: false }),
          (err) => err.code === 'WORKSPACE_MULTI_PROJECT',
        );
      });
    });
  });

  test('two workspace roots do not snapshot sibling projects', async () => {
    const { createSession, baselineDir } = require('../lib/session-store');
    await withCodexHome(async () => {
      await withTempDir(async (parent) => {
        await mkdirp(path.join(parent, 'sibling', '.git'));
        await write(path.join(parent, 'sibling', 'secret.txt'), 'nope');
        await write(path.join(parent, 'test', 'test.txt'), 'hello 1');
        await write(path.join(parent, 'test2', 'test.txt'), 'hello 2');
        const meta = await createSession({
          workspaces: [path.join(parent, 'test'), path.join(parent, 'test2')],
          watch: false,
        });
        assert.equal(meta.workspaceRoot, path.resolve(parent));
        assert.deepEqual(
          meta.workspaceRoots.map((p) => path.resolve(p)),
          [path.resolve(parent, 'test'), path.resolve(parent, 'test2')],
        );
        const files = await listRelFiles(baselineDir(meta.sessionId));
        assert.ok(files.includes('test/test.txt'));
        assert.ok(files.includes('test2/test.txt'));
        assert.equal(files.some((f) => f.includes('sibling')), false, files.join(','));
        assert.equal(files.some((f) => f.includes('secret')), false);
      });
    });
  });

  test('summarize prunes unchanged files from baseline but keeps original content', async () => {
    const {
      createSession,
      baselineDir,
      captureAfterSnapshot,
      readBaselineText,
    } = require('../lib/session-store');
    await withCodexHome(async () => {
      await withTempDir(async (proj) => {
        await mkdirp(path.join(proj, '.git'));
        await write(path.join(proj, 'keep.txt'), 'before');
        await write(path.join(proj, 'drop.txt'), 'untouched');
        const meta = await createSession({ workspace: proj, watch: false });
        const before = await listRelFiles(baselineDir(meta.sessionId));
        assert.ok(before.includes('keep.txt'));
        assert.ok(before.includes('drop.txt'));

        await write(path.join(proj, 'keep.txt'), 'after');
        await captureAfterSnapshot(meta.sessionId, { refresh: true });

        const after = await listRelFiles(baselineDir(meta.sessionId));
        assert.ok(after.includes('keep.txt'), after.join(','));
        assert.equal(after.includes('drop.txt'), false, after.join(','));
        const baseline = await readBaselineText(meta.sessionId, 'keep.txt');
        assert.equal(baseline.exists, true);
        assert.equal(baseline.text, 'before');
      });
    });
  });
});
