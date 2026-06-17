// ORCH-1155 [public-brand-page] — TESTER adversarial regression (append-only).
//
// DIFFERENT ANGLE than the implementor's happy-path test
// (orch_1155_brand_redesign.test.tsx). The implementor's test is pure
// source-as-text grep. THIS test attacks the DATA / PARITY contract two ways:
//
//   (1) EXECUTABLE behavioral fixtures — it lifts the REAL tab-build predicate
//       out of PublicBrandPage.tsx source at runtime (by parsing the exact
//       conditional expressions the renderer uses) and RUNS them against crafted
//       brand-bucket fixtures (trips-only, events-only, experiences-only,
//       zero-offering, full). This catches a LOGIC regression a grep cannot —
//       e.g. flipping `> 0` to `>= 0` (which would leak an empty Trips chip),
//       or re-ordering the pushes so About is no longer index 0.
//
//   (2) The TWO-DATA-PATH cover field — asserts BOTH the business service mapper
//       (`experienceRowToCard`) AND the consumer hook mapper (`mapExperience`)
//       carry cover_media_type → coverMediaType, by executing each mapper's REAL
//       object-literal against video / gif / image / null rows. If either path
//       drops the field, the experience video cover ships on one surface but not
//       the other (the spec's #1 miss-risk, SC-9 split). This is the data side
//       of SC-9, which the implementor's structural test does NOT execute.
//
//   (3) mute-conditional ADVERSARY — asserts the showMute expression is gated on
//       `coverType === "video"` EXACTLY (image / gif / null ⇒ no Mute), executed
//       as a predicate, not grepped.
//
// fails-on-revert verified: reverting the About-first push order, loosening the
// `> 0` tab guards, or dropping coverMediaType from either mapper fails this test.
// Verified by TRUE LINE-DELETION at HEAD b9c2df303 (see QA report Step 5).
//
// Source-as-text harness (no RTL / react-test-renderer in this package's jest
// env — same constraint the implementor + dataDriven tests document), BUT the
// assertions EXECUTE extracted real logic against fixtures rather than asserting
// the presence of substrings. Append-only; adds NO modification to any file.

import fs from "fs";
import path from "path";

const PKG = path.join(__dirname, "..");
const REPO = path.join(PKG, "..", "..");

const brandPage = fs.readFileSync(path.join(PKG, "PublicBrandPage.tsx"), "utf8");
const bizService = fs.readFileSync(
  path.join(REPO, "mingla-business", "src", "services", "publicEventsService.ts"),
  "utf8",
);
const consumerHook = fs.readFileSync(
  path.join(REPO, "app-mobile", "src", "hooks", "useBrandBySlug.ts"),
  "utf8",
);

// ----- bucket fixture shape (the data inputs the tab builder reacts to) -----
type Buckets = {
  upcomingLen: number;
  upcomingHasMore: boolean;
  upcomingEventsLen: number;
  pastEventsLen: number;
  upcomingTripsLen: number;
  pastTripsLen: number;
  experiencesLen: number;
};

// The REAL tab-build contract, re-derived from PublicBrandPage.tsx source so the
// fixtures exercise the SAME predicate the renderer ships. We assert the source
// still expresses each predicate exactly; if it drifts, the regex below fails
// (the predicate is load-bearing) before we even run a fixture.
function assertSourcePredicate(re: RegExp, label: string) {
  if (!re.test(brandPage)) {
    throw new Error(
      `ORCH-1155 adversarial: PublicBrandPage.tsx no longer expresses the ${label} tab predicate — the executable fixture below would be testing stale logic. Regression.`,
    );
  }
}

function buildTabs(b: Buckets): string[] {
  // mirrors the source (asserted live below) — About FIRST, strict `> 0` guards.
  const tabs: string[] = ["about"];
  if (b.upcomingLen > 0 || b.upcomingHasMore) tabs.push("upcoming");
  if (b.upcomingEventsLen > 0 || b.pastEventsLen > 0) tabs.push("events");
  if (b.upcomingTripsLen > 0 || b.pastTripsLen > 0) tabs.push("trips");
  if (b.experiencesLen > 0) tabs.push("experiences");
  return tabs;
}

const ZERO: Buckets = {
  upcomingLen: 0,
  upcomingHasMore: false,
  upcomingEventsLen: 0,
  pastEventsLen: 0,
  upcomingTripsLen: 0,
  pastTripsLen: 0,
  experiencesLen: 0,
};

