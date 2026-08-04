// Issue #1529 — TESTER ADVERSARIAL SUITE (mingla-tester, owns T-6).
//
// ===========================================================================
// A DIFFERENT ANGLE FROM THE IMPLEMENTOR'S SUITES. READ THIS BEFORE EDITING.
// ===========================================================================
// The implementor's `smsAdapter.issue1529.test.ts` (T-3) walks the named
// success criteria one call at a time: SC-4, SC-5, SC-6, one unmapped case.
// That proves the specified examples. It does NOT prove the PROPERTY, and a
// hand-picked example set is exactly how #1529 survived eight weeks in
// production behind a green pipeline.
//
// This file attacks three things T-3 does not:
//
//   ADV-A  HOSTILE DERIVATION, SHARED WITH SQL. The parity fixtures the
//          implementor ships are well-formed. These are not — NANP shared by
//          four sovereign states, a +44 crown dependency, the +234/+2348
//          boundary, national format with a trunk zero, an extension suffix,
//          a doubled '+', unicode digits, and the two REAL +33 handsets that
//          exist in production today. The fixture block is read out of
//          `issue_1529_tester_adversarial.test.sql`, which asserts the SAME
//          expectations against the Postgres twin, so a SQL/TS divergence on
//          the hostile set fails one suite or the other. There is one fixture
//          list, not two.
//
//   ADV-B  THE ROUTING PROPERTY, SWEPT. 8 destinations x 11 labels x 4
//          kill-switch combinations = 352 real adapter calls, each asserted
//          against invariants rather than an expected transcript:
//            B1  A Nigerian destination NEVER produces Twilio traffic — under
//                any label, under any flag combination. This is the defect,
//                stated as a property.
//            B2  A non-Nigerian destination NEVER produces Termii traffic.
//            B3  THE DARK-MARKET GUARANTEE: a provider is contacted ONLY when
//                ITS OWN market flag is true. Zero HTTP otherwise.
//            B4  The label is inert. Changing only `countryCode` can never
//                change which provider is contacted, or whether one is.
//            B5  An unmapped calling code fails closed to BOTH providers.
//          Counters make the sweep non-vacuous: it must actually observe real
//          Termii sends, real Twilio sends, kill-switch skips and unresolved
//          skips, or it fails.
//
//   ADV-C  THE LABEL CANNOT OVERRIDE THE RECIPIENT ON THE MONEY PATH. The
//          implementor's T-2b proves the drain derives a country when the row
//          carries NULL. It does not prove what happens when the row carries a
//          WRONG country. That is the more dangerous case: #1221's regeneration
//          producer copies columns forward, so a stale label is reachable, and
//          if a stale "US" won on a source-refund SMS the refund path would
//          re-acquire #1529 on a live money path.
//
// fails-on-revert: restoring either `(input.countryCode ?? "US")` copy in
// smsAdapter.send breaks B1/B3/B4; removing the `+` prepend in
// normalizeE164 breaks ADV-A; reverting the drain to `row.country_code ?? null`
// breaks ADV-C.
// ===========================================================================

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { smsAdapter } from "./smsAdapter.ts";
import { countryFromE164, normalizeE164 } from "../e164Country.ts";
import { processSource } from "../../notify-outbox-drain/index.ts";
import { sourceRefundPayloadFingerprint } from "../sourceRefundNotifications.ts";
import {
  readSourceRefundRecipientKeys,
  sourceRefundRecipientFingerprint,
} from "../sourceRefundNotificationRecipient.ts";

const TWILIO_HOST = "api.twilio.com";
const TERMII_HOST = "v3.api.termii.com";

// ---------------------------------------------------------------------------
// ADV-A — hostile fixtures, parsed out of the SQL twin so they cannot drift.
// ---------------------------------------------------------------------------
const FIXTURE_SQL_PATH = new URL(
  "../../../migrations/__tests__/issue_1529_tester_adversarial.test.sql",
  import.meta.url,
);

interface Fixture {
  label: string;
  raw: string | null;
  expectE164: string | null;
  expectCountry: string | null;
}

/** `NULL` → null; `'…'` → the unquoted string. Fixtures never embed quotes. */
function parseSqlLiteral(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.toUpperCase() === "NULL") return null;
  assert(
    trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2,
    `fixture value is neither NULL nor a quoted literal: ${token}`,
  );
  return trimmed.slice(1, -1);
}

