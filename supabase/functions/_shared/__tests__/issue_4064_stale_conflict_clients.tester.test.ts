// Issue #4064 — changing the database SQLSTATE to PT409 must preserve both
// screens' existing conflict handling. Admin executes its parser; the RSVP
// test pins the message-driven reconciliation path without importing Expo.
import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { parseServerError } from "../../../../mingla-admin/src/lib/crmModel.js";
import { opsErrorWords } from "../../../../mingla-admin/src/lib/opsModel.js";

const RSVP_SERVICE = new URL(
  "../../../../mingla-business/src/services/eventDrafts.ts",
  import.meta.url,
);

Deno.test("#4064 Admin treats PT409 stale_write as the same refresh conflict", () => {
  const parsed = parseServerError({
    code: "PT409",
    message:
      "stale_write: This card changed since you opened it. Reload it, then try again.",
    details: null,
    hint: null,
  });

  assertEquals(parsed.token, "stale_write");
  assertEquals(
    parsed.message,
    "This card changed since you opened it. Reload it, then try again.",
  );
  assertEquals(opsErrorWords(parsed), "This card changed. Showing the latest.");
});

Deno.test("#4064 RSVP reconciliation is message-driven and SQLSTATE-agnostic", () => {
  const source = Deno.readTextFileSync(RSVP_SERVICE);
  const matcherStart = source.indexOf("const REVISION_CONFLICT_SIGNALS");
  const matcherEnd = source.indexOf(
    "export const isServerDraftLifecycleError",
    matcherStart,
  );
  const reconcileStart = source.indexOf("const toRevisionConflictError");
  const reconcileEnd = source.indexOf(
    "export interface AutosaveServerDraftOptions",
    reconcileStart,
  );

  const matcher = source.slice(matcherStart, matcherEnd);
  const reconcile = source.slice(reconcileStart, reconcileEnd);
  assertMatch(matcher, /rsvp_revision_conflict/);
  assertMatch(matcher, /message\.includes\(signal\)/);
  assertNotMatch(matcher, /40001|PT409|\.code/);
  assertMatch(reconcile, /isRevisionConflictResponse\(error\)/);
  assertMatch(
    reconcile,
    /new DraftRevisionConflictError\(draftId, serverDraft\)/,
  );
});
