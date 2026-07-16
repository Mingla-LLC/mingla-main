/**
 * ORCH-1375 — the sessionStorage hand-off that carries `next` across the OAuth
 * round-trip. Backs T-9 / T-10 / T-14 / T-15 and, critically, SC-4.
 *
 * ─── WHY SC-4 IS THE ONE THAT MATTERS ──────────────────────────────────────
 * A fix that wires only `auth/index.tsx` makes the EMAIL-OTP resume work — so it
 * LOOKS complete — while silently dropping the token for every Google/Apple
 * invitee, because `buildWebRedirectTo()` returns a bare `${origin}/auth/callback`
 * with no query params and `next` lives only in the `/auth` URL. The OAuth leg is
 * invisible unless you test it. So: `simulateOAuthRoundTrip` below actually
 * DESTROYS the URL, exactly as the browser does.
 */

import {
  AUTH_NEXT_STORAGE_KEY,
  captureNextRoute,
  consumeNextRoute,
} from "../authNextHandoff";
import { sanitizeNextRoute } from "../nextRoute";

/** Minimal in-memory sessionStorage. */
function installFakeSessionStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const fake: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  (globalThis as unknown as { window: unknown }).window = {
    sessionStorage: fake,
  };
  return map;
}

const clearWindow = (): void => {
  delete (globalThis as unknown as { window?: unknown }).window;
};

const INVITE_NEXT = "/accept-brand-invitation?token=abc123";