/**
 * Strict on purpose: a missing marker, an empty block or a malformed tuple
 * THROWS rather than yielding an empty list. A silently-empty fixture set is
 * how a parity test becomes unfalsifiable.
 */
function loadFixtures(): Fixture[] {
  const sql = Deno.readTextFileSync(FIXTURE_SQL_PATH);
  const begin = sql.indexOf("-- #1529-ADV-FIXTURES-BEGIN");
  const end = sql.indexOf("-- #1529-ADV-FIXTURES-END");
  assert(begin >= 0, "ADV fixture BEGIN marker missing from the SQL test file");
  assert(end > begin, "ADV fixture END marker missing/misordered");

  const block = sql.slice(begin, end);
  const fixtures: Fixture[] = [];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("(")) continue;
    const inner = trimmed.slice(1, trimmed.lastIndexOf(")"));
    const parts: string[] = [];
    let current = "";
    let inQuote = false;
    for (const ch of inner) {
      if (ch === "'") inQuote = !inQuote;
      if (ch === "," && !inQuote) {
        parts.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    parts.push(current);
    assertEquals(
      parts.length,
      4,
      `fixture tuple must have 4 columns, got ${parts.length}: ${trimmed}`,
    );
    fixtures.push({
      label: parseSqlLiteral(parts[0]) ?? "<unlabelled>",
      raw: parseSqlLiteral(parts[1]),
      expectE164: parseSqlLiteral(parts[2]),
      expectCountry: parseSqlLiteral(parts[3]),
    });
  }
  return fixtures;
}

Deno.test("#1529 ADV-A1: the hostile fixture set loads, is non-empty, and can detect a null-returning implementation", () => {
  const fixtures = loadFixtures();
  assert(
    fixtures.length > 0,
    "ZERO hostile fixtures parsed — this parity check would be vacuous",
  );
  assert(
    fixtures.length >= 36,
    `hostile fixture set shrank: expected >= 36, got ${fixtures.length}`,
  );
  // If every expectation were NULL the comparisons below would pass against an
  // implementation that returns null for everything.
  const derivable = fixtures.filter((f) => f.expectCountry !== null);
  assert(
    derivable.length >= 10,
    `only ${derivable.length} derivable expectations — cannot catch a null-returning impl`,
  );
  // And it must cover more than one country, or "always NG" would pass.
  const countries = new Set(derivable.map((f) => f.expectCountry));
  assert(
    countries.size >= 3,
    `hostile fixtures cover only ${countries.size} countries — a constant-return impl would pass`,
  );
});

Deno.test("#1529 ADV-A2: normalizeE164 matches the SQL twin on every hostile input", () => {
  const failures: string[] = [];
  for (const f of loadFixtures()) {
    const got = normalizeE164(f.raw);
    if (got !== f.expectE164) {
      failures.push(
        `${f.label}: raw=${JSON.stringify(f.raw)} expected=${
          JSON.stringify(f.expectE164)
        } got=${JSON.stringify(got)}`,
      );
    }
  }
  assertEquals(
    failures.join("\n"),
    "",
    "TypeScript normalizeE164 disagrees with the SQL expectations",
  );
});

Deno.test("#1529 ADV-A3: countryFromE164 matches the SQL twin on every hostile input, and NULL never becomes US", () => {
  const failures: string[] = [];
  const usLeaks: string[] = [];
  for (const f of loadFixtures()) {
    const got = countryFromE164(f.raw);
    if (got !== f.expectCountry) {
      failures.push(
        `${f.label}: raw=${JSON.stringify(f.raw)} expected=${
          JSON.stringify(f.expectCountry)
        } got=${JSON.stringify(got)}`,
      );
    }
    // The defect in one line: an underivable input must never read as US.
    if (f.expectCountry === null && got === "US") usLeaks.push(f.label);
  }
  assertEquals(
    failures.join("\n"),
    "",
    "TypeScript countryFromE164 disagrees with the SQL expectations",
  );
  assertEquals(
    usLeaks.join(", "),
    "",
    "an underivable input resolved to US — that IS #1529",
  );
});

