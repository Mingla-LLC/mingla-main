#!/usr/bin/env node
/**
 * ORCH-1355 [draft-promotion-no-remount] — strict-grep gate (symptom 1).
 *
 * WHY: the create flow starts on a client `d_<ts36>` draft at
 * `/{rsvp|event}/{d_id}/edit`. The first dirty keystroke promotes it to a server
 * draft; PRE-FIX the route called `router.replace('/{rsvp|event}/<serverId>/edit')`
 * inside the autosave-promotion `.then`, changing the `[id]` dynamic segment →
 * expo-router replaces the screen instance → the name TextInput remounts → the
 * keyboard drops mid-type (~700 ms after the first char). Proven at the JS level
 * by RsvpPromotionRemount.orch1355.router.test.tsx / EventPromotionRemount.* .
 *
 * FIX (ORCH-1355): the promotion resolves the wizard against a route-state
 * activeDraftId (`effectiveDraftId = promotedServerId ?? idParam`), sets
 * `setPromotedServerId(serverId)`, and reconciles the URL IN PLACE via
 * `router.setParams` — NEVER a screen-replacing `router.replace` to the new id.
 *
 * This is CREATE-FLOW-WIDE: both `app/rsvp/[id]/edit.tsx` and
 * `app/event/[id]/edit.tsx` carry the byte-identical promotion path and MUST
 * both hold the fix.
 *
 * RULE — for EACH route file, all must hold against the comment-stripped source,
 * else exit 1. Enforces I-PROPOSED-1355-DRAFT-PROMOTION-NO-REMOUNT:
 *   A. `handleAutosaveDraft = React.useCallback(` region exists.
 *   B. that region contains ZERO `router.replace(` calls (an eager replace to
 *      the promoted id remounts the screen — banned in the promotion path).
 *   C. that region contains at least one `router.setParams(` (in-place reconcile).
 *   D. that region contains at least one `setPromotedServerId(` (route-state
 *      activeDraftId set on promotion).
 *   E. the file declares `const effectiveDraftId =` AND resolves the rendered
 *      draft via `useDraftById(` on `effectiveDraftId` (decoupled from URL [id]).
 *
 * Self-test: `node orch-1355-draft-promotion-no-remount.mjs --self-test` proves
 * the fixed shape PASSES and the eager-router.replace revert FAILS.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const ROUTE_RELS = [
  "mingla-business/app/rsvp/[id]/edit.tsx",
  "mingla-business/app/event/[id]/edit.tsx",
];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** From the index of an open bracket char, return the substring up to its match. */
function balanced(s, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return s.slice(openIdx, i + 1);
    }
  }
  return s.slice(openIdx);
}

/** The `handleAutosaveDraft = React.useCallback( ... )` region (balanced parens). */
function autosaveRegion(s) {
  const marker = "handleAutosaveDraft = React.useCallback(";
  const idx = s.indexOf(marker);
  if (idx === -1) return null;
  return balanced(s, idx + marker.length - 1, "(", ")");
}

const count = (region, re) => (region.match(re) ?? []).length;

