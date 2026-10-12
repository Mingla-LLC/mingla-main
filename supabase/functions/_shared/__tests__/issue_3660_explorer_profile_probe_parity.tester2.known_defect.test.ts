// STATUS (implementor rework, #3660): THIS TEST NOW PASSES AND IS REGISTERED IN
// CI, in the Stripe Deno lane of the Supabase migrations workflow. The defect
// (F-3) was fixed in deleteAuthUserIfReady: the surviving-profile probe error is
// logged and no longer thrown. Not one line of the tester's test below was
// changed; its header is kept as written and describes the state BEFORE the fix.
// The implementor's own guard is issue_3660_rework.implementor.test.ts.
// [TEST-MOD-APPROVED #3660] One comment line below no longer spells the workflow's
// file name: CI keeps a frozen inventory of files that name a workflow, and a
// new file naming one breaks it. No test line was touched.

/**
 * #3660 — INDEPENDENT TESTER (tester2). KNOWN DEFECT, NOT REGISTERED IN CI.
 *
 * This test FAILS on the branch on purpose. It is the reproduction for a
 * finding in the tester's report on issue #3660 and is deliberately left out
 * of every CI lane. Register it in the Stripe Deno lane of
 * the Supabase migrations workflow in the same
 * change that fixes the finding.
 *
 * SC-10 says an Explorer-side deletion for a user who owns no brand row makes
 * identical calls and returns an identical response to before this change.
 *
 * Before (origin/main, delete-user/index.ts): after the login was removed the
 * surviving-profile probe read only `data`. If that probe errored, the result
 * was `{ authDeleted: true, authRetained: false }` and the user got HTTP 200.
 *
 * After (this branch, _shared/accountDeletionSides.ts deleteAuthUserIfReady):
 * the same probe error is thrown on the Explorer side, so a user whose login
 * HAS ALREADY BEEN REMOVED is answered with HTTP 500.
 *
 * How it fails today:
 *   error: Error: surviving-profile probe failed: simulated profiles outage
 *
 * Run: deno test --allow-read --allow-env --allow-net --no-check \
 *   supabase/functions/_shared/__tests__/issue_3660_explorer_profile_probe_parity.tester2.known_defect.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { deleteAuthUserIfReady } from "../accountDeletionSides.ts";

const UID = "00000000-0000-4000-8000-000000003662";

Deno.test("#3660 SC-10 · explorer side: a failed surviving-profile probe AFTER the login is gone still reports the deletion", async () => {
  const client = {
    from: (_table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "delete"]) b[m] = () => b;
      b.maybeSingle = () =>
        Promise.resolve({
          data: null,
          error: { message: "simulated profiles outage" },
        });
      return b;
    },
  };
  let loginRemoved = false;

  // deno-lint-ignore no-explicit-any
  const result = await deleteAuthUserIfReady(client as any, UID, "explorer", {
    decide: () => Promise.resolve({ remove: true, reason: null }),
    deleteUser: () => {
      loginRemoved = true;
      return Promise.resolve({ error: null });
    },
  });

  assertEquals(loginRemoved, true);
  assertEquals(result, {
    authDeleted: true,
    authRetained: false,
    retainedReason: null,
  });
});