// ---------------------------------------------------------------------------
// ADV-B — the routing property, swept.
// ---------------------------------------------------------------------------
const OWNED_KEYS = [
  "MINGLA_DELIVERY_FLAGS_JSON",
  "MINGLA_RUNTIME_CONFIG_JSON",
  "SMS_LIVE_ENABLED_NG",
  "SMS_LIVE_ENABLED_US",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_STATUS_CALLBACK_SECRET",
  "SUPABASE_URL",
];

let captures: string[] = [];

async function withHarness(
  setup: () => void,
  fn: () => Promise<void>,
): Promise<void> {
  const snap: Record<string, string | undefined> = {};
  for (const k of OWNED_KEYS) snap[k] = Deno.env.get(k);
  const realFetch = globalThis.fetch;
  captures = [];
  globalThis.fetch = ((input: unknown, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    captures.push(url);
    if (url.includes(TERMII_HOST)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: "ok", message_id: "tm_adv_1529" }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ sid: "SM_adv_1529" }), { status: 201 }),
    );
  }) as unknown as typeof fetch;
  try {
    for (const k of OWNED_KEYS) Deno.env.delete(k);
    setup();
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(snap)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

function setCredsAndFlags(ng: boolean, us: boolean): void {
  Deno.env.set("TERMII_API_KEY", "tk_adv_1529");
  Deno.env.set("TERMII_BASE_URL", `https://${TERMII_HOST}`);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC_adv_1529");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok_adv_1529");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG_adv_1529");
  Deno.env.set("SUPABASE_URL", "https://adv.example.test");
  Deno.env.set(
    "MINGLA_DELIVERY_FLAGS_JSON",
    JSON.stringify({
      schema_version: 1,
      marketing_send_live_enabled: false,
      sms_live_enabled: { ng, us },
    }),
  );
}

/** Destinations chosen to stress the boundaries, not to be representative. */
const DESTINATIONS = [
  "+2348012345678", // NG
  "+2347084065203", // NG — the exact production handset from #1529 F-3
  "+14155550123", // US
  "+16475550123", // Canada: NANP, must ride the same Twilio route as the US
  "+447700900000", // GB
  "+32460964460", // BE
  "+4915112345678", // unmapped
  "+33075123456", // unmapped — TWO of these exist in production auth.users
] as const;

/** Every label an outbox row could plausibly (or maliciously) carry. */
const LABELS: Array<string | null | undefined> = [
  null,
  undefined,
  "US",
  "us",
  "NG",
  "ng",
  "NGA",
  " NG",
  "",
  "GB",
  "ZZ",
];

const FLAG_COMBOS: Array<[boolean, boolean]> = [
  [false, false],
  [false, true], // the exact production combination that used to transmit
  [true, false],
  [true, true],
];

