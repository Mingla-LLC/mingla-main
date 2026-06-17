/**
 * ORCH-1153 Reserve-UX fix pass — implementor-owned happy-path regression for
 * the 4 device-found reserve-UX bugs (Seth, dev channel). Source-contract
 * assertions on the EXACT load-bearing lines, each with a documented
 * FAILS-ON-REVERT so a regression trips CI.
 *
 * BUG 1 (consumer) — the experience reserve bar was cut off / not floating: the
 *   scroll content used a flat 8pt bottom clearance, so the DOCKED bar (last
 *   scroll child) landed in the gorhom sheet's ~63pt bottom overshoot and was
 *   clipped. Fixed: clearance = SHEET_BOTTOM_OVERSHOOT + 8.
 * BUG 2 (public /exp) — the parallax cover (shared 4/5) was too tall, leaving a
 *   slit of content. Fixed: ParallaxCoverShell takes an OPTIONAL coverAspectRatio
 *   (default 4/5, trip/event/RSVP unchanged); the experience preview passes 1
 *   (square) so the content gets a readable viewport.
 * BUG 3 (public /exp) — the open-daily reserve copy said "Reserve a table"
 *   (restaurant leak). Fixed: "Reserve a spot" on the /exp page + the business
 *   ExperienceReservePicker title.
 * BUG 4 (public /exp) — the date picker was "dead": the Confirm button was a
 *   fixed footer OUTSIDE the ScrollView, so the open-daily time/party steps (and
 *   the button) could collapse/scroll off in the desktop centred card → date
 *   selection appeared to do nothing. Fixed: the Confirm button moved INSIDE the
 *   ScrollView (one scroll, mirroring the working consumer picker) + a
 *   reset-on-open effect.
 *
 * Pure source-contract (no RN render) — same style as the sibling 1153 tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const PKG_ROOT = join(ROOT, "..");

const read = (p: string): string => readFileSync(p, "utf8");

const CONSUMER_SCREEN = join(
  PKG_ROOT,
  "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
);
const SHELL = join(PKG_ROOT, "packages/offering-rendering/ParallaxCoverShell.tsx");
const EXP_PREVIEW = join(ROOT, "src/components/experience/ExperiencePreview.tsx");
const BIZ_PICKER = join(
  ROOT,
  "src/components/experience/ExperienceReservePicker.tsx",
);
const EXP_ROUTE = join(ROOT, "app/exp/[brandSlug]/[experienceSlug].tsx");

describe("ORCH-1153 reserve-UX fix pass", () => {
  // ----- BUG 1: consumer reserve-bar clears the sheet bottom overshoot -----
  test("BUG-1: consumer scroll clearance clears the sheet bottom overshoot (not a flat 8)", () => {
    const src = read(CONSUMER_SCREEN);
    // FAILS-ON-REVERT: restoring `const reserveBarClearance = 8;` removes this
    // match and the bar gets clipped again.
    expect(src).toMatch(/SHEET_BOTTOM_OVERSHOOT\s*=\s*63/);
    expect(src).toMatch(
      /reserveBarClearance\s*=\s*SHEET_BOTTOM_OVERSHOOT\s*\+\s*8/,
    );
    // Must NOT have reverted to the flat-8 clearance.
    expect(src).not.toMatch(/const\s+reserveBarClearance\s*=\s*8\s*;/);
  });

  // ----- BUG 2: ParallaxCoverShell coverAspectRatio prop + experience passes it -----
  test("BUG-2: ParallaxCoverShell accepts coverAspectRatio defaulting to 4/5", () => {
    const src = read(SHELL);
    // The prop exists on the interface + is destructured with the 4/5 default
    // (preserves trip/event/RSVP). FAILS-ON-REVERT: dropping the prop removes both.
    expect(src).toMatch(/coverAspectRatio\?:\s*number/);
    expect(src).toMatch(/coverAspectRatio\s*=\s*4\s*\/\s*5/);
    // The cover + spacer use the prop, not a hardcoded ratio, on phone + native.
    expect(src).toMatch(/aspectRatio:\s*coverAspectRatio/);
    expect(src).toMatch(/aspectRatio:\s*coverAspectRatio\s*\}/);
  });

  test("BUG-2: the experience preview passes a shorter (square) cover, trip/event keep 4/5", () => {
    const src = read(EXP_PREVIEW);
    // FAILS-ON-REVERT: removing the prop pass-through makes the experience cover
    // fall back to the 4/5 default and the slit returns.
    expect(src).toMatch(/coverAspectRatio=\{1\}/);
  });

  // ----- BUG 3: "Reserve a table" -> "Reserve a spot" -----
  test("BUG-3: no 'Reserve a table' copy survives anywhere on the experience reserve surfaces", () => {
    const route = read(EXP_ROUTE);
    const picker = read(BIZ_PICKER);
    // FAILS-ON-REVERT: reverting either string trips the corresponding assertion.
    expect(route).not.toMatch(/Reserve a table/);
    expect(picker).not.toMatch(/Reserve a table/);
    expect(route).toMatch(/Reserve a spot any upcoming day/);
    expect(picker).toMatch(/"Reserve a spot"/);
  });

  // ----- BUG 4: Confirm button lives INSIDE the ScrollView + reset-on-open -----
  test("BUG-4: business reserve picker Confirm is the LAST child INSIDE the ScrollView", () => {
    const src = read(BIZ_PICKER);
    // The confirm Pressable (testID) must appear BEFORE the </ScrollView> close,
    // i.e. it is a scroll child, not a fixed footer after the scroll.
    const confirmIdx = src.indexOf("orch-1138-experience-reserve-confirm");
    const scrollCloseIdx = src.indexOf("</ScrollView>");
    expect(confirmIdx).toBeGreaterThan(-1);
    expect(scrollCloseIdx).toBeGreaterThan(-1);
    // FAILS-ON-REVERT: moving the Confirm back OUTSIDE the scroll (footer) makes
    // confirmIdx land AFTER </ScrollView> and this flips.
    expect(confirmIdx).toBeLessThan(scrollCloseIdx);
  });

  test("BUG-4: business reserve picker resets selection when the sheet opens", () => {
    const src = read(BIZ_PICKER);
    // FAILS-ON-REVERT: deleting the reset effect removes the visible-gated reset.
    expect(src).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*if\s*\(visible\)/);
    expect(src).toMatch(/setSelectedDateId\(null\)/);
  });
});
