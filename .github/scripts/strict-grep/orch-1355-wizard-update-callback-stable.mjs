#!/usr/bin/env node
/**
 * ORCH-1355 [rsvp-wizard-toggle-snap-back] — strict-grep gate (F-1/F-3).
 *
 * WHY: RsvpCreatorWizard's `handleUpdate` rebuilt the debounced autosave payload
 * from a CAPTURED `liveDraft` (`{ ...liveDraft, ...revisionedPatch }`) and listed
 * `liveDraft` in its useCallback deps. When one user action fired TWO sequential
 * `updateDraft` calls (capacity-OFF also clears the waitlist; "private" forces
 * discover OFF), both ran through the SAME closure: the second write's patch did
 * not re-include the first field, so `{ ...liveDraft(stale), ...patch2 }`
 * re-introduced the OLD value and `queueAutosave` overwrote the good timer with
 * the stale payload. The server echoed the stale value back → the guest-limit
 * toggle snapped back ON (proven: RsvpWizardToggleSnapback.orch1355.render.test).
 *
 * FIX (ORCH-1355 C-1): `handleUpdate` reads the FRESH post-write draft from the
 * store (`useDraftEventStore.getState().getDraft(draftId)`) for the autosave
 * payload — never a captured `liveDraft` — and drops `liveDraft` from its deps
 * (stable identity). Sequential writes in one handler now COMPOUND.
 *
 * RULE — all must hold against RsvpCreatorWizard.tsx `handleUpdate` (comment-
 * stripped), else exit 1. Enforces I-PROPOSED-1355-WIZARD-UPDATE-CALLBACK-STABLE:
 *   A. `handleUpdate`'s useCallback DEPENDENCY ARRAY does NOT contain `liveDraft`.
 *   B. `handleUpdate`'s body does NOT spread a captured `liveDraft`
 *      (`...liveDraft`) — the autosave payload must not be built from it.
 *   C. `handleUpdate`'s body DOES read fresh store state
 *      (`getState().getDraft(`) for the autosave payload.
 *
 * Self-test: `node orch-1355-wizard-update-callback-stable.mjs --self-test`
 * proves the fixed shape PASSES and each revert (liveDraft in deps, spread
 * liveDraft, or no fresh read) FAILS.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const WIZARD_REL =
  "mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx";

/** Strip block comments + whole-line `//` comments so prose can't satisfy/trip. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Collapse whitespace so a multi-line callback matches on one line. */
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** From the index of a `(`, return the substring up to its matching `)`. */
function balancedParen(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return s.slice(openIdx, i + 1);
    }
  }
  return s.slice(openIdx); // unbalanced — return the tail
}

/** Extract the `handleUpdate = useCallback( ... )` region (balanced). */
function handleUpdateRegion(s) {
  const marker = "handleUpdate = useCallback(";
  const idx = s.indexOf(marker);
  if (idx === -1) return null;
  const openIdx = idx + marker.length - 1; // position of the `(`
  return balancedParen(s, openIdx);
}

/** The useCallback dependency array = the final top-level `[...]` in the region. */
function depsArray(region) {
  const m = region.match(/\[([^[\]]*)\]\s*,?\s*\)\s*;?\s*$/);
  return m ? m[1] : null;
}

