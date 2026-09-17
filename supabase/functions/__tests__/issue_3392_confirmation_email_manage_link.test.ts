// ISSUE-3392 — the venue booking confirmation email carries "Manage or cancel",
// and the plaintext token is never stored.
//
// Drives the REAL send path end to end, hermetically:
//   outbox row (the exact shape the reservation trigger writes)
//     → notify-outbox-drain `processGeneric` (real)
//     → the notify-dispatch v2 hop, in-process: `trustedReservationManageCta`
//       (real) + `dispatchV2` (real) with a write-recording fake client
//     → `emailAdapter` (real) → the Resend request, captured.
//
//   E1  FREE web guest booking: the email goes to the guest's email (the
//       trigger addresses the row to their PHONE, which used to skip the email
//       entirely), and it carries a "Manage or cancel" button whose link opens
//       the booking with the create-side token.
//   E2  PAID web booking by a signed-in buyer (inbox + push + email): the link is
//       in the email only — not in the inbox row, not in push data.
//   E3  no key at send time: the email still sends, with no button.
//   E4  an existing random-token booking: the email sends with no button (a link
//       that 404s is worse than none).
//   E5  a caller that is not the service role cannot put a URL behind the button.
//   E6  other reservation categories and guests without an email are unchanged.
//   E7  NEVER STORED: across every case, no database write, outbox update or
//       payload holds the plaintext token or the link.
//   E8  the create function issues the derived token for BOTH web paths and
//       writes the session under the id it was derived from.
//
// FAILS-ON-REVERT: reverting processGeneric's confirmation branch turns E1/E2
// red (no email for a phone-addressed guest, no link); reverting notifyV2's
// `emailContent` turns E1/E2 red (no button); passing the link inside `payload`
// turns E7 red.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { processGeneric } from "../notify-outbox-drain/index.ts";
import { dispatchV2, type MinimalClient } from "../_shared/notifyV2.ts";
import { trustedReservationManageCta } from "../_shared/venueReservationManageLink.ts";
import {
  issueWebGuestManageToken,
  readVenueReservationManageKeyRing,
} from "../_shared/venueReservationManageToken.ts";
import { guestCancelTokenHash } from "../_shared/guestReservationManageView.ts";

const SERVICE_KEY = "issue-3392-service-role";
const SUPABASE_URL = "http://127.0.0.1:54321";
const BRAND_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const RESERVATION_ID = "8b0f2f7a-3c1e-4d7b-9a51-6f1d2c3b4a5e";
const SESSION_ID = "5f2d9c1e-8a4b-4c3d-9e2f-1a0b3c4d5e6f";
const USER_ID = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";
const GUEST_EMAIL = "guest.3392@example.com";
const GUEST_PHONE = "+447700900123";

const key32 = (fill: number) =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const MANAGE_KEY_BUNDLE = JSON.stringify({
  APPSFLYER_API_V2_TOKEN: "unrelated",
  VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KID: "m1",
  VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KEY_B64: key32(11),
});

const CATEGORY = {
  key: "buyer_reservation_confirmed",
  is_transactional: true,
  urgency: "normal",
  default_channels: ["inapp", "push", "email"],
  active: true,
};

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

interface World {
  /** Every write any fake client received, serialized. */
  writes: string[];
  dispatchBodies: AnyRecord[];
  resendBodies: AnyRecord[];
  sessions: AnyRecord[];
}

function drainAdmin(world: World) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rows = () => {
        const source = table === "reservation_checkout_sessions"
          ? world.sessions
          : table === "brands"
          ? [{ id: BRAND_ID, name: "Lantern & Vine" }]
          : [];
        return source.filter((row) =>
          filters.every(([column, value]) => row[column] === value)
        );
      };
      const builder: AnyRecord = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        update(values: AnyRecord) {
          world.writes.push(JSON.stringify({ table, update: values }));
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        then(resolve: (value: unknown) => void) {
          resolve({ data: rows(), error: null });
        },
      };
      return builder;
    },
  };
}

