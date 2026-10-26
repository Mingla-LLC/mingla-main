import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  conflictingPhoneOwners,
  getPhoneIdentityOwners,
  hasCurrentVerifiedPhoneOwnership,
  isProfileOnlyPhoneOwner,
  type RpcCapable,
} from "../phoneIdentityOwnership.ts";

const CURRENT = "40630000-0000-4000-8000-000000009001";
const OTHER = "40630000-0000-4000-8000-000000009002";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(`../../../../${path}`, import.meta.url));

Deno.test("#4063 complete phone ownership rows are parsed and classified", async () => {
  const client: RpcCapable = {
    rpc: () =>
      Promise.resolve({
        data: [
          {
            owner_user_id: CURRENT,
            owner_sources: ["profile", "verified_phone_identity", "profile"],
          },
          { owner_user_id: OTHER, owner_sources: ["auth_user"] },
        ],
        error: null,
      }),
  };
  const result = await getPhoneIdentityOwners(client, "+12025550901");
  assertEquals(result.error, null);
  assertEquals(result.owners, [
    {
      userId: CURRENT,
      sources: ["profile", "verified_phone_identity"],
    },
    { userId: OTHER, sources: ["auth_user"] },
  ]);
  assert(hasCurrentVerifiedPhoneOwnership(result.owners, CURRENT));
  assertEquals(conflictingPhoneOwners(result.owners, CURRENT), [
    { userId: OTHER, sources: ["auth_user"] },
  ]);
  assert(!isProfileOnlyPhoneOwner(result.owners[1]));
  assert(isProfileOnlyPhoneOwner({ userId: OTHER, sources: ["profile"] }));
});

Deno.test("#4063 ownership lookup errors and malformed rows fail closed", async () => {
  const rpcFailure: RpcCapable = {
    rpc: () =>
      Promise.resolve({ data: null, error: { message: "rpc unavailable" } }),
  };
  assertEquals(await getPhoneIdentityOwners(rpcFailure, "+12025550901"), {
    owners: [],
    error: "rpc unavailable",
  });

  for (
    const data of [
      null,
      [{ owner_user_id: "not-a-uuid", owner_sources: ["profile"] }],
      [{ owner_user_id: CURRENT, owner_sources: [] }],
      [{ owner_user_id: CURRENT, owner_sources: ["unknown"] }],
    ]
  ) {
    const malformed: RpcCapable = {
      rpc: () => Promise.resolve({ data, error: null }),
    };
    const result = await getPhoneIdentityOwners(malformed, "+12025550901");
    assertEquals(result.owners, []);
    assert(result.error !== null);
  }
});

Deno.test("#4063 send and verify OTP use the complete owner guard", () => {
  const send = read("supabase/functions/send-otp/index.ts");
  const verify = read("supabase/functions/verify-otp/index.ts");
  const sendGuard = send.indexOf(
    "getPhoneIdentityOwners(serviceClient, phone)",
  );
  const sendTwilio = send.indexOf(
    "https://verify.twilio.com/v2/Services/${serviceSid}/Verifications",
  );
  assert(sendGuard > 0 && sendGuard < sendTwilio);

  const approved = verify.indexOf("if (twilioData.status === 'approved')");
  const verifyGuard = verify.indexOf(
    "getPhoneIdentityOwners(serviceClient, phone)",
    approved,
  );
  const writer = verify.indexOf(
    "recordVerifiedPhone(serviceClient, user.id, phone)",
    approved,
  );
  assert(approved > 0 && verifyGuard > approved && writer > verifyGuard);

  for (const source of [send, verify]) {
    assertStringIncludes(
      source,
      "conflictingPhoneOwners(ownership.owners, user.id)",
    );
    assertStringIncludes(source, "isProfileOnlyPhoneOwner(owner)");
    assertStringIncludes(source, "authCheckError.status !== 404");
    assertStringIncludes(
      source,
      "Could not verify phone availability. Please try again.",
    );
  }
  assertStringIncludes(verify, ".update({ phone })");
  assertStringIncludes(verify, "if (updateError.code === '23505')");
});

Deno.test("#4063 SQL authority reads every durable source and is service-role only", () => {
  const migration = read(
    "supabase/migrations/20271219014063_issue_4063_ticket_send_to_friend.sql",
  );
  const ownerFn = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.phone_identity_owners",
    ),
    migration.indexOf("COMMENT ON FUNCTION public.phone_identity_owners"),
  );
  assertStringIncludes(ownerFn, "FROM public.profiles p");
  assertStringIncludes(ownerFn, "FROM public.verified_phone_identities v");
  assertStringIncludes(ownerFn, "FROM auth.users u");
  assertStringIncludes(ownerFn, "THEN '+' || btrim(u.phone)");

  assertStringIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.phone_identity_owners(text)\n  FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    migration,
    "GRANT EXECUTE ON FUNCTION public.phone_identity_owners(text) TO service_role;",
  );

  // #2269 deliberately owns the post-Twilio possession writer and its
  // recycled-number semantics. #4063 closes the unsafe path before an OTP is
  // sent and rechecks immediately after approval; it does not rewrite that
  // older proof contract from a later ticket-transfer migration.
  assert(
    !migration.includes(
      "CREATE OR REPLACE FUNCTION public.record_verified_phone",
    ),
    "#4063 unexpectedly replaced the #2269 possession writer",
  );
});
