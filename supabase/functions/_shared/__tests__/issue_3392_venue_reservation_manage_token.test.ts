// ISSUE-3392 — the venue booking manage token is DERIVED, so the confirmation
// email can carry a working "Manage or cancel" link.
//
// Hermetic: real modules, fake query clients, no network, no real key.
//
//   K1  key ring: absent → absent; any malformed, partial, duplicate or orphaned
//       slot → invalid; never throws and never echoes key material.
//   K2  derivation: `<kid>.<43 base64url>`, deterministic per session + key,
//       different for another session, kid or key.
//   K3  create-side issue: derived with the current key; without a usable key
//       it falls back to a random token instead of failing the booking.
//   K4  send-side resolve: a derived booking gets a link whose token opens the
//       REAL #3406 manage view; a random-token booking (every booking made
//       before the key existed) gets NO link and still opens with its own token;
//       a rotated booking resolves through the previous key; no web session,
//       no key or a malformed id → no link.
//   K5  notify-dispatch's gate: only the service role, only the confirmation
//       category, only the exact manage URL for the payload's own reservation.
//
// FAILS-ON-REVERT: making `issueWebGuestManageToken` return a random token
// turns K3/K4 red; dropping the hash comparison in
// `resolveVenueReservationManageLink` turns K4 (random-token booking) red;
// dropping any clause of `trustedReservationManageCta` turns K5 red.

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveVenueReservationManageToken,
  issueWebGuestManageToken,
  readVenueReservationManageKeyRing,
  resolveVenueReservationManageLink,
  VENUE_RESERVATION_MANAGE_TOKEN_FIELDS as F,
} from "../venueReservationManageToken.ts";
import {
  buildVenueReservationManageUrl,
  trustedReservationManageCta,
  VENUE_RESERVATION_MANAGE_CTA_LABEL,
  VENUE_RESERVATION_MANAGE_EMAIL_NOTE,
  venueReservationManageUrlReservationId,
} from "../venueReservationManageLink.ts";
import {
  guestCancelTokenHash,
  loadGuestReservationManageView,
} from "../guestReservationManageView.ts";

// The pre-#3392 web token shape (`randomBuyerStatusToken` in ticketCheckout.ts),
// inlined so this suite imports nothing from the network beyond std.
const randomBuyerStatusToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

const SESSION_ID = "5f2d9c1e-8a4b-4c3d-9e2f-1a0b3c4d5e6f";
const OTHER_SESSION_ID = "6a3e0d2f-9b5c-4d4e-8f3a-2b1c4d5e6f70";
const RESERVATION_ID = "8b0f2f7a-3c1e-4d7b-9a51-6f1d2c3b4a5e";
const BRAND_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const VENUE_ID = "2d6c8e4a-1b3f-4a5c-8d7e-9f0a1b2c3d4e";

const b64 = (fill: number) =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));

function bundle(fields: Record<string, unknown>): string {
  // Unrelated envelope fields ride along, exactly as in production.
  return JSON.stringify({ APPSFLYER_API_V2_TOKEN: "unrelated", ...fields });
}

const CURRENT = { [F.currentKid]: "m2", [F.currentKey]: b64(7) };
const PREVIOUS = { [F.previousKid]: "m1", [F.previousKey]: b64(9) };

function ring(fields: Record<string, unknown>) {
  const result = readVenueReservationManageKeyRing(bundle(fields));
  if (!result.ok) throw new Error(`ring not ok: ${result.reason}`);
  return result;
}

