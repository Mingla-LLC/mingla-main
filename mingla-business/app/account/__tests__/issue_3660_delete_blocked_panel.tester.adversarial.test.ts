// @ts-nocheck — Deno-runtime contract test; the app TypeScript project does not
// include Deno globals. Independent tester guard for issue #3660. It runs in the
// Stripe Deno lane of the Supabase migrations workflow
// (the #2321 batch suite for the same route is sealed and takes no new
// assertions); the default Business Jest config excludes this wrong-runtime file.
//
// Angle: the implementor Jest suite proves the WORDS (accountDeletionErrors).
// This guard attacks the ROUTE: that it stopped promising a recovery that no
// longer exists, and that a refusal reaches a screen the Host can act on
// instead of the old generic toast.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const stripComments = (text: string): string =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = async (relative: string): Promise<string> =>
  stripComments(await Deno.readTextFile(new URL(relative, import.meta.url)));

const route = await read("../delete.tsx");
const hook = await read("../../../src/hooks/useAccountDeletion.ts");
const errors = await read("../../../src/utils/accountDeletionErrors.ts");
const accountTab = await read("../../(tabs)/account.tsx");

/** Source with whitespace collapsed, so a sentence wrapped across JSX lines still matches. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

// ── SC-14 — the promise that is no longer true is gone ──────────────────────

const RETIRED_PROMISES = [
  /30\s+days/i,
  /day\s+31/i,
  /scheduled\s+for\s+deletion/i,
  /recover(ed|y|able)?\b[^.]{0,80}\bsign(ing)?\s+in/i,
  /sign(ing)?\s+in\b[^.]{0,80}\brecover/i,
];

Deno.test("#3660 SC-14 · the delete route promises no recovery window", () => {
  const text = flat(route);
  for (const pattern of RETIRED_PROMISES) {
    assert(!pattern.test(text), `delete.tsx still says ${pattern}`);
  }
});

Deno.test("#3660 SC-14 · the strings the route renders from the shared module promise none either", () => {
  const text = flat(errors);
  for (const pattern of RETIRED_PROMISES) {
    assert(!pattern.test(text), `accountDeletionErrors.ts says ${pattern}`);
  }
});

Deno.test("#3660 SC-14 · the sign-in toast no longer claims the account was recovered", () => {
  assert(
    !/has been recovered/i.test(accountTab),
    "the Account tab still tells a returning host their account was recovered",
  );
  assertStringIncludes(accountTab, "Welcome back to Mingla Host.");
});

Deno.test("#3660 SC-14 · the new copy says what actually happens", () => {
  const text = flat(route);
  assertStringIncludes(text, "This can't be undone in the app.");
  assertStringIncludes(
    text,
    "Events with no tickets or RSVPs are taken down when you delete.",
  );
  assertStringIncludes(text, "Account and login deleted");
});

// ── SC-13 — a refusal reaches a screen, not the old toast ───────────────────

Deno.test("#3660 SC-13 · the route has a blocked step and renders the panel for it", () => {
  assert(/type DeleteStep = [^;]*"blocked"/.test(route), 'DeleteStep must include "blocked"');
  assertStringIncludes(route, 'step === "blocked"');
  assertStringIncludes(route, "const BlockedPanel:");
  assertStringIncludes(route, "ACCOUNT_DELETION_BLOCKED_TITLE");
  assertStringIncludes(errors, '"You can\'t delete your account yet"');
});

Deno.test("#3660 SC-13 · a blocked error goes to the blocked step BEFORE any toast", () => {
  const handler = route.slice(
    route.indexOf("const handleConfirmDelete"),
    route.indexOf("const handleGoHome"),
  );
  const catchBlock = handler.slice(handler.lastIndexOf("} catch ("));
  const blockedAt = catchBlock.indexOf("instanceof AccountDeletionBlockedError");
  const setStepAt = catchBlock.indexOf('setStep("blocked")');
  const returnAt = catchBlock.indexOf("return;", setStepAt);
  const toastAt = catchBlock.indexOf("showToast(");

  assert(blockedAt >= 0, "the catch must recognise AccountDeletionBlockedError");
  assert(setStepAt > blockedAt, 'a block must set step "blocked"');
  assert(returnAt > setStepAt, "the blocked branch must return before the failure toast");
  assert(toastAt > returnAt, "the failure toast must come after the blocked branch has returned");
  assertStringIncludes(catchBlock, "setConfirmBlockers(err.blockers)");
  // [TEST-MOD-APPROVED #3660] rework F-5: the toast's words are now chosen by
  // what is known (a failure with no answer must not say "Nothing was changed"),
  // so the catch hands the error to describeDeletionFailure instead of always
  // showing ACCOUNT_DELETION_FAILED_MESSAGE. Both messages are pinned word for
  // word in the Jest suite and in the rework render-proof.
  assertStringIncludes(catchBlock, "showToast(describeDeletionFailure(err))");
  assert(
    !catchBlock.includes("showToast(ACCOUNT_DELETION_FAILED_MESSAGE)"),
    "the failure toast must not be hardcoded to 'Nothing was changed'",
  );
  assertStringIncludes(
    errors,
    '"We couldn\'t confirm whether your account was deleted. Check your connection and try again."',
  );
});

Deno.test("#3660 SC-13 · the old generic failure toast is gone", () => {
  assert(!route.includes("Couldn't delete. Tap to try again."));
});

Deno.test("#3660 SC-13 · the panel's two buttons are labelled, wired and never disabled", () => {
  const start = route.indexOf("const BlockedPanel:");
  const panel = route.slice(start, route.indexOf("\n);", start));
  assertStringIncludes(panel, 'label="Go to Home"');
  assertStringIncludes(panel, 'accessibilityLabel="Go to Home"');
  assertStringIncludes(panel, "onPress={onGoHome}");
  assertStringIncludes(panel, 'label="Close"');
  assertStringIncludes(panel, 'accessibilityLabel="Close"');
  assertStringIncludes(panel, "onPress={onClose}");
  assert(!panel.includes("disabled"), "no button on the blocked panel may be disabled");
  assertStringIncludes(route, 'router.replace("/(tabs)/home"');
});

Deno.test("#3660 SC-13 · step 2 asks the server and shows the panel in place of Continue", () => {
  assertStringIncludes(route, "useAccountDeletionBlockers(step === 2)");
  const start = route.indexOf("const Step2Preview:");
  const step2 = route.slice(start, route.indexOf("\n);", start));
  const panelAt = step2.indexOf("<BlockedPanel");
  const continueAt = step2.indexOf('"Continue"');
  assert(panelAt >= 0 && continueAt > panelAt, "the panel must be the first arm, Continue the fallback");
  assertStringIncludes(step2, "blockers.length > 0 ?");
  assertStringIncludes(step2, "disabled={blockersLoading}");
  assertStringIncludes(step2, '"Checking…"');
  assertStringIncludes(
    flat(step2),
    "We couldn't check your events right now. You can continue; we'll check again before anything is deleted.",
  );
});

Deno.test("#3660 · partner connections are announced on step 2, and only when there are any", () => {
  const start = route.indexOf("const Step2Preview:");
  const step2 = route.slice(start, route.indexOf("\n);", start));
  assertStringIncludes(step2, "partnerLinkCount > 0 ?");
  assertStringIncludes(step2, "ACCOUNT_DELETION_PARTNER_LINKS_LINE");
  assertStringIncludes(
    errors,
    '"Your partner connections will end and you\'ll stop earning from them."',
  );
  // Counted from accepted, non-cancelled links only.
  assertStringIncludes(route, "link.accepted_at !== null && link.cancelled_at === null");
});

// ── The hook reads the server's reason instead of discarding it ─────────────

Deno.test("#3660 · the hook turns a non-2xx into a typed error from the response body", () => {
  assertStringIncludes(hook, "if (error) throw await toDeletionError(error);");
  assertStringIncludes(hook, "parseDeletionFailure(status, body)");
  assert(!/if \(error\) throw error;/.test(hook), "the raw invoke error must not be rethrown");
  assertStringIncludes(hook, "supabase.rpc(");
  assertStringIncludes(flat(hook), '"biz_my_host_account_deletion_blockers"');
  assertStringIncludes(hook, "staleTime: 0");
  assertEquals(/side:\s*"business"/.test(hook), true);
});
