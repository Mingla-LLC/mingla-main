/**
 * #4238 media-buyer, wave A (P0) — the Host builder matches each app on its
 * own, offers a wider area as a one-tap choice, says "Couldn't check" for an
 * app error, searches any chosen country, greys out apps that don't run in
 * the chosen countries, starts places at 17 km, and keeps every app's id on
 * the right place when a plan is reopened.
 */
import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = {
  props: Record<string, unknown>;
  type: unknown;
  children: (RenderNode | string)[];
};
type Renderer = {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  update: (element: React.ReactElement) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
  create: (element: React.ReactElement) => Renderer;
};

// The text field is a plain input here (the design-system Input loads icons).
jest.mock("../../../ui/Input", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Input: (props: Record<string, unknown>) => require("react").createElement("TextInput", props),
}));

// eslint-disable-next-line import/first
import { HostAdPlacesEditor } from "../HostAdPlacesEditor";
// eslint-disable-next-line import/first
import { HostAdInterestsEditor } from "../HostAdInterestsEditor";
// eslint-disable-next-line import/first
import {
  acceptWiderOffer,
  applyInterestLookup,
  applyPlaceLookup,
  HOST_AD_DEFAULT_RADIUS_KM,
  hostAdAppAvailability,
  hostAdAppReviewStatus,
  hostAdPlaceAppStatus,
  hostAdPlaceKey,
  hostAdRefsForApp,
  hostAdSelectionsFromCanonical,
  type HostAdPlace,
} from "../hostAdTargeting";
// eslint-disable-next-line import/first
import { hostAdCopyIsPlain, hostAdTargetingNote } from "../hostAdCopy";

const LAGOS: HostAdPlace = { name: "Lagos", countryCode: "NG", radiusKm: 17, refs: {} };
const NONE = { availability: [] as never[], radiusKm: 17 };

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const allText = (renderer: Renderer): string =>
  renderer.root
    .findAll((node) => typeof node.type === "string" && node.type === "Text")
    .map(textOf)
    .join(" | ");
const byTestId = (renderer: Renderer, id: string): RenderNode[] =>
  renderer.root.findAll((node) => node.props.testID === id && typeof node.props.onPress === "function");