function scanRoute(rel, src) {
  const failures = [];
  const s = normalize(src);

  const region = autosaveRegion(s);
  if (region === null) {
    failures.push(
      `${rel} — A: \`handleAutosaveDraft = React.useCallback(\` not found; ` +
        "the promotion handler moved/renamed and cannot be proven remount-safe.",
    );
    return failures;
  }

  // B — no eager router.replace inside the promotion path (it remounts the screen).
  const replaceN = count(region, /router\.replace\s*\(/g);
  if (replaceN > 0) {
    failures.push(
      `${rel} — B: handleAutosaveDraft calls router.replace(${replaceN}x). An ` +
        "eager router.replace to the promoted [id] replaces the screen → the " +
        "name TextInput remounts → the keyboard drops mid-type. Reconcile the " +
        "URL in place with router.setParams instead (ORCH-1355 symptom 1).",
    );
  }

  // C — the in-place URL reconcile is present.
  if (count(region, /router\.setParams\s*\(/g) < 1) {
    failures.push(
      `${rel} — C: handleAutosaveDraft never calls router.setParams(. The d_*→` +
        "server promotion must reconcile the URL in place (no screen replace) " +
        "so the focused input survives (ORCH-1355 symptom 1).",
    );
  }

  // D — the rendered draft is promoted via route state, decoupled from the URL.
  if (count(region, /setPromotedServerId\s*\(/g) < 1) {
    failures.push(
      `${rel} — D: handleAutosaveDraft never calls setPromotedServerId(. The ` +
        "wizard must resolve the server draft via route-state activeDraftId on " +
        "promotion, not wait for the URL [id] to change (ORCH-1355 symptom 1).",
    );
  }

  // E — the file resolves the rendered draft from effectiveDraftId (activeDraftId).
  if (!/const effectiveDraftId\s*=/.test(s)) {
    failures.push(
      `${rel} — E: no \`const effectiveDraftId =\` — the rendered draft id must ` +
        "be decoupled from the URL [id] (effectiveDraftId = promotedServerId ?? " +
        "idParam) so promotion does not depend on a screen-replacing navigation.",
    );
  } else if (!/useDraftById\s*\(\s*[^)]*effectiveDraftId/.test(s)) {
    failures.push(
      `${rel} — E: useDraftById is not resolved on effectiveDraftId — the ` +
        "rendered draft must follow the route-state activeDraftId (ORCH-1355).",
    );
  }

  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    const effectiveDraftId = promotedServerId ?? idParam;
    const draft = useDraftById(
      !isEditPublished && typeof effectiveDraftId === "string" ? effectiveDraftId : null,
    );
    const handleAutosaveDraft = React.useCallback(
      (incoming) => {
        if (!incoming.id.startsWith("d_")) { autosave.saveDraft(incoming); return; }
        void createServerDraft(incoming.brandId, incoming).then((serverDraft) => {
          replaceDraft(incoming.id, serverDraft);
          setPromotedServerId(serverDraft.id);
          router.setParams({ id: serverDraft.id, step: String(initialStep ?? 0) });
        });
      },
      [autosave, isAuthReady, initialStep, queryClient, replaceDraft, router],
    );`;
  const BAD_REPLACE = `
    const effectiveDraftId = promotedServerId ?? idParam;
    const draft = useDraftById(effectiveDraftId);
    const handleAutosaveDraft = React.useCallback(
      (incoming) => {
        void createServerDraft(incoming.brandId, incoming).then((serverDraft) => {
          replaceDraft(incoming.id, serverDraft);
          setPromotedServerId(serverDraft.id);
          router.replace(\`/rsvp/\${serverDraft.id}/edit?step=0\`);
        });
      },
      [router],
    );`;
  const BAD_NO_SETPARAMS = `
    const effectiveDraftId = promotedServerId ?? idParam;
    const draft = useDraftById(effectiveDraftId);
    const handleAutosaveDraft = React.useCallback(
      (incoming) => {
        void createServerDraft(incoming.brandId, incoming).then((serverDraft) => {
          replaceDraft(incoming.id, serverDraft);
          setPromotedServerId(serverDraft.id);
        });
      },
      [router],
    );`;
  const BAD_COUPLED = `
    const draft = useDraftById(idParam);
    const handleAutosaveDraft = React.useCallback(
      (incoming) => {
        void createServerDraft(incoming.brandId, incoming).then((serverDraft) => {
          replaceDraft(incoming.id, serverDraft);
          setPromotedServerId(serverDraft.id);
          router.setParams({ id: serverDraft.id });
        });
      },
      [router],
    );`;

  const check = (label, failures, expectFail, needle) => {
    const failed = failures.length > 0;
    if (expectFail && !failed) {
      console.error(`ORCH-1355 no-remount self-test FAIL: ${label} should have FAILED but passed.`);
      process.exit(1);
    }
    if (!expectFail && failed) {
      console.error(
        `ORCH-1355 no-remount self-test FAIL: ${label} should have PASSED but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
    if (expectFail && needle && !failures.some((f) => f.includes(needle))) {
      console.error(
        `ORCH-1355 no-remount self-test FAIL: ${label} failed but not on check ${needle}:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("GOOD (setParams + route-state)", scanRoute("GOOD", GOOD), false);
  check("BAD_REPLACE (eager router.replace)", scanRoute("x", BAD_REPLACE), true, "— B:");
  check("BAD_NO_SETPARAMS (missing setParams)", scanRoute("x", BAD_NO_SETPARAMS), true, "— C:");
  check("BAD_COUPLED (draft still on idParam)", scanRoute("x", BAD_COUPLED), true, "— E:");

  console.log(
    "ORCH-1355 draft-promotion-no-remount self-test PASS (4/4: the setParams + " +
      "route-state shape passes; eager router.replace, missing setParams, and " +
      "URL-coupled draft resolution each fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1355 no-remount gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = ROUTE_RELS.flatMap((rel) => scanRoute(rel, read(rel)));

if (failures.length > 0) {
  console.error(
    "ORCH-1355 draft-promotion-no-remount gate FAIL — a create route promotes a " +
      "client draft with a screen-replacing navigation (or without the in-place " +
      "reconcile), which remounts the wizard and drops the keyboard mid-type:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nThe d_*→server promotion MUST resolve the wizard via route-state " +
      "activeDraftId and reconcile the URL with router.setParams — never " +
      "router.replace to the new draft id. See ORCH-1355 symptom 1.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1355 draft-promotion-no-remount gate PASS — both create routes reconcile " +
    "the d_*→server promotion in place (setParams + route-state activeDraftId); " +
    "no eager router.replace remounts the wizard.",
);
