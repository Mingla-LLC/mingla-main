/**
 * #4347 wave 2 — the expanded single place's decisions, run against the REAL
 * producers (implementor happy path + the state-table edges).
 *
 *   gallery media (video slot 1, every still, de-duplicated) and the lightbox
 *   mapping; the four basics tiles (each omitted when missing, tone by open
 *   status); the "When you'd go" chips; the TYPICAL crowd curve and its level;
 *   the "quieter at" hint; the hourly forecast lookup in venue time; sunset
 *   computed on the phone; the one directions helper; the Open-Meteo hourly
 *   parser.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: drop the open-status tile (G-2), let the tonight chip stay
 * after 7pm (W-1), key the forecast on UTC instead of venue time (W-4), make
 * the quieter hint ignore opening hours (W-3), or let directions drop the
 * coordinates (D-1) — each fails here.
 */
jest.mock("../../../utils/openMapsTarget", () => ({ openMapsTarget: jest.fn() }));
import {
  basicsTiles,
  crowdLevel,
  forecastAt,
  lightboxFor,
  quieterHour,
  sheetGalleryMedia,
  sunsetAt,
  typicalCrowdAt,
  whenChips,
  type BasicsLabels,
} from "../placeSheetModel";
import { directionsTarget, openPlaceDirections } from "../placeDirections";
import { parseHourlyForecast } from "../../../services/weatherService";

const { openMapsTarget } = require("../../../utils/openMapsTarget");

