#!/usr/bin/env node
/**
 * Issue #976 [event-name-focus] — strict-grep gate: single draft-promotion owner.
 *
 * WHY: one typing session on a fresh create-event draft minted up to THREE
 * duplicate `events` rows and dropped the keyboard after the first letter
 * (runtime-proven on the physical Samsung, issue #976). Root cause: d_*→server
 * draft promotion had FOUR independent call sites (the ORCH-0893 legacy
 * migration loop in useServerDraftEvents.ts, both edit routes, both preview
 * routes), each with its own in-flight ref, blind to the others. The legacy
 * loop additionally fired with zero debounce on the FIRST dirty keystroke from
 * list-hook instances mounted behind the wizard and swapped in a stale
 * first-keystroke snapshot — destroying typed text and unmounting the focused
 * TextInput.
 *
 * FIX (#976): `src/utils/draftPromotion.ts` `promoteLegacyDraftOnce` is the
 * ONE owner of every promotion (single-flight per d_* id, live-merge swap),
 * and the legacy loop never promotes the actively-edited draft.
 *
 * RULE — all must hold against the source, else exit 1:
 *   A. (I-PROPOSED-0976-SINGLE-DRAFT-PROMOTION-OWNER) Across
 *      `mingla-business/app/**` and `mingla-business/src/**` (excluding
 *      `__tests__`), the call token `createServerDraft(` may appear ONLY in
 *      `src/services/eventDrafts.ts` (the definition) and
 *      `src/utils/draftPromotion.ts` (the registry). Any other occurrence
 *      needs the verbatim allowlist comment within the 5 preceding lines:
 *        // orch-strict-grep-allow single-promotion-owner — <reason>
 *      (today exactly one annotated call exists: `useCreateServerDraft`'s
 *      FRESH-draft mint in useServerDraftEvents.ts — no d_* source, not a
 *      promotion).
 *   B. (I-PROPOSED-0976-NO-BACKGROUND-PROMOTION-OF-ACTIVE-DRAFT)
 *      `src/hooks/useServerDraftEvents.ts` subscribes the store's
 *      `activeDraftId` (`useDraftEventStore((s) => s.activeDraftId)`) AND its
 *      legacy-loop filter block (`localDrafts .filter( … ).forEach(`) carries
 *      the `draft.id !== activeDraftId` predicate.
 *
 * Self-test: `node orch-0976-single-promotion-owner.mjs --self-test` proves
 * the fixed shape PASSES and each violation shape FAILS.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_ROOTS = ["mingla-business/app", "mingla-business/src"];
const ALLOWED_CALL_FILES = new Set([
  "mingla-business/src/services/eventDrafts.ts",
  "mingla-business/src/utils/draftPromotion.ts",
]);
const HOOK_REL = "mingla-business/src/hooks/useServerDraftEvents.ts";
const CALL_TOKEN = "createServerDraft(";
const ALLOWLIST_TAG = "orch-strict-grep-allow single-promotion-owner";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/**
 * Check A on ONE file's raw source. Returns failure strings.
 * Line-based (house style — i-proposed-creator-entry-is-instant.mjs): comment
 * lines are skipped; a hit is excused only by the verbatim allowlist tag
 * within the 5 preceding lines.
 */
export function scanFileForCallToken(rel, source) {
  if (ALLOWED_CALL_FILES.has(rel)) return [];
  const failures = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Skip comment lines (line comments + block-comment bodies).
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    if (!line.includes(CALL_TOKEN)) continue;
    let allowlisted = false;
    for (let k = i - 1; k >= Math.max(0, i - 5); k -= 1) {
      if (lines[k].includes(ALLOWLIST_TAG)) {
        allowlisted = true;
        break;
      }
    }
    if (allowlisted) continue;
    failures.push(
      `${rel}:${i + 1} — A: \`${CALL_TOKEN}\` outside the allowed owners ` +
        "(src/services/eventDrafts.ts + src/utils/draftPromotion.ts). Every " +
        "d_*→server promotion MUST go through promoteLegacyDraftOnce — a " +
        "direct call reintroduces the duplicate-row / snapshot-swap race " +
        "(issue #976). A genuine non-promotion use needs the allowlist " +
        `comment \`// ${ALLOWLIST_TAG} — <reason>\` within 5 lines above.`,
    );
  }
  return failures;
}

