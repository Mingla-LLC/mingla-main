#!/usr/bin/env node
/**
 * ORCH-1355 [rsvp-wizard-toggle-single-patch] — strict-grep gate (F-1/F-4).
 *
 * WHY: a single user toggle/select in RsvpStep5Setup that issues TWO sequential
 * `updateDraft` calls is dropped from autosave by the wizard's debounced payload
 * builder (the second write does not re-include the first field). Two known
 * sites did this:
 *   - `toggleCapacity`-OFF: `updateDraft({ rsvpCapacity: null })` THEN
 *     `if (capacityOn) updateDraft({ rsvpWaitlistEnabled: false })` (F-1).
 *   - the visibility "private" pick: `updateDraft({ visibility: opt.id })` THEN
 *     `if (opt.id === "private") updateDraft({ rsvpDiscoverable: false })` (F-4).
 *
 * FIX (ORCH-1355 C-2/C-3): each is now ONE combined `updateDraft(...)` patch so
 * both fields land in a single write and reach autosave together. Even with the
 * C-1 wizard fix as backstop, single-patch is the primary invariant.
 *
 * RULE — all must hold against RsvpStep5Setup.tsx (comment-stripped), else exit 1.
 * Enforces I-PROPOSED-1355-TOGGLE-SINGLE-PATCH:
 *   A. the `toggleCapacity` handler issues EXACTLY ONE `updateDraft(` call.
 *   B. the visibility-pick `onPress` (the handler that patches `visibility:
 *      opt.id`) issues EXACTLY ONE `updateDraft(` call.
 *   C. the file contains NO trailing conditional second write of the known bug
 *      shape (`if (capacityOn) updateDraft(` or `if (opt.id === "private")
 *      updateDraft(`).
 *
 * Self-test: `node orch-1355-toggle-single-patch.mjs --self-test` proves the
 * fixed single-patch shape PASSES and each two-write revert FAILS.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const STEP_REL = "mingla-business/src/components/rsvp/RsvpStep5Setup.tsx";

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

/** The `toggleCapacity = useCallback( ... )` region (balanced parens). */
function toggleCapacityRegion(s) {
  const marker = "toggleCapacity = useCallback(";
  const idx = s.indexOf(marker);
  if (idx === -1) return null;
  return balanced(s, idx + marker.length - 1, "(", ")");
}

/** The `onPress={ ... }` region that patches `visibility: opt.id` (balanced braces). */
function visibilityOnPressRegion(s) {
  const re = /onPress=\{/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const braceIdx = s.indexOf("{", m.index + "onPress=".length - 1);
    if (braceIdx === -1) continue;
    const region = balanced(s, braceIdx, "{", "}");
    if (/visibility:\s*opt\.id/.test(region)) return region;
  }
  return null;
}

