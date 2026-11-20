// MINGLA-INVARIANT: I-BUYER-MEDIA-NO-TRANSFORM | issue #4518 | buyer image fallback rewrites only Supabase public-storage object URLs to the same-origin road, byte-for-byte, and never to the image-transformation endpoint.
/**
 * issue #4518 follow-up — buyer pictures take the second road.
 *
 * Proves the pure owner (`buyerMediaRoute.ts`) and the package hook
 * (`useOfferingImageUri`): one fallback per picture, an 8 s hang timer that a
 * load cancels, nothing scheduled without a provider (native), handler
 * identity stable across parent renders (#3827).
 *
 * FAILS ON REVERT: remove the hook's fallback (`offeringImageAfterError`) or
 * the resolver and M-6 / M-7 / M-8 fail (the uri stays direct). Rewrite a
 * `/render/image/` or signed url and M-2 fails.
 *
 * Lives beside the app owner (not under packages/offering-rendering) because
 * package tests run under Deno and this proof needs React plus the app module.
 */
import React from "react";

jest.mock("../supabase", () => ({
  databaseRouteNow: () => "direct",
  supabaseProjectUrl: "https://proj.supabase.co",
}));

const mockCapture = jest.fn();
jest.mock("../../analytics/webAnalytics", () => ({
  captureWeb: (...args: unknown[]) => mockCapture(...args),
}));

// eslint-disable-next-line import/first
import {
  createBuyerMediaRoute,
  isPublicStorageUrl,
  resetBuyerMediaRoute,
  toSameOriginStorage,
} from "../buyerMediaRoute";
// eslint-disable-next-line import/first
import {
  OfferingMediaRouteContext,
  PASS_THROUGH_MEDIA_ROUTE,
  type OfferingMediaRoute,
} from "../../../../packages/offering-rendering/offeringMediaRoute";
// eslint-disable-next-line import/first
import {
  useOfferingImageUri,
  type OfferingImageUri,
} from "../../../../packages/offering-rendering/useOfferingImageUri";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    update: (element: React.ReactElement) => void;
    unmount: () => void;
  };
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mounted = ReturnType<typeof TestRenderer.create>;

/**
 * Re-render a mounted tree with react-test-renderer's own `update`. A named
 * helper so the I-MUTATION-ROWCOUNT scan (which reads every update call under
 * src/services as a Supabase write) does not mistake a renderer for a query.
 */
function rerender(mounted: Mounted | null, element: React.ReactElement): void {
  if (mounted === null) throw new Error("rerender: nothing mounted");
  const { update } = mounted;
  update(element);
}

const ORIGIN = "https://proj.supabase.co";
const THUMB = `${ORIGIN}/storage/v1/object/public/place-photos/ChIJ123/2_thumb.jpg?x=1`;
const COVER = `${ORIGIN}/storage/v1/object/public/event-covers/a%20b/cover.jpg`;
const SAME_THUMB = "/_sb/storage/v1/object/public/place-photos/ChIJ123/2_thumb.jpg?x=1";

const flushImports = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
  resetBuyerMediaRoute();
  mockCapture.mockReset();
});

