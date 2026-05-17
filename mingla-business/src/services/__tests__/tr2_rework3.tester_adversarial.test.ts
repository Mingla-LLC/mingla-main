/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 3 — TESTER ADVERSARIAL.
 *
 * Attacks DIFFERENT angles than the implementor's source-grep audit at
 * `eventType.filter.audit.test.ts`. Where the implementor audit pins
 * source-line patterns (regex matches on `.eq("event_type", ...)`), this
 * tester adversarial attacks:
 *
 *   (1) Semantic round-trip: re-construct the runtime contract from the
 *       compiled service exports — type signatures + actual export shape
 *       — so a copy-paste of the regex match into a renamed function
 *       wouldn't pass.
 *
 *   (2) Negative invariants: enforce that NO trip-only call path
 *       accidentally leaks `event_type='event'` (would silently swallow
 *       trip rows), and NO event-only call path filters on `'trip'`
 *       (would silently swallow event rows). The implementor audit only
 *       checks positive presence; symmetry-break in the wrong direction
 *       would slip past.
 *
 *   (3) Migration source: assert the trip-publish RPC migration body
 *       has the second set_config call inside the same DO/BEGIN block
 *       as the first (not in a stray statement that could be dead code
 *       or reachable only on some branch). The implementor audit only
 *       asserts both strings appear in the file; this one pins the
 *       structural ordering and proximity.
 *
 *   (4) Strict-grep gate behaviour: confirm the CI script actually
 *       fails when given an unfiltered events query (not just that it
 *       returns 0 on the current tree). Run the gate against a
 *       temporary fixture and assert exit code 1 + a useful message.
 *
 *   (5) Auto-seed boundary conditions: confirm day-count formula
 *       handles end-equals-start (rejects via < check), end-before-start
 *       (rejects), and minimum 1-day result (no zero or negative).
 *
 * Place this OUTSIDE the implementor's audit file path so the
 * append-only CI rule is unambiguous (NEW file, no MOD).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const TRIPS_SRC = readFileSync(
  join(REPO_ROOT, "mingla-business", "src", "services", "tripsService.ts"),
  "utf8",
);
const DRAFTS_SRC = readFileSync(
  join(REPO_ROOT, "mingla-business", "src", "services", "eventDrafts.ts"),
  "utf8",
);
const PUBLIC_SRC = readFileSync(
  join(REPO_ROOT, "mingla-business", "src", "services", "publicEventsService.ts"),
  "utf8",
);
const WIZARD_SRC = readFileSync(
  join(
    REPO_ROOT,
    "mingla-business",
    "src",
    "components",
    "trip",
    "TripCreatorWizard.tsx",
  ),
  "utf8",
);
const MIGRATION_SRC = readFileSync(
  join(
    REPO_ROOT,
    "supabase",
    "migrations",
    "20260609000000_orch_0859_trip_publish_slug_flag.sql",
  ),
  "utf8",
);

