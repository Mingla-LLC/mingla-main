/**
 * #4490 Explorer W2 fix round 3 — the signed-out claim flow (W2-N27, W2-N26),
 * the claim-link banner destination (N157) and the Purchases month header
 * year (W2-N28).
 *
 * FAILS-ON-REVERT:
 * - drop the claim branch in index.tsx handleDeepLink (claim links deferred
 *   again while signed out) and F3-L3 fails;
 * - drop the stamp check in loadWelcomePendingClaim / welcomeClaimDecision
 *   and F3-S5 / F3-V1 fail; drop the not_found status and F3-S3 fails;
 * - drop the settle effect or the post-sweep settle in index.tsx and F3-C2
 *   fails; make accountPendingClaimAction keep the code in the app and F3-C1
 *   fails;
 * - hide the plain email option beside a claim card again and F3-W1 fails;
 * - drop the year in other-year month headers and F3-M1 fails.
 */
// Jest globals, typed locally (app-mobile has no jest types in its tsconfig).
interface F3Matchers {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toContain(v: unknown): void;
  toBeGreaterThan(v: number): void;
  not: { toBe(v: unknown): void; toContain(v: unknown): void; toBeNull(): void };
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void | Promise<void>) => void;
declare const beforeEach: (body: () => void) => void;
declare const expect: (v: unknown) => F3Matchers;
declare const jest: { mock(path: string, factory: () => unknown): void };
declare const require: (id: string) => { readFileSync(p: string, enc: string): string };
declare const __dirname: string;

// In-memory secure store and a scripted claim-link endpoint.
const mockStore = new Map<string, string>();
const mockCalls: { op: string; code?: string }[] = [];
let mockNextResolve: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock("../../lib/secureStoreSafe", () => ({
  secureGetItem: async (key: string) => mockStore.get(key) ?? null,
  secureSetItem: async (key: string, value: string) => { mockStore.set(key, value); },
  secureDeleteItem: async (key: string) => { mockStore.delete(key); },
}));
jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: async (_name: string, options: { body: { op: string; code?: string } }) => {
        mockCalls.push(options.body);
        return mockNextResolve;
      },
    },
  },
  reactivateExplorerForVerifiedSession: () => undefined,
}));
jest.mock("@mingla/phone-input/phoneNumber", () => ({ formatPhoneNational: (v: string) => v }));
jest.mock("../../constants/countries", () => ({ COUNTRIES: [] }));
jest.mock("../../utils/zoneLabel", () => ({ formatStartsAtLabel: () => "" }));
jest.mock("../../config/queryClient", () => ({
  queryClient: { setQueryData: () => undefined, invalidateQueries: async () => undefined },
}));
jest.mock("../../hooks/useMyReservations", () => ({ myReservationsKeys: { all: ["myReservations"] } }));
jest.mock("@mingla/brand-rendering/stayGuest", () => ({ stayGuestKeys: { all: ["stayGuest"] } }));

import {
  loadWelcomePendingClaim,
  pendingClaimCodeFromUrl,
  savePendingClaimCode,
  settlePendingClaimForAccount,
  type PendingClaim,
} from "../attendanceClaimService";
import {
  accountPendingClaimAction,
  linkedClaimedEntry,
  parseStoredPendingClaim,
  pendingClaimRecord,
  welcomeClaimDecision,
} from "../pendingClaimPolicy";
import { welcomeSignInOptions } from "../../components/signIn/welcomeClaimModel";
import { lastAttachedClaimSweep, resetClaimSweepStateForTests, runClaimSweep } from "../claimSweep";
import { claimedEntryPath } from "../../components/purchases/missingTicketModel";
import { buildPurchaseTimeline, type PurchaseSources } from "../../utils/purchaseTimeline";

const fs = require("fs");
const read = (rel: string): string => fs.readFileSync(`${__dirname}/${rel}`, "utf8");
const KEY = "mingla.claimLink.pending.v1";
const CODE = "E5DP35E90M";

