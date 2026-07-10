// ORCH-1334 [rsvp-guest-console-identity-gap] — TESTER adversarial source-contract.
//
// DIFFERENT ANGLE from the implementor's happy-path (orch_1334_rsvp_guest_identity
// .test.ts asserts the PRESENCE of the fix strings). This suite attacks the
// STRUCTURE the presence-tests cannot see:
//
//   1. guard-FIRST *ORDERING* — a DEFINER function that produced rows BEFORE the
//      guard would still pass every "string is present" assertion yet leak the
//      whole guest list. Here we assert the RAISE index comes strictly BEFORE any
//      row production (RETURN QUERY / FROM public.event_rsvps) in BOTH the host and
//      admin functions.
//   2. CLOSED sensitive-column blocklist — the whitelist is only safe if the
//      NON-whitelisted profile columns never appear. We assert a blocklist of
//      sensitive profile fields (visibility_mode, bio, birthday, gender, is_admin,
//      …) is absent from the executable SQL of the host + admin functions.
//   3. consumer RETURN SIGNATURE — the implementor checks the consumer BODY has no
//      email/phone; we additionally assert the declared RETURNS TABLE signature
//      names no email/phone OUTPUT column (a different structural surface).
//
// FAILS-ON-REVERT: deleting the host `RAISE EXCEPTION 'insufficient_event_permission'`
// makes the ordering assertion fail (no RAISE → index -1 → not before row output).
//
// Run: deno test --allow-read supabase/migrations/__tests__/orch_1334_rsvp_identity_adversarial.test.ts
import { assert } from "jsr:@std/assert@1";

const MIG =
  "supabase/migrations/20261224000000_orch_1334_rsvp_guest_identity.sql";
const sql = await Deno.readTextFile(MIG);
// Executable-only view (strip `--` comments so blocklist/ordering checks never
// match the explanatory prose that legitimately names reverted-state keywords).
const code = sql.replace(/--[^\n]*/g, "");

/** Slice the executable body of a function between its CREATE header and the
 *  matching body terminator. */
function bodyOf(header: string, terminator: string): string {
  const start = code.indexOf(header);
  assert(start >= 0, `function header not found: ${header}`);
  const end = code.indexOf(terminator, start + header.length);
  assert(end > start, `function body not terminated for: ${header}`);
  return code.slice(start, end);
}

const hostBody = bodyOf(
  "CREATE FUNCTION public.host_list_rsvp_guests(p_event_id uuid)",
  "$$;",
);
const adminBody = bodyOf(
  "CREATE OR REPLACE FUNCTION public.admin_list_event_rsvps(",
  "$$;",
);
// Consumer: header → RETURNS TABLE ( … ) signature, and full body.
const consumerFull = bodyOf(
  "CREATE OR REPLACE FUNCTION public.fetch_user_going_rsvps(p_user_id uuid)",
  "$function$;",
);

// ───────────────────────────────────────────────────────────────────────────
// 1. GUARD-FIRST ORDERING (the angle the presence-tests miss).
// ───────────────────────────────────────────────────────────────────────────
Deno.test("adversarial: host guard RAISE precedes ALL row production", () => {
  const raise = hostBody.indexOf("RAISE EXCEPTION 'insufficient_event_permission'");
  const returnQuery = hostBody.indexOf("RETURN QUERY");
  const fromRsvps = hostBody.indexOf("FROM public.event_rsvps");
  assert(raise > 0, "host guard RAISE must exist in the executable body");
  assert(returnQuery > 0, "host must RETURN QUERY the rows");
  assert(fromRsvps > 0, "host must read event_rsvps");
  // The guard must fire BEFORE any row is materialized.
  assert(
    raise < returnQuery,
    `guard (idx ${raise}) must precede RETURN QUERY (idx ${returnQuery})`,
  );
  assert(
    raise < fromRsvps,
    `guard (idx ${raise}) must precede FROM event_rsvps (idx ${fromRsvps})`,
  );
});

Deno.test("adversarial: admin is_admin_user() guard precedes ALL row production", () => {
  const guard = adminBody.indexOf("is_admin_user()");
  const firstFrom = adminBody.indexOf("FROM public.event_rsvps");
  const jsonAgg = adminBody.indexOf("jsonb_agg(");
  assert(guard > 0, "admin guard is_admin_user() must exist");
  assert(firstFrom > 0, "admin must read event_rsvps");
  assert(jsonAgg > 0, "admin must aggregate rows");
  assert(
    guard < firstFrom,
    `admin guard (idx ${guard}) must precede the first event_rsvps read (idx ${firstFrom})`,
  );
  assert(
    guard < jsonAgg,
    `admin guard (idx ${guard}) must precede jsonb_agg row build (idx ${jsonAgg})`,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 2. CLOSED sensitive-column blocklist — the whitelist is only as safe as the
//    absence of everything NOT on it (I-PROPOSED-1334-RSVP-GUEST-CONTACT-WHITELIST).
// ───────────────────────────────────────────────────────────────────────────
const SENSITIVE_PROFILE_COLS = [
  "visibility_mode",
  "bio",
  "birthday",
  "birthdate",
  "gender",
  "is_admin",
  "is_seed",
  "is_beta_tester",
  "push_token",
  "expo_push_token",
  "onesignal",
  "stripe_customer_id",
  "date_of_birth",
];

Deno.test("adversarial: host+admin project NO non-whitelisted profile column", () => {
  // Match the profile-ALIAS projection form only (`p.<col>` / `profile_<col>`), so
  // the check cannot self-collide with the legitimate `is_admin_user()` guard call.
  for (const col of SENSITIVE_PROFILE_COLS) {
    for (const [name, body] of [["host", hostBody], ["admin", adminBody]] as const) {
      assert(
        !body.includes(`p.${col}`),
        `${name} RPC must not project sensitive profile column \`p.${col}\``,
      );
      assert(
        !body.includes(`profile_${col}`),
        `${name} RPC must not carry sensitive profile column \`profile_${col}\``,
      );
    }
  }
  // And the definer surface must never widen to a wholesale profile projection.
  assert(!hostBody.includes("p.*"), "host must not project p.*");
  assert(!adminBody.includes("p.*"), "admin must not project p.*");
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Consumer RETURN SIGNATURE carries no contact OUTPUT column
//    (I-PROPOSED-1334-RSVP-CONSUMER-SELF-IDENTITY-ONLY — signature surface).
// ───────────────────────────────────────────────────────────────────────────
Deno.test("adversarial: consumer RETURNS TABLE declares no email/phone column", () => {
  const retStart = consumerFull.indexOf("RETURNS TABLE (");
  const retEnd = consumerFull.indexOf(")", retStart);
  assert(retStart >= 0 && retEnd > retStart, "consumer RETURNS TABLE block present");
  const signature = consumerFull.slice(retStart, retEnd);
  // Column declarations are `name type,` — a contact column would read
  // `email  text` / `phone  text`. Assert neither is declared.
  assert(!/\bemail\b/.test(signature), "consumer must not DECLARE an email output column");
  assert(!/\bphone\b/.test(signature), "consumer must not DECLARE a phone output column");
});

Deno.test("adversarial: consumer keeps BOTH self-scoping WHERE clauses (no cross-user rows)", () => {
  assert(
    consumerFull.includes("WHERE r.user_id = p_user_id"),
    "primary branch must remain self-scoped to the caller",
  );
  assert(
    consumerFull.includes("WHERE g.matched_user_id = p_user_id"),
    "guest branch must remain self-scoped to the matched caller",
  );
});