const LABELS: BasicsLabels = {
  openUntil: (t) => `Open until ${t}`,
  closesIn: (m) => `Closes in ${m} min`,
  opensAt: (t) => `Opens ${t}`,
  opensTomorrow: (t) => `Opens tomorrow ${t}`,
  opensOn: (d, t) => `Opens +${d} ${t}`,
  open24h: "Open 24 hours",
  clock: (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`,
  rating: (r, c) => (c === null ? `★ ${r}` : `★ ${r} · ${c} reviews`),
};
const HOURS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
  (d) => `${d}: 12:00 PM – 11:00 PM`,
);
const LAGOS = 60;
const MON_1440 = new Date("2026-11-09T13:40:00Z"); // 14:40 in Lagos

describe("#4347 wave 2 gallery", () => {
  test("G-1 video cover first, every still once, the card image included", () => {
    const media = sheetGalleryMedia(["https://c/1.jpg", "https://c/v.mp4", "https://c/1.jpg", "https://c/2.jpg", ""], "https://c/0.jpg");
    expect(media).toEqual([
      { uri: "https://c/v.mp4", isVideo: true },
      { uri: "https://c/0.jpg", isVideo: false },
      { uri: "https://c/1.jpg", isVideo: false },
      { uri: "https://c/2.jpg", isVideo: false },
    ]);
    expect(sheetGalleryMedia([], "")).toEqual([]);
    // The lightbox is stills only; slot 2 (the second still) opens at still index 1.
    expect(lightboxFor(media, 2)).toEqual({ images: ["https://c/0.jpg", "https://c/1.jpg", "https://c/2.jpg"], initialIndex: 1 });
    expect(lightboxFor(media, 0).initialIndex).toBe(0);
  });
});

describe("#4347 wave 2 basics tiles", () => {
  const full = {
    openingHours: HOURS,
    utcOffsetMinutes: LAGOS,
    priceText: "≈ $19–30",
    travelTime: "12 min",
    distanceText: "3.4 mi",
    rating: 4.6,
    reviewCount: 212,
  };

  test("G-2 four tiles in order: Hours, Per person, From you, Rating", () => {
    const tiles = basicsTiles(full, MON_1440, LABELS);
    expect(tiles.map((t) => [t.key, t.value, t.tone])).toEqual([
      ["hours", "Open until 23:00", "open"],
      ["price", "≈ $19–30", "neutral"],
      ["distance", "12 min · 3.4 mi", "neutral"],
      ["rating", "★ 4.6 · 212 reviews", "neutral"],
    ]);
  });

  test("G-3 closes soon, closed, unknown hours; Free; each missing tile is left out", () => {
    expect(basicsTiles(full, new Date("2026-11-09T21:30:00Z"), LABELS)[0]).toEqual({ key: "hours", value: "Closes in 30 min", tone: "closing" });
    expect(basicsTiles(full, new Date("2026-11-09T09:00:00Z"), LABELS)[0]).toEqual({ key: "hours", value: "Opens 12:00", tone: "closed" });
    expect(basicsTiles({ ...full, openingHours: null }, MON_1440, LABELS).map((t) => t.key)).toEqual(["price", "distance", "rating"]);
    expect(basicsTiles({ priceText: "Free" }, MON_1440, LABELS)).toEqual([{ key: "price", value: "Free", tone: "neutral" }]);
    expect(basicsTiles({ travelTime: null, distanceText: "3.4 mi" }, MON_1440, LABELS)[0].value).toBe("3.4 mi");
    expect(basicsTiles({ rating: 4.2, reviewCount: 0 }, MON_1440, LABELS)[0].value).toBe("★ 4.2");
    expect(basicsTiles({}, MON_1440, LABELS)).toEqual([]);
  });
});

describe("#4347 wave 2 When you'd go", () => {
  test("W-1 Now · Tonight 7pm (only while it is ahead) · Tomorrow 7pm · a future scheduled time", () => {
    const chips = whenChips(MON_1440, LAGOS, new Date("2026-11-12T19:00:00Z"));
    expect(chips.map((c) => [c.key, c.at.toISOString()])).toEqual([
      ["now", MON_1440.toISOString()],
      ["tonight", "2026-11-09T18:00:00.000Z"],
      ["tomorrow", "2026-11-10T18:00:00.000Z"],
      ["scheduled", "2026-11-12T19:00:00.000Z"],
    ]);
    const late = whenChips(new Date("2026-11-09T20:30:00Z"), LAGOS, new Date("2026-11-01T19:00:00Z"));
    expect(late.map((c) => c.key)).toEqual(["now", "tomorrow"]);
  });

  test("W-2 the crowd is the typical curve for the place's kind, by venue hour and day", () => {
    const crowd = typicalCrowdAt("Restaurant", new Date("2026-11-09T18:00:00Z"), LAGOS); // Mon 19:00 Lagos
    expect(crowd.hour).toBe(19);
    expect(crowd.hourly).toHaveLength(24);
    expect(crowd.level).toBe(crowdLevel(crowd.hourly[19]));
    expect(["quiet", "steady", "busy", "packed"]).toContain(crowd.level);
    expect(crowdLevel(10)).toBe("quiet");
    expect(crowdLevel(80)).toBe("packed");
  });

  test("W-3 'quieter at' is a later hour a full level quieter, and only while open", () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 19 ? 90 : h === 20 ? 80 : h === 21 ? 40 : h === 22 ? 20 : 60));
    const crowd = { hourly, hour: 19, level: crowdLevel(90) } as const;
    expect(quieterHour(crowd, () => true)).toBe(21);
    expect(quieterHour(crowd, (h) => h < 21)).toBeNull();
    // Rework (W-7): an hour we cannot say is open is not offered.
    expect(quieterHour(crowd, () => null)).toBeNull();
    expect(quieterHour({ hourly, hour: 22, level: "quiet" }, () => true)).toBeNull();
  });

  test("W-4 the hourly forecast is read in VENUE time; a missing hour shows nothing", () => {
    const hourly = parseHourlyForecast({
      time: ["2026-11-09T18:00", "2026-11-09T19:00"],
      temperature_2m: [81.4, 79.6],
      weather_code: [2, 61],
      precipitation: [0, 0.1],
      precipitation_probability: [10, 70],
      is_day: [0, 0],
    });
    expect(hourly[1]).toMatchObject({ time: "2026-11-09T19:00", temperature: 80, condition: "Rain", precipitationProbability: 70 });
    // 18:10Z is 19:10 in Lagos (offset 3600s): the 19:00 row.
    expect(forecastAt(hourly, new Date("2026-11-09T18:10:00Z"), 3600)?.time).toBe("2026-11-09T19:00");
    expect(forecastAt(hourly, new Date("2026-11-10T18:10:00Z"), 3600)).toBeNull();
    expect(forecastAt([], new Date(), 0)).toBeNull();
    expect(parseHourlyForecast(null)).toEqual([]);
    expect(parseHourlyForecast({ time: ["2026-11-09T19:00"], temperature_2m: [null] })).toEqual([]);
  });

  test("W-5 sunset is computed on the phone (Lagos ≈ 18:2x WAT in early November; polar night is null)", () => {
    const sunset = sunsetAt(6.4474, 3.43, new Date("2026-11-09T12:00:00Z"));
    expect(sunset).not.toBeNull();
    const lagosMinutes = ((sunset!.getUTCHours() + 1) % 24) * 60 + sunset!.getUTCMinutes();
    expect(lagosMinutes).toBeGreaterThan(18 * 60 + 10);
    expect(lagosMinutes).toBeLessThan(18 * 60 + 40);
    expect(sunsetAt(80, 15, new Date("2026-12-21T12:00:00Z"))).toBeNull();
    expect(sunsetAt(Number.NaN, 0, new Date())).toBeNull();
  });
});

describe("#4347 wave 2 directions", () => {
  test("D-1 ONE helper: coordinates when the card has them, the address only as the label", () => {
    expect(directionsTarget({ lat: 6.4, lng: 3.4, label: " 12A Akin Olugbade St " })).toEqual({
      label: "12A Akin Olugbade St",
      geo: { lat: 6.4, lng: 3.4 },
    });
    expect(directionsTarget({ lat: null, lng: 3.4, label: "x" }).geo).toBeNull();
    const onUnavailable = jest.fn();
    openPlaceDirections({ lat: 6.4, lng: 3.4, label: "Nok", googlePlaceId: "ChIJ" }, { onUnavailable, preflight: true });
    expect(openMapsTarget).toHaveBeenCalledWith({ label: "Nok", geo: { lat: 6.4, lng: 3.4 } }, { preflight: true, onUnavailable });
  });

  test("D-2 a usable Google place id rides to the shared Maps target (#4334 query_place_id)", () => {
    const { buildMapsDeepLink } = require("../../../../../packages/offering-rendering/mapsDeepLink");
    const id = "ChIJN1t_tDeuEmsRUsoyG83frY4";
    const target = directionsTarget({ lat: 6.4, lng: 3.4, label: "Nok", googlePlaceId: ` ${id} ` });
    expect(target).toEqual({ label: "Nok", geo: { lat: 6.4, lng: 3.4 }, googlePlaceId: id });
    expect(buildMapsDeepLink({ ...target, platform: "web" }).url).toBe(
      `https://www.google.com/maps/search/?api=1&query=6.4,3.4&query_place_id=${id}`,
    );
    // Not Google ids: the pool's own UUID and a pre-#4334 urn id leave the link as before.
    for (const bad of ["33333333-3333-4333-8333-333333333333", "dXJuOm1ieHBvaTpmb28", "", null]) {
      expect(directionsTarget({ lat: 6.4, lng: 3.4, label: "Nok", googlePlaceId: bad })).toEqual({ label: "Nok", geo: { lat: 6.4, lng: 3.4 } });
    }
  });
});

describe("#4347 wave 2 sheet order (wiring)", () => {
  test("O-1 the single place reads in the approved order, with the actions pinned", () => {
    const fs = require("fs");
    const path = require("path");
    const src: string = fs.readFileSync(path.join(__dirname, "../../ExpandedCardModal.tsx"), "utf8");
    const single = src.slice(src.indexOf("<PlaceGallery"));
    const order = [
      "<PlaceGallery",
      "<PlaceBasics",
      "<CardInfoSection",
      "<LocalReviewsSection",
      "{companionStops.length > 0 ? (",
      "<VenueExperiencesSection",
      "<WhenYoudGo",
      "<PracticalDetailsSection",
    ].map((needle) => single.indexOf(needle));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // No conditions section on the single place; it reads "When you'd go".
    expect(single).not.toMatch(/<\w*Conditions\w*[\s/>]/);
    expect(src).toMatch(/stickyFooter=\{\s*isNightOut && nightOut \? \(\s*nightOutTicketBar\s*\) : !isCuratedCard \? \(/);
    // Every maps link on the sheet goes through the one helper.
    expect(src).not.toMatch(/openMapsTarget\(/);
  });
});