const activePayload = (code = CODE, over: Record<string, unknown> = {}) => ({
  data: {
    ok: true, status: "active", code, kind: "venue_booking", noun: "pass",
    title: "Gameland QA", orderLabel: null, startsAt: "2026-11-23T09:00:00+00:00",
    timezone: "Africa/Lagos", emailMasked: "h•••@e•••.com", phoneLast4: null,
    preferredProof: "email", ...over,
  },
  error: null,
});
const claim = (over: Partial<PendingClaim> = {}): PendingClaim => ({
  code: CODE, noun: "pass", title: "Gameland QA", orderLabel: null,
  startsAt: "2026-11-23T09:00:00+00:00", timezone: "Africa/Lagos",
  emailMasked: "h•••@e•••.com", phoneLast4: null, preferredProof: "email",
  expired: false, kind: "venue_booking", ...over,
});
const stored = () => parseStoredPendingClaim(mockStore.get(KEY) ?? null, Date.now());

beforeEach(() => {
  mockStore.clear();
  mockCalls.length = 0;
  mockNextResolve = activePayload();
});

describe("W2-N27 a claim link opened while signed out reaches the claim handler", () => {
  test("F3-L1 scheme and universal links give the same code", () => {
    expect(pendingClaimCodeFromUrl(`com.mingla.app.v2://c/${CODE}`)).toBe(CODE);
    expect(pendingClaimCodeFromUrl(`https://usemingla.com/c/${CODE}`)).toBe(CODE);
    expect(pendingClaimCodeFromUrl(`https://usemingla.com/c/${CODE.toLowerCase()}?x=1`)).toBe(CODE);
    expect(pendingClaimCodeFromUrl("https://usemingla.com/e/brand/event")).toBeNull();
  });

  test("F3-L2 cold or warm, scheme or https: the code is saved for this phone and the card is built for THAT purchase", async () => {
    for (const url of [`com.mingla.app.v2://c/${CODE}`, `https://usemingla.com/c/${CODE}`]) {
      mockStore.clear();
      const code = pendingClaimCodeFromUrl(url)!;
      await savePendingClaimCode(code, null); // signed out: no account stamp
      const parsed = stored();
      expect(parsed.kind).toBe("ok");
      if (parsed.kind === "ok") expect(parsed.record.accountId).toBeNull();
      const welcome = await loadWelcomePendingClaim();
      expect(welcome.claim?.code).toBe(CODE);
      expect(welcome.claim?.title).toBe("Gameland QA");
      const options = welcomeSignInOptions({
        ticketClaim: welcome.claim, platform: "ios", emailSignInAvailable: true,
        claimEmailFallback: false, claimEmailCodeOpen: false,
      });
      expect(options.claimCard).toBe(true);
      expect(options.claimEmail).toBe(true);
    }
  });

  test("F3-L3 the shell routes /c links before the unauthenticated deferral, on the cold and the warm path", () => {
    // [TEST-MOD-APPROVED #4490] fix 4: handleDeepLink takes a source ("os")
    // (W2-N32) and passes the link's noun to the claim handler (W2-N33).
    const index = read("../../../app/index.tsx");
    const body = index.slice(index.indexOf("const handleDeepLink = async (url: string, opts"));
    const claimAt = body.indexOf("const claimLinkCode = isOAuthCallback ? null : pendingClaimCodeFromUrl(url);");
    const handleAt = body.indexOf("handleIncomingClaimCode(claimLinkCode, claimLinkNounFromUrl(url));");
    const deferAt = body.indexOf("'mingla_deferred_deeplink'");
    expect(claimAt).toBeGreaterThan(-1);
    expect(handleAt).toBeGreaterThan(claimAt);
    expect(deferAt).toBeGreaterThan(handleAt);
    expect(body.slice(claimAt, deferAt)).toContain("if (claimLinkCode && !userIdRef.current) {");
    // Cold start (getInitialURL) and warm links (url listener) both use it.
    const linking = index.slice(index.indexOf("Linking.getInitialURL().then(async (url) => {"));
    expect(linking.slice(0, 1200)).toContain('handleDeepLink(url, { routerOpened: routerServesLink(url) });');
    expect(linking.slice(0, 1600)).toContain('handleDeepLink(event.url, { routerOpened: routerServesLink(event.url) });');
  });

  test("F3-L4 the handler waits for the session check, stamps a signed-in open, and never logs the code with an email", () => {
    const index = read("../../../app/index.tsx");
    const handler = index.slice(
      index.indexOf("const handleIncomingClaimCode = useCallback("),
      index.indexOf("const nextUserId = user?.id ?? null;"),
    );
    expect(handler).toContain("await waitForAuthSettled();");
    expect(handler).toContain("await savePendingClaimCode(code, accountAtOpen);");
    expect(handler).toContain("await cachePendingClaim(resolution.claim);");
    expect(handler).not.toContain("console.log(");
  });

  test("F3-L5 after sign-in, View opens the purchase the link was for even when several were attached (N157)", () => {
    const entry = (id: string, startsAt: string) => ({
      kind: "venue_booking", id, routeKind: "venue_booking" as const, routeId: id,
      offeringType: "venue" as const, noun: "pass" as const, title: "Gameland QA",
      orderLabel: null, startsAt, timezone: "Africa/Lagos", venueLine: null, quantity: 1,
      source: "booking" as const, sentByFirstName: null, chatJoined: null, conversationId: null,
    });
    const claimed = [
      entry("c14ed7f7", "2026-11-23T09:00:00Z"),
      entry("f345010d", "2026-11-26T13:00:00Z"),
    ];
    const picked = linkedClaimedEntry(claimed, claim());
    expect(picked?.id).toBe("c14ed7f7");
    expect(claimedEntryPath(picked as never)).toBe("/purchases/venue_booking/c14ed7f7");
    expect(linkedClaimedEntry(claimed, null)).toBeNull();
    expect(linkedClaimedEntry([claimed[1]], null)?.id).toBe("f345010d");
  });

  test("F3-L6 a new account made from the card lands on that purchase after onboarding, even after an idempotent repeat sweep", async () => {
    resetClaimSweepStateForTests();
    const row = {
      kind: "venue_booking", id: "c14ed7f7", routeKind: "venue_booking", routeId: "c14ed7f7",
      offeringType: "venue", noun: "pass", title: "Gameland QA", orderLabel: null,
      startsAt: "2026-11-23T09:00:00Z", timezone: "Africa/Lagos", venueLine: null, quantity: 1,
      source: "booking", sentByFirstName: null, chatJoined: null, conversationId: null,
    };
    mockNextResolve = { data: { count: 1, claimed: [row], more: false }, error: null };
    await runClaimSweep("u-new", "sign_in", { showBanner: false });
    mockNextResolve = { data: { count: 0, claimed: [], more: false }, error: null };
    await runClaimSweep("u-new", "sign_in", { showBanner: false });
    const attached = lastAttachedClaimSweep("u-new");
    const entry = attached ? linkedClaimedEntry(attached.claimed, claim()) : null;
    expect(entry ? claimedEntryPath(entry) : null).toBe("/purchases/venue_booking/c14ed7f7");
    // [TEST-MOD-APPROVED #4490] fix 4 (W2-N31): the hand-off moved into
    // onboardingClaimHandoff (missingTicketModel) and survives the sign-in
    // remount; the fix-4 suite covers it in depth.
    const index = read("../../../app/index.tsx");
    const done = index.slice(index.indexOf("logger.nav('OnboardingFlow completed"));
    expect(done.slice(0, 3200)).toContain("onboardingClaimHandoff(");
    expect(done.slice(0, 3200)).toContain("router.push(path as never);");
  });
});

