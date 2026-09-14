/**
 * Issue #3291 — Host address search ranks results near the host, RANK-ONLY.
 *
 * THE DEFECT: the business picker never sent a location, so Mapbox ranked from
 * the edge server's own IP in the United States — typing "Lagos" surfaced a
 * restaurant in Virginia before Lagos, Nigeria.
 *
 * THE CONTRACT: brand point → a point already picked on the draft → the
 * draft's time zone → nothing. Proximity reorders; it never filters: the
 * request carries no `types` and no `country` (INV-3 / ORCH-1079).
 *
 * FAILS-ON-REVERT: drop `proximity={proximity}` from the business wrapper and
 * the wrapper case goes red; reorder the sources in
 * resolveAddressSearchProximity and the order case goes red; drop the
 * last-draft-point ref from the hook and the mid-typing case goes red.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<
  (fn: string, options: { body: Record<string, unknown> }) => Promise<{
    data: unknown;
    error: null;
  }>
>(async () => ({ data: { suggestions: [] }, error: null }));

jest.mock("../services/supabase", () => ({
  supabase: {
    functions: {
      invoke: (fn: string, options: { body: Record<string, unknown> }) =>
        mockInvoke(fn, options),
    },
  },
}));
jest.mock("../components/ui/Icon", () => ({ Icon: () => null }));

import { MapboxAddressInput } from "../components/location/MapboxAddressInput";
import { useAddressSearchProximity } from "../hooks/useAddressSearchProximity";
import {
  approximatePointForTimeZone,
  deviceTimeZone,
  geoPointFrom,
  resolveAddressSearchProximity,
} from "../utils/addressSearchProximity";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type HostNode = { props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] };
  update: (el: React.ReactElement) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const BRAND = { lat: 6.4281, lng: 3.4219 };
const DRAFT = { lat: 6.439518, lng: 3.428755 };

describe("Issue #3291 — where ranking comes from", () => {
  test("brand point, then draft point, then time zone, then nothing", () => {
    expect(
      resolveAddressSearchProximity({
        brandPoint: BRAND,
        draftPoint: DRAFT,
        timeZone: "Europe/London",
      }),
    ).toBe("3.4219,6.4281");
    expect(
      resolveAddressSearchProximity({
        brandPoint: null,
        draftPoint: DRAFT,
        timeZone: "Europe/London",
      }),
    ).toBe("3.428755,6.439518");
    expect(
      resolveAddressSearchProximity({ timeZone: "Africa/Lagos" }),
    ).toBe("3.4,6.45");
    expect(resolveAddressSearchProximity({})).toBeUndefined();
  });

  test("Mapbox order is longitude,latitude", () => {
    expect(resolveAddressSearchProximity({ brandPoint: { lat: 51.5, lng: -0.12 } })).toBe(
      "-0.12,51.5",
    );
  });

  test("unusable points are skipped, never sent", () => {
    for (const bad of [
      { lat: 0, lng: 0 },
      { lat: Number.NaN, lng: 3 },
      { lat: 91, lng: 3 },
      { lat: 6, lng: 181 },
    ]) {
      expect(
        resolveAddressSearchProximity({ brandPoint: bad, timeZone: "Africa/Lagos" }),
      ).toBe("3.4,6.45");
    }
    expect(geoPointFrom(null, 3)).toBeNull();
    expect(geoPointFrom(undefined, undefined)).toBeNull();
    expect(geoPointFrom(6.45, 3.4)).toEqual({ lat: 6.45, lng: 3.4 });
  });

  test("an unknown zone or UTC yields no point instead of a guess", () => {
    expect(approximatePointForTimeZone("UTC")).toBeNull();
    expect(approximatePointForTimeZone("Mars/Olympus_Mons")).toBeNull();
    expect(approximatePointForTimeZone(null)).toBeNull();
    expect(resolveAddressSearchProximity({ timeZone: "UTC" })).toBeUndefined();
  });

  test("the live markets resolve inside their own country", () => {
    const lagos = approximatePointForTimeZone("Africa/Lagos");
    const london = approximatePointForTimeZone("Europe/London");
    const newYork = approximatePointForTimeZone("America/New_York");
    // Coarse bounding boxes: Nigeria, Great Britain, the US east coast.
    expect(lagos !== null && lagos.lat > 4 && lagos.lat < 14 && lagos.lng > 2.6 && lagos.lng < 14.7).toBe(true);
    expect(london !== null && london.lat > 49.9 && london.lat < 58.7 && london.lng > -8 && london.lng < 1.8).toBe(true);
    expect(newYork !== null && newYork.lat > 38 && newYork.lat < 45 && newYork.lng > -80 && newYork.lng < -70).toBe(true);
  });
});

function ProximityProbe(props: {
  brandPoint?: { lat: number; lng: number } | null;
  draftPoint?: { lat: number; lng: number } | null;
  timeZone?: string | null;
}): React.ReactElement {
  const proximity = useAddressSearchProximity(props);
  return React.createElement("Probe", { proximity });
}

const probeValue = (tree: Tree): unknown =>
  tree.root.findAll((n) => "proximity" in n.props)[0]?.props.proximity;

describe("Issue #3291 — the hook", () => {
  test("a draft point cleared by typing keeps ranking where it was", async () => {
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <ProximityProbe draftPoint={DRAFT} timeZone="Europe/London" />,
      );
    });
    expect(probeValue(tree as Tree)).toBe("3.428755,6.439518");
    // The first keystroke nulls the draft's coordinates.
    await TestRenderer.act(() => {
      (tree as Tree).update(<ProximityProbe draftPoint={null} timeZone="Europe/London" />);
    });
    expect(probeValue(tree as Tree)).toBe("3.428755,6.439518");
    await TestRenderer.act(() => {
      (tree as Tree).unmount();
    });
  });

  test("no draft zone falls back to the device zone", async () => {
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(<ProximityProbe timeZone="  " />);
    });
    expect(probeValue(tree as Tree)).toBe(
      resolveAddressSearchProximity({ timeZone: deviceTimeZone() }),
    );
    await TestRenderer.act(() => {
      (tree as Tree).unmount();
    });
  });
});

async function typeIntoBusinessPicker(proximity: string | undefined): Promise<Record<string, unknown>> {
  jest.useFakeTimers();
  mockInvoke.mockClear();
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <MapboxAddressInput
        value=""
        onChangeText={() => undefined}
        onPick={() => undefined}
        onClear={() => undefined}
        proximity={proximity}
      />,
    );
  });
  const input = (tree as Tree).root.findAll(
    (n) => n.props.accessibilityRole === "combobox",
  )[0];
  await TestRenderer.act(async () => {
    (input.props.onChangeText as (v: string) => void)("Lagos");
    jest.advanceTimersByTime(300);
    await Promise.resolve();
  });
  await TestRenderer.act(() => {
    (tree as Tree).unmount();
  });
  jest.useRealTimers();
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  const [fn, options] = mockInvoke.mock.calls[0] ?? [];
  expect(fn).toBe("mapbox-geocode");
  return (options as { body: Record<string, unknown> }).body;
}

describe("Issue #3291 — the Host picker request", () => {
  test("sends the proximity it is given, and still no types or country filter", async () => {
    const body = await typeIntoBusinessPicker("3.4,6.45");
    expect(body.action).toBe("suggest");
    expect(body.proximity).toBe("3.4,6.45");
    expect(body).not.toHaveProperty("types");
    expect(body).not.toHaveProperty("country");
  });

  test("without a point the request carries no proximity at all", async () => {
    const body = await typeIntoBusinessPicker(undefined);
    expect(body.action).toBe("suggest");
    expect(body).not.toHaveProperty("proximity");
    expect(body).not.toHaveProperty("types");
    expect(body).not.toHaveProperty("country");
  });
});