function scanWizard(src) {
  const failures = [];
  const s = normalize(src);
  const region = handleUpdateRegion(s);
  if (region === null) {
    failures.push(
      "handleUpdate = useCallback(...) not found in RsvpCreatorWizard.tsx — the " +
        "wizard's update callback moved or was renamed; the gate can no longer " +
        "prove it is stable + fresh-read (ORCH-1355 F-1/F-3).",
    );
    return failures;
  }

  // A — deps must not contain liveDraft.
  const deps = depsArray(region);
  if (deps === null) {
    failures.push(
      "A: could not locate handleUpdate's useCallback dependency array in " +
        "RsvpCreatorWizard.tsx — cannot prove `liveDraft` is absent from deps " +
        "(ORCH-1355 F-3).",
    );
  } else if (/\bliveDraft\b/.test(deps)) {
    failures.push(
      "A: handleUpdate lists `liveDraft` in its useCallback deps. That makes it " +
        "re-created every render and closes each keystroke/tap over a fresh but " +
        "still-captured draft — the multi-write autosave then drops the first " +
        "write. Depend only on stable refs (draftId + store setters). Deps: [" +
        deps.trim() + "] (ORCH-1355 F-3).",
    );
  }

  // B — body must not spread a captured liveDraft into the autosave payload.
  if (/\.\.\.\s*liveDraft\b/.test(region)) {
    failures.push(
      "B: handleUpdate spreads a captured `liveDraft` (`...liveDraft`) when it " +
        "builds the autosave payload. Two sequential writes in one handler then " +
        "clobber each other (the second re-introduces the first field's stale " +
        "value) — the exact guest-limit snap-back ORCH-1355 fixed. Build the " +
        "payload from the store's fresh post-write state instead (ORCH-1355 F-1).",
    );
  }

  // C — body must read fresh store state for the payload.
  if (!/getState\(\)\.getDraft\(/.test(region)) {
    failures.push(
      "C: handleUpdate no longer reads the FRESH post-write draft " +
        "(`useDraftEventStore.getState().getDraft(...)`) for the autosave " +
        "payload. Without the fresh read, sequential writes in one handler do " +
        "not compound and the OFF/forced-false write is dropped from autosave " +
        "(ORCH-1355 F-1).",
    );
  }

  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    const draftId = initialDraft.id;
    const handleUpdate = useCallback(
      (patch) => {
        const nextRevision = clientRevisionRef.current + 1;
        clientRevisionRef.current = nextRevision;
        const revisionedPatch = { ...patch, clientRevision: nextRevision };
        markDraftDirty(draftId, nextRevision);
        updateDraft(draftId, revisionedPatch);
        const fresh =
          useDraftEventStore.getState().getDraft(draftId) ?? latestDraftRef.current;
        const nextDraft = { ...fresh, updatedAt: new Date().toISOString() };
        latestDraftRef.current = nextDraft;
        queueAutosave(nextDraft);
      },
      [draftId, markDraftDirty, queueAutosave, updateDraft],
    );`;
  const BAD_DEPS = GOOD.replace(
    "[draftId, markDraftDirty, queueAutosave, updateDraft]",
    "[liveDraft, markDraftDirty, queueAutosave, updateDraft]",
  );
  const BAD_SPREAD = `
    const handleUpdate = useCallback(
      (patch) => {
        const revisionedPatch = { ...patch, clientRevision: nextRevision };
        markDraftDirty(liveDraft.id, nextRevision);
        updateDraft(liveDraft.id, revisionedPatch);
        const nextDraft = { ...liveDraft, ...revisionedPatch, updatedAt: now };
        queueAutosave(nextDraft);
      },
      [draftId, markDraftDirty, queueAutosave, updateDraft],
    );`;
  const BAD_NO_FRESH = `
    const handleUpdate = useCallback(
      (patch) => {
        const revisionedPatch = { ...patch, clientRevision: nextRevision };
        updateDraft(draftId, revisionedPatch);
        const nextDraft = { ...latestDraftRef.current, ...revisionedPatch };
        queueAutosave(nextDraft);
      },
      [draftId, markDraftDirty, queueAutosave, updateDraft],
    );`;

  const check = (label, failures, expectFail, needle) => {
    const failed = failures.length > 0;
    if (expectFail && !failed) {
      console.error(`ORCH-1355 stable self-test FAIL: ${label} should have FAILED but passed.`);
      process.exit(1);
    }
    if (!expectFail && failed) {
      console.error(
        `ORCH-1355 stable self-test FAIL: ${label} should have PASSED but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
    if (expectFail && needle && !failures.some((f) => f.startsWith(needle))) {
      console.error(
        `ORCH-1355 stable self-test FAIL: ${label} failed but not on check ${needle}:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("wizard GOOD (stable + fresh-read)", scanWizard(GOOD), false);
  check("wizard BAD_DEPS (liveDraft in deps)", scanWizard(BAD_DEPS), true, "A:");
  check("wizard BAD_SPREAD (spreads liveDraft)", scanWizard(BAD_SPREAD), true, "B:");
  check("wizard BAD_NO_FRESH (no getState().getDraft)", scanWizard(BAD_NO_FRESH), true, "C:");

  console.log(
    "ORCH-1355 wizard-update-callback-stable self-test PASS (4/4: fixed shape " +
      "passes; liveDraft-in-deps, spread-liveDraft, and no-fresh-read each fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1355 stable gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = scanWizard(read(WIZARD_REL));

if (failures.length > 0) {
  console.error(
    "ORCH-1355 wizard-update-callback-stable gate FAIL — RsvpCreatorWizard's " +
      "handleUpdate can drop a write from autosave:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nhandleUpdate MUST be stable (no `liveDraft` in deps) and build the " +
      "autosave payload from the store's fresh post-write state " +
      "(getState().getDraft), never a captured `liveDraft`. See ORCH-1355 F-1/F-3.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1355 wizard-update-callback-stable gate PASS — RsvpCreatorWizard's " +
    "handleUpdate is stable and builds the autosave payload from fresh store state.",
);