describe("#4518 buyerMediaRoute — which pictures may take our own site", () => {
  test("M-1 only public-storage objects on the project origin match", () => {
    expect(isPublicStorageUrl(THUMB, ORIGIN)).toBe(true);
    expect(isPublicStorageUrl(COVER, ORIGIN)).toBe(true);
    expect(isPublicStorageUrl(`${ORIGIN}/storage/v1/render/image/public/x.jpg?width=300`, ORIGIN)).toBe(false);
    expect(isPublicStorageUrl(`${ORIGIN}/storage/v1/object/sign/x.jpg?token=t`, ORIGIN)).toBe(false);
    expect(isPublicStorageUrl(`${ORIGIN}/storage/v1/object/authenticated/x.jpg`, ORIGIN)).toBe(false);
    expect(isPublicStorageUrl("https://res.cloudinary.com/x/image/upload/v1/a.jpg", ORIGIN)).toBe(false);
    expect(isPublicStorageUrl(`https://evil.example/${ORIGIN}/storage/v1/object/public/x.jpg`, ORIGIN)).toBe(false);
    expect(isPublicStorageUrl(`${ORIGIN}.evil.example/storage/v1/object/public/x.jpg`, ORIGIN)).toBe(false);
    expect(isPublicStorageUrl(THUMB, "")).toBe(false);
  });

  test("M-2 the rewrite keeps path and query byte-for-byte; never the transform endpoint", () => {
    expect(toSameOriginStorage(THUMB, ORIGIN)).toBe(SAME_THUMB);
    expect(toSameOriginStorage(COVER, ORIGIN)).toBe(
      "/_sb/storage/v1/object/public/event-covers/a%20b/cover.jpg",
    );
    const route = createBuyerMediaRoute(() => "direct", ORIGIN);
    for (const url of [
      `${ORIGIN}/storage/v1/render/image/public/x.jpg?width=300`,
      `${ORIGIN}/storage/v1/object/sign/x.jpg?token=t`,
      "https://res.cloudinary.com/x/image/upload/v1/a.jpg",
    ]) {
      expect(route.resolve(url)).toBe(url);
      expect(route.fallback(url)).toBeNull();
    }
    const out = [route.fallback(THUMB), route.fallback(COVER)].join(" ");
    expect(out).not.toContain("/render/image/");
    expect(out).not.toMatch(/[?&](width|height|quality|format|resize)=/);
  });

  test("M-3 a visit already on the second road starts pictures there; a fine visit does not", () => {
    expect(createBuyerMediaRoute(() => "direct", ORIGIN).resolve(THUMB)).toBe(THUMB);
    expect(createBuyerMediaRoute(() => "sameOrigin", ORIGIN).resolve(THUMB)).toBe(SAME_THUMB);
    // Already same-origin: no second fallback.
    expect(createBuyerMediaRoute(() => "sameOrigin", ORIGIN).fallback(SAME_THUMB)).toBeNull();
  });

  test("M-4 the first rescued picture moves this visit's later pictures; reported once", async () => {
    const route = createBuyerMediaRoute(() => "direct", ORIGIN);
    route.onFallbackResult?.(true);
    route.onFallbackResult?.(true);
    expect(route.resolve(COVER)).toBe("/_sb/storage/v1/object/public/event-covers/a%20b/cover.jpg");
    await flushImports();
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith("buyer_database_route", {
      outcome: "rescued",
      path: "/storage/v1/object/public",
    });
  });

  test("M-5 both roads failing is reported once and moves nothing", async () => {
    const route = createBuyerMediaRoute(() => "direct", ORIGIN);
    route.onFallbackResult?.(false);
    route.onFallbackResult?.(false);
    expect(route.resolve(COVER)).toBe(COVER);
    await flushImports();
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith("buyer_database_route", {
      outcome: "unreachable",
      path: "/storage/v1/object/public",
    });
  });
});

// ---- the package hook ------------------------------------------------------

let latest: OfferingImageUri | null = null;
const Probe = ({ url, label }: { url: string | null; label: string }): React.ReactElement | null => {
  latest = useOfferingImageUri(url);
  return label.length > 0 ? null : null;
};
const mount = (route: OfferingMediaRoute | null, url: string | null, label = "a"): React.ReactElement =>
  route === null ? (
    <Probe url={url} label={label} />
  ) : (
    <OfferingMediaRouteContext.Provider value={route}>
      <Probe url={url} label={label} />
    </OfferingMediaRouteContext.Provider>
  );
const current = (): OfferingImageUri => {
  if (latest === null) throw new Error("hook not rendered");
  return latest;
};

