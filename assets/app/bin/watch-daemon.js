#!/usr/bin/env node
const path = require('path');
const { loadSession, sessionDir, sessionsRootIgnorePrefix } = require('../lib/session-store');
const { runWatchLoop } = require('../lib/workspace-watch');
const { makeWorkspaceIgnore } = require('../lib/workspace-scan');

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('watch-daemon 需要 sessionId');
    process.exit(2);
  }
  const meta = await loadSession(sessionId);
  const dir = sessionDir(sessionId);
  const extra = sessionsRootIgnorePrefix(meta.workspaceRoot);
  const ignore = await makeWorkspaceIgnore(meta.workspaceRoot, extra);
  process.title = `codex-session-watch:${sessionId}`;
  await runWatchLoop({
    sessionId,
    sessionDir: dir,
    workspaceRoot: meta.workspaceRoot,
    shouldIgnore: ignore.shouldIgnore,
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
