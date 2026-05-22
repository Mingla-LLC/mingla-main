import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

const SCRIPT = new URL(
  "./i-proposed-finalize-callers-pass-installment-params.mjs",
  import.meta.url,
);

test("ORCH-0921 T-08 - strict-grep gate passes the post-fix codebase", () => {
  const output = execFileSync(process.execPath, [SCRIPT.pathname], {
    encoding: "utf8",
  });
  assert.match(output, /0 violations/);
});

test("ORCH-0921 T-09 - strict-grep gate fails a fixture caller missing p_installment_plan_root", () => {
  const root = mkdtempSync(join(tmpdir(), "orch-0921-finalize-gate-"));
  const fnDir = join(root, "supabase", "functions", "bad-finalize");
  mkdirSync(fnDir, { recursive: true });
  writeFileSync(
    join(fnDir, "index.ts"),
    [
      "export async function handler(supabase) {",
      '  return await supabase.rpc("biz_ticket_checkout_finalize", {',
      "    p_checkout_session_id: sessionId,",
      "    p_stripe_payment_intent_id: piId,",
      "  });",
      "}",
      "",
    ].join("\n"),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [SCRIPT.pathname, "--scan-dir", join(root, "supabase", "functions")],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /omits p_installment_plan_root/);
    assert.match(result.stdout, /1 violations/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