describe("#4238 wave A — each app is matched on its own", () => {
  it("SC-A1 TikTok's state-only answer becomes a wider-area choice, then Ready (wider area)", () => {
    const offered = applyPlaceLookup(LAGOS, "tiktok", {
      results: [],
      match: { state: "wider", wider: { id: "2332453", name: "Lagos State" } },
    });
    expect(offered.refs.tiktok).toBeUndefined();
    const before = hostAdPlaceAppStatus(offered, "tiktok", NONE);
    expect(before.state).toBe("offer");
    expect(before.text).toBe("TikTok only knows Lagos State, not Lagos.");
    expect(
      hostAdAppReviewStatus({ app: "tiktok", verdict: "check_required", places: [offered], interests: [] }),
    ).toBe("Needs a choice");
    const accepted = acceptWiderOffer(offered, "tiktok");
    expect(accepted.refs.tiktok).toBe("2332453");
    expect(hostAdPlaceAppStatus(accepted, "tiktok", NONE).text).toBe("Lagos State (wider area)");
    expect(
      hostAdAppReviewStatus({ app: "tiktok", verdict: "exact", places: [accepted], interests: [] }),
    ).toBe("Ready");
  });

  it("SC-A2 an app error reads Couldn't check, never not found", () => {
    const failed = applyPlaceLookup(LAGOS, "google", { results: [], unavailable: true });
    expect(failed.missing?.google).toBeUndefined();
    expect(failed.errors?.google).toBe(true);
    expect(hostAdPlaceAppStatus(failed, "google", NONE).text).toBe("Couldn't check Google. Try again.");
    expect(
      hostAdAppReviewStatus({ app: "google", verdict: "check_required", places: [failed], interests: [] }),
    ).toBe("Couldn't check");
    // A thrown lookup (null) is the same as an app error.
    expect(applyPlaceLookup(LAGOS, "meta", null).errors?.meta).toBe(true);
    const interest = applyInterestLookup({ name: "Live music", refs: {} }, "tiktok", {
      results: [],
      unavailable: true,
    });
    expect(interest.errors?.tiktok).toBe(true);
    expect(interest.missing?.tiktok).toBeUndefined();
  });

  it("SC-A7 each app keeps its own interest name", () => {
    const tiktok = applyInterestLookup({ name: "Live music", refs: {} }, "tiktok", {
      results: [],
      match: { state: "match", best: { id: "t7", name: "Music › Live performances" } },
    });
    expect(tiktok.refs.tiktok).toBe("t7");
    expect(tiktok.labels?.tiktok).toBe("Music › Live performances");
  });

  it("SC-A4 an app greys out only when it runs in none of the chosen countries", () => {
    const rows = [
      { platform: "tiktok", country_code: "GB", status: "not_available", reason: null },
    ];
    expect(hostAdAppAvailability("tiktok", ["GB"], rows)).toEqual({
      works: false,
      reason: "TikTok doesn't run in United Kingdom.",
    });
    expect(hostAdAppAvailability("tiktok", ["GB", "NG"], rows).works).toBe(true);
    // Unknown pairs work until staff mark them.
    expect(hostAdAppAvailability("reddit", ["GH"], rows).works).toBe(true);
  });

  it("SC-A5 places start at 17 km and Meta under 17 km says what to do", () => {
    expect(HOST_AD_DEFAULT_RADIUS_KM).toBe(17);
    const status = hostAdPlaceAppStatus({ ...LAGOS, radiusKm: 15 }, "meta", { ...NONE, radiusKm: 15 });
    expect(status.state).toBe("radius");
    expect(status.text).toBe(
      "Needs at least 17 km around a city. Move the distance up, or turn Facebook & Instagram off.",
    );
    expect(hostAdPlaceAppStatus({ ...LAGOS, radiusKm: 15 }, "snapchat", { ...NONE, radiusKm: 15 }).state).toBe("ok");
  });

  it("SC-A6 ids are sent and read back by place key, never by position", () => {
    // Google found nothing for Lekki but found Lagos: Lagos keeps its id.
    const lekki: HostAdPlace = { name: "Lekki", countryCode: "NG", refs: { meta: "m-lekki" } };
    const lagos: HostAdPlace = { ...LAGOS, refs: { meta: "m-lagos", google: "g-lagos" } };
    expect(hostAdRefsForApp("google", [lekki, lagos], []).locationIds).toEqual({
      "NG:lagos": "g-lagos",
    });
    const region: HostAdPlace = { name: "Lagos State", countryCode: "NG", kind: "region", refs: { meta: "r" } };
    expect(hostAdPlaceKey(region)).toBe("region:NG:lagos state");
    const back = hostAdSelectionsFromCanonical({
      audience_intent: { countries: ["NG"], cities: [{ name: "Lekki", countryCode: "NG" }, { name: "Lagos", countryCode: "NG" }] },
      targeting_selection: { places: [lekki, lagos], excluded: [], interests: [] },
    });
    expect(back.places.find((p) => p.name === "Lagos")?.refs.google).toBe("g-lagos");
    expect(back.places.find((p) => p.name === "Lekki")?.refs.google).toBeUndefined();
  });

  it("new compiler notes stay plain for a Host", () => {
    for (const line of [
      "Facebook & Instagram needs at least 17 km around a city.",
      "TikTok uses the wider area around your pin.",
      "Resolve Meta keys for left-out places: NG:ikorodu.",
      "Resolve Meta region keys for: region:NG:lagos state.",
      "Resolve Meta language keys for: en.",
    ]) {
      const note = hostAdTargetingNote("meta", "check_required", line, ["NG"]);
      expect(hostAdCopyIsPlain(note)).toBe(true);
    }
    expect(
      hostAdTargetingNote("meta", "check_required", "Resolve Meta region keys for: region:NG:lagos state.", ["NG"]),
    ).toBe("Facebook & Instagram couldn't find Lagos State, Nigeria. Remove it, or turn Facebook & Instagram off.");
  });
});

