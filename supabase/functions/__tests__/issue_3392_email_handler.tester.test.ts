// Independent #3392 regression: real HTTP create/dispatch handlers, real
// Supabase query builders, drain, token resolver, renderer and email adapter.
// Only transport is replaced: owned loopback listeners and fail-closed HTTP
// fixtures. No copied dispatch/auth logic and no live credentials or sends.
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processGeneric } from "../notify-outbox-drain/index.ts";
import {
  guestCancelTokenHash,
  loadGuestReservationManageView,
} from "../_shared/guestReservationManageView.ts";
import {
  readVenueReservationManageKeyRing,
  resolveVenueReservationManageLink,
} from "../_shared/venueReservationManageToken.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER_BRAND = "22222222-2222-4222-8222-222222222222";
const VENUE = "33333333-3333-4333-8333-333333333333";
const RESERVATION = "44444444-4444-4444-8444-444444444444";
const OTHER_RESERVATION = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";
const EMAIL = "handler-fixture@example.test";
const SERVICE = "fixture-service-role-3392";
const DB = "https://fixture-3392.invalid";
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(39)));
const BUNDLE = JSON.stringify({
  VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KID: "qa39",
  VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KEY_B64: KEY,
});

Deno.test("#3392 independent actual-handler credential/recipient boundary", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalListen = Deno.listen;
  const originalGet = Deno.env.get;
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const listeners: Deno.TcpListener[] = [];
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE,
    RESEND_API_KEY: "fixture-resend-3392",
    AD_CONVERSION_TOKENS: BUNDLE,
    DENO_TESTING: "1",
    PAYSTACK_SECRET_KEY_TEST: "sk_test_fixture_only_3392",
    MINGLA_STRIPE_MODE: "test",
    STRIPE_RAK_TICKET_CHECKOUT_TEST: "rk_test_fixture_only_3392",
    BUSINESS_WEB_ORIGIN: "https://host.usemingla.com",
    ONESIGNAL_APP_ID: "fixture-app-3392",
    ONESIGNAL_REST_API_KEY: "fixture-push-key-3392",
  };
  let tables: Record<string, Row[]> = {};
  let writes: Row[] = [];
  let emails: Row[] = [];
  let pushes: Row[] = [];
  let dispatches: Row[] = [];
  let providers: Row[] = [];
  let logs: string[] = [];
  let rejected: string[] = [];
  let dispatchOrigin = "";
  let createOrigin = "";
  let stripe = false;
  const reservedFor = new Date(Date.now() + 86400000 * 7).toISOString();
  const response = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  function reset(paid = false) {
    assertEquals(rejected, [], "previous scenario attempted unmodelled HTTP");
    stripe = false;
    writes = [];
    emails = [];
    pushes = [];
    dispatches = [];
    providers = [];
    logs = [];
    rejected = [];
    env.AD_CONVERSION_TOKENS = BUNDLE;
    tables = {
      venue_listings: [{ id: VENUE, brand_id: BRAND, name: "Fixture venue" }],
      brands: [{
        id: BRAND,
        name: "Fixture brand",
        default_currency: "NGN",
        payout_hold_cutover_at: "2026-01-01T00:00:00Z",
      }],
      venue_reservation_settings: [{
        venue_id: VENUE,
        reservations_enabled: true,
        fee_enabled: paid,
        fee_amount_cents: paid ? 10000 : 0,
        fee_currency: "NGN",
      }],
      notification_categories: [{
        key: "buyer_reservation_confirmed",
        is_transactional: true,
        urgency: "normal",
        default_channels: ["inapp", "push", "email"],
        active: true,
      }],
      reservation_checkout_sessions: [],
      reservations: [],
    };
  }
  function matches(row: Row, url: URL) {
    return [...url.searchParams].every(([key, value]) => {
      if (["select", "limit", "order"].includes(key)) return true;
      assert(value.startsWith("eq."), `unmodelled query operator: ${key}`);
      return String(row[key]) === value.slice(3);
    });
  }
  async function post(origin: string, body: Row, bearer?: string) {
    const result = await originalFetch(origin, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        connection: "close",
        ...(bearer ? { authorization: bearer } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: result.status, body: await result.json() };
  }
  function createBody(surface = "web") {
    return {
      venueId: VENUE,
      brandId: OTHER_BRAND,
      surface,
      reservedForUtc: reservedFor,
      partySize: 2,
      buyer: {
        name: "Fixture Guest",
        email: EMAIL,
        phone: "+2348031234567",
        phoneCountryIso: "NG",
      },
    };
  }
  function outbox(
    guestEmail: unknown = EMAIL,
    contact: string | null = "+2348031234567",
    user: string | null = null,
  ) {
    return {
      id: crypto.randomUUID(),
      brand_id: BRAND,
      category_key: "buyer_reservation_confirmed",
      user_id: user,
      contact,
      attempts: 0,
      country_code: "NG",
      idempotency_key: crypto.randomUUID(),
      payload: {
        reservation_id: RESERVATION,
        guest_email: guestEmail,
        guest_phone_e164: "+2348031234567",
        reserved_for: reservedFor,
        party_size: 2,
      },
    };
  }
  const client = () =>
    createClient(DB, SERVICE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  async function drain(row: Row) {
    assertEquals(await processGeneric(client(), row, DB, SERVICE), true);
  }
  function assertPrivate(token: string) {
    assert(
      !JSON.stringify(pushes).includes(token),
      "credential reached push provider payload",
    );
    assert(
      !JSON.stringify(writes).includes(token),
      "plaintext credential reached DB/RPC writes",
    );
    assert(
      !JSON.stringify(logs).includes(token),
      "plaintext credential reached logs",
    );
    assert(
      !JSON.stringify(dispatches.map((d) => d.payload)).includes(token),
      "credential reached reusable payload",
    );
    assert(
      !JSON.stringify(writes).includes(KEY),
      "signing key reached a write",
    );
    assert(!JSON.stringify(logs).includes(KEY), "signing key reached logs");
    assertEquals(rejected, [], "unmodelled outbound HTTP attempted");
  }
  try {
    // Never read the host's environment. All function reads see fixtures only.
    Deno.env.get = (name: string) => env[name];
    for (const level of ["log", "warn", "error"] as const) {
      console[level] = (...args: unknown[]) => logs.push(JSON.stringify(args));
    }
    globalThis.fetch =
      (async (input: string | URL | Request, init?: RequestInit) => {
        const req = new Request(input, init);
        const url = new URL(req.url);
        if (
          [dispatchOrigin, createOrigin].includes(url.origin) &&
          url.hostname === "127.0.0.1"
        ) return originalFetch(req);
        const rawBody = req.method === "GET" || req.method === "HEAD"
          ? ""
          : await req.text();
        const body = url.hostname === "api.stripe.com"
          ? Object.fromEntries(new URLSearchParams(rawBody))
          : JSON.parse(rawBody || "null");
        if (
          url.origin === DB && url.pathname === "/functions/v1/notify-dispatch"
        ) {
          dispatches.push(body);
          const delivered = await post(
            dispatchOrigin,
            body,
            req.headers.get("authorization") ?? undefined,
          );
          return response(delivered.body, delivered.status);
        }
        if (url.origin === DB && url.pathname === "/auth/v1/user") {
          return response({ id: USER });
        }
        if (url.origin === DB && url.pathname.startsWith("/rest/v1/")) {
          const table = url.pathname.slice("/rest/v1/".length);
          if (req.method !== "GET") writes.push({ table, body });
          if (table === "rpc/can_send") return response(true);
          if (table === "rpc/pg_venue_available_slots") {
            return response([{
              slot_start_utc: reservedFor,
              is_full: false,
              remaining: 3,
            }]);
          }
          if (table === "rpc/pg_create_guest_reservation") {
            assertEquals(body.p_venue_id, VENUE);
            tables.reservations.push({
              id: RESERVATION,
              venue_id: VENUE,
              status: "confirmed",
              payment_status: "none",
              reserved_for: reservedFor,
              party_size: 2,
            });
            return response([{ id: RESERVATION }]);
          }
          if (table === "rpc/resolve_brand_pricing_inputs") {
            return response([{
              pass_tax: false,
              pass_mingla_fee: false,
              pass_service_fee: false,
              pricing_region: "NG",
              pricing_currency: "NGN",
              effective_take_rate_bps: 500,
              take_rate_source: "platform_default",
              payment_provider: "paystack",
              payment_country: "NG",
              vat_rate_bps: 0,
              ...(stripe
                ? {
                  pricing_region: "GB",
                  pricing_currency: "GBP",
                  payment_provider: "stripe",
                  payment_country: "GB",
                  stripe_account_id: "acct_fixture",
                  stripe_charges_enabled: true,
                }
                : {}),
            }]);
          }
          if (table.startsWith("rpc/")) return response(null);
          const rows = tables[table] ?? [];
          let result: Row[];
          if (req.method === "GET") {
            result = rows.filter((r) => matches(r, url)).slice(
              0,
              Number(url.searchParams.get("limit") ?? 100),
            );
          } else if (req.method === "POST") {
            result = (Array.isArray(body) ? body : [body]).map((r) => ({
              id: crypto.randomUUID(),
              ...r,
            }));
            tables[table] = [...rows, ...result];
          } else {
            assertEquals(req.method, "PATCH");
            result = rows.filter((r) => matches(r, url));
            result.forEach((r) => Object.assign(r, body));
          }
          return response(
            req.headers.get("accept")?.includes("vnd.pgrst.object")
              ? result[0] ?? null
              : result,
          );
        }
        if (url.href === "https://api.onesignal.com/notifications") {
          pushes.push(body);
          return response({ id: "fixture-push-id", recipients: 1 });
        }
        if (url.href === "https://api.resend.com/emails") {
          emails.push(body);
          return response({ id: "fixture-resend-id" });
        }
        if (url.href === "https://api.paystack.co/transaction/initialize") {
          providers.push(body);
          return response({
            status: true,
            data: {
              authorization_url: "https://fixture.invalid/pay",
              reference: body.reference,
              access_code: "fixture",
            },
          });
        }
        if (url.href === "https://api.stripe.com/v1/checkout/sessions") {
          providers.push(body);
          return response({
            id: "cs_test_fixture",
            url: "https://fixture.invalid/stripe",
          });
        }
        rejected.push(`${req.method} ${url.origin}${url.pathname}`);
        throw new Error("Unmodelled outbound HTTP denied by fixture");
      }) as typeof fetch;
    // The production handlers are imported unchanged. The std server owns its
    // normal loop, but may bind only a fresh loopback listener, never port 8000.
    Deno.listen = ((options: Deno.ListenOptions) => {
      const listener = originalListen({
        ...options,
        hostname: "127.0.0.1",
        port: 0,
      });
      listeners.push(listener);
      return listener;
    }) as typeof Deno.listen;
    await import("../notify-dispatch/index.ts");
    dispatchOrigin = `http://127.0.0.1:${listeners.at(-1)!.addr.port}`;
    await import("../venue-reservation-create/index.ts");
    createOrigin = `http://127.0.0.1:${listeners.at(-1)!.addr.port}`;
    Deno.listen = originalListen;
    assertEquals(listeners.length, 2);

    await t.step(
      "free web HTTP create → phone-addressed outbox → HTTP dispatch → matching email credential; no plaintext writes",
      async () => {
        reset();
        const created = await post(createOrigin, createBody());
        assertEquals(created.status, 200);
        assertEquals(created.body.kind, "free_completed");
        assertEquals(
          created.body.brandId,
          BRAND,
          "venue owner, not caller's other brand, controls scope",
        );
        const token = created.body.guestCancelToken;
        assertMatch(token, /^qa39\.[A-Za-z0-9_-]{43}$/);
        assertEquals(tables.reservation_checkout_sessions.length, 1);
        assertEquals(
          tables.reservation_checkout_sessions[0].guest_cancel_token_hash,
          await guestCancelTokenHash(token),
        );
        await drain(outbox());
        assertEquals(emails.length, 1);
        assertEquals(emails[0].to, [EMAIL]);
        assert(emails[0].html.includes("Manage or cancel"));
        const link = new URL(dispatches[0].reservation_manage_url);
        const renderedHref = emails[0].html.match(
          /href="([^"]+\/manage#[^"]+)"/,
        );
        assert(renderedHref, "real email must contain a clickable manage URL");
        assertEquals(renderedHref[1].replaceAll("&amp;", "&"), link.href);
        assertEquals(link.pathname, `/reserve/${BRAND}/manage`);
        assertEquals(
          new URLSearchParams(link.hash.slice(1)).get("token"),
          token,
        );
        assertEquals(
          new URLSearchParams(link.hash.slice(1)).get("reservationId"),
          RESERVATION,
        );
        assertEquals(
          (await loadGuestReservationManageView(client(), {
            reservationId: RESERVATION,
            guestToken: token,
          }))?.canCancel,
          true,
        );
        assertPrivate(token);
      },
    );

    await t.step(
      "paid web HTTP create binds derivation to persisted session; signed-in email/inbox stay separated",
      async () => {
        reset(true);
        const created = await post(
          createOrigin,
          createBody(),
          "Bearer fixture-user-jwt",
        );
        assertEquals(created.status, 200);
        assertEquals(created.body.kind, "requires_paystack_redirect");
        const token = created.body.guestCancelToken;
        assertEquals(created.body.buyerStatusToken, token);
        assertMatch(token, /^qa39\.[A-Za-z0-9_-]{43}$/);
        const session = tables.reservation_checkout_sessions[0];
        assertEquals(session.id, created.body.reservationDraftId);
        assertEquals(session.consumer_user_id, USER);
        assertEquals(session.brand_id, BRAND);
        assertEquals(
          session.guest_cancel_token_hash,
          await guestCancelTokenHash(token),
        );
        assertEquals(providers.length, 1);
        // Fixture finalization, not a real charge or the confirm handler under test.
        Object.assign(session, {
          reservation_id: RESERVATION,
          status: "completed",
        });
        await drain(outbox(EMAIL, "+2348031234567", USER));
        assertEquals(emails.length, 1);
        assert(emails[0].html.includes(token));
        assert(
          tables.notifications.length > 0,
          "signed-in inbox must actually execute",
        );
        assertEquals(
          pushes.length,
          1,
          "signed-in push boundary must actually execute",
        );
        assertPrivate(token);
      },
    );

    await t.step(
      "actual HTTP dispatcher exact-service gate and canonical booking URL reject hostile CTA variants",
      async () => {
        reset();
        const created = await post(createOrigin, createBody());
        const token = created.body.guestCancelToken;
        await drain(outbox());
        const valid = dispatches[0];
        for (
          const [bearer, link] of [
            ["Bearer fixture-user-jwt", valid.reservation_manage_url],
            [`Bearer ${SERVICE}suffix`, valid.reservation_manage_url],
            [
              `Bearer ${SERVICE}`,
              valid.reservation_manage_url.replace(
                RESERVATION,
                OTHER_RESERVATION,
              ),
            ],
            [
              `Bearer ${SERVICE}`,
              valid.reservation_manage_url.replace(
                "host.usemingla.com",
                "attacker.invalid",
              ),
            ],
            [`Bearer ${SERVICE}`, valid.reservation_manage_url + "&extra=1"],
          ]
        ) {
          emails = [];
          const result = await post(dispatchOrigin, {
            ...valid,
            idempotency_key: crypto.randomUUID(),
            reservation_manage_url: link,
          }, bearer);
          assertEquals(result.status, 200);
          assertEquals(
            emails.length,
            1,
            "ordinary confirmation must survive rejected CTA",
          );
          assert(!emails[0].html.includes("Manage or cancel"));
          assert(!emails[0].html.includes(token));
        }
        assertEquals((await post(dispatchOrigin, valid)).status, 401);
        assertPrivate(token);
      },
    );

    await t.step(
      "Stripe web creation uses the same persisted-session credential as its later confirmation email",
      async () => {
        reset(true);
        stripe = true;
        tables.brands[0].default_currency = "GBP";
        const created = await post(createOrigin, createBody());
        assertEquals(created.status, 200);
        assertEquals(created.body.kind, "requires_web_redirect");
        const token = created.body.guestCancelToken;
        assertMatch(token, /^qa39\.[A-Za-z0-9_-]{43}$/);
        assertEquals(created.body.buyerStatusToken, token);
        const session = tables.reservation_checkout_sessions[0];
        assertEquals(session.id, created.body.reservationDraftId);
        assertEquals(
          session.guest_cancel_token_hash,
          await guestCancelTokenHash(token),
        );
        assertEquals(providers.length, 1);
        assertEquals(
          new URL(providers[0].success_url).searchParams.get("bst"),
          token,
        );
        Object.assign(session, {
          reservation_id: RESERVATION,
          status: "completed",
        });
        await drain(outbox());
        assertEquals(emails.length, 1);
        assert(emails[0].html.includes(token));
        assertPrivate(token);
      },
    );

    await t.step(
      "wrong/other-booking/malformed credentials fail closed; past booking is view-only (tokens have no invented expiry)",
      async () => {
        reset();
        const created = await post(createOrigin, createBody());
        const token = created.body.guestCancelToken;
        for (
          const bad of [
            "",
            "qa39.",
            token + "x",
            "malformed",
            token.replace("qa39", "other"),
          ]
        ) {
          assertEquals(
            await loadGuestReservationManageView(client(), {
              reservationId: RESERVATION,
              guestToken: bad,
            }),
            null,
          );
        }
        assertEquals(
          await loadGuestReservationManageView(client(), {
            reservationId: OTHER_RESERVATION,
            guestToken: token,
          }),
          null,
        );
        tables.reservations[0].reserved_for = "2000-01-01T00:00:00Z";
        assertEquals(
          (await loadGuestReservationManageView(client(), {
            reservationId: RESERVATION,
            guestToken: token,
          }))?.canCancel,
          false,
        );
        tables.reservation_checkout_sessions[0].reservation_id =
          OTHER_RESERVATION;
        assertEquals(
          (await resolveVenueReservationManageLink(client(), {
            reservationId: RESERVATION,
            ring: readVenueReservationManageKeyRing(BUNDLE),
          })).url,
          null,
        );
        assertPrivate(token);
      },
    );

    await t.step(
      "missing/partial/malformed signing fields preserve booking and confirmation but cannot invent an email credential",
      async () => {
        for (
          const raw of [
            "{}",
            "{",
            JSON.stringify({
              VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KID: "qa39",
            }),
            JSON.stringify({
              VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KEY_B64: KEY,
            }),
          ]
        ) {
          reset();
          env.AD_CONVERSION_TOKENS = raw;
          const created = await post(createOrigin, createBody());
          assertEquals(created.status, 200);
          const token = created.body.guestCancelToken;
          assertMatch(token, /^[a-f0-9]{64}$/);
          assertEquals(
            tables.reservation_checkout_sessions[0].guest_cancel_token_hash,
            await guestCancelTokenHash(token),
          );
          await drain(outbox());
          assertEquals(emails.length, 1);
          assert(!emails[0].html.includes("Manage or cancel"));
          assertPrivate(token);
        }
      },
    );

    await t.step(
      "email/phone/null recipient variations and native control preserve credential boundaries",
      async () => {
        for (const contact of ["+2348031234567", EMAIL, null]) {
          reset();
          const created = await post(createOrigin, createBody());
          await drain(outbox(` ${EMAIL} `, contact));
          assertEquals(emails.length, 1);
          assertEquals(emails[0].to, [EMAIL]);
          assert(emails[0].html.includes(created.body.guestCancelToken));
          assertPrivate(created.body.guestCancelToken);
        }
        for (const missing of [null, "", "bad-email", 123]) {
          reset();
          await drain(outbox(missing));
          assertEquals(emails.length, 0);
        }
        reset();
        const native = await post(
          createOrigin,
          createBody("native"),
          "Bearer fixture-user-jwt",
        );
        assertEquals(native.status, 200);
        assertEquals(native.body.guestCancelToken, undefined);
        assertEquals(tables.reservation_checkout_sessions, []);
        assertEquals(
          writes.find((w) => w.table === "rpc/pg_create_guest_reservation")
            ?.body.p_consumer_user_id,
          USER,
        );
        assertEquals(rejected, []);
      },
    );
  } finally {
    for (const listener of listeners) listener.close();
    // Allow the std server loops to observe their closed, owned listeners.
    await new Promise((resolve) => setTimeout(resolve, 0));
    Deno.listen = originalListen;
    globalThis.fetch = originalFetch;
    Deno.env.get = originalGet;
    Object.assign(console, originalConsole);
  }
});
