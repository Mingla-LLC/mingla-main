import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// #3872 simulator pass fixes (Explorer). Runs under `node --experimental-strip-types --test`.
// Fails before the fix: the shoot calendar had no window from the server and
// opened on today's month with every later day open; the shoot sheet's error
// sat under the pinned Send button; the contract and gig screens only
// refreshed on pull; rows said "Post by Nov 20" with no time; the interest
// sheet never mentioned the gig's pay; "10% of sales from your link" was cut.
import { isForegroundReturn, JOIN_IN_FLIGHT } from "../../programs/programRefresh.ts";
import {
  interestPricePrefill,
  overPayUpToNote,
  salesShareText,
  shootPickRange,
  videoDueText,
} from "../../../utils/programFormat.ts";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// ── B4 shoot calendar ──────────────────────────────────────────────────────

test("B4 the shoot calendar opens on the window and only allows its days (never before today)", () => {
  const now = new Date(2026, 9, 26, 12, 0);
  assert.deepEqual(shootPickRange({ start: "2026-11-18", end: "2026-11-20" }, null, now),
    { minDate: "2026-11-18", maxDate: "2026-11-20", initialDay: "2026-11-18" });
  // A window that began in the past starts today.
  assert.deepEqual(shootPickRange({ start: "2026-10-20", end: "2026-11-02" }, null, now),
    { minDate: "2026-10-26", maxDate: "2026-11-02", initialDay: "2026-10-26" });
  // A picked time inside the window is kept; one outside it is not.
  assert.equal(shootPickRange({ start: "2026-11-18", end: "2026-11-20" }, "2026-11-19T19:00:00", now).initialDay, "2026-11-19");
  assert.equal(shootPickRange({ start: "2026-11-18", end: "2026-11-20" }, "2026-12-01T19:00:00", now).initialDay, "2026-11-18");
  // No window: from today, open-ended.
  assert.deepEqual(shootPickRange(null, null, now), { minDate: "2026-10-26", maxDate: null, initialDay: "2026-10-26" });
  // A window that is over leaves nothing to pick.
  assert.equal(shootPickRange({ start: "2026-10-01", end: "2026-10-02" }, null, now).initialDay, null);
});

test("B4 ShootSheet uses the window range, remounts the calendar on it, and shows errors above Send", () => {
  const parts = read("src/components/creator/contract/ContractSections.tsx");
  const sheet = parts.slice(parts.indexOf("export function ShootSheet"), parts.indexOf("// ── Script"));
  assert.match(sheet, /shootPickRange\(window, initialAt\)/);
  assert.match(sheet, /<CalendarGrid key=\{`\$\{range\.minDate\}:\$\{range\.maxDate \?\? ''\}`\} start=\{day\} onPick=\{setDay\} minDate=\{range\.minDate\} maxDate=\{range\.maxDate\}/);
  // The error is part of the footer, directly above the Send button; not in the body below it.
  assert.match(sheet, /footer=\{<View style=\{styles\.footerStack\}>\s*\{error \? <ProgramNotice tone="error" text=\{error\} \/> : null\}\s*<ProgramButton label=\{at \?/);
  assert.equal((sheet.match(/ProgramNotice tone="error"/g) ?? []).length, 1);
});

// ── B6 refresh on focus / foreground ───────────────────────────────────────

test("B6 foreground return only on the move into active", () => {
  assert.equal(isForegroundReturn("background", "active"), true);
  assert.equal(isForegroundReturn("inactive", "active"), true);
  assert.equal(isForegroundReturn("active", "active"), false);
  assert.equal(isForegroundReturn("active", "background"), false);
  assert.deepEqual(JOIN_IN_FLIGHT, { cancelRefetch: false });
});

test("B6 hub, gig and contract re-read on focus and on returning to the app, without loops", () => {
  const hook = read("src/components/programs/useProgramRefresh.ts");
  assert.match(hook, /useFocusEffect\(useCallback\(/);
  assert.match(hook, /AppState\.addEventListener\('change'/);
  assert.match(hook, /latest\.current = refresh/);
  assert.match(hook, /\}, \[\]\)\);/, "focus effect must not depend on the callback");
  for (const screen of ["app/creator/index.tsx", "app/creator/gig/[gigId].tsx", "app/creator/contract/[contractId].tsx"]) {
    const src = read(screen);
    assert.match(src, /useRefreshOnFocus\(/, `${screen} must refresh on focus`);
    assert.match(src, /JOIN_IN_FLIGHT/, `${screen} must join an in-flight fetch`);
  }
});

// ── G1 video due time ──────────────────────────────────────────────────────

test("G1 the video due row shows the stored time, falling back to the day", () => {
  const now = new Date(2026, 9, 26);
  const due = new Date(2026, 10, 20, 19, 0).toISOString();
  assert.match(videoDueText(due, "2026-11-20", now, "en-US"), /^Nov 20, 7:00\s?PM$/);
  assert.equal(videoDueText(null, "2026-11-20", now, "en-US"), "Nov 20");
  assert.equal(videoDueText(undefined, undefined, now, "en-US"), "");
  for (const file of ["app/creator/gig/[gigId].tsx", "src/components/creator/contract/ContractSections.tsx"]) {
    const src = read(file);
    assert.match(src, /title="Video due"/, `${file} names the row Video due`);
    assert.doesNotMatch(src, /title="Post by"|`Post by /, `${file} still says Post by`);
  }
});

// ── G2 interest price vs the gig's pay ─────────────────────────────────────

test("G2 interest price prefills the lower of rate and ceiling; above it a calm note shows", () => {
  const gig = { pay_up_to_minor: 25000, currency: "USD" };
  assert.equal(interestPricePrefill(40000, "USD", gig), 25000);
  assert.equal(interestPricePrefill(20000, "USD", gig), 20000);
  assert.equal(interestPricePrefill(40000, "USD", { pay_up_to_minor: null, currency: "USD" }), 40000);
  assert.equal(interestPricePrefill(40000, "GBP", gig), 40000, "different currencies are never compared");
  assert.equal(overPayUpToNote(30000, "USD", gig), "This gig pays up to $250. Hosts can still offer you a different fee.");
  assert.equal(overPayUpToNote(25000, "USD", gig), null);
  assert.equal(overPayUpToNote(null, "USD", gig), null);
  assert.equal(overPayUpToNote(30000, "GBP", gig), null);
  const src = read("app/creator/gig/[gigId].tsx");
  assert.match(src, /interestPricePrefill\(pkg\.price_minor, pkg\.currency, g\)/);
  assert.match(src, /overPayUpToNote\(/);
});

// ── P1 + P5 copy ───────────────────────────────────────────────────────────

test("P1 the sales share fits its row; P5 the change button names the video-due date", () => {
  assert.equal(salesShareText(1000), "10% of sales");
  assert.equal(salesShareText(null), null);
  for (const file of ["app/creator/gig/[gigId].tsx", "src/components/creator/contract/ContractSections.tsx"]) {
    assert.doesNotMatch(read(file), /of sales from your link/);
  }
  const contract = read("app/creator/contract/[contractId].tsx");
  assert.match(contract, /Ask to change the video-due date/);
  assert.doesNotMatch(contract, /post-by/i);
});
