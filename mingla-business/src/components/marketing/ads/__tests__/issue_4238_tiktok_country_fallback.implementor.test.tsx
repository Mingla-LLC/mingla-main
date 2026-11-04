/**
 * #4238 live check (2026-11-04) — TikTok has no place below the country in
 * Nigeria. The search then answers `wider` with the whole country, and the
 * builder offers "Use all of Nigeria on TikTok (wider area)" instead of
 * telling the Host to remove Lagos (which would drop it on every app).
 * Accepting moves only TikTok to the country; the other apps keep Lagos.
 * Also: Google's own "Lagos,Lagos,Nigeria" reads "Lagos, Lagos, Nigeria"
 * (display only; the id is untouched).
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
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
  create: (element: React.ReactElement) => Renderer;
};

jest.mock("../../../ui/Input", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Input: (props: Record<string, unknown>) => require("react").createElement("TextInput", props),
}));

// eslint-disable-next-line import/first
import { HostAdPlacesEditor } from "../HostAdPlacesEditor";
// eslint-disable-next-line import/first
import {
  acceptWiderOffer,
  applyPlaceLookup,
  hostAdAcceptedWiderLines,
  hostAdAppPlaceLabel,
  hostAdAppReviewStatus,
  hostAdPlaceAppStatus,
  hostAdPlaceForSave,
  hostAdPlaceFromSaved,
  hostAdPlaceNeedsAction,
  hostAdRefsForApp,
  type HostAdPlace,
  undoWiderOffer,
} from "../hostAdTargeting";
// eslint-disable-next-line import/first
import { hostAdCopyIsPlain } from "../hostAdCopy";

const LAGOS: HostAdPlace = { name: "Lagos", countryCode: "NG", radiusKm: 17, refs: {} };
const NONE = { availability: [] as never[], radiusKm: 17 };
// What admin-ad-targeting-search returns for TikTok in Nigeria now.
const NIGERIA = {
  results: [],
  match: {
    state: "wider",
    wider: {
      id: "2328926",
      name: "Nigeria",
      meta: { location_id: "2328926", country_code: "NG", level: "COUNTRY" },
    },
  },
};

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const allText = (renderer: Renderer): string =>
  renderer.root
    .findAll((node) => typeof node.type === "string" && node.type === "Text")
    .map(textOf)
    .join(" | ");

describe("#4238 TikTok whole-country wider area", () => {
  it("offers all of Nigeria on TikTok instead of 'couldn't find Lagos'", () => {
    const offered = applyPlaceLookup(
      { ...LAGOS, refs: { meta: "1630653" } },
      "tiktok",
      NIGERIA,
    );
    expect(offered.refs.tiktok).toBeUndefined();
    expect(offered.missing?.tiktok).toBeUndefined();
    expect(offered.offers?.tiktok).toEqual({ id: "2328926", name: "Nigeria", wholeCountry: true });
    const status = hostAdPlaceAppStatus(offered, "tiktok", NONE);
    expect(status.state).toBe("offer");
    expect(status.text).toBe("TikTok has no smaller area for Lagos.");
    expect(status.text).not.toMatch(/couldn't find|Remove it/);
    expect(status.offer?.name).toBe("all of Nigeria");
    expect(hostAdPlaceNeedsAction(status.state)).toBe(true);
    expect(hostAdCopyIsPlain(status.text)).toBe(true);
  });

  it("accepting moves only TikTok to the country; Facebook keeps Lagos", () => {
    const offered = applyPlaceLookup({ ...LAGOS, refs: { meta: "1630653" } }, "tiktok", NIGERIA);
    const accepted = acceptWiderOffer(offered, "tiktok");
    expect(accepted.refs).toEqual({ meta: "1630653", tiktok: "2328926" });
    expect(accepted.accepted?.tiktok).toBe(true);
    expect(accepted.wholeCountry?.tiktok).toBe(true);
    expect(hostAdPlaceAppStatus(accepted, "tiktok", NONE)).toEqual({
      state: "accepted",
      text: "All of Nigeria (wider area)",
    });
    expect(hostAdPlaceAppStatus(accepted, "meta", NONE).text).toBe("Lagos, 17 km");
    // TikTok gets the country id under Lagos's key; Meta still gets Lagos.
    expect(hostAdRefsForApp("tiktok", [accepted], [])).toEqual({
      locationIds: { "NG:lagos": "2328926" },
    });
    expect(hostAdRefsForApp("meta", [accepted], [])).toEqual({
      locationIds: { "NG:lagos": "1630653" },
    });
    // Check my ad says it plainly.
    expect(hostAdAcceptedWiderLines("tiktok", [accepted])).toEqual([
      "Lagos: all of Nigeria (wider area)",
    ]);
    expect(hostAdAcceptedWiderLines("meta", [accepted])).toEqual([]);
    expect(
      hostAdAppReviewStatus({ app: "tiktok", verdict: "exact", places: [accepted], interests: [] }),
    ).toBe("Ready (wider area)");
    expect(
      hostAdAppReviewStatus({ app: "meta", verdict: "exact", places: [accepted], interests: [] }),
    ).toBe("Ready");
    // Undo puts the same offer back.
    const undone = undoWiderOffer(accepted, "tiktok");
    expect(undone.refs.tiktok).toBeUndefined();
    expect(undone.wholeCountry).toBeUndefined();
    expect(hostAdPlaceAppStatus(undone, "tiktok", NONE).offer?.name).toBe("all of Nigeria");
  });

  it("the accepted country survives a save and reload", () => {
    const accepted = acceptWiderOffer(
      applyPlaceLookup(LAGOS, "tiktok", NIGERIA),
      "tiktok",
    );
    const reloaded = hostAdPlaceFromSaved(JSON.parse(JSON.stringify(hostAdPlaceForSave(accepted))));
    expect(reloaded?.wholeCountry).toEqual({ tiktok: true });
    expect(hostAdPlaceAppStatus(reloaded!, "tiktok", NONE).text).toBe("All of Nigeria (wider area)");
  });

  it("a region and a pin get the same whole-country answer", () => {
    const region = applyPlaceLookup({ ...LAGOS, name: "Lagos State", kind: "region" }, "tiktok", NIGERIA);
    expect(hostAdPlaceAppStatus(region, "tiktok", NONE).offer?.name).toBe("all of Nigeria");
    const pin = applyPlaceLookup(
      { ...LAGOS, name: "Landmark Beach, Oniru, Lekki", kind: "pin", radiusKm: 2 },
      "tiktok",
      NIGERIA,
    );
    // A pin's wider area is the only TikTok option, so it is used directly.
    expect(pin.refs.tiktok).toBe("2328926");
    expect(hostAdPlaceAppStatus(pin, "tiktok", NONE).text).toBe("Uses all of Nigeria (wider area).");
  });

  it("a state answer still reads as before, and an app error is still Couldn't check", () => {
    const state = applyPlaceLookup(LAGOS, "tiktok", {
      results: [],
      match: { state: "wider", wider: { id: "2332453", name: "Lagos State", meta: { level: "PROVINCE" } } },
    });
    expect(state.offers?.tiktok).toEqual({ id: "2332453", name: "Lagos State" });
    expect(hostAdPlaceAppStatus(state, "tiktok", NONE).text).toBe("TikTok only knows Lagos State, not Lagos.");
    const failed = applyPlaceLookup(LAGOS, "tiktok", { results: [], unavailable: true });
    expect(hostAdPlaceAppStatus(failed, "tiktok", NONE).text).toBe("Couldn't check TikTok. Try again.");
  });

  it("the builder shows the chip 'Use all of Nigeria on TikTok (wider area)'", async () => {
    const onChange = jest.fn();
    const place = applyPlaceLookup({ ...LAGOS, refs: { meta: "1630653" } }, "tiktok", NIGERIA);
    let renderer!: Renderer;
    await act(() => {
      renderer = create(
        <HostAdPlacesEditor
          apps={["meta", "tiktok"]}
          availability={[]}
          checking={new Set<string>()}
          busy={false}
          onAdd={jest.fn()}
          onRemove={jest.fn()}
          onRetry={jest.fn()}
          places={[place]}
          countries={["NG"]}
          onSearch={jest.fn()}
          onChange={onChange}
        />,
      );
    });
    const text = allText(renderer);
    expect(text).toContain("Use all of Nigeria on TikTok (wider area)");
    expect(text).not.toContain("TikTok couldn't find Lagos");
    const chip = renderer.root.findAll(
      (node) => node.props.testID === "host-ad-places-accept-tiktok" && typeof node.props.onPress === "function",
    )[0];
    await act(() => {
      (chip.props.onPress as () => void)();
    });
    expect(onChange).toHaveBeenCalledWith(
      "NG:lagos",
      expect.objectContaining({
        refs: { meta: "1630653", tiktok: "2328926" },
        wholeCountry: { tiktok: true },
      }),
    );
  });
});

describe("#4238 Google's place name reads with spaces", () => {
  it("formats Lagos,Lagos,Nigeria for display and keeps the id", () => {
    expect(hostAdAppPlaceLabel("Lagos,Lagos,Nigeria")).toBe("Lagos, Lagos, Nigeria");
    expect(hostAdAppPlaceLabel("Lagos")).toBe("Lagos");
    const place = applyPlaceLookup(LAGOS, "google", {
      results: [],
      match: { state: "match", best: { id: "1010294", name: "Lagos,Lagos,Nigeria" } },
    });
    expect(place.refs.google).toBe("1010294");
    expect(hostAdPlaceAppStatus(place, "google", NONE).text).toBe("Lagos, Lagos, Nigeria, 17 km");
    expect(hostAdRefsForApp("google", [place], [])).toEqual({
      locationIds: { "NG:lagos": "1010294" },
    });
  });
});