const countUpdateDraft = (region) =>
  (region.match(/updateDraft\s*\(/g) ?? []).length;

function scanStep(src) {
  const failures = [];
  const s = normalize(src);

  // A — toggleCapacity issues exactly one updateDraft.
  const capRegion = toggleCapacityRegion(s);
  if (capRegion === null) {
    failures.push(
      "A: `toggleCapacity = useCallback(...)` not found in RsvpStep5Setup.tsx — " +
        "the capacity handler moved/renamed; cannot prove it is a single write " +
        "(ORCH-1355 F-1).",
    );
  } else {
    const n = countUpdateDraft(capRegion);
    if (n !== 1) {
      failures.push(
        `A: toggleCapacity issues ${n} updateDraft() calls (must be exactly 1). ` +
          "Two sequential writes let the wizard's debounced autosave drop the " +
          "second field — the guest-limit toggle snaps back ON. Collapse to one " +
          "combined patch ({ rsvpCapacity: null, rsvpWaitlistEnabled: false }) " +
          "(ORCH-1355 C-2).",
      );
    }
  }

  // B — the visibility-pick onPress issues exactly one updateDraft.
  const visRegion = visibilityOnPressRegion(s);
  if (visRegion === null) {
    failures.push(
      "B: could not locate the visibility-pick onPress (the handler patching " +
        "`visibility: opt.id`) in RsvpStep5Setup.tsx — cannot prove it is a " +
        "single write (ORCH-1355 F-4).",
    );
  } else {
    const n = countUpdateDraft(visRegion);
    if (n !== 1) {
      failures.push(
        `B: the visibility-pick onPress issues ${n} updateDraft() calls (must be ` +
          "exactly 1). The forced `rsvpDiscoverable: false` on a 'private' pick " +
          "must ride the SAME write as `visibility` or autosave drops it. " +
          "Collapse to one combined patch (ORCH-1355 C-3).",
      );
    }
  }

  // C — no trailing conditional second-write of the known bug shape.
  if (/if\s*\(\s*capacityOn\s*\)\s*updateDraft\s*\(/.test(s)) {
    failures.push(
      "C: found `if (capacityOn) updateDraft(` — the dropped-second-write bug " +
        "shape. Fold the waitlist-clear into the capacity-OFF patch (ORCH-1355 F-1).",
    );
  }
  if (/if\s*\(\s*opt\.id\s*===\s*["']private["']\s*\)\s*updateDraft\s*\(/.test(s)) {
    failures.push(
      "C: found `if (opt.id === \"private\") updateDraft(` — the dropped-second-" +
        "write bug shape. Fold the forced discover-OFF into the visibility patch " +
        "(ORCH-1355 F-4).",
    );
  }

  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    const toggleCapacity = useCallback(() => {
      updateDraft(
        capacityOn
          ? { rsvpCapacity: null, rsvpWaitlistEnabled: false }
          : { rsvpCapacity: Math.max(draft.rsvpCapacity ?? 1, 1) },
      );
    }, [capacityOn, draft.rsvpCapacity, updateDraft]);
    <Pressable
      onPress={() =>
        updateDraft(
          opt.id === "private"
            ? { visibility: opt.id, rsvpDiscoverable: false }
            : { visibility: opt.id },
        )
      }
    />`;
  const BAD_CAP = `
    const toggleCapacity = useCallback(() => {
      updateDraft({ rsvpCapacity: capacityOn ? null : Math.max(draft.rsvpCapacity ?? 1, 1) });
      if (capacityOn) updateDraft({ rsvpWaitlistEnabled: false });
    }, [capacityOn, draft.rsvpCapacity, updateDraft]);
    <Pressable
      onPress={() =>
        updateDraft(
          opt.id === "private"
            ? { visibility: opt.id, rsvpDiscoverable: false }
            : { visibility: opt.id },
        )
      }
    />`;
  const BAD_VIS = `
    const toggleCapacity = useCallback(() => {
      updateDraft(
        capacityOn
          ? { rsvpCapacity: null, rsvpWaitlistEnabled: false }
          : { rsvpCapacity: Math.max(draft.rsvpCapacity ?? 1, 1) },
      );
    }, [capacityOn, draft.rsvpCapacity, updateDraft]);
    <Pressable
      onPress={() => {
        updateDraft({ visibility: opt.id });
        if (opt.id === "private") updateDraft({ rsvpDiscoverable: false });
      }}
    />`;

  const check = (label, failures, expectFail, needle) => {
    const failed = failures.length > 0;
    if (expectFail && !failed) {
      console.error(`ORCH-1355 single-patch self-test FAIL: ${label} should have FAILED but passed.`);
      process.exit(1);
    }
    if (!expectFail && failed) {
      console.error(
        `ORCH-1355 single-patch self-test FAIL: ${label} should have PASSED but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
    if (expectFail && needle && !failures.some((f) => f.startsWith(needle))) {
      console.error(
        `ORCH-1355 single-patch self-test FAIL: ${label} failed but not on check ${needle}:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("step GOOD (single patches)", scanStep(GOOD), false);
  check("step BAD_CAP (capacity two-write)", scanStep(BAD_CAP), true, "A:");
  check("step BAD_VIS (visibility two-write)", scanStep(BAD_VIS), true, "B:");

  console.log(
    "ORCH-1355 toggle-single-patch self-test PASS (3/3: single-patch shape " +
      "passes; the capacity and visibility two-write reverts each fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1355 single-patch gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = scanStep(read(STEP_REL));

if (failures.length > 0) {
  console.error(
    "ORCH-1355 toggle-single-patch gate FAIL — a RsvpStep5Setup toggle/select " +
      "issues a dependent second write that autosave can drop:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nEach single user toggle/select MUST persist via ONE combined " +
      "updateDraft patch (no sequential dependent writes). See ORCH-1355 C-2/C-3.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1355 toggle-single-patch gate PASS — capacity toggle + visibility pick " +
    "each persist via a single combined updateDraft patch.",
);