/** Check B on the hook file's raw source. Returns failure strings. */
export function scanHookForActiveDraftSuppression(source) {
  const failures = [];
  const s = normalize(source);

  if (!/useDraftEventStore\(\s*\(s\)\s*=>\s*s\.activeDraftId\s*\)/.test(s)) {
    failures.push(
      `${HOOK_REL} — B: no \`useDraftEventStore((s) => s.activeDraftId)\` ` +
        "subscription. The migration effect must re-run when the wizard " +
        "opens/closes a draft, or active-draft suppression goes stale " +
        "(issue #976).",
    );
  }

  const filterStart = s.indexOf("localDrafts .filter(");
  const filterStartCompact = filterStart === -1 ? s.indexOf("localDrafts.filter(") : filterStart;
  if (filterStartCompact === -1) {
    failures.push(
      `${HOOK_REL} — B: the legacy-loop \`localDrafts.filter(\` block was not ` +
        "found; the loop moved/renamed and cannot be proven to suppress the " +
        "actively-edited draft (issue #976).",
    );
    return failures;
  }
  const filterEnd = s.indexOf(".forEach(", filterStartCompact);
  const filterBlock =
    filterEnd === -1 ? s.slice(filterStartCompact) : s.slice(filterStartCompact, filterEnd);
  if (!/draft\.id\s*!==\s*activeDraftId/.test(filterBlock)) {
    failures.push(
      `${HOOK_REL} — B: the legacy-loop filter block is missing the ` +
        "`draft.id !== activeDraftId` predicate. Without it the loop promotes " +
        "the draft being typed into on the FIRST dirty keystroke — the " +
        "keyboard-drop + typed-text-destruction + duplicate-rows bug " +
        "(issue #976, I-PROPOSED-0976-NO-BACKGROUND-PROMOTION-OF-ACTIVE-DRAFT).",
    );
  }
  return failures;
}

