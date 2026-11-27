#!/usr/bin/env node
const { loadSession, sessionDir, buildWatchTargets } = require('../lib/session-store');
const { runWatchLoop } = require('../lib/workspace-watch');

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('watch-daemon 需要 sessionId');
    process.exit(2);
  }
  const meta = await loadSession(sessionId);
  const dir = sessionDir(sessionId);
  const targets = await buildWatchTargets(meta);
  process.title = `codex-session-watch:${sessionId}`;
  await runWatchLoop({
    sessionId,
    sessionDir: dir,
    workspaceRoot: meta.workspaceRoot,
    targets,
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
