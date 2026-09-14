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
 * BOOT PAYLOAD: the resolver + time-zone table load through a dynamic import so
 * they stay out of the eager `__common` web chunk (ORCH-1083). The boundary
 * case below fails if any Host file value-imports them.
 *
 * FAILS-ON-REVERT: drop `proximity={proximity ?? resolvedProximity}` from the
 * business wrapper and both request cases go red; reorder the sources in
 * resolveAddressSearchProximity and the order case goes red; stop recording
 * `memory.lastDraftPoint` in resolveHostAddressProximity and the mid-typing
 * case goes red; turn the wrapper's dynamic import into a static one and the
 * boundary case goes red.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";
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

import {
  MapboxAddressInput,
  useAddressSearchProximity,
} from "../components/location/MapboxAddressInput";
import {
  approximatePointForTimeZone,
  deviceTimeZone,
  geoPointFrom,
  resolveAddressSearchProximity,
  resolveHostAddressProximity,
  type HostAddressProximitySources,
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

const ROOT = path.resolve(__dirname, "../../..");
const BRAND = { lat: 6.4281, lng: 3.4219 };
const DRAFT = { lat: 6.439518, lng: 3.428755 };

/** Let the wrapper's dynamic import settle. */
const flushLazyResolver = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  });
};

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
      { lat: null, lng: 3 },
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

  test("a field's candidate points are tried in order: its own first, then the others", () => {
    const empty = { lat: null, lng: null };
    // Trip departure field: departure unset → the destination already picked.
    expect(
      resolveHostAddressProximity(
        { lastDraftPoint: null },
        { draftPoint: [empty, DRAFT], timeZone: "Europe/London" },
      ),
    ).toBe("3.428755,6.439518");
    // Experience: the first stop that has been placed.
    expect(
      resolveHostAddressProximity(
        { lastDraftPoint: null },
        { draftPoint: [empty, { lat: 51.5, lng: -0.12 }, DRAFT], timeZone: "UTC" },
      ),
    ).toBe("-0.12,51.5");
    // A blank zone falls back to the device zone.
    expect(
      resolveHostAddressProximity({ lastDraftPoint: null }, { timeZone: "  " }),
    ).toBe(resolveAddressSearchProximity({ timeZone: deviceTimeZone() }));
  });
});

function ProximityProbe(props: {
  sources?: HostAddressProximitySources;
}): React.ReactElement {
  const proximity = useAddressSearchProximity(props.sources);
  return React.createElement("Probe", { proximity });
}

const probeValue = (tree: Tree): unknown =>
  tree.root.findAll((n) => "proximity" in n.props)[0]?.props.proximity;

describe("Issue #3291 — the lazy hook", () => {
  test("a draft point cleared by typing keeps ranking where it was", async () => {
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <ProximityProbe sources={{ draftPoint: DRAFT, timeZone: "Europe/London" }} />,
      );
    });
    await flushLazyResolver();
    expect(probeValue(tree as Tree)).toBe("3.428755,6.439518");
    // The first keystroke nulls the draft's coordinates.
    await TestRenderer.act(() => {
      (tree as Tree).update(
        <ProximityProbe sources={{ draftPoint: null, timeZone: "Europe/London" }} />,
      );
    });
    expect(probeValue(tree as Tree)).toBe("3.428755,6.439518");
    await TestRenderer.act(() => {
      (tree as Tree).unmount();
    });
  });

  test("no sources means no proximity", async () => {
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(<ProximityProbe />);
    });
    await flushLazyResolver();
    expect(probeValue(tree as Tree)).toBeUndefined();
    await TestRenderer.act(() => {
      (tree as Tree).unmount();
    });
  });

  test("the resolver stays behind a dynamic import — no Host file value-imports it", () => {
    const wrapper = fs.readFileSync(
      path.resolve(ROOT, "mingla-business/src/components/location/MapboxAddressInput.tsx"),
      "utf8",
    );
    expect(wrapper).toContain('import("../../utils/addressSearchProximity")');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || entry.name === "addressSearchProximity.ts") continue;
        const source = fs.readFileSync(full, "utf8");
        const valueImport =
          /^import\s+(?!type\b)[^;]*?from\s+["'][^"']*utils\/addressSearchProximity["']/ms;
        const requireCall = /require\(\s*["'][^"']*utils\/addressSearchProximity["']\s*\)/;
        if (valueImport.test(source) || requireCall.test(source)) {
          offenders.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.resolve(ROOT, "mingla-business/src"));
    walk(path.resolve(ROOT, "mingla-business/app"));
    expect(offenders).toEqual([]);
  });
});

async function typeIntoBusinessPicker(
  props: { proximity?: string; proximitySources?: HostAddressProximitySources },
): Promise<Record<string, unknown>> {
  mockInvoke.mockClear();
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <MapboxAddressInput
        value=""
        onChangeText={() => undefined}
        onPick={() => undefined}
        onClear={() => undefined}
        {...props}
      />,
    );
  });
  await flushLazyResolver();
  jest.useFakeTimers();
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
  test("a Host field's sources become proximity on the request, and still no types or country filter", async () => {
    const body = await typeIntoBusinessPicker({
      proximitySources: { brandPoint: null, draftPoint: null, timeZone: "Africa/Lagos" },
    });
    expect(body.action).toBe("suggest");
    expect(body.proximity).toBe("3.4,6.45");
    expect(body).not.toHaveProperty("types");
    expect(body).not.toHaveProperty("country");
  });

  test("an already-resolved proximity string is sent as given", async () => {
    const body = await typeIntoBusinessPicker({ proximity: "3.4219,6.4281" });
    expect(body.proximity).toBe("3.4219,6.4281");
    expect(body).not.toHaveProperty("types");
    expect(body).not.toHaveProperty("country");
  });

  test("without any source the request carries no proximity at all", async () => {
    const body = await typeIntoBusinessPicker({});
    expect(body.action).toBe("suggest");
    expect(body).not.toHaveProperty("proximity");
    expect(body).not.toHaveProperty("types");
    expect(body).not.toHaveProperty("country");
  });
});
