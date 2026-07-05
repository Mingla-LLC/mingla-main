#!/usr/bin/env node
/**
 * ORCH-1310 [brand-edit-draft-async-sync] — strict-grep gate.
 *
 * WHY: ORCH-1309 made /brand/[id]/edit FETCH the brand (useBrand) instead of
 * reading the already-loaded useBrandList(). That introduced an ASYNC window: on
 * a cold deep-link `brand` is null on the first render and non-null a beat later.
 * BrandEditView does `const [draft, setDraft] = useState(initialDraft)` — which
 * reads its initializer ONLY on the first render — with NO effect syncing draft
 * when brand arrives. So draft stayed null after the brand loaded, and the
 * `if (brand === null || draft === null)` not-found branch fired even though the
 * brand was present. (Deterministically confirmed on the Samsung: the
 * `["brands","detail",id]` query was SUCCESS with data, yet the page showed
 * "Brand not found".) This is why the 1309 deep-link fix still 404'd on the edit
 * route (team.tsx has no draft, so it was unaffected).
 *
 * FIX (ORCH-1310): a useEffect initializes `draft` when the brand first arrives
 * (`brand !== null && draft === null → setDraft(brand)`). The `draft === null`
 * guard means an in-progress edit is never clobbered by a later brand change.
 *
 * RULE — all must hold against BrandEditView.tsx (comment-stripped), else fail:
 *   A. an effect syncs draft when the brand arrives: the file contains both the
 *      guard `brand !== null && draft === null` and `setDraft(brand)`.
 *   B. that guard and setDraft(brand) live inside a useEffect.
 *
 * Self-test (`--self-test`): the GOOD (post-fix) shape passes; the BAD (no sync
 * effect) revert fails. Invariant I-PROPOSED-1310-BRAND-EDIT-DRAFT-ASYNC-SYNC.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const VIEW_REL = "mingla-business/src/components/brand/BrandEditView.tsx";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

function scanView(src) {
  const failures = [];
  const s = normalize(src);
  const hasGuard = /brand !== null && draft === null/.test(s);
  const hasSetDraft = /setDraft\(\s*brand\s*\)/.test(s);
  if (!hasGuard || !hasSetDraft) {
    failures.push(
      "A: BrandEditView.tsx no longer initializes the draft when the brand " +
        "arrives async (`brand !== null && draft === null` → `setDraft(brand)`) — " +
        "a cold deep-link with an async brand keeps draft null and flashes " +
        "not-found (ORCH-1310).",
    );
    return failures; // B is moot if A fails
  }
  // B: the guard + setDraft(brand) must sit inside a useEffect.
  const effectBlock = s.match(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)/g);
  const inEffect =
    Array.isArray(effectBlock) &&
    effectBlock.some(
      (b) => /brand !== null && draft === null/.test(b) && /setDraft\(\s*brand\s*\)/.test(b),
    );
  if (!inEffect) {
    failures.push(
      "B: BrandEditView.tsx has the draft-sync guard but not inside a useEffect " +
        "keyed on [brand, draft] — the sync won't run when the brand arrives " +
        "(ORCH-1310).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const GOOD = `
    const [draft, setDraft] = useState(initialDraft);
    useEffect(() => {
      if (brand !== null && draft === null) {
        setDraft(brand);
      }
    }, [brand, draft]);`;
  const BAD_NO_EFFECT = `
    const [draft, setDraft] = useState(initialDraft);
    // no sync effect`;
  const BAD_GUARD_NOT_IN_EFFECT = `
    const [draft, setDraft] = useState(initialDraft);
    if (brand !== null && draft === null) { setDraft(brand); }`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1310 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1310 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  check("view GOOD (sync effect)", scanView(GOOD), false);
  check("view BAD (no sync effect)", scanView(BAD_NO_EFFECT), true);
  check("view BAD (guard not in effect)", scanView(BAD_GUARD_NOT_IN_EFFECT), true);

  console.log("ORCH-1310 gate self-test PASS (3/3).");
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1310 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = scanView(read(VIEW_REL));

if (failures.length > 0) {
  console.error(
    "ORCH-1310 gate FAIL — BrandEditView won't recover from an async brand:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nWhen the fetched brand arrives after first render, the draft MUST be " +
      "initialized (brand !== null && draft === null → setDraft(brand)) or the " +
      "edit route flashes 'Brand not found'. See ORCH-1310.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1310 gate PASS — BrandEditView initializes the draft when the brand " +
    "arrives async (cold deep-link recovers to the form).",
);