describe("#4518 useOfferingImageUri — one fallback per picture", () => {
  beforeEach(() => {
    latest = null;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("M-6 an error swaps once to the fallback; a second error hands back to the caller", async () => {
    const results: boolean[] = [];
    const route: OfferingMediaRoute = {
      ...createBuyerMediaRoute(() => "direct", ORIGIN),
      onFallbackResult: (ok) => results.push(ok),
    };
    let r: ReturnType<typeof TestRenderer.create> | null = null;
    await TestRenderer.act(() => {
      r = TestRenderer.create(mount(route, THUMB));
    });
    expect(current().uri).toBe(THUMB);
    let handled = false;
    await TestRenderer.act(() => {
      handled = current().onError();
    });
    expect(handled).toBe(true);
    expect(current().uri).toBe(SAME_THUMB);
    await TestRenderer.act(() => {
      handled = current().onError();
    });
    expect(handled).toBe(false);
    expect(current().uri).toBe(SAME_THUMB);
    expect(results).toEqual([false]);
    await TestRenderer.act(() => {
      (r as unknown as { unmount: () => void }).unmount();
    });
  });

  test("M-7 a hang of 8 s swaps to the fallback; the fallback loading reports success", async () => {
    const results: boolean[] = [];
    const route: OfferingMediaRoute = {
      ...createBuyerMediaRoute(() => "direct", ORIGIN),
      onFallbackResult: (ok) => results.push(ok),
    };
    await TestRenderer.act(() => {
      TestRenderer.create(mount(route, COVER));
    });
    await TestRenderer.act(() => {
      jest.advanceTimersByTime(7999);
    });
    expect(current().uri).toBe(COVER);
    await TestRenderer.act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(current().uri).toBe("/_sb/storage/v1/object/public/event-covers/a%20b/cover.jpg");
    // No second timer on the fallback.
    await TestRenderer.act(() => {
      jest.advanceTimersByTime(60000);
    });
    expect(current().uri).toBe("/_sb/storage/v1/object/public/event-covers/a%20b/cover.jpg");
    await TestRenderer.act(() => {
      current().onLoad();
    });
    expect(results).toEqual([true]);
  });

  test("M-8 a load before the time limit cancels the timer (a fine connection costs nothing)", async () => {
    const route = createBuyerMediaRoute(() => "direct", ORIGIN);
    await TestRenderer.act(() => {
      TestRenderer.create(mount(route, COVER));
    });
    await TestRenderer.act(() => {
      current().onLoad();
    });
    await TestRenderer.act(() => {
      jest.advanceTimersByTime(60000);
    });
    expect(current().uri).toBe(COVER);
  });

  test("M-9 no provider (native) never schedules a timer and never rewrites", async () => {
    expect(PASS_THROUGH_MEDIA_ROUTE.timeLimitMs).toBeNull();
    const spy = jest.spyOn(global, "setTimeout");
    await TestRenderer.act(() => {
      TestRenderer.create(mount(null, THUMB));
    });
    const hookTimers = spy.mock.calls.filter(([, ms]) => ms === 8000);
    expect(hookTimers).toHaveLength(0);
    expect(current().uri).toBe(THUMB);
    let handled = true;
    await TestRenderer.act(() => {
      handled = current().onError();
    });
    expect(handled).toBe(false);
    expect(current().uri).toBe(THUMB);
    spy.mockRestore();
  });

  test("M-10 handler identity is stable across parent renders and changes with the url (#3827)", async () => {
    const route = createBuyerMediaRoute(() => "direct", ORIGIN);
    let r: ReturnType<typeof TestRenderer.create> | null = null;
    await TestRenderer.act(() => {
      r = TestRenderer.create(mount(route, THUMB, "first"));
    });
    const before = current();
    await TestRenderer.act(() => {
      rerender(r, mount(route, THUMB, "second"));
    });
    expect(current().onError).toBe(before.onError);
    expect(current().onLoad).toBe(before.onLoad);
    await TestRenderer.act(() => {
      rerender(r, mount(route, COVER, "second"));
    });
    expect(current().onError).not.toBe(before.onError);
    expect(current().uri).toBe(COVER);
  });

  test("M-11 a url change resets the one fallback", async () => {
    const route = createBuyerMediaRoute(() => "direct", ORIGIN);
    let r: ReturnType<typeof TestRenderer.create> | null = null;
    await TestRenderer.act(() => {
      r = TestRenderer.create(mount(route, THUMB));
    });
    await TestRenderer.act(() => {
      current().onError();
    });
    expect(current().uri).toBe(SAME_THUMB);
    await TestRenderer.act(() => {
      rerender(r, mount(route, COVER));
    });
    expect(current().uri).toBe(COVER);
    let handled = false;
    await TestRenderer.act(() => {
      handled = current().onError();
    });
    expect(handled).toBe(true);
  });
});