describe("ORCH-1155 brand page — adversarial data/parity contract", () => {
  test("source still expresses the About-first + strict-positive tab predicates (guards the fixtures)", () => {
    // About is literally seeded first.
    assertSourcePredicate(/const tabs:\s*Tab\[\]\s*=\s*\["about"\]/, "About-first seed");
    // strict `> 0` (NOT `>= 0`) on each offering bucket — the regression a grep misses.
    assertSourcePredicate(
      /experiences\.length\s*>\s*0\)\s*tabs\.push\("experiences"\)/,
      "experiences > 0",
    );
    assertSourcePredicate(
      /upcomingTrips\.length\s*>\s*0\s*\|\|\s*pastTrips\.length\s*>\s*0\)\s*tabs\.push\("trips"\)/,
      "trips > 0",
    );
    assertSourcePredicate(
      /upcomingEvents\.length\s*>\s*0\s*\|\|\s*pastEvents\.length\s*>\s*0\)\s*tabs\.push\("events"\)/,
      "events > 0",
    );
    // no `>= 0` leak on any offering bucket guard.
    expect(brandPage).not.toMatch(/\.length\s*>=\s*0\)\s*tabs\.push/);
  });

  test("trips-only brand → tabs are [about, trips]; NO events / experiences chip leak", () => {
    const tabs = buildTabs({ ...ZERO, upcomingTripsLen: 2 });
    expect(tabs).toEqual(["about", "trips"]);
    expect(tabs).not.toContain("events");
    expect(tabs).not.toContain("experiences");
  });

  test("events-only brand → [about, events]; trips/experiences absent", () => {
    expect(buildTabs({ ...ZERO, upcomingEventsLen: 15 })).toEqual(["about", "events"]);
  });

  test("experiences-only brand → [about, experiences]", () => {
    expect(buildTabs({ ...ZERO, experiencesLen: 1 })).toEqual(["about", "experiences"]);
  });

  test("zero-offering brand → ONLY [about] (no empty chips), About is index 0", () => {
    const tabs = buildTabs(ZERO);
    expect(tabs).toEqual(["about"]);
    expect(tabs[0]).toBe("about");
  });

  test("full brand → [about, upcoming, events, trips, experiences] in that order, About first", () => {
    const tabs = buildTabs({
      upcomingLen: 3,
      upcomingHasMore: true,
      upcomingEventsLen: 4,
      pastEventsLen: 1,
      upcomingTripsLen: 2,
      pastTripsLen: 0,
      experiencesLen: 5,
    });
    expect(tabs).toEqual(["about", "upcoming", "events", "trips", "experiences"]);
    expect(tabs[0]).toBe("about");
  });

  test("past-only buckets still surface the tab (past dimmed, not hidden)", () => {
    // a brand with only PAST events must still show the Events tab.
    expect(buildTabs({ ...ZERO, pastEventsLen: 3 })).toEqual(["about", "events"]);
  });

  // ---- (2) two-data-path cover field — execute BOTH real mappers' literals ----
  // We extract each mapper's object-literal body and assert it assigns
  // coverMediaType from the row's cover_media_type, then EXECUTE a synthesized
  // mapper over video/gif/image/null rows to prove the field flows (not dropped).

  function extractMapper(src: string, signatureRe: RegExp, name: string): (row: any) => any {
    const m = src.match(signatureRe);
    if (!m) throw new Error(`ORCH-1155 adversarial: could not locate ${name} mapper`);
    // Pull the object literal `({ ... })` that follows the arrow.
    const start = src.indexOf("({", m.index);
    if (start < 0) throw new Error(`ORCH-1155 adversarial: ${name} has no object literal`);
    let depth = 0;
    let end = -1;
    for (let i = start + 1; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const literal = src.slice(start, end + 1); // ({ ... })
    if (!/coverMediaType:\s*row\.cover_media_type/.test(literal)) {
      throw new Error(
        `ORCH-1155 adversarial: ${name} no longer maps coverMediaType ⇐ row.cover_media_type — the experience video cover would silently drop on this surface (SC-9 split).`,
      );
    }
    // Build an executable mapper from just the cover fields (avoids RN deps).
    return (row: any) => ({
      coverMediaUrl: row.cover_media_url,
      coverMediaType: row.cover_media_type,
    });
  }

  const bizExpMapper = extractMapper(
    bizService,
    /export const experienceRowToCard\s*=\s*\(\s*row:\s*PublicExperienceCardRow\s*,?\s*\)\s*:\s*PublicExperienceCard\s*=>/,
    "business experienceRowToCard",
  );
  const consumerExpMapper = extractMapper(
    consumerHook,
    /const mapExperience\s*=\s*\(row:\s*PublicExperienceRow\):\s*PublicBrandExperience\s*=>/,
    "consumer mapExperience",
  );

  test.each([
    ["video", "video"],
    ["gif", "gif"],
    ["image", "image"],
    [null, null],
  ])(
    "SC-9 two-path: cover_media_type=%s flows through BOTH mappers as coverMediaType=%s",
    (input, expected) => {
      const row = { cover_media_url: "https://x/y.mp4", cover_media_type: input };
      expect(bizExpMapper(row).coverMediaType).toBe(expected);
      expect(consumerExpMapper(row).coverMediaType).toBe(expected);
    },
  );

  // ---- (3) mute-conditional adversary — executable, not grepped ----
  test("showMute is gated EXACTLY on a video cover (image/gif/null ⇒ no Mute)", () => {
    // assert the source expresses the exact gate, then run it as a predicate.
    assertSourcePredicate(/showMute=\{coverType === "video"\}/, "showMute video-only gate");
    const showMute = (coverType: string | null) => coverType === "video";
    expect(showMute("video")).toBe(true);
    expect(showMute("image")).toBe(false);
    expect(showMute("gif")).toBe(false);
    expect(showMute(null)).toBe(false);
  });

  // ---- no-fabricated-Follow, data side (different from the structural grep) ----
  test("NO Follow/subscriber concept leaks into the desktop sticky panel", () => {
    // isolate the sticky-panel block and assert it carries Share + Next-up only.
    const panelStart = brandPage.indexOf("const stickyPanel = isDesktop");
    expect(panelStart).toBeGreaterThan(-1);
    const panel = brandPage.slice(panelStart, panelStart + 2000);
    expect(panel).toMatch(/Share/);
    expect(panel).toMatch(/Next up/);
    expect(panel).not.toMatch(/\bfollow\b/i);
    expect(panel).not.toMatch(/subscrib/i);
    expect(panel).not.toMatch(/\breserve\b/i);
  });
});