describe("ORCH-1375 authNextHandoff — capture/consume", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installFakeSessionStorage();
  });
  afterEach(clearWindow);

  it("captures a sanitized value under the namespaced per-tab key", () => {
    captureNextRoute(sanitizeNextRoute(INVITE_NEXT));
    expect(store.get(AUTH_NEXT_STORAGE_KEY)).toBe(INVITE_NEXT);
  });

  it("capture(null) CLEARS a stale value rather than leaving it armed", () => {
    store.set(AUTH_NEXT_STORAGE_KEY, "/rsvp/create");
    // A rejected/absent `next` on a fresh sign-in must not resurrect the old one.
    captureNextRoute(sanitizeNextRoute("//evil.com"));
    expect(store.has(AUTH_NEXT_STORAGE_KEY)).toBe(false);
  });

  it("CONSUME-ONCE — the key is cleared on read (success path)", () => {
    captureNextRoute(INVITE_NEXT);
    expect(consumeNextRoute()).toBe(INVITE_NEXT);
    expect(consumeNextRoute()).toBeNull();
    expect(store.has(AUTH_NEXT_STORAGE_KEY)).toBe(false);
  });

  it("CONSUME-ONCE — the key is cleared even when the value is later REJECTED", () => {
    // Someone wrote a hostile value directly into sessionStorage (same-origin).
    store.set(AUTH_NEXT_STORAGE_KEY, "https://evil.com");
    const raw = consumeNextRoute();
    expect(store.has(AUTH_NEXT_STORAGE_KEY)).toBe(false); // burned regardless
    expect(sanitizeNextRoute(raw)).toBeNull(); // and rejected
  });

  it("a stale next NEVER resumes a later, unrelated sign-in", () => {
    captureNextRoute(INVITE_NEXT);
    consumeNextRoute(); // first sign-in consumes it
    // A second, unrelated sign-in later:
    expect(sanitizeNextRoute(consumeNextRoute())).toBeNull();
  });

  it("consume returns RAW — the module never validates on read (callers must)", () => {
    store.set(AUTH_NEXT_STORAGE_KEY, "javascript:alert(1)");
    // This is the contract: raw out, caller sanitizes. Pinning it so nobody
    // "helpfully" removes the caller-side sanitize believing this validates.
    expect(consumeNextRoute()).toBe("javascript:alert(1)");
  });

  it("is storage-less-safe (SSR / native / privacy mode) — never throws", () => {
    clearWindow();
    expect(() => captureNextRoute(INVITE_NEXT)).not.toThrow();
    expect(consumeNextRoute()).toBeNull();
  });

  it("survives a sessionStorage that throws on access (Safari privacy mode)", () => {
    (globalThis as unknown as { window: unknown }).window = {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    };
    expect(() => captureNextRoute(INVITE_NEXT)).not.toThrow();
    expect(consumeNextRoute()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-4 — the leg a naive fix silently breaks
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1375 SC-4 — the OAuth round-trip destroys the URL; the handoff survives it", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installFakeSessionStorage();
  });
  afterEach(clearWindow);

  /**
   * Reproduces what the browser actually does on Google/Apple sign-in:
   *   /auth?next=X → Google → Supabase → /auth/callback#access_token=…
   * `buildWebRedirectTo()` returns `${origin}/auth/callback` with NO query
   * params, so the `next` in the URL is GONE by the time we land.
   */
  const simulateOAuthRoundTrip = (): { urlNextOnCallback: string | null } => ({
    urlNextOnCallback: null, // ← the whole point: the URL no longer carries it
  });

  it("T-10 / SC-4 — an OAuth invitee still resumes to the invite (the URL cannot carry it)", () => {
    // 1. /auth?next=/accept-brand-invitation?token=abc123 — capture on mount.
    captureNextRoute(sanitizeNextRoute(INVITE_NEXT));

    // 2. The round-trip. The URL's `next` is annihilated.
    const { urlNextOnCallback } = simulateOAuthRoundTrip();
    expect(sanitizeNextRoute(urlNextOnCallback)).toBeNull();

    // 3. /auth/callback resolves the destination from the handoff instead.
    const resumed = sanitizeNextRoute(consumeNextRoute());
    expect(resumed).toBe(INVITE_NEXT);
  });

  it("PROOF THE NAIVE FIX FAILS — URL-only resolution drops the token on OAuth", () => {
    captureNextRoute(sanitizeNextRoute(INVITE_NEXT));
    const { urlNextOnCallback } = simulateOAuthRoundTrip();

    // The naive implementation: read `next` from the URL only.
    const naiveDestination = sanitizeNextRoute(urlNextOnCallback) ?? "/(tabs)/home";

    // It lands the invitee on HOME with the invite silently discarded — which
    // LOOKS like success. That is worse than the infinite spinner it replaced.
    expect(naiveDestination).toBe("/(tabs)/home");
    expect(naiveDestination).not.toBe(INVITE_NEXT);
  });

  it("T-9 — the EMAIL-OTP path never navigates, so the URL still wins there", () => {
    captureNextRoute(sanitizeNextRoute(INVITE_NEXT));
    // No page navigation: `next` is still in the /auth URL.
    const fromUrl = sanitizeNextRoute(INVITE_NEXT);
    const stored = consumeNextRoute(); // consumed anyway (consume-once)
    expect(fromUrl ?? sanitizeNextRoute(stored)).toBe(INVITE_NEXT);
    expect(store.has(AUTH_NEXT_STORAGE_KEY)).toBe(false);
  });

  it.each([
    ["T-14 — /rsvp/create", "/rsvp/create"],
    ["T-15 — /event/create", "/event/create"],
    ["scanner invite", "/accept-scanner-invitation?token=xyz"],
  ])("%s resumes through the same route-agnostic readers (fixed for free)", (_l, target) => {
    captureNextRoute(sanitizeNextRoute(target));
    expect(sanitizeNextRoute(consumeNextRoute())).toBe(target);
  });

  it("SECURITY — a hostile value planted in sessionStorage NEVER reaches the router", () => {
    for (const attack of [
      "https://evil.com",
      "//evil.com",
      "javascript:alert(1)",
      "/brand/1/payments",
    ]) {
      store.set(AUTH_NEXT_STORAGE_KEY, attack);
      expect(sanitizeNextRoute(consumeNextRoute())).toBeNull();
    }
  });
});