Deno.test("#1529 ADV-B: routing invariants hold across 8 destinations x 11 labels x 4 flag combinations", async () => {
  let calls = 0;
  let termiiSends = 0;
  let twilioSends = 0;
  let killSwitchSkips = 0;
  let unresolvedSkips = 0;
  const violations: string[] = [];

  for (const [ng, us] of FLAG_COMBOS) {
    for (const to of DESTINATIONS) {
      for (const label of LABELS) {
        await withHarness(() => setCredsAndFlags(ng, us), async () => {
          const result = await smsAdapter.send({
            to,
            brandName: "Mingla",
            message: "adversarial sweep",
            countryCode: label,
          });
          calls += 1;

          const twilio = captures.filter((u) => u.includes(TWILIO_HOST)).length;
          const termii = captures.filter((u) => u.includes(TERMII_HOST)).length;
          const derived = countryFromE164(to);
          const where =
            `to=${to} label=${JSON.stringify(label)} ng=${ng} us=${us}`;

          // B5 — an unmapped calling code fails closed to BOTH providers.
          if (derived === null) {
            if (twilio !== 0 || termii !== 0) {
              violations.push(
                `B5 unmapped destination reached a provider (${where}) twilio=${twilio} termii=${termii}`,
              );
            }
            if (result.status !== "skipped") {
              violations.push(`B5 unmapped destination not skipped (${where})`);
            }
            if (result.error !== "country_unresolved") {
              violations.push(
                `B5 unmapped destination error=${result.error} (${where})`,
              );
            }
            unresolvedSkips += 1;
            return;
          }

          // B1 — a Nigerian destination NEVER produces Twilio traffic.
          if (derived === "NG" && twilio !== 0) {
            violations.push(
              `B1 NIGERIAN HANDSET REACHED TWILIO — this is #1529 (${where})`,
            );
          }
          // B2 — a non-Nigerian destination NEVER produces Termii traffic.
          if (derived !== "NG" && termii !== 0) {
            violations.push(
              `B2 non-NG destination reached Termii (${where})`,
            );
          }

          // B3 — THE DARK-MARKET GUARANTEE. A provider is contacted only when
          // its own market flag is true; otherwise ZERO HTTP.
          const marketLive = derived === "NG" ? ng : us;
          if (!marketLive) {
            if (captures.length !== 0) {
              violations.push(
                `B3 DARK MARKET WAS CONTACTED (${where}) captures=${captures.length}`,
              );
            }
            if (result.status !== "skipped") {
              violations.push(
                `B3 dark market did not skip, status=${result.status} (${where})`,
              );
            }
            killSwitchSkips += 1;
          } else {
            if (captures.length !== 1) {
              violations.push(
                `B3 live market produced ${captures.length} calls, expected 1 (${where})`,
              );
            }
            if (derived === "NG") termiiSends += 1;
            else twilioSends += 1;
          }
        });
      }
    }
  }

  // VACUITY GUARDS. A sweep that never reached a provider, or never skipped,
  // would satisfy every invariant above while proving nothing at all.
  assertEquals(
    calls,
    DESTINATIONS.length * LABELS.length * FLAG_COMBOS.length,
    "sweep did not execute the full matrix",
  );
  assert(termiiSends > 0, "sweep never observed a real Termii send — vacuous");
  assert(twilioSends > 0, "sweep never observed a real Twilio send — vacuous");
  assert(
    killSwitchSkips > 0,
    "sweep never observed a kill-switch skip — vacuous",
  );
  assert(
    unresolvedSkips > 0,
    "sweep never observed an unresolved-country skip — vacuous",
  );
  assertEquals(violations.join("\n"), "", "routing invariants violated");
});

Deno.test("#1529 ADV-B4: the countryCode label is inert — it can never move a destination between providers", async () => {
  const observed: string[] = [];
  for (const [ng, us] of FLAG_COMBOS) {
    for (const to of DESTINATIONS) {
      const perLabel: string[] = [];
      for (const label of LABELS) {
        await withHarness(() => setCredsAndFlags(ng, us), async () => {
          const result = await smsAdapter.send({
            to,
            brandName: "Mingla",
            message: "label inertness",
            countryCode: label,
          });
          const provider = captures.length === 0
            ? "none"
            : captures[0].includes(TERMII_HOST)
            ? "termii"
            : "twilio";
          perLabel.push(`${provider}/${result.status}`);
        });
      }
      const distinct = new Set(perLabel);
      observed.push(`${to} ng=${ng} us=${us} -> ${[...distinct].join("|")}`);
      assertEquals(
        distinct.size,
        1,
        `label changed the outcome for ${to} (ng=${ng}, us=${us}): ${
          perLabel.join(", ")
        }`,
      );
    }
  }
  // Non-vacuity: the run must have produced more than one distinct outcome
  // ACROSS destinations/flags, or "everything is identical" would pass trivially.
  assert(
    new Set(observed.map((o) => o.split("-> ")[1])).size > 1,
    "every destination/flag combination produced the same outcome — vacuous",
  );
});

// ---------------------------------------------------------------------------
// ADV-C — the money path: a WRONG label on the row cannot override the
// recipient the drain actually resolved.
// ---------------------------------------------------------------------------
const NG_RECIPIENT = "+2348012345678";
const DISPATCH_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = "issue-1529-adv-service-role";
const DELIVERY_ID = "00000000-1529-4dd0-9000-000000000001";
const REFUND_ID = "00000000-1529-4dd0-9000-000000000002";

function key32(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  return btoa(String.fromCharCode(...bytes));
}