function dispatchClient(world: World): MinimalClient {
  return {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: CATEGORY, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        insert(row: AnyRecord) {
          world.writes.push(JSON.stringify({ table, insert: row }));
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "notification-3392" }, error: null }),
            }),
          });
        },
        update(values: AnyRecord) {
          world.writes.push(JSON.stringify({ table, update: values }));
          return {
            eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
          };
        },
      };
    },
    rpc(fn: string) {
      return Promise.resolve({ data: fn === "can_send" ? true : null, error: null });
    },
  } as unknown as MinimalClient;
}

/**
 * The notify-dispatch v2 hop, in-process. Mirrors notify-dispatch/index.ts:
 * `serviceCaller` is the exact service bearer, and `manageUrl` is the body's
 * `reservation_manage_url` (E8 pins that wiring in the real file).
 */
async function runSend(
  world: World,
  row: AnyRecord,
  options: { dispatchBearer?: string } = {},
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/functions/v1/notify-dispatch")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      world.dispatchBodies.push(body);
      const authorization = options.dispatchBearer ??
        new Headers(init?.headers).get("Authorization");
      const result = await dispatchV2(dispatchClient(world), {
        user_id: body.user_id ?? null,
        contact: body.contact ?? null,
        category_key: body.category_key,
        payload: body.payload ?? {},
        idempotency_key: body.idempotency_key,
        country_code: body.country_code ?? null,
        requested_channel: body.requested_channel ?? null,
        email_cta: trustedReservationManageCta({
          serviceCaller: authorization === `Bearer ${SERVICE_KEY}`,
          categoryKey: body.category_key,
          payload: body.payload ?? {},
          manageUrl: body.reservation_manage_url,
        }),
      });
      return new Response(JSON.stringify(result), { status: 200 });
    }
    if (url.includes("api.resend.com/emails")) {
      world.resendBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ id: "resend-3392" }), { status: 200 });
    }
    // Push (OneSignal) and anything else: a generic refusal, never a crash.
    return new Response("{}", { status: 400 });
  }) as typeof fetch;
  try {
    return await processGeneric(drainAdmin(world), row, SUPABASE_URL, SERVICE_KEY);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** The outbox row exactly as orch_1161_reservation_notify_outbox writes it. */
function outboxRow(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: "outbox-3392",
    category_key: "buyer_reservation_confirmed",
    user_id: null,
    contact: GUEST_PHONE, // COALESCE(guest_phone_e164, guest_email)
    brand_id: BRAND_ID,
    country_code: "GB",
    attempts: 0,
    idempotency_key: `buyer_reservation_confirmed:${RESERVATION_ID}`,
    payload: {
      reservation_id: RESERVATION_ID,
      status: "confirmed",
      reserved_for: "2026-10-01T19:30:00+00:00",
      party_size: 2,
      guest_name: "Ada Guest",
      guest_phone_e164: GUEST_PHONE,
      guest_email: GUEST_EMAIL,
    },
    ...overrides,
  };
}

async function webSession(token: string, overrides: AnyRecord = {}) {
  return {
    id: SESSION_ID,
    brand_id: BRAND_ID,
    reservation_id: RESERVATION_ID,
    created_via: "web",
    guest_cancel_token_hash: await guestCancelTokenHash(token),
    ...overrides,
  };
}

function newWorld(): World {
  return { writes: [], dispatchBodies: [], resendBodies: [], sessions: [] };
}

function withEnv(values: Record<string, string | null>, fn: () => Promise<void>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, Deno.env.get(name)]),
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === null) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  return fn().finally(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  });
}

const BASE_ENV = {
  RESEND_API_KEY: "re_test_3392",
  // The transactional shell requires a footer address; DENO_TESTING supplies
  // its test default (email/index.ts).
  DENO_TESTING: "1",
  AD_CONVERSION_TOKENS: MANAGE_KEY_BUNDLE,
};

async function issuedToken(): Promise<string> {
  const issued = await issueWebGuestManageToken({
    checkoutSessionId: SESSION_ID,
    randomToken: () => "unused",
    ring: readVenueReservationManageKeyRing(MANAGE_KEY_BUNDLE),
  });
  assert(issued.derived);
  return issued.token;
}

