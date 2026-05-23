import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

const SCRIPT = new URL(
  "./i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs",
  import.meta.url,
);

function writeFixture(root, rel, source) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

const positiveSource = `
import { RecommendationsProvider } from "../../contexts/RecommendationsContext";

export function CollabDeckSheet({ sessionId, onClose }) {
  return (
    <View style={styles.deck}>
      <RecommendationsProvider
        currentMode={sessionId}
        refreshKey={0}
        persistedSessionId={sessionId}
        onSessionLost={onClose}
        key={sessionId}
      >
        <SwipeableCards currentMode={sessionId} sessionIdOverride={sessionId} />
      </RecommendationsProvider>
    </View>
  );
}
`;

const negativeSource = `
export function CollabDeckSheet({ sessionId }) {
  return (
    <View style={styles.deck}>
      <SwipeableCards currentMode={sessionId} sessionIdOverride={sessionId} />
    </View>
  );
}
`;

test("ORCH-0939 strict-grep gate passes the post-fix codebase", () => {
  const output = execFileSync(process.execPath, [SCRIPT.pathname], {
    encoding: "utf8",
  });
  assert.match(output, /PASS/);
  assert.match(output, /violations=0/);
});

test("ORCH-0939 strict-grep gate passes a positive provider-wrap fixture", () => {
  const root = mkdtempSync(join(tmpdir(), "orch-0939-provider-positive-"));
  try {
    const file = writeFixture(root, "CollabDeckSheet.tsx", positiveSource);
    const output = execFileSync(process.execPath, [SCRIPT.pathname, "--target", file], {
      encoding: "utf8",
    });
    assert.match(output, /PASS/);
    assert.match(output, /violations=0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ORCH-0939 strict-grep gate fails when the provider wrap is removed", () => {
  const root = mkdtempSync(join(tmpdir(), "orch-0939-provider-negative-"));
  try {
    const file = writeFixture(root, "CollabDeckSheet.tsx", negativeSource);
    const result = spawnSync(process.execPath, [SCRIPT.pathname, "--target", file], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing RecommendationsProvider import/);
    assert.match(result.stderr, /missing <RecommendationsProvider currentMode=\{sessionId\}/);
    assert.match(result.stdout, /FAIL/);
    assert.match(result.stdout, /violations=2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
