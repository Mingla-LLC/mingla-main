/**
 * issue #2269 — the EDGE contract for the phone possession proof.
 *
 * The SQL suite (supabase/migrations/__tests__/issue_2269_verified_phone_possession.test.sql)
 * proves the claim decision on real PostgreSQL. This file guards the surface
 * AROUND it, where the defect class is different and SQL cannot see it: the
 * ledger is only a possession proof if the ONLY thing that writes it is a
 * Twilio `approved`, and only if its failure is not swallowed the way the
 * GoTrue sync's failure was.
 *
 * FAILS-ON-REVERT: deleting the recordVerifiedPhone call, moving it above the
 * Twilio approval branch, making its failure non-fatal, sending an identifier
 * the caller supplied instead of the verified one, or reintroducing
 * profiles.phone / phone_confirmed_at into the identifier predicate each makes a
 * NAMED assertion below fail.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(`../../../../${path}`, import.meta.url));

const FN = read("supabase/functions/verify-otp/index.ts");
const MIGRATION = read(
  "supabase/migrations/20270422002269_issue_2269_verified_phone_possession.sql",
);

Deno.test("#2269 the possession proof is written only after Twilio approves", () => {
  const approvedIndex = FN.indexOf("if (twilioData.status === 'approved')");
  const recordIndex = FN.indexOf(
    "recordVerifiedPhone(serviceClient, user.id, phone)",
  );
  assert(approvedIndex > 0, "the Twilio approval branch is gone");
  assert(
    recordIndex > approvedIndex,
    "the ledger is written outside/before the Twilio approval branch",
  );
  // The number recorded is the one Twilio checked, not one re-read from
  // anywhere else. `phone` is the E164-validated request value that was sent to
  // VerificationCheck as `To`.
  assertStringIncludes(FN, "body: new URLSearchParams({ To: phone, Code: code })");
});

Deno.test("#2269 a failure to record the proof is FATAL, not swallowed", () => {
  // THE BUG THIS ISSUE FIXES WAS A SWALLOWED WRITE. If this one is allowed to
  // warn-and-continue, verify-otp reports success for a phone that can never
  // claim a ticket — the exact failure mode, moved one table across.
  const call = FN.slice(FN.indexOf("const { ledgerError } = await recordVerifiedPhone"));
  const block = call.slice(0, call.indexOf("// Sync to auth.users"));
  assertStringIncludes(block, "if (ledgerError) {");
  assertStringIncludes(block, "status: 500");
  assertStringIncludes(block, "return new Response");
});

Deno.test("#2269 the ledger write goes through the service-role RPC, never a table write", () => {
  assertStringIncludes(FN, "client.rpc('record_verified_phone'");
  assertStringIncludes(FN, "p_user_id: userId");
  assertStringIncludes(FN, "p_phone: phone");
  // A direct PostgREST write to the table would bypass the one-live-owner rule
  // the RPC enforces, and would need a grant the table must never have.
  assert(
    !/from\(['"]verified_phone_identities['"]\)/.test(FN),
    "the function writes the ledger table directly instead of via the RPC",
  );
  // 'recorded' is the only success value; anything else must be reported.
  assertStringIncludes(FN, "if (result !== 'recorded')");
});

Deno.test("#2269 the reviewer bypass records a proof too", () => {
  // ORCH-0977's reviewer path never calls Twilio and never touched GoTrue, so
  // the reviewer account had NO possession proof and its ticket could not be
  // claimed. Measured on production: 87207cdb, 1 order.
  const rev = FN.slice(FN.indexOf("if (phone === REVIEWER_TEST_PHONE"));
  const body = rev.slice(0, rev.indexOf("const accountSid"));
  assertStringIncludes(
    body,
    "recordVerifiedPhone(reviewerClient, user.id, REVIEWER_TEST_PHONE)",
  );
});

Deno.test("#2269 the GoTrue sync is no longer silent", () => {
  // It stays non-fatal — #2269 moved the proof off it precisely because it can
  // refuse — but a console.warn is how this bug hid for four months.
  const sync = FN.slice(FN.indexOf("// Sync to auth.users"));
  const block = sync.slice(0, sync.indexOf("if (updateError)"));
  assertStringIncludes(block, "auth.admin.updateUserById(user.id, { phone })");
  assertStringIncludes(block, "console.error");
  assert(
    !/console\.warn\([^)]*sync phone to auth\.users/.test(block),
    "the auth.users sync failure is still logged at warn level",
  );
});

Deno.test("#2269 the phone arm reads the ledger and the GoTrue identity, and nothing else", () => {
  const fn = MIGRATION.slice(
    MIGRATION.indexOf(
      "CREATE OR REPLACE FUNCTION public.verified_account_identifiers",
    ),
  );
  const body = fn.slice(0, fn.indexOf("$function$;"));
  assertStringIncludes(body, "public.verified_phone_identities");
  assertStringIncludes(body, "i.provider = 'phone'");
  // #2217's email arm, unchanged and asserted so a rewrite of this function
  // cannot quietly drop the fallback that works.
  assertStringIncludes(body, "i.provider = 'email'");
  assertStringIncludes(body, "email_verified");
  // Measured 2026-08-18: phone_confirmed_at is set on 128 of 128 accounts
  // including 66 with no phone. profiles.phone is writable by `authenticated`
  // (column UPDATE grant + USING (auth.uid() = id)). Either in this predicate
  // turns knowledge into a claim.
  assert(
    !/phone_confirmed_at/.test(body),
    "phone_confirmed_at is in the identifier predicate",
  );
  assert(
    !/email_confirmed_at/.test(body),
    "email_confirmed_at is in the identifier predicate",
  );
  assert(
    !/public\.profiles|\bprofiles\b/.test(body),
    "profiles.phone — which any signed-in user can write — is in the predicate",
  );
  // ONE statement, UNIONed. An implementation that appended with successive
  // RETURN QUERY would hand back duplicate identifiers and break #2217's I-03.
  assertEquals(body.match(/RETURN QUERY/g)?.length, 1);
});

Deno.test("#2269 the ledger is service-role only, at the table AND the function", () => {
  assertStringIncludes(
    MIGRATION,
    "REVOKE ALL ON TABLE public.verified_phone_identities FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    MIGRATION,
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.verified_phone_identities TO service_role;",
  );
  assertStringIncludes(
    MIGRATION,
    "ALTER TABLE public.verified_phone_identities ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    MIGRATION,
    "ALTER TABLE public.verified_phone_identities FORCE ROW LEVEL SECURITY;",
  );
  for (
    const fn of [
      "public.record_verified_phone(uuid, text)",
      "public.verified_account_identifiers(uuid)",
    ]
  ) {
    assertStringIncludes(
      MIGRATION,
      `REVOKE ALL ON FUNCTION ${fn}\n  FROM PUBLIC, anon, authenticated;`,
    );
    assertStringIncludes(MIGRATION, `GRANT EXECUTE ON FUNCTION ${fn}`);
  }
});

Deno.test("#2269 one live owner per number, enforced in the writer and in the schema", () => {
  const fn = MIGRATION.slice(
    MIGRATION.indexOf("CREATE OR REPLACE FUNCTION public.record_verified_phone"),
  );
  const body = fn.slice(0, fn.indexOf("$function$;"));
  // A recycled number must stop entitling the account that used to hold it.
  assertStringIncludes(body, "DELETE FROM public.verified_phone_identities");
  assertStringIncludes(body, "user_id <> p_user_id");
  // And one live number per account, so claims cannot accumulate.
  assertStringIncludes(body, "ON CONFLICT (user_id) DO UPDATE");
  assertStringIncludes(
    MIGRATION,
    "CREATE UNIQUE INDEX IF NOT EXISTS verified_phone_identities_phone_key",
  );
  assertStringIncludes(MIGRATION, "user_id     uuid PRIMARY KEY");
});