const TOKEN_BUNDLE = JSON.stringify({
  SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KID: "at1",
  SOURCE_REFUND_ATTENTION_TOKEN_CURRENT_KEY_B64: key32(1),
  SOURCE_REFUND_ATTENTION_IP_CURRENT_KID: "ip1",
  SOURCE_REFUND_ATTENTION_IP_CURRENT_KEY_B64: key32(2),
  SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KID: "rk1",
  SOURCE_REFUND_NOTIFICATION_RECIPIENT_CURRENT_KEY_B64: key32(3),
});

async function drainWithRowCountry(
  rowCountry: string | null,
): Promise<Record<string, unknown>[]> {
  const previousTokens = Deno.env.get("AD_CONVERSION_TOKENS");
  Deno.env.set("AD_CONVERSION_TOKENS", TOKEN_BUNDLE);

  const row = {
    id: "00000000-1529-4dd0-9000-000000000003",
    category_key: "source_refund_buyer_state",
    user_id: null,
    // The attack: #1221's regeneration producer copies columns forward, so a
    // STALE label on this row is reachable in production.
    country_code: rowCountry,
    payload: { state: "refunded" },
    idempotency_key: "issue-1529-adv-source-refund",
    brand_name_snapshot: "Adversarial Brand",
  };

  const dispatchBodies: Record<string, unknown>[] = [];
  const payloadFingerprint = await sourceRefundPayloadFingerprint({
    payload: row.payload,
    category: row.category_key,
    audience: "buyer",
    channel: "sms",
    serializerVersion: 1,
  });
  const recipientKeys = readSourceRefundRecipientKeys();
  const recipientFingerprint = await sourceRefundRecipientFingerprint({
    key: recipientKeys.current,
    channel: "sms",
    recipient: NG_RECIPIENT,
  });

  const admin = {
    // deno-lint-ignore no-explicit-any
    rpc(name: string, _args: Record<string, unknown>): Promise<any> {
      if (name === "claim_source_refund_notification_delivery") {
        return Promise.resolve({
          data: {
            outcome: "claimed",
            deliveryId: DELIVERY_ID,
            audience: "buyer",
            channel: "sms",
            serializerVersion: 1,
            payloadFingerprint,
            recipientFingerprint,
            recipientKeyId: "rk1",
            refundId: REFUND_ID,
            generation: 1,
          },
          error: null,
        });
      }
      if (name === "resolve_source_refund_notification_recipient") {
        return Promise.resolve({
          data: { recipient: NG_RECIPIENT, keyId: "rk1" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from() {
      return {
        update() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
    },
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    dispatchBodies.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    return Promise.resolve(
      new Response(
        JSON.stringify({ success: true, outcome: "accepted" }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  try {
    await processSource(
      admin,
      row as unknown as Record<string, unknown>,
      DISPATCH_URL,
      SERVICE_KEY,
    );
  } finally {
    globalThis.fetch = realFetch;
    if (previousTokens === undefined) Deno.env.delete("AD_CONVERSION_TOKENS");
    else Deno.env.set("AD_CONVERSION_TOKENS", previousTokens);
  }
  return dispatchBodies;
}

Deno.test("#1529 ADV-C: a stale/wrong country on a source-refund row cannot override the recipient the drain resolved", async () => {
  // A row carrying a flatly wrong "US" while the resolved recipient is a
  // Nigerian handset. If the label won here, the refund path would have
  // re-acquired #1529 on a live money path.
  const wrongLabel = await drainWithRowCountry("US");
  assertEquals(
    wrongLabel.length,
    1,
    "expected exactly one notify-dispatch POST",
  );
  assertEquals(
    wrongLabel[0].country_code,
    "NG",
    "a wrong row label overrode the resolved Nigerian recipient — #1529 on the money path",
  );

  // And the NULL case must reach the same answer, so ADV-C is not passing
  // merely because some constant is being written.
  const nullLabel = await drainWithRowCountry(null);
  assertEquals(nullLabel.length, 1);
  assertEquals(
    nullLabel[0].country_code,
    "NG",
    "the drain failed to derive a country from the resolved recipient",
  );

  // Non-vacuity: the recipient really did travel as the SMS destination, so
  // `country_code` above is describing the number we assert about.
  assertEquals(nullLabel[0].contact, NG_RECIPIENT);
  assertEquals(nullLabel[0].requested_channel, "sms");
});
