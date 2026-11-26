const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Bump when snapshot comparison semantics change. */
const VIEWER_PROTOCOL = 'session-watch-v1';

const FINGERPRINT_FILES = [
  'server.js',
  'bin/cli.js',
  'bin/watch-daemon.js',
  'lib/session-diff.js',
  'lib/session-store.js',
  'lib/viewer-identity.js',
  'lib/ignore-files.js',
  'lib/workspace-scan.js',
  'lib/workspace-watch.js',
  'public/app.js',
];

function hashFile(filePath) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return 'missing';
  }
}

function getViewerIdentity(appRoot) {
  const root = path.resolve(appRoot || path.join(__dirname, '..'));
  const hash = crypto.createHash('sha1');
  for (const rel of FINGERPRINT_FILES) {
    hash.update(rel);
    hash.update('\0');
    hash.update(hashFile(path.join(root, rel)));
    hash.update('\0');
  }
  return {
    protocol: VIEWER_PROTOCOL,
    codeFingerprint: hash.digest('hex').slice(0, 16),
    appRoot: root,
    supportsAfterSnapshot: true,
  };
}

function describeViewerCompatibility(health, expected) {
  if (!health || health.ok !== true) {
    return { ok: false, reason: 'unreachable' };
  }
  if (!health.protocol || health.supportsAfterSnapshot !== true) {
    return { ok: false, reason: 'missing-after-snapshot' };
  }
  if (health.protocol !== expected.protocol) {
    return { ok: false, reason: `protocol ${health.protocol} != ${expected.protocol}` };
  }
  if (health.codeFingerprint !== expected.codeFingerprint) {
    return { ok: false, reason: 'code-fingerprint-mismatch' };
  }
  if (health.appRoot && expected.appRoot
    && path.resolve(health.appRoot) !== path.resolve(expected.appRoot)) {
    return { ok: false, reason: 'app-root-mismatch' };
  }
  return { ok: true, reason: 'ok' };
}

module.exports = {
  VIEWER_PROTOCOL,
  getViewerIdentity,
  describeViewerCompatibility,
};
