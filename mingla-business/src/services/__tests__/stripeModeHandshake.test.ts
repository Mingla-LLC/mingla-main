/**
 * ORCH-1056 — Jest test for the boot Stripe mode handshake.
 *
 * Verifies:
 *   - throws StripeModeMismatchError when backend disagrees with bundled pk
 *   - resolves to backend payload when both match
 *   - resolves to null when backend unreachable / non-200 (soft-warn)
 *   - resolves to null when bundled pk is unset
 *   - cache memoizes per session
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
        EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon_stub",
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_bundled_default",
      },
    },
  },
}));

import {
  StripeModeMismatchError,
  __resetStripeModeHandshakeCacheForTests,
  verifyStripeModeAlignment,
} from "../stripeModeHandshake";
import Constants from "expo-constants";

type FetchMock = jest.MockedFunction<typeof fetch>;

function installFetchMock(
  response: { ok: boolean; status?: number; json: () => unknown },
): FetchMock {
  const mock = jest.fn(async () =>
    ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.json(),
    } as Response)
  ) as unknown as FetchMock;
  (globalThis as unknown as { fetch: FetchMock }).fetch = mock;
  return mock;
}

function setBundledPk(pk: string | undefined): void {
  const extra = (Constants.expoConfig as unknown as { extra: Record<string, unknown> })
    .extra;
  if (pk === undefined) {
    delete extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  } else {
    extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk;
  }
}

describe("verifyStripeModeAlignment", () => {
  beforeEach(() => {
    __resetStripeModeHandshakeCacheForTests();
    jest.restoreAllMocks();
    setBundledPk("pk_test_bundled_default");
  });

  test("returns backend payload when pk_test_ bundled + backend test mode", async () => {
    installFetchMock({
      ok: true,
      json: () => ({ mode: "test", publishablePrefix: "pk_test_" }),
    });
    const result = await verifyStripeModeAlignment();
    expect(result).toEqual({ mode: "test", publishablePrefix: "pk_test_" });
  });

  test("throws StripeModeMismatchError when bundled pk_test_ but backend live", async () => {
    installFetchMock({
      ok: true,
      json: () => ({ mode: "live", publishablePrefix: "pk_live_" }),
    });
    await expect(verifyStripeModeAlignment()).rejects.toBeInstanceOf(
      StripeModeMismatchError,
    );
  });

  test("throws StripeModeMismatchError when bundled pk_live_ but backend test", async () => {
    setBundledPk("pk_live_bundled_live");
    installFetchMock({
      ok: true,
      json: () => ({ mode: "test", publishablePrefix: "pk_test_" }),
    });
    await expect(verifyStripeModeAlignment()).rejects.toBeInstanceOf(
      StripeModeMismatchError,
    );
  });

  test("returns null (soft-warn) when backend returns 500", async () => {
    installFetchMock({
      ok: false,
      status: 500,
      json: () => ({ error: "stripe_mode_unconfigured" }),
    });
    const result = await verifyStripeModeAlignment();
    expect(result).toBeNull();
  });

  test("returns null (soft-warn) when fetch throws", async () => {
    const mock = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as FetchMock;
    (globalThis as unknown as { fetch: FetchMock }).fetch = mock;
    const result = await verifyStripeModeAlignment();
    expect(result).toBeNull();
  });

  test("returns null when bundled pk is unset (no handshake possible)", async () => {
    setBundledPk(undefined);
    const result = await verifyStripeModeAlignment();
    expect(result).toBeNull();
  });

  test("caches the handshake — second call does not re-fetch", async () => {
    const mock = installFetchMock({
      ok: true,
      json: () => ({ mode: "test", publishablePrefix: "pk_test_" }),
    });
    await verifyStripeModeAlignment();
    await verifyStripeModeAlignment();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("returns null when backend payload shape is unexpected", async () => {
    installFetchMock({
      ok: true,
      json: () => ({ mode: "sandbox", publishablePrefix: "pk_dev_" }),
    });
    const result = await verifyStripeModeAlignment();
    expect(result).toBeNull();
  });
});
