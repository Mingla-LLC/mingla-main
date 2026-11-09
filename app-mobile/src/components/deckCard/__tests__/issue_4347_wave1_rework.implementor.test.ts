/**
 * #4347 wave 1 REWORK (tester verdict FAIL: 2 P1, 1 P2, 2 P3, 1 P4).
 *
 *   P1-1 the smart chip reads arrival with the status line's own parser
 *        (getOpenStatusAt), so an overnight range counts after midnight;
 *   P1-2 a route that leaves the deck (claimed venue, brand page) is handed to
 *        the deck's host, so the collab modal closes before the push;
 *   P2   the kicker clause is solved at the largest text size (tester K-2);
 *   P3-1 the tap zones read card-local locationX/Y + the card's onLayout size,
 *        never an async measure();
 *   P3-2 the behind poster is the same first photo the front face shows;
 *   P4   a card that leaves the top forgets its photo page.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs. Each block fails when its
 * fix line is deleted (see the issue's rework comment).
 */
jest.mock("../../../services/supabase", () => ({ supabase: {} }));
import fs from "fs";
import path from "path";
import { leaveDeckTo } from "../deckNavigation";
import { curatedSmartChip, pagerPresentation, placeDeckPhotos, placeSmartChip } from "../deckCardModel";

const CI = require("../../../../../packages/card-identity/index.js");
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const DECK = read("../../SwipeableCards.tsx");
const COLLAB = read("../../connections/CollabDeckSheet.tsx");
const PLATE = read("../../deckCardPlate.tsx");

const BAR = ["Monday", "Tuesday", "Wednesday", "Thursday", "Sunday"]
  .map((d) => `${d}: Closed`)
  .concat(["Friday: 6:00 PM – 2:00 AM", "Saturday: 6:00 PM – 2:00 AM"]);
const SAT_2330_LAGOS = new Date("2026-11-07T22:30:00Z");

describe("#4347 rework", () => {
  test("RW-1 (P1-1) an overnight bar is open at a 00:15 arrival: no chip; a 02:30 arrival: chip", () => {
    expect(placeSmartChip({ openingHours: BAR, utcOffsetMinutes: 60, travelTime: "45 min" }, SAT_2330_LAGOS)).toBeNull();
    expect(placeSmartChip({ openingHours: BAR, utcOffsetMinutes: 60, travelTime: "3 hr" }, SAT_2330_LAGOS)).toEqual({
      kind: "closedAtArrival",
      tone: "warn",
    });
    expect(curatedSmartChip([{ openingHours: BAR, utcOffsetMinutes: 60, travelTimeFromUserMin: 45 }], SAT_2330_LAGOS)).toBeNull();
    const src = read("../deckCardModel.ts");
    expect(src).not.toMatch(/isPlaceOpenAt\(/);
  });

  test("RW-2 (P1-2) leaving the deck goes through the host when it has one, else a direct push", () => {
    const pushes: string[] = [];
    const handed: string[] = [];
    leaveDeckTo("/b/itan/v/garden", { onExternalRoute: (p) => handed.push(p), push: (p) => pushes.push(p) });
    expect(handed).toEqual(["/b/itan/v/garden"]);
    expect(pushes).toEqual([]);
    leaveDeckTo("/b/itan", { push: (p) => pushes.push(p) });
    expect(pushes).toEqual(["/b/itan"]);
    leaveDeckTo("", { push: (p) => pushes.push(p) });
    expect(pushes).toEqual(["/b/itan"]);
    // Both deck routes use it; no raw brand/venue push survives in the deck.
    expect(DECK.match(/leaveDeckTo\(/g)?.length).toBe(2);
    expect(DECK).not.toMatch(/router\.push\(\s*`\/b\//);
    // The collab sheet closes itself first and pushes after the modal is gone.
    expect(COLLAB).toMatch(/onExternalRoute=\{handleExternalRoute\}/);
    expect(COLLAB).toMatch(/onDismiss=\{flushPendingRoute\}/);
    expect(COLLAB).toMatch(/pendingRouteRef\.current = path;\s*setShowPrefsSheet\(false\);\s*onClose\(\);/);
  });

  test("RW-3 (P2) the kicker clause is solved at the title's and kicker's largest text", () => {
    const S1 = CI.SURFACES.s1Single;
    const atOne = CI.titleTopDepthForLines("s1Single", 2) + CI.KICKER.gap + CI.KICKER.lineHeight;
    const growth =
      S1.titleLines * S1.titleLH * (CI.MAX_FONT_SCALE.title - 1) + CI.KICKER.lineHeight * (CI.MAX_FONT_SCALE.meta - 1);
    expect(CI.kickerTopDepthForLines("s1Single", 2)).toBe(atOne);
    expect(CI.kickerSolveDepthForLines("s1Single", 2)).toBeCloseTo(atOne + growth, 6);
    expect(CI.surfaceScrimHeight("s1Single")).toBe(
      CI.scrimHeight(CI.plateTopDepthForLines("s1Single", 2), CI.titleTopDepthForLines("s1Single", 2), S1.h, atOne + growth),
    );
  });

  test("RW-4 (P3-1) the tap zones use card-local locationX/Y and the card's onLayout size", () => {
    expect(DECK).toMatch(/tapPointRef\.current = \{ x: event\.nativeEvent\.locationX, y: event\.nativeEvent\.locationY \}/);
    expect(DECK).toMatch(/cardSizeRef\.current = \{ width: nativeEvent\.layout\.width, height: nativeEvent\.layout\.height \}/);
    expect(DECK).not.toMatch(/\.measure\(/);
    // The plate's background and rows pass touches through, so a plate tap is card-local too.
    expect(PLATE).toMatch(/pointerEvents="box-none"\s*>\s*<PlateMaterial/);
  });

  test("RW-5 (P3-2) the behind poster is the front face's first photo, not the raw `image`", () => {
    const card = { image: "", images: ["https://cdn/a.jpg", "https://cdn/b.jpg"] };
    expect(pagerPresentation(placeDeckPhotos(card), 0, new Set()).posterUri).toBe("https://cdn/a.jpg");
    expect(DECK).toMatch(
      /uri=\{nextRec\.cardType \? nextRec\.image : pagerPresentation\(deckPhotosForCard\(nextRec\), 0, NO_FAILED_PHOTOS\)\.posterUri\}/,
    );
  });

  test("RW-6 (P4) a card that leaves the top forgets its photo page", () => {
    expect(DECK).toMatch(/delete next\[previous\];/);
    expect(DECK).toMatch(/\}, \[currentTopId\]\);/);
  });
});
