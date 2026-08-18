/**
 * issue #2217 — the identity reconnect's EDGE contract.
 *
 * The SQL suite (supabase/migrations/__tests__/issue_2217_identity_attendance_claim.test.sql)
 * proves the decision on real PostgreSQL. This file guards the surface AROUND
 * that decision, where the defect class is different: an identifier reaching the
 * RPC from the request body would turn the whole thing back into knowledge, and
 * no amount of SQL correctness would catch it.
 *
 * FAILS-ON-REVERT: adding an identifier parameter to the RPC call, flipping
 * verify_jwt to false, dropping the anonymous 401, dropping the rate-limit
 * admission, or deleting the arming call from attendance-claim-link each makes a
 * NAMED assertion below fail.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(`../../../../${path}`, import.meta.url));

const FN = read("supabase/functions/attendance-claim-identity/index.ts");
const LINK = read("supabase/functions/attendance-claim-link/index.ts");
const CONFIG = read("supabase/config.toml");
const MIGRATION = read(
  "supabase/migrations/20270421002217_issue_2217_identity_attendance_claim.sql",
);

Deno.test("#2217 the claim RPC is called with the user id and NOTHING else", () => {
  const call = FN.slice(FN.indexOf('"claim_attendance_by_verified_identity"'));
  const args = call.slice(0, call.indexOf(");"));
  assertStringIncludes(args, "p_user_id: authData.user.id");
  // The security property, asserted as an ABSENCE: there is no parameter a
  // guessed identifier could ride in on.
  assert(!/p_email/.test(args), "an email parameter reached the claim RPC");
  assert(!/p_phone/.test(args), "a phone parameter reached the claim RPC");
  assert(!/body/.test(args), "request body data reached the claim RPC");
});

Deno.test("#2217 the function never reads an identifier off the request", () => {
  assert(
    !/req\.json\(\)/.test(FN),
    "the function parses a request body it must not trust",
  );
  assert(
    !/\bemail\b/.test(FN.replace(/\/\*[\s\S]*?\*\//g, "")),
    "an email is referenced outside the docblock",
  );
});

Deno.test("#2217 an anonymous caller is refused before the claim RPC", () => {
  const authIndex = FN.indexOf("authentication_required");
  const claimIndex = FN.indexOf('"claim_attendance_by_verified_identity"');
  assert(
    authIndex > 0 && claimIndex > authIndex,
    "the 401 does not precede the claim call",
  );
  assertStringIncludes(FN, "if (!authData.user)");
});

Deno.test("#2217 the sweep is admitted through the same rate ledger as the token claim", () => {
  assertStringIncludes(FN, '"begin_attendance_claim_attempt"');
  assertStringIncludes(FN, "claim_rate_limited");
  assertStringIncludes(FN, "retryAfterSeconds: 600");
  const admissionIndex = FN.indexOf('"begin_attendance_claim_attempt"');
  const claimIndex = FN.indexOf('"claim_attendance_by_verified_identity"');
  assert(admissionIndex < claimIndex, "the claim runs before admission");
});

Deno.test("#2217 verify_jwt is TRUE for the identity claim", () => {
  const section = CONFIG.slice(
    CONFIG.indexOf("[functions.attendance-claim-identity]"),
  );
  const value = section.slice(0, section.indexOf("\n[", 1));
  assertStringIncludes(value, "verify_jwt = true");
});

Deno.test("#2217 verify_jwt stays FALSE where signed-out guests must still reach", () => {
  // Guarded because #2217 edits this file: the confirm/status pair is the only
  // thing standing between a guest and their tickets, and flipping either to
  // true would lock every anonymous buyer out of their own confirmation.
  for (
    const fn of [
      "ticket-checkout-confirm",
      "ticket-checkout-status",
      "attendance-claim-link",
    ]
  ) {
    const section = CONFIG.slice(CONFIG.indexOf(`[functions.${fn}]`));
    assertStringIncludes(
      section.slice(0, section.indexOf("\n[", 1)),
      "verify_jwt = false",
    );
  }
});

Deno.test("#2217 attendance-claim-link arms from the possession proof it already checked", () => {
  assertStringIncludes(LINK, '"arm_order_identity_attendance_claim"');
  const proofIndex = LINK.indexOf("buyer_status_token_hash");
  const armIndex = LINK.indexOf('"arm_order_identity_attendance_claim"');
  assert(
    proofIndex > 0 && armIndex > proofIndex,
    "arming does not sit behind the buyer status token check",
  );
  // Arming must not be able to withhold the link the buyer asked for.
  const armCall = LINK.slice(armIndex - 60, armIndex + 200);
  assert(
    !/return json\(/.test(armCall),
    "an arming failure aborts the link mint",
  );
});

Deno.test("#2217 the identifier set is derived from auth.identities, never from the confirmed-at columns", () => {
  const fn = MIGRATION.slice(
    MIGRATION.indexOf(
      "CREATE OR REPLACE FUNCTION public.verified_account_identifiers",
    ),
  );
  const body = fn.slice(0, fn.indexOf("$function$;"));
  assertStringIncludes(body, "auth.identities");
  assertStringIncludes(body, "i.provider = 'email'");
  assertStringIncludes(body, "i.provider = 'phone'");
  // Measured on production 2026-08-18: email_confirmed_at is set for 125/125
  // users and phone_confirmed_at for 64 users who have no phone. Either column
  // in this predicate turns knowledge into a claim.
  assert(
    !/email_confirmed_at/.test(body),
    "email_confirmed_at is back in the predicate",
  );
  assert(
    !/phone_confirmed_at/.test(body),
    "phone_confirmed_at is back in the predicate",
  );
});

Deno.test("#2217 the claim RPC signature admits no identifier argument", () => {
  const decl = MIGRATION.slice(
    MIGRATION.indexOf(
      "CREATE OR REPLACE FUNCTION public.claim_attendance_by_verified_identity",
    ),
  );
  const signature = decl.slice(0, decl.indexOf(")"));
  assertStringIncludes(signature, "p_user_id uuid");
  assertEquals(signature.match(/p_[a-z_]+ /g)?.length, 1);
});

Deno.test("#2217 every new function is service-role only", () => {
  for (
    const fn of [
      "public.verified_account_identifiers(uuid)",
      "public.arm_order_identity_attendance_claim(uuid, uuid)",
      "public.claim_attendance_by_verified_identity(uuid)",
      "public.drop_unentitled_buyer_from_event_chat(uuid, uuid)",
    ]
  ) {
    assertStringIncludes(
      MIGRATION,
      `REVOKE ALL ON FUNCTION ${fn}\n  FROM PUBLIC, anon, authenticated;`,
    );
    assertStringIncludes(MIGRATION, `GRANT EXECUTE ON FUNCTION ${fn}`);
  }
});

Deno.test("#2217 the consumer app runs the sweep once per signed-in account", () => {
  const service = read("app-mobile/src/services/attendanceClaimService.ts");
  const shell = read("app-mobile/app/index.tsx");

  assertStringIncludes(service, "claimAttendanceByVerifiedIdentity");
  assertStringIncludes(service, '"attendance-claim-identity"');
  // The client must not invent an identifier to send. The body is empty and
  // stays empty — the server reads the account's own identities.
  assertStringIncludes(service, "{ body: {} }");
  assert(
    !/body:\s*\{\s*(email|phone)/.test(service),
    "the client sends an identifier the server must not trust",
  );
  // Silent by design: this fires on every sign-in, including for people who
  // never bought anything.
  assertStringIncludes(
    service,
    "if (error) return { count: 0, eventIds: [] };",
  );

  assertStringIncludes(shell, "claimAttendanceByVerifiedIdentity()");
  assertStringIncludes(shell, "identitySweptForUserRef");
  // Once per user id, and reset on sign-out so the next account is swept too.
  assertStringIncludes(
    shell,
    "if (identitySweptForUserRef.current === userId) return;",
  );
  assertStringIncludes(shell, "identitySweptForUserRef.current = null;");
});

Deno.test("#2217 the confirmation screen never gates the existing guest path on the claim", () => {
  const card = read(
    "mingla-business/src/components/checkout/DownloadMinglaCta.tsx",
  );
  // The button renders unconditionally; only the status line below it varies.
  const buttonIndex = card.indexOf('testID="confirm-app-cta-primary"');
  const phaseIndex = card.indexOf('claimPhase === "error"');
  assert(buttonIndex > 0, "the single button is missing");
  assert(
    phaseIndex > buttonIndex,
    "the button is rendered inside a claim-phase branch and can disappear",
  );
});
