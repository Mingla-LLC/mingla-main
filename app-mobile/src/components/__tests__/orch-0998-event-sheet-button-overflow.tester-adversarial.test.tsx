// @ts-nocheck
/**
 * ORCH-0998 [Ticketmaster expanded event sheet — text bleeds out of buttons] —
 * tester ADVERSARIAL regression test.
 *
 * Different angle than the implementor happy-path (which asserts the component
 * clamp contract in EventDetailLayout.tsx). This test attacks the OTHER failure
 * mode that produced the bleed: the localization layer.
 *
 * The fix introduced a new short visible label `expanded.calendar`. Because the
 * app falls back to `en` for missing keys, a locale that lacks the key would
 * silently render English — and, worse, a "fix" that simply re-pointed the chip
 * at the long `expanded.add_to_calendar` phrase would re-introduce the exact
 * bleed. This test enforces two adversarial invariants across ALL locales:
 *
 *   INV-1 (completeness): every locale's cards.json defines a non-empty
 *          `expanded.calendar`. (FAILS-ON-REVERT: revert deletes the keys.)
 *   INV-2 (compactness):  in every locale, `expanded.calendar` is no LONGER
 *          than that locale's `expanded.add_to_calendar` — the short label must
 *          never regress back to the bleeding long phrase.
 *
 * Run directly:  node app-mobile/src/components/__tests__/orch-0998-event-sheet-button-overflow.tester-adversarial.test.tsx
 * Fails-on-revert proof: point ORCH_0998_LOCALES_DIR at a pre-fix locales tree.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveLocalesDir() {
  const override = process.env.ORCH_0998_LOCALES_DIR;
  if (override) return override;
  const rel = "src/i18n/locales";
  const direct = path.resolve(process.cwd(), rel);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), "app-mobile", rel);
}

function runOrch0998Adversarial() {
  const localesDir = resolveLocalesDir();
  const locales = fs
    .readdirSync(localesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((loc) =>
      fs.existsSync(path.join(localesDir, loc, "cards.json")),
    );

  assert.ok(
    locales.length >= 20,
    `expected the full locale set (found only ${locales.length})`,
  );

  const missing = [];
  const tooLong = [];
  for (const loc of locales) {
    const cards = JSON.parse(
      fs.readFileSync(path.join(localesDir, loc, "cards.json"), "utf8"),
    );
    const short = cards["expanded.calendar"];
    const long = cards["expanded.add_to_calendar"];

    // INV-1 completeness.
    if (typeof short !== "string" || short.trim().length === 0) {
      missing.push(loc);
      continue;
    }
    // INV-2 compactness — only meaningful where the long phrase exists.
    if (typeof long === "string" && short.length > long.length) {
      tooLong.push(`${loc} (calendar=${short.length} > add=${long.length})`);
    }
  }

  // [FAILS-ON-REVERT KEY] INV-1.
  assert.deepEqual(
    missing,
    [],
    `every locale must define a non-empty expanded.calendar; missing in: ${missing.join(", ")}`,
  );

  // INV-2 — the short label must never be longer than the original (no re-bleed).
  assert.deepEqual(
    tooLong,
    [],
    `expanded.calendar must be <= expanded.add_to_calendar in every locale; violations: ${tooLong.join("; ")}`,
  );

  console.log(
    `ORCH-0998 tester-adversarial: PASS (${locales.length} locales: completeness + compactness)`,
  );
}

runOrch0998Adversarial();

if (typeof describe === "function") {
  describe("ORCH-0998 adversarial: Calendar label is complete + compact across locales", () => {
    it("defines a non-empty, no-longer-than-original expanded.calendar everywhere", () => {
      runOrch0998Adversarial();
    });
  });
}
