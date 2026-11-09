/**
 * #4347 × #4334 — TESTER ADVERSARIAL: the sheet's Directions and "Route all
 * stops" on #4334's shared Maps target (9d1275d822).
 *
 *   M-1 a place Directions target, fed to #4334's REAL builder, gives exactly
 *       #4334's bytes: `query` stays the coordinate pair and only the Google
 *       links gain `query_place_id`; with no usable id the target carries no
 *       id key at all and the link is the pre-#4334 link, byte for byte.
 *   M-2 ids that must never reach Google: pool UUIDs (any case, padded),
 *       #4334's `dXJuOm` ids, too-short and malformed ids.
 *   M-3 Route all stops: no ids -> the exact pre-change link; every id ->
 *       `destination_place_id` and `waypoint_place_ids` paired with the
 *       waypoints by position; one waypoint missing (or a UUID) -> no
 *       `waypoint_place_ids`, `destination_place_id` kept.
 *   M-4 the pairing survives an unplaceable stop in the middle (dropped from
 *       BOTH lists) and the 9-waypoint cap (ids cut at the same place).
 *   M-5 an out-of-range coordinate falls back to the label, as in #4334.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - the UUID refusal removed from BOTH directionsPlaceId and #4334's
 *     normalizeGooglePlaceId (6853044953) -> M-1, M-2 and M-3 fail. Either
 *     guard alone keeps them green: the two rules agree, by design;
 *   - waypoint_place_ids added when only SOME waypoints have ids -> M-3 fails;
 *   - stopToken back on the old 0,0-only check (no normalizeMapsGeo) -> M-5 fails.
 */
import { buildMapsDeepLink } from "@mingla/offering-rendering/mapsDeepLink";
import { directionsPlaceId, directionsTarget, routeAllStopsUrl } from "../placeDirections";

jest.mock("../../../utils/openMapsTarget", () => ({ openMapsTarget: jest.fn() }));

const GID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const GID2 = "ChIJ2eUgeAK6j4ARbn5u_wAGqWA";
const GID3 = "ChIJP3Sa8ziYEmsRUKgyFmh9AQM";
const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("M — #4347 Directions on #4334's Maps target", () => {
  test("M-1 the target gives #4334's exact bytes, with and without a place id", () => {
    const withId = directionsTarget({ lat: 6.45, lng: 3.43, label: "Nok by Alara", googlePlaceId: GID });
    expect(withId).toEqual({ label: "Nok by Alara", geo: { lat: 6.45, lng: 3.43 }, googlePlaceId: GID });
    expect(buildMapsDeepLink({ ...withId, platform: "web" })?.url).toBe(
      `https://www.google.com/maps/search/?api=1&query=6.45,3.43&query_place_id=${GID}`,
    );
    const ios = buildMapsDeepLink({ ...withId, platform: "ios" });
    expect(ios?.url).toBe("maps://?ll=6.45,3.43&q=Nok%20by%20Alara");
    expect(ios?.fallbackUrl).toBe(`https://www.google.com/maps/search/?api=1&query=6.45,3.43&query_place_id=${GID}`);
    expect(buildMapsDeepLink({ ...withId, platform: "android" })?.url).toBe("geo:6.45,3.43?q=6.45,3.43(Nok%20by%20Alara)");

    const noId = directionsTarget({ lat: 6.45, lng: 3.43, label: "Nok by Alara", googlePlaceId: UUID });
    expect(Object.keys(noId).sort()).toEqual(["geo", "label"]);
    expect(buildMapsDeepLink({ ...noId, platform: "web" })?.url).toBe("https://www.google.com/maps/search/?api=1&query=6.45,3.43");
  });

  test("M-2 ids that must never reach Google", () => {
    for (const bad of [UUID, UUID.toUpperCase(), `  ${UUID}  `, "dXJuOmNvbTpnb29nbGU6cGxhY2U", "ChIJ", "", "   ", "ChIJ has spaces", null, undefined]) {
      expect([bad, directionsPlaceId(bad as string | null | undefined)]).toEqual([bad, null]);
    }
    expect(directionsPlaceId(`  ${GID}  `)).toBe(GID);
    // #4334's length rule (10..1024): the long route / area ids pass, longer is refused.
    expect(directionsPlaceId(`Ej${"a".repeat(1022)}`)).toBe(`Ej${"a".repeat(1022)}`);
    expect(directionsPlaceId(`Ej${"a".repeat(1023)}`)).toBeNull();
  });

  test("M-3 route all: no ids is the old link; all ids pair by position; one missing drops only the waypoint list", () => {
    const stops = [
      { lat: 6.41, lng: 3.41, label: "A" },
      { lat: 6.42, lng: 3.42, label: "B" },
      { lat: 6.43, lng: 3.43, label: "C" },
    ];
    expect(routeAllStopsUrl(stops, "driving")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=6.43%2C3.43&waypoints=6.41%2C3.41%7C6.42%2C3.42&travelmode=driving",
    );
    const all = routeAllStopsUrl(
      stops.map((s, i) => ({ ...s, googlePlaceId: [GID, GID2, GID3][i] })),
      "walking",
    ) as string;
    const q = new URL(all).searchParams;
    expect(q.get("destination_place_id")).toBe(GID3);
    expect(q.get("waypoint_place_ids")).toBe(`${GID}|${GID2}`);
    expect(q.get("waypoints")!.split("|")).toEqual(["6.41,3.41", "6.42,3.42"]);
    for (const missing of [null, UUID]) {
      const partial = new URL(
        routeAllStopsUrl(stops.map((s, i) => ({ ...s, googlePlaceId: [GID, missing, GID3][i] })), "walking") as string,
      ).searchParams;
      expect(partial.get("waypoint_place_ids")).toBeNull();
      expect(partial.get("destination_place_id")).toBe(GID3);
    }
  });

  test("M-4 the pairing survives an unplaceable middle stop and the 9-waypoint cap", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `ChIJ${String(i).padStart(2, "0")}xxxxxxxxxxxxxxxxxxxx`);
    const stops = ids.map((googlePlaceId, i) => ({ lat: 6 + i / 100, lng: 3 + i / 100, label: `S${i}`, googlePlaceId }));
    // Stop 3 cannot be placed (no coordinate, no label) but HAS an id.
    stops[3] = { lat: null as unknown as number, lng: null as unknown as number, label: "", googlePlaceId: ids[3] };
    const q = new URL(routeAllStopsUrl(stops, "driving") as string).searchParams;
    const wp = q.get("waypoints")!.split("|");
    const wpIds = q.get("waypoint_place_ids")!.split("|");
    expect(wp).toHaveLength(9);
    expect(wpIds).toHaveLength(9);
    expect(wpIds).not.toContain(ids[3]);
    // Position by position, each id belongs to the stop at that waypoint.
    wp.forEach((token, k) => {
      const i = stops.findIndex((s) => s.lat !== null && `${s.lat},${s.lng}` === token);
      expect([k, wpIds[k]]).toEqual([k, ids[i]]);
    });
    expect(q.get("destination_place_id")).toBe(ids[11]);
  });

  test("M-5 an out-of-range coordinate falls back to the label", () => {
    const q = new URL(routeAllStopsUrl([{ lat: 95, lng: 3.4, label: "Bad Lat Cafe" }, { lat: 6.4, lng: 200, label: "Bad Lng Bar" }], "driving") as string).searchParams;
    expect(q.get("waypoints")).toBe("Bad Lat Cafe");
    expect(q.get("destination")).toBe("Bad Lng Bar");
  });
});
