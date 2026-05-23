import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

const SCRIPT = new URL(
  "./i-proposed-orch-0931-no-pk-filter-realtime.mjs",
  import.meta.url,
);

function writeFixture(root, rel, source) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

test("ORCH-0931 strict-grep gate passes the post-fix codebase", () => {
  const output = execFileSync(process.execPath, [SCRIPT.pathname], {
    encoding: "utf8",
  });
  assert.match(output, /0 violations/);
});

test("ORCH-0931 strict-grep gate fails PK id=eq filters and allows non-PK filters plus broadcast", () => {
  const root = mkdtempSync(join(tmpdir(), "orch-0931-realtime-gate-"));
  try {
    const srcRoot = join(root, "app-mobile", "src");
    mkdirSync(srcRoot, { recursive: true });
    writeFixture(
      root,
      "app-mobile/src/bad-collab.ts",
      [
        "supabase.channel('board_session:sess-1')",
        "  .on('postgres_changes', {",
        "    event: 'UPDATE',",
        "    schema: 'public',",
        "    table: 'collaboration_sessions',",
        "    filter: `id=eq.${sessionId}`,",
        "  }, handler);",
        "",
      ].join("\n"),
    );
    writeFixture(
      root,
      "app-mobile/src/bad-board.ts",
      [
        "supabase.channel('board:board-1')",
        "  .on(\"postgres_changes\", {",
        "    event: \"UPDATE\",",
        "    schema: \"public\",",
        "    table: \"boards\",",
        "    filter: \"id=eq.board-1\",",
        "  }, handler);",
        "",
      ].join("\n"),
    );
    writeFixture(
      root,
      "app-mobile/src/good.ts",
      [
        "supabase.channel('board_session:sess-1')",
        "  .on('postgres_changes', {",
        "    event: 'INSERT',",
        "    schema: 'public',",
        "    table: 'board_saved_cards',",
        "    filter: `session_id=eq.${sessionId}`,",
        "  }, handler)",
        "  .on('broadcast', { event: 'session_updated' }, handler);",
        "",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [SCRIPT.pathname, "--scan-dir", srcRoot], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bad-collab\.ts:2/);
    assert.match(result.stderr, /bad-board\.ts:2/);
    assert.match(result.stdout, /2 violations/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