describe("W2-N26 a stale saved claim never blocks the next person", () => {
  test("F3-V1 validation outcomes for a saved code", () => {
    const record = pendingClaimRecord(CODE, null, Date.now(), claim());
    expect(welcomeClaimDecision(record, { status: "claim", claim: claim() }).action).toBe("show");
    expect(welcomeClaimDecision(record, { status: "claim", claim: claim({ expired: true }) }).action).toBe("clear");
    expect(welcomeClaimDecision(record, { status: "not_found" }).action).toBe("clear"); // cancelled / unconfirmed / unknown
    expect(welcomeClaimDecision(record, { status: "redirect" }).action).toBe("clear");
    const offline = welcomeClaimDecision(record, { status: "unavailable" });
    expect(offline.action).toBe("keep");
    if (offline.action === "keep") expect(offline.claim?.title).toBe("Gameland QA");
    // Carried by an account that has left: cleared whatever Mingla says.
    const stamped = pendingClaimRecord(CODE, "c7b493ec", Date.now(), claim());
    expect(welcomeClaimDecision(stamped, { status: "claim", claim: claim() }).action).toBe("clear");
  });

  test("F3-S2 offline or a failed resolve keeps the saved code and shows the last good card", async () => {
    await savePendingClaimCode(CODE, null);
    await loadWelcomePendingClaim(); // caches the good copy
    mockNextResolve = { data: null, error: new Error("offline") };
    const welcome = await loadWelcomePendingClaim();
    expect(welcome.cached).toBe(true);
    expect(welcome.claim?.title).toBe("Gameland QA");
    expect(stored().kind).toBe("ok");
  });

  test("F3-S3 a cancelled, unconfirmed or unknown purchase (not_found) clears the code: normal welcome", async () => {
    await savePendingClaimCode(CODE, null);
    mockNextResolve = { data: { ok: true, status: "not_found" }, error: null };
    const welcome = await loadWelcomePendingClaim();
    expect(welcome.claim).toBeNull();
    expect(mockStore.has(KEY)).toBe(false);
  });

  test("F3-S4 an expired link clears the saved code", async () => {
    await savePendingClaimCode(CODE, null);
    mockNextResolve = activePayload(CODE, { status: "expired" });
    expect((await loadWelcomePendingClaim()).claim).toBeNull();
    expect(mockStore.has(KEY)).toBe(false);
  });

  test("F3-S5 session expiry or forced sign-out: a code the account carried is cleared with no network call", async () => {
    await savePendingClaimCode(CODE, "c7b493ec"); // saved while signed in
    mockCalls.length = 0;
    const welcome = await loadWelcomePendingClaim();
    expect(welcome.claim).toBeNull();
    expect(mockStore.has(KEY)).toBe(false);
    expect(mockCalls.length).toBe(0);
  });

  test("F3-S6 a record saved before this version (no stamp, W2-N26's card) is dropped once", async () => {
    mockStore.set(KEY, JSON.stringify({ code: "0T38Y2EKC2", savedAt: Date.now() }));
    expect((await loadWelcomePendingClaim()).claim).toBeNull();
    expect(mockStore.has(KEY)).toBe(false);
  });

  test("F3-C1 a completed claim clears the code: banner View, detail, sweep success or idempotent repeat all happen in the app", async () => {
    const record = pendingClaimRecord(CODE, null, Date.now());
    expect(accountPendingClaimAction({ signedInUserId: "u1", onboardingActive: false, record })).toBe("clear");
    expect(accountPendingClaimAction({ signedInUserId: "u1", onboardingActive: true, record })).toBe("stamp");
    expect(accountPendingClaimAction({ signedInUserId: null, onboardingActive: false, record })).toBe("none");
    await savePendingClaimCode(CODE, null);
    expect(await settlePendingClaimForAccount("u1", true)).toBe("stamp");
    const parsed = stored();
    if (parsed.kind === "ok") expect(parsed.record.accountId).toBe("u1");
    expect(await settlePendingClaimForAccount("u1", false)).toBe("clear");
    expect(mockStore.has(KEY)).toBe(false);
  });

  test("F3-C2 the shell settles the code on every sign-in, onboarding change and after the claim sweep", () => {
    const index = read("../../../app/index.tsx");
    expect(index).toContain("void settlePendingClaimForAccount(user.id, pendingClaimOnboardingActive);");
    expect(index).toContain("}, [user?.id, pendingClaimOnboardingActive]);");
    const handler = index.slice(index.indexOf("const handleIncomingClaimCode = useCallback("));
    const sweepAt = handler.indexOf('await recheckClaims("claim_link");');
    expect(handler.indexOf("await settlePendingClaimForAccount(")).toBeGreaterThan(sweepAt);
    const loader = index.slice(index.indexOf("void loadWelcomePendingClaim()") - 900);
    expect(loader).toContain("if (isLoadingAuth) return;");
    // Explicit sign-out keeps fix 2's clear.
    const branch = index.slice(index.indexOf('if (authAction === "clear") {'), index.indexOf('} else if (authAction === "resume") {'));
    expect(branch).toContain("void clearPendingClaimIntent().then(");
  });

  test("F3-W1 the welcome always offers the normal sign-in options beside a card, and a way to dismiss it", () => {
    const withCard = welcomeSignInOptions({
      ticketClaim: claim(), platform: "ios", emailSignInAvailable: true,
      claimEmailFallback: false, claimEmailCodeOpen: false,
    });
    expect(withCard).toEqual({
      claimCard: true, claimEmail: true, dismissClaim: true, apple: true, google: true, email: true,
    });
    const android = welcomeSignInOptions({
      ticketClaim: claim(), platform: "android", emailSignInAvailable: true,
      claimEmailFallback: false, claimEmailCodeOpen: false,
    });
    expect(android.google && android.email && !android.apple).toBe(true);
    // Only while the purchase-email code is being typed is the plain option hidden.
    expect(welcomeSignInOptions({
      ticketClaim: claim(), platform: "ios", emailSignInAvailable: true,
      claimEmailFallback: false, claimEmailCodeOpen: true,
    }).email).toBe(false);
    expect(welcomeSignInOptions({
      ticketClaim: null, platform: "ios", emailSignInAvailable: true,
      claimEmailFallback: false, claimEmailCodeOpen: false,
    }).dismissClaim).toBe(false);
    const welcome = read("../../components/signIn/WelcomeScreen.tsx");
    expect(welcome).toContain("{signInOptions.email ? (");
    expect(welcome).toContain('testID="welcome-ticket-claim-dismiss"');
    const index = read("../../../app/index.tsx");
    expect(index).toContain("onDismissTicketClaim={dismissWelcomeTicketClaim}");
  });
});

describe("W2-N28 a month in another year carries its year", () => {
  const NOW = new Date("2026-11-22T06:00:00Z");
  const empty: PurchaseSources = { orders: [], rsvps: [], reservations: [], venueOrders: [] };
  const order = (id: string, startAt: string) => ({
    id, eventId: `e-${id}`, eventTitle: "Afrobeats night", eventType: "event", brandName: "Host",
    coverMediaUrl: null, startAt, endAt: null, timezone: "Africa/Lagos", venueLine: null,
    paymentStatus: "paid", ticketCount: 1, validTicketCount: 1, source: null, currency: "NGN",
    buyerTotalCents: 1075000, refundedAmountCents: 0, raw: {},
  });

  test("F3-M1 next year's November reads 'November 2027'; this year's December stays 'December'", () => {
    const result = buildPurchaseTimeline({
      ...empty,
      orders: [order("a", "2026-12-05T18:00:00Z"), order("b", "2027-11-21T18:00:00Z")] as never,
    }, NOW, "en-GB");
    expect(result.upcoming.map((group) => group.title)).toEqual(["December", "November 2027"]);
  });
});