describe("#4238 wave A — the places editor", () => {
  const base = {
    apps: ["meta", "tiktok", "google"] as const,
    availability: [],
    checking: new Set<string>(),
    busy: false,
    onAdd: jest.fn(),
    onRemove: jest.fn(),
  };

  it("shows the accept chip and Try again, and both act", async () => {
    const onChange = jest.fn();
    const onRetry = jest.fn();
    const place: HostAdPlace = {
      ...LAGOS,
      refs: { meta: "1630653" },
      offers: { tiktok: { id: "2332453", name: "Lagos State" } },
      errors: { google: true },
    };
    let renderer!: Renderer;
    await act(() => {
      renderer = create(
        <HostAdPlacesEditor
          {...base}
          places={[place]}
          countries={["NG"]}
          onSearch={jest.fn()}
          onChange={onChange}
          onRetry={onRetry}
        />,
      );
    });
    const text = allText(renderer);
    expect(text).toContain("Use Lagos State on TikTok (wider area)");
    expect(text).toContain("Couldn't check Google. Try again.");
    expect(text).not.toContain("Not found");
    await act(() => {
      (byTestId(renderer, "host-ad-places-accept-tiktok")[0].props.onPress as () => void)();
    });
    expect(onChange).toHaveBeenCalledWith("NG:lagos", expect.objectContaining({ refs: { meta: "1630653", tiktok: "2332453" } }));
    await act(() => {
      (byTestId(renderer, "host-ad-places-retry-google")[0].props.onPress as () => void)();
    });
    expect(onRetry).toHaveBeenCalledWith("NG:lagos", "google");
  });

  it("SC-A3 searches the country the Host picks, not only the first", async () => {
    const onSearch = jest.fn().mockResolvedValue([{ id: "a", name: "Accra", meta: { country_code: "GH" } }]);
    let renderer!: Renderer;
    await act(() => {
      renderer = create(
        <HostAdPlacesEditor {...base} places={[]} countries={["NG", "GH"]} onSearch={onSearch} onChange={jest.fn()} onRetry={jest.fn()} />,
      );
    });
    await act(() => {
      (byTestId(renderer, "host-ad-places-country-GH")[0].props.onPress as () => void)();
    });
    const input = renderer.root.findAll((node) => node.props.accessibilityLabel === "Search a place" && typeof node.props.onChangeText === "function")[0];
    await act(() => {
      (input.props.onChangeText as (v: string) => void)("Accra");
    });
    await act(async () => {
      (byTestId(renderer, "host-ad-places-search")[0].props.onPress as () => void)();
    });
    expect(onSearch).toHaveBeenCalledWith("Accra", "GH", "city");
    expect(allText(renderer)).toContain("Accra");
  });

  it("decision (a): a Host swaps one app's interest from that app's own list", async () => {
    const onChange = jest.fn();
    const onSearch = jest.fn().mockResolvedValue([{ id: "t9", name: "Concerts" }]);
    let renderer!: Renderer;
    await act(() => {
      renderer = create(
        <HostAdInterestsEditor
          interests={[{ name: "Live music", refs: { tiktok: "t7" }, labels: { tiktok: "Music › Live performances" } }]}
          apps={["tiktok"]}
          checking={new Set()}
          busy={false}
          onSearch={onSearch}
          onAdd={jest.fn()}
          onChange={onChange}
          onRemove={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    expect(allText(renderer)).toContain("Pick a different TikTok interest");
    await act(() => {
      (byTestId(renderer, "host-ad-interest-swap-tiktok")[0].props.onPress as () => void)();
    });
    await act(async () => {
      (byTestId(renderer, "host-ad-interest-swap-search-tiktok")[0].props.onPress as () => void)();
    });
    expect(onSearch).toHaveBeenCalledWith("Live music", "tiktok");
    await act(() => {
      (byTestId(renderer, "host-ad-interest-swap-result-tiktok")[0].props.onPress as () => void)();
    });
    expect(onChange).toHaveBeenCalledWith(
      "live music",
      expect.objectContaining({ refs: { tiktok: "t9" }, labels: { tiktok: "Concerts" } }),
    );
  });
});