// ── K1 ─────────────────────────────────────────────────────────────────────
Deno.test("K1 key ring: absent vs invalid, never throws, never echoes a key", () => {
  assertEquals(readVenueReservationManageKeyRing(undefined), {
    ok: false,
    reason: "manage_key_absent",
  });
  assertEquals(readVenueReservationManageKeyRing(""), {
    ok: false,
    reason: "manage_key_absent",
  });
  // The envelope exists but the #3392 fields are not installed yet.
  assertEquals(readVenueReservationManageKeyRing(bundle({})), {
    ok: false,
    reason: "manage_key_absent",
  });

  const invalid: Array<[string, string]> = [
    ["not json", "{"],
    ["array envelope", "[]"],
    ["kid only", bundle({ [F.currentKid]: "m2" })],
    ["key only", bundle({ [F.currentKey]: b64(7) })],
    ["uppercase kid", bundle({ ...CURRENT, [F.currentKid]: "M2" })],
    ["kid too long", bundle({ ...CURRENT, [F.currentKid]: "k".repeat(17) })],
    [
      "31-byte key",
      bundle({
        ...CURRENT,
        [F.currentKey]: btoa(String.fromCharCode(...new Uint8Array(31))),
      }),
    ],
    ["base64url key", bundle({ ...CURRENT, [F.currentKey]: b64(255).replace(/\//g, "_") })],
    ["padded whitespace", bundle({ ...CURRENT, [F.currentKey]: ` ${b64(7)}` })],
    ["numeric key", bundle({ ...CURRENT, [F.currentKey]: 7 })],
    ["previous without current", bundle({ ...PREVIOUS })],
    ["half a previous slot", bundle({ ...CURRENT, [F.previousKid]: "m1" })],
    ["previous reuses kid", bundle({ ...CURRENT, ...PREVIOUS, [F.previousKid]: "m2" })],
    ["previous reuses key", bundle({ ...CURRENT, ...PREVIOUS, [F.previousKey]: b64(7) })],
  ];
  for (const [label, raw] of invalid) {
    const result = readVenueReservationManageKeyRing(raw);
    assertEquals(result, { ok: false, reason: "manage_key_invalid" }, label);
    assert(!JSON.stringify(result).includes(b64(7)), `${label} echoed a key`);
  }

  const one = ring(CURRENT);
  assertEquals(one.current.kid, "m2");
  assertEquals(one.current.key.length, 32);
  assertEquals(one.previous, null);
  const two = ring({ ...CURRENT, ...PREVIOUS });
  assertEquals(two.previous?.kid, "m1");
});

// ── K2 ─────────────────────────────────────────────────────────────────────
Deno.test("K2 derivation is deterministic, well-formed and bound to session, kid and key", async () => {
  const { current, previous } = ring({ ...CURRENT, ...PREVIOUS });
  const token = await deriveVenueReservationManageToken({
    checkoutSessionId: SESSION_ID,
    key: current,
  });
  assertMatch(token, /^m2\.[A-Za-z0-9_-]{43}$/);
  assertEquals(
    await deriveVenueReservationManageToken({
      checkoutSessionId: SESSION_ID.toUpperCase(),
      key: current,
    }),
    token,
  );
  assertNotEquals(
    await deriveVenueReservationManageToken({
      checkoutSessionId: OTHER_SESSION_ID,
      key: current,
    }),
    token,
  );
  assertNotEquals(
    await deriveVenueReservationManageToken({
      checkoutSessionId: SESSION_ID,
      key: previous!,
    }),
    token,
  );
  assertNotEquals(
    await deriveVenueReservationManageToken({
      checkoutSessionId: SESSION_ID,
      key: { kid: "m1", key: current.key },
    }),
    token,
    "the kid is inside the MAC input",
  );
  let threw = false;
  try {
    await deriveVenueReservationManageToken({
      checkoutSessionId: "not-a-uuid",
      key: current,
    });
  } catch (error) {
    threw = (error as Error).message === "manage_token_input_invalid";
  }
  assert(threw);
});

// ── K3 ─────────────────────────────────────────────────────────────────────
Deno.test("K3 create issues a derived token, or a random one when the key is unusable", async () => {
  const withKey = await issueWebGuestManageToken({
    checkoutSessionId: SESSION_ID,
    randomToken: () => {
      throw new Error("random token must not be used when the key exists");
    },
    ring: ring(CURRENT),
  });
  assertEquals(withKey.derived, true);
  assertEquals(withKey.reason, null);
  assertEquals(
    withKey.token,
    await deriveVenueReservationManageToken({
      checkoutSessionId: SESSION_ID,
      key: ring(CURRENT).current,
    }),
  );

  for (
    const [raw, reason] of [
      [undefined, "manage_key_absent"],
      [bundle({}), "manage_key_absent"],
      ["{", "manage_key_invalid"],
    ] as Array<[string | undefined, string]>
  ) {
    const fallback = await issueWebGuestManageToken({
      checkoutSessionId: SESSION_ID,
      randomToken: randomBuyerStatusToken,
      ring: readVenueReservationManageKeyRing(raw),
    });
    assertEquals(fallback.derived, false);
    assertEquals(fallback.reason, reason);
    assertMatch(fallback.token, /^[0-9a-f]{64}$/);
  }
});

// ── K4 ─────────────────────────────────────────────────────────────────────
interface Call {
  table: string;
  filters: Array<[string, unknown]>;
}

function fakeClient(tables: Record<string, Array<Record<string, unknown>>>) {
  const calls: Call[] = [];
  return {
    calls,
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const rows = () =>
        (tables[table] ?? []).filter((row) =>
          call.filters.every(([column, value]) => row[column] === value)
        );
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        then(resolve: (value: unknown) => void) {
          resolve({ data: rows(), error: null });
        },
      };
      return builder;
    },
  };
}

async function bookingTables(token: string, sessionId = SESSION_ID) {
  return {
    reservation_checkout_sessions: [{
      id: sessionId,
      brand_id: BRAND_ID,
      venue_id: VENUE_ID,
      reservation_id: RESERVATION_ID,
      created_via: "web",
      guest_cancel_token_hash: await guestCancelTokenHash(token),
    }],
    reservations: [{
      id: RESERVATION_ID,
      status: "confirmed",
      payment_status: "none",
      reserved_for: new Date(Date.now() + 86_400_000).toISOString(),
      party_size: 2,
      venue_id: VENUE_ID,
    }],
    venue_listings: [{ id: VENUE_ID, name: "Lantern & Vine" }],
  };
}

function fragment(url: string) {
  const params = new URLSearchParams(new URL(url).hash.replace(/^#/, ""));
  return {
    reservationId: params.get("reservationId") ?? "",
    token: params.get("token") ?? "",
  };
}

Deno.test("K4 a derived booking's email link opens the real manage view", async () => {
  const keyRing = ring(CURRENT);
  const issued = await issueWebGuestManageToken({
    checkoutSessionId: SESSION_ID,
    randomToken: randomBuyerStatusToken,
    ring: keyRing,
  });
  const client = fakeClient(await bookingTables(issued.token));
  const link = await resolveVenueReservationManageLink(client, {
    reservationId: RESERVATION_ID,
    ring: keyRing,
  });
  assertEquals(link.reason, null);
  assert(link.url);
  assert(
    link.url.startsWith(
      `https://host.usemingla.com/reserve/${BRAND_ID}/manage#reservationId=`,
    ),
  );
  const credentials = fragment(link.url);
  assertEquals(credentials.reservationId, RESERVATION_ID);
  assertEquals(credentials.token, issued.token);
  // The lookup is scoped to THIS reservation's web session.
  assertEquals(client.calls[0].filters, [
    ["reservation_id", RESERVATION_ID],
    ["created_via", "web"],
  ]);
  // The manage page's own server check accepts the emailed token.
  const view = await loadGuestReservationManageView(client, {
    reservationId: credentials.reservationId,
    guestToken: credentials.token,
  });
  assert(view !== null, "the emailed link must open the booking");
  assertEquals(view.canCancel, true);
});

Deno.test("K4 an existing random-token booking gets no link and still opens with its own token", async () => {
  const legacyToken = randomBuyerStatusToken();
  const client = fakeClient(await bookingTables(legacyToken));
  const link = await resolveVenueReservationManageLink(client, {
    reservationId: RESERVATION_ID,
    ring: ring(CURRENT),
  });
  assertEquals(link, { url: null, reason: "token_not_derived" });
  const view = await loadGuestReservationManageView(client, {
    reservationId: RESERVATION_ID,
    guestToken: legacyToken,
  });
  assert(view !== null, "pre-#3392 bookings must keep working");
});

Deno.test("K4 rotation: a booking made under the previous key still resolves", async () => {
  const oldRing = ring({
    [F.currentKid]: PREVIOUS[F.previousKid],
    [F.currentKey]: PREVIOUS[F.previousKey],
  });
  const issued = await issueWebGuestManageToken({
    checkoutSessionId: SESSION_ID,
    randomToken: randomBuyerStatusToken,
    ring: oldRing,
  });
  const tables = await bookingTables(issued.token);
  const rotated = await resolveVenueReservationManageLink(fakeClient(tables), {
    reservationId: RESERVATION_ID,
    ring: ring({ ...CURRENT, ...PREVIOUS }),
  });
  assertEquals(fragment(rotated.url!).token, issued.token);
  const retired = await resolveVenueReservationManageLink(fakeClient(tables), {
    reservationId: RESERVATION_ID,
    ring: ring(CURRENT),
  });
  assertEquals(retired, { url: null, reason: "token_not_derived" });
});

Deno.test("K4 no key, no web session or a malformed id → no link", async () => {
  const issued = await issueWebGuestManageToken({
    checkoutSessionId: SESSION_ID,
    randomToken: randomBuyerStatusToken,
    ring: ring(CURRENT),
  });
  const tables = await bookingTables(issued.token);

  for (
    const [raw, reason] of [
      [undefined, "manage_key_absent"],
      ["{", "manage_key_invalid"],
    ] as Array<[string | undefined, string]>
  ) {
    const client = fakeClient(tables);
    assertEquals(
      await resolveVenueReservationManageLink(client, {
        reservationId: RESERVATION_ID,
        ring: readVenueReservationManageKeyRing(raw),
      }),
      { url: null, reason } as never,
    );
    assertEquals(client.calls.length, 0);
  }

  const appBooking = fakeClient({
    reservation_checkout_sessions: [{
      ...tables.reservation_checkout_sessions[0],
      created_via: "app",
    }],
  });
  assertEquals(
    await resolveVenueReservationManageLink(appBooking, {
      reservationId: RESERVATION_ID,
      ring: ring(CURRENT),
    }),
    { url: null, reason: "no_web_session" },
  );

  const malformed = fakeClient(tables);
  assertEquals(
    await resolveVenueReservationManageLink(malformed, {
      reservationId: "reservation-1",
      ring: ring(CURRENT),
    }),
    { url: null, reason: "reservation_id_invalid" },
  );
  assertEquals(malformed.calls.length, 0);
});

// ── K5 ─────────────────────────────────────────────────────────────────────
Deno.test("K5 notify-dispatch renders only the exact manage URL, from the service role", async () => {
  const token = await deriveVenueReservationManageToken({
    checkoutSessionId: SESSION_ID,
    key: ring(CURRENT).current,
  });
  const url = buildVenueReservationManageUrl({
    brandId: BRAND_ID,
    reservationId: RESERVATION_ID,
    token,
  });
  assertEquals(venueReservationManageUrlReservationId(url), RESERVATION_ID);
  const good = {
    serviceCaller: true,
    categoryKey: "buyer_reservation_confirmed",
    payload: { reservation_id: RESERVATION_ID },
    manageUrl: url,
  };
  assertEquals(trustedReservationManageCta(good), {
    label: VENUE_RESERVATION_MANAGE_CTA_LABEL,
    url,
    note: VENUE_RESERVATION_MANAGE_EMAIL_NOTE,
  });
  assertEquals(VENUE_RESERVATION_MANAGE_CTA_LABEL, "Manage or cancel");
  assertEquals(trustedReservationManageCta({ ...good, manageUrl: undefined }), undefined);

  const rejected: Array<[string, typeof good]> = [
    ["not the service role", { ...good, serviceCaller: false }],
    ["another category", { ...good, categoryKey: "buyer_reservation_changed" }],
    [
      "another reservation",
      { ...good, payload: { reservation_id: "9c1a3b5d-7e9f-4a1b-8c3d-5e7f9a1b3c5d" } },
    ],
    ["another origin", { ...good, manageUrl: url.replace("host.usemingla.com", "evil.example") }],
    ["plain http", { ...good, manageUrl: url.replace("https://", "http://") }],
    ["another path", { ...good, manageUrl: url.replace("/manage#", "/cancel#") }],
    ["query string", { ...good, manageUrl: url.replace("/manage#", "/manage?x=1#") }],
    ["extra fragment key", { ...good, manageUrl: `${url}&next=https://evil.example` }],
    ["random-token shape", { ...good, manageUrl: url.replace(/token=.*$/, `token=${"a".repeat(64)}`) }],
    ["non-string", { ...good, manageUrl: 42 as unknown as string }],
  ];
  for (const [label, input] of rejected) {
    assertEquals(trustedReservationManageCta(input), undefined, label);
  }
});