function assertNeverStored(world: World, token: string, label: string) {
  assert(world.writes.length > 0, `${label}: vacuity — no writes recorded`);
  for (const write of world.writes) {
    assert(!write.includes(token), `${label}: a write held the token: ${write.slice(0, 120)}`);
    assert(!write.includes("/manage#"), `${label}: a write held the link`);
  }
  for (const body of world.dispatchBodies) {
    assert(
      !JSON.stringify(body.payload ?? {}).includes(token),
      `${label}: the payload carried the token`,
    );
  }
}

function manageFragment(html: string) {
  const match = html.match(/href="([^"]+\/manage#[^"]+)"/);
  assert(match, "the email has no manage link");
  const url = match[1].replaceAll("&amp;", "&");
  const params = new URLSearchParams(new URL(url).hash.slice(1));
  return { url, reservationId: params.get("reservationId"), token: params.get("token") };
}

// ── E1 ─────────────────────────────────────────────────────────────────────
Deno.test("E1 free web booking: the guest's email carries a working Manage or cancel link", async () => {
  await withEnv(BASE_ENV, async () => {
    const token = await issuedToken();
    const world = newWorld();
    world.sessions.push(await webSession(token));
    assertEquals(await runSend(world, outboxRow()), true);

    assertEquals(world.dispatchBodies.length, 1);
    assertEquals(world.dispatchBodies[0].contact, GUEST_EMAIL);
    assertEquals(world.resendBodies.length, 1, "exactly one confirmation email");
    const email = world.resendBodies[0];
    assertEquals(email.to, [GUEST_EMAIL]);
    assertStringIncludes(email.subject, "reservation is confirmed");
    assertStringIncludes(email.html, ">Manage or cancel</a>");
    assertStringIncludes(email.html, "please don&#39;t forward this email");
    const link = manageFragment(email.html);
    assert(link.url.startsWith(`https://host.usemingla.com/reserve/${BRAND_ID}/manage#`));
    assertEquals(link.reservationId, RESERVATION_ID);
    assertEquals(link.token, token, "the email token is the one create issued");
    assertEquals(
      await guestCancelTokenHash(link.token!),
      world.sessions[0].guest_cancel_token_hash,
    );
    assertStringIncludes(email.text, `Manage or cancel: ${link.url}`);
    assertNeverStored(world, token, "E1");
  });
});

// ── E2 ─────────────────────────────────────────────────────────────────────
Deno.test("E2 paid web booking by a signed-in buyer: link in the email only", async () => {
  await withEnv(BASE_ENV, async () => {
    // On the paid web path the same derived token is the `bst` status token.
    const token = await issuedToken();
    const world = newWorld();
    world.sessions.push(await webSession(token, { status: "completed", amount_cents: 2500 }));
    await runSend(world, outboxRow({ user_id: USER_ID, contact: GUEST_PHONE }));

    assertEquals(world.resendBodies.length, 1);
    assertEquals(manageFragment(world.resendBodies[0].html).token, token);
    const inbox = world.writes.filter((write) => write.includes('"notifications"'));
    assertEquals(inbox.length, 1, "vacuity — the inbox row was written");
    assert(!inbox[0].includes(token) && !inbox[0].includes("manage"));
    assertNeverStored(world, token, "E2");
  });
});

// ── E3 ─────────────────────────────────────────────────────────────────────
Deno.test("E3 no key at send time: the email still sends, without the button", async () => {
  const token = await issuedToken();
  for (
    const bundle of [
      null,
      JSON.stringify({ APPSFLYER_API_V2_TOKEN: "unrelated" }),
      JSON.stringify({ VENUE_RESERVATION_MANAGE_TOKEN_CURRENT_KID: "m1" }),
    ]
  ) {
    await withEnv({ ...BASE_ENV, AD_CONVERSION_TOKENS: bundle }, async () => {
      const world = newWorld();
      world.sessions.push(await webSession(token));
      await runSend(world, outboxRow());
      assertEquals(world.dispatchBodies[0].reservation_manage_url, undefined);
      assertEquals(world.resendBodies.length, 1, "the confirmation still sends");
      assert(!world.resendBodies[0].html.includes("Manage or cancel"));
      assertNeverStored(world, token, "E3");
    });
  }
});