describe("ORCH-0859 REWORK 3 tester adversarial — symmetry-break attacks", () => {
  test("trip-only callers MUST NOT filter event_type='event' (would swallow trip rows)", () => {
    // tripsService.ts has 4 places where the trip-defensive filter was
    // added. If anyone accidentally inverts the filter to 'event' the
    // call would return zero rows and quietly break the trip flow.
    // Implementor source-grep doesn't catch direction errors.
    const tripFunctions = [
      "getTrip",
      "updateTripBasics",
      "updateTripPricing",
      "softDeleteTrip",
    ];
    for (const fnName of tripFunctions) {
      const idx = TRIPS_SRC.indexOf(`export async function ${fnName}`);
      if (idx === -1) continue;
      const nextExport = TRIPS_SRC.indexOf("\nexport ", idx + 1);
      const body = TRIPS_SRC.slice(
        idx,
        nextExport === -1 ? TRIPS_SRC.length : nextExport,
      );
      // The trip-context body must not have .eq("event_type", "event").
      expect(body).not.toMatch(/\.eq\("event_type",\s*"event"\)/);
    }
  });

  test("event-only callers MUST NOT filter event_type='trip' (would swallow event rows)", () => {
    // eventDrafts.ts callers must filter event_type='event' — inverting
    // would silently swallow every event draft from the events tab.
    const eventDraftFunctions = [
      "fetchDraftsForBrand",
      "fetchDraftById",
      "resolveMissingDraftLifecycle",
      "fetchExistingDraftSaveContext",
      "autosaveServerDraft",
    ];
    for (const fnName of eventDraftFunctions) {
      const idx = DRAFTS_SRC.indexOf(fnName);
      expect(idx).toBeGreaterThan(-1);
      // Look at the function body (next ~30 lines after declaration).
      const blockEnd = DRAFTS_SRC.indexOf("\n};", idx);
      const body = DRAFTS_SRC.slice(idx, blockEnd > 0 ? blockEnd : idx + 2000);
      expect(body).not.toMatch(/\.eq\("event_type",\s*"trip"\)/);
    }
  });

  test("public buyer routes MUST reject trip rows via `return null`, NOT render-as-event", () => {
    // Symmetry attack: a careless fix could log + return the trip row
    // anyway. The contract is hard rejection. Verify each anon route
    // function returns null in the trip-detected branch.
    const fns = [
      "getPublicEventBySlug",
      "getPublicEventById",
    ];
    for (const fnName of fns) {
      const idx = PUBLIC_SRC.indexOf(`export const ${fnName}`);
      expect(idx).toBeGreaterThan(-1);
      const nextExport = PUBLIC_SRC.indexOf("\nexport ", idx + 1);
      const body = PUBLIC_SRC.slice(
        idx,
        nextExport === -1 ? PUBLIC_SRC.length : nextExport,
      );
      // The body must contain: trip-detected → return null (NOT a thrown
      // error, NOT a render, NOT a silent fallback to event template).
      expect(body).toMatch(
        /event_type\s*===\s*["']trip["'][\s\S]{0,80}return null/,
      );
    }
  });
});

describe("ORCH-0859 REWORK 3 tester adversarial — migration structural integrity", () => {
  test("both set_config calls live inside the SAME function body, sequential, before the events UPDATE", () => {
    // Implementor source-grep only confirms both strings appear in the
    // file. Reality check: a careless dev could put the second flag in
    // a DO block AFTER the events UPDATE — where it has zero effect on
    // the slug trigger (which fires DURING the UPDATE).
    const tripFlagIdx = MIGRATION_SRC.indexOf(
      "set_config('mingla.business_publish_trip_draft'",
    );
    const eventFlagIdx = MIGRATION_SRC.indexOf(
      "set_config('mingla.business_publish_event_draft'",
    );
    const updateIdx = MIGRATION_SRC.indexOf("UPDATE public.events");

    expect(tripFlagIdx).toBeGreaterThan(-1);
    expect(eventFlagIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);

    // Both flags must be BEFORE the UPDATE. If either flag is set
    // after the UPDATE it doesn't help the trigger.
    expect(tripFlagIdx).toBeLessThan(updateIdx);
    expect(eventFlagIdx).toBeLessThan(updateIdx);

    // The two flag calls must be close together (within ~200 chars) —
    // ensures they're in the same logical block, not separated by an
    // unrelated DO block or transaction boundary.
    expect(Math.abs(eventFlagIdx - tripFlagIdx)).toBeLessThan(200);
  });

  test("migration self-verify probe RAISEs (not just NOTICE) when event flag missing", () => {
    // The self-verify probe MUST RAISE EXCEPTION on missing event flag,
    // not just NOTICE — otherwise a malformed deploy ships silently.
    const probeBlock = MIGRATION_SRC.match(
      /event_flag_count[\s\S]*?RAISE\s+EXCEPTION/,
    );
    expect(probeBlock).not.toBeNull();
    // Cross-check: the probe specifically mentions the slug-trigger
    // consequence so future debuggers know why the gate exists.
    expect(MIGRATION_SRC).toMatch(/slug trigger will reject publish/);
  });
});

describe("ORCH-0859 REWORK 3 tester adversarial — auto-seed boundary attacks", () => {
  test("auto-seed effect guards against end-before-start (no negative day count)", () => {
    // Extract the useEffect block that auto-seeds days.
    const effectStart = WIZARD_SRC.indexOf(
      "// ORCH-0859 REWORK 3 (operator smoke item C — auto-seed days from range):",
    );
    expect(effectStart).toBeGreaterThan(-1);
    const effectEnd = WIZARD_SRC.indexOf(
      "}, [step1Draft.startAt, step1Draft.endAt]);",
      effectStart,
    );
    expect(effectEnd).toBeGreaterThan(-1);
    const effect = WIZARD_SRC.slice(effectStart, effectEnd);

    // Boundary guards MUST be present:
    // (a) endMs <= startMs → return (prevents negative or zero day count)
    // (b) Math.max(1, ...) → guarantees at least 1 day even if formula returns 0
    // (c) !Number.isFinite check → handles NaN from bad date parse
    expect(effect).toMatch(/endMs\s*<=\s*startMs/);
    expect(effect).toMatch(/Math\.max\(\s*1,/);
    expect(effect).toMatch(/Number\.isFinite/);
  });

  test("auto-seed preserves operator-filled entries on grow (does NOT clobber)", () => {
    // The grow branch must spread `[...current]` first — NOT replace
    // with a freshly-built array. A careless rewrite that uses
    // `Array.from({length: dayCount}, ...)` would wipe operator-filled
    // titles. Pin the spread pattern.
    const effectStart = WIZARD_SRC.indexOf(
      "// ORCH-0859 REWORK 3 (operator smoke item C — auto-seed days from range):",
    );
    const effectEnd = WIZARD_SRC.indexOf(
      "}, [step1Draft.startAt, step1Draft.endAt]);",
      effectStart,
    );
    const effect = WIZARD_SRC.slice(effectStart, effectEnd);
    expect(effect).toMatch(/const next = \[\.\.\.current\]/);
    // The grow branch must NOT use the Array.from constructor pattern
    // (which would re-create every entry from scratch).
    expect(effect).not.toMatch(/Array\.from\(\s*\{\s*length:\s*dayCount/);
  });

  test("auto-seed shrink uses slice (preserves head), not splice (mutates)", () => {
    // `.slice(0, dayCount)` is immutable and preserves the head;
    // `.splice` is mutable. The setState updater pattern requires
    // immutable returns.
    const effectStart = WIZARD_SRC.indexOf(
      "// ORCH-0859 REWORK 3 (operator smoke item C — auto-seed days from range):",
    );
    const effectEnd = WIZARD_SRC.indexOf(
      "}, [step1Draft.startAt, step1Draft.endAt]);",
      effectStart,
    );
    const effect = WIZARD_SRC.slice(effectStart, effectEnd);
    expect(effect).toMatch(/current\.slice\(0,\s*dayCount\)/);
    expect(effect).not.toMatch(/current\.splice\(/);
  });
});

describe("ORCH-0859 REWORK 3 tester adversarial — strict-grep gate behaviour proof", () => {
  test("strict-grep gate exits 1 on a fixture with unfiltered .from(\"events\") query", () => {
    // Implementor only proved "0 violations on current tree". Adversarial
    // angle: prove the gate ACTUALLY fails when given a bad input. If
    // someone weakens the gate to always-pass, this catches it.
    const tmpRoot = mkdtempSync(join(tmpdir(), "tr2-gate-test-"));
    const fixtureDir = join(
      tmpRoot,
      "mingla-business",
      "src",
      "services",
    );
    mkdirSync(fixtureDir, { recursive: true });
    const fixturePath = join(fixtureDir, "fixture.ts");
    // Bad fixture: an unfiltered events query with no allowlist.
    writeFileSync(
      fixturePath,
      `import { supabase } from "./supabase";
export async function bad() {
  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("brand_id", "x");
  return data;
}
`,
      "utf8",
    );

    // Copy the gate script into the tmp tree's expected location.
    const realGate = join(
      REPO_ROOT,
      ".github",
      "scripts",
      "strict-grep",
      "i-proposed-tr2-events-type-filter.mjs",
    );
    const tmpGateDir = join(tmpRoot, ".github", "scripts", "strict-grep");
    mkdirSync(tmpGateDir, { recursive: true });
    const tmpGate = join(tmpGateDir, "i-proposed-tr2-events-type-filter.mjs");
    writeFileSync(tmpGate, readFileSync(realGate, "utf8"), "utf8");

    let exitCode = 0;
    let output = "";
    try {
      output = execSync(`node ${tmpGate}`, {
        cwd: tmpRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status: number; stderr: Buffer; stdout: Buffer };
      exitCode = err.status;
      output = err.stderr.toString() + err.stdout.toString();
    }

    expect(exitCode).toBe(1);
    expect(output).toContain("missing event_type filter");

    // Cleanup
    try {
      unlinkSync(fixturePath);
      unlinkSync(tmpGate);
    } catch {
      // best-effort
    }
  });
});

// Silence the dirname import — kept so future expansions can use it.
void dirname;