function* walkSourceFiles(absDir) {
  let entries;
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "__tests__" || entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }
    const full = join(absDir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkSourceFiles(full);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      yield full;
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const A_BAD = `
    const handleAutosaveDraft = React.useCallback((incoming) => {
      void createServerDraft(incoming.brandId, incoming).then((serverDraft) => {
        replaceDraft(incoming.id, serverDraft);
      });
    }, []);`;
  const A_ALLOWLISTED = `
    const mutation = useMutation({
      mutationFn: (brandId) => {
        // orch-strict-grep-allow single-promotion-owner — fresh mint, not a promotion
        return createServerDraft(brandId);
      },
    });`;
  const A_CLEAN = `
    void promoteLegacyDraftOnce({ queryClient, brandId, draftId: draft.id });`;

  const B_GOOD = `
    const activeDraftId = useDraftEventStore((s) => s.activeDraftId);
    localDrafts
      .filter(
        (draft) =>
          draft.brandId === brandId &&
          draft.id.startsWith("d_") &&
          isDraftDirty(draft) &&
          draft.id !== activeDraftId,
      )
      .forEach((draft) => {});`;
  const B_NO_PREDICATE = `
    const activeDraftId = useDraftEventStore((s) => s.activeDraftId);
    localDrafts
      .filter(
        (draft) =>
          draft.brandId === brandId &&
          draft.id.startsWith("d_") &&
          isDraftDirty(draft),
      )
      .forEach((draft) => {});`;
  const B_NO_SUBSCRIPTION = `
    localDrafts
      .filter(
        (draft) =>
          draft.brandId === brandId &&
          draft.id.startsWith("d_") &&
          isDraftDirty(draft) &&
          draft.id !== activeDraftId,
      )
      .forEach((draft) => {});`;

  const check = (label, failures, expectFail, needle) => {
    const failed = failures.length > 0;
    if (expectFail && !failed) {
      console.error(`ORCH-0976 single-owner self-test FAIL: ${label} should have FAILED but passed.`);
      process.exit(1);
    }
    if (!expectFail && failed) {
      console.error(
        `ORCH-0976 single-owner self-test FAIL: ${label} should have PASSED but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
    if (expectFail && needle && !failures.some((f) => f.includes(needle))) {
      console.error(
        `ORCH-0976 single-owner self-test FAIL: ${label} failed but not on ${needle}:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check(
    "A_BAD (route calls createServerDraft directly)",
    scanFileForCallToken("mingla-business/app/event/[id]/edit.tsx", A_BAD),
    true,
    "— A:",
  );
  check(
    "A_ALLOWLISTED (annotated fresh-mint call)",
    scanFileForCallToken("mingla-business/src/hooks/useServerDraftEvents.ts", A_ALLOWLISTED),
    false,
  );
  check(
    "A_CLEAN (registry call only)",
    scanFileForCallToken("mingla-business/app/rsvp/[id]/edit.tsx", A_CLEAN),
    false,
  );
  check(
    "A_OWNER_FILE (definition file is exempt)",
    scanFileForCallToken("mingla-business/src/services/eventDrafts.ts", A_BAD),
    false,
  );
  check("B_GOOD (predicate + subscription)", scanHookForActiveDraftSuppression(B_GOOD), false);
  check(
    "B_NO_PREDICATE (filter misses activeDraftId)",
    scanHookForActiveDraftSuppression(B_NO_PREDICATE),
    true,
    "draft.id !== activeDraftId",
  );
  check(
    "B_NO_SUBSCRIPTION (no s.activeDraftId subscribe)",
    scanHookForActiveDraftSuppression(B_NO_SUBSCRIPTION),
    true,
    "subscription",
  );

  console.log(
    "ORCH-0976 single-promotion-owner self-test PASS (7/7: direct call-site " +
      "fails; allowlisted fresh-mint, registry call, and owner files pass; " +
      "missing predicate and missing subscription each fail).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];

for (const root of SCAN_ROOTS) {
  const absRoot = join(REPO_ROOT, root);
  for (const abs of walkSourceFiles(absRoot)) {
    const rel = relative(REPO_ROOT, abs);
    let source;
    try {
      source = readFileSync(abs, "utf8");
    } catch (err) {
      console.error(`ORCH-0976 single-owner gate FAIL — cannot read ${rel}: ${err.message}`);
      process.exit(2);
    }
    failures.push(...scanFileForCallToken(rel, source));
  }
}

let hookSource;
try {
  hookSource = readFileSync(join(REPO_ROOT, HOOK_REL), "utf8");
} catch (err) {
  console.error(`ORCH-0976 single-owner gate FAIL — cannot read ${HOOK_REL}: ${err.message}`);
  process.exit(2);
}
failures.push(...scanHookForActiveDraftSuppression(hookSource));

if (failures.length > 0) {
  console.error(
    "ORCH-0976 single-promotion-owner gate FAIL — a d_*→server draft promotion " +
      "exists outside the single-flight registry, or the legacy loop lost its " +
      "active-draft suppression (issue #976 — first-keystroke focus drop + " +
      "duplicate draft rows):\n\n  - " +
      failures.join("\n  - ") +
      "\n\nRoute every promotion through promoteLegacyDraftOnce " +
      "(src/utils/draftPromotion.ts) and keep the loop's " +
      "`draft.id !== activeDraftId` predicate + `s.activeDraftId` subscription.",
  );
  process.exit(1);
}

console.log(
  "ORCH-0976 single-promotion-owner gate PASS — createServerDraft( is confined " +
    "to its owners, and the legacy loop suppresses the actively-edited draft.",
);