// ── E4 ─────────────────────────────────────────────────────────────────────
Deno.test("E4 an existing random-token booking gets its email with no button", async () => {
  await withEnv(BASE_ENV, async () => {
    const legacyToken = "0123456789abcdef".repeat(4);
    const world = newWorld();
    world.sessions.push(await webSession(legacyToken));
    await runSend(world, outboxRow());
    assertEquals(world.resendBodies.length, 1);
    assert(!world.resendBodies[0].html.includes("/manage#"));
    assertNeverStored(world, legacyToken, "E4");
  });
});

// ── E5 ─────────────────────────────────────────────────────────────────────
Deno.test("E5 only the service role can put a link behind the button", async () => {
  await withEnv(BASE_ENV, async () => {
    const token = await issuedToken();
    const world = newWorld();
    world.sessions.push(await webSession(token));
    await runSend(world, outboxRow(), { dispatchBearer: "Bearer some-user-jwt" });
    assert(world.dispatchBodies[0].reservation_manage_url, "vacuity — a link was offered");
    assertEquals(world.resendBodies.length, 1);
    assert(!world.resendBodies[0].html.includes("Manage or cancel"));
  });
});

// ── E6 ─────────────────────────────────────────────────────────────────────
Deno.test("E6 other categories and email-less guests keep today's addressing", async () => {
  await withEnv(BASE_ENV, async () => {
    const token = await issuedToken();

    const changed = newWorld();
    changed.sessions.push(await webSession(token));
    await runSend(changed, outboxRow({ category_key: "buyer_reservation_changed" }));
    assertEquals(changed.dispatchBodies[0].contact, GUEST_PHONE);
    assertEquals(changed.dispatchBodies[0].reservation_manage_url, undefined);

    const noEmail = newWorld();
    noEmail.sessions.push(await webSession(token));
    const row = outboxRow();
    row.payload = { ...row.payload, guest_email: null };
    await runSend(noEmail, row);
    assertEquals(noEmail.dispatchBodies[0].contact, GUEST_PHONE);
    assertEquals(noEmail.dispatchBodies[0].reservation_manage_url, undefined);
    assertEquals(noEmail.resendBodies.length, 0);
  });
});

// ── E8 ─────────────────────────────────────────────────────────────────────
Deno.test("E8 wiring: create derives for both web paths; dispatch trusts only the service bearer", async () => {
  const create = await Deno.readTextFile(
    new URL("../venue-reservation-create/index.ts", import.meta.url),
  );
  // FREE path: derived from the credential row's id, then written under it.
  assertStringIncludes(create, "const freeCheckoutSessionId = crypto.randomUUID();");
  assertStringIncludes(create, "? await issueWebManageToken(freeCheckoutSessionId)");
  assertStringIncludes(create, "id: freeCheckoutSessionId,");
  // PAID path: the web bst (also the guest token) is derived from the session id.
  assertStringIncludes(create, "const checkoutSessionId = crypto.randomUUID();");
  assertStringIncludes(create, "? await issueWebManageToken(checkoutSessionId)");
  assertStringIncludes(create, "id: s.checkoutSessionId,");
  assertEquals(
    create.match(/insertReservationSession\(supabase, \{\n\s+checkoutSessionId,/g)
      ?.length,
    2,
    "both paid session inserts (Paystack and Stripe) pass the derived id",
  );
  // Only the hash is persisted (#1221 unchanged).
  assertStringIncludes(create, "guest_cancel_token: null");

  const dispatch = await Deno.readTextFile(
    new URL("../notify-dispatch/index.ts", import.meta.url),
  );
  assertStringIncludes(
    dispatch,
    "serviceCaller: isExactServiceBearer(\n            authHeader,\n            SUPABASE_SERVICE_ROLE_KEY,\n          ),",
  );
  assertStringIncludes(dispatch, "manageUrl: payload.reservation_manage_url,");
});
