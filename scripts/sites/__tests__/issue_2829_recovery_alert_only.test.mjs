// MINGLA-INVARIANT: I-PROPOSED-2829-02 | issue #2829 | Recovery evidence alerts and may block a new site's first publish, but never removes a published site from public resolution; only an explicit admin or owner action does.
/*
 * #2829 R-7 (ops half) — a late or failed backup alerts and takes no site down.
 *
 * invariant: I-PROPOSED-2829-02 (DRAFT) — recovery evidence alerts and may
 * block a NEW site's first publish, but never removes a published site.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  alertBody,
  recordRecoveryStateInCore,
  recoveryStateForVerdict,
  VERDICT_EXPIRED,
  VERDICT_LATE,
  VERDICT_OK,
} from "../check-recovery-freshness.mjs";

const SITES = fileURLToPath(new URL("..", import.meta.url));

test("#2829 verdicts map to recovery states, healthy maps to nothing", () => {
  assert.equal(recoveryStateForVerdict(VERDICT_LATE), "late");
  assert.equal(recoveryStateForVerdict(VERDICT_EXPIRED), "stale");
  assert.equal(recoveryStateForVerdict(VERDICT_OK), null);
});

test("#2829 the watchdog records the state in Core when it can, and says when it cannot", async () => {
  const verdict = { code: VERDICT_LATE, last_success_at: null };
  assert.deepEqual(
    await recordRecoveryStateInCore(verdict, { env: {}, fetchImpl: fetch, now: new Date() }),
    { recorded: false, reason: "CORE_SIGNING_NOT_CONFIGURED" },
  );
  let posted = null;
  const env = {
    SITES_PILOT_SITE_ID: "aaaaaaaa-1111-4111-8111-111111111111",
    SITES_CORE_BASE_URL: "https://core.example.test",
    MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
    MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 9).toString("base64"),
    GITHUB_REPOSITORY: "Mingla-LLC/mingla-main",
    GITHUB_RUN_ID: "2829",
  };
  const now = new Date("2026-10-25T12:00:00Z");
  const result = await recordRecoveryStateInCore(verdict, {
    env,
    now,
    fetchImpl: async (url, init) => {
      posted = { url: String(url), body: JSON.parse(init.body) };
      return Response.json({ ok: true, data: {
        state: "late", previous_state: "fresh", observed_at: now.toISOString(),
        accepted_at: now.toISOString(), sites_affected: 0,
      } });
    },
  });
  assert.deepEqual(result, { recorded: true, reason: "RECORDED" });
  assert.match(posted.url, /\/recovery-state$/);
  assert.equal(posted.body.state, "late");
});

test("#2829 nothing in the backup tooling can take a site offline", () => {
  const backup = readFileSync(`${SITES}/backup-sites-cms.mjs`, "utf8");
  for (const forbidden of ["pilot-deactivation", "deactivate_gogi_pilot", "hostname:"]) {
    assert.equal(backup.includes(forbidden), false, `backup still contains ${forbidden}`);
  }
  const body = alertBody({ code: VERDICT_EXPIRED, last_success_at: null }, "https://x.invalid/run");
  assert.equal(body.includes("404"), false);
  assert.ok(body.includes("keeps serving"));
});
