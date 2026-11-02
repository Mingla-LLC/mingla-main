// Issue #4238 wave 2 — T6 / T7: customer-list wire builders and the hash-only
// guard. Pure: no provider is called.
//
// MINGLA-INVARIANT: I-4238-TERMS-NEVER-AUTO | issue #4238 | No code accepts provider customer-list terms: terms are detected (Meta tos_accepted read, provider errors) and recorded, Admin accepts them in the provider's own UI, and the Google Customer Match builder throws unless an Admin confirmation is recorded.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertHashOnly,
  buildGoogleIngest,
  buildMetaListCreate,
  buildMetaLookalike,
  buildMetaTermsRead,
  buildMetaUsers,
  buildRedditUsers,
  buildSnapListCreate,
  buildSnapLookalike,
  buildSnapUsers,
  buildTikTokAudienceFile,
  buildTikTokListCreate,
  buildTikTokListUpdate,
  buildTikTokLookalike,
  listAudienceErrorCode,
  listAudienceErrorState,
  metaDeliveryState,
  parseListFact,
  parseMetaTerms,
} from "../adListAudienceProvider.ts";
import {
  audienceProviderName,
  LIST_MIN,
  neededCount,
} from "../adListAudienceRules.ts";

async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A real SHA-256 whose hex has a run of 7+ digits (the old guard's trap). */
async function digitHeavyHash(): Promise<string> {
  for (let i = 0;; i += 1) {
    const hash = await sha(`guest${i}@mingla-fixture.org`);
    if (/[0-9]{7,}/.test(hash)) return hash;
  }
}

const hashes = Promise.all([
  sha("ada@mingla-fixture.org"),
  sha("2348030004238"),
  digitHeavyHash(),
]);

Deno.test("T6 assertHashOnly accepts real hashes, including digit-heavy ones", async () => {
  const [a, b, c] = await hashes;
  assert(/[0-9]{7,}/.test(c), "fixture is digit-heavy");
  // The #3697 JSON-wide regex rejected this; the per-value check accepts it.
  assert(/@|\+?[0-9][0-9 ()-]{6,}/.test(JSON.stringify([c])));
  assertHashOnly([a, b, c]);
});

Deno.test("T6 assertHashOnly rejects an email, an E.164 phone and upper-case hex", async () => {
  const [a] = await hashes;
  assertThrows(() => assertHashOnly(["ada@mingla-fixture.org"]), Error, "list_audience_unhashed_value");
  assertThrows(() => assertHashOnly(["+2348030004238"]), Error, "list_audience_unhashed_value");
  assertThrows(() => assertHashOnly(["2348030004238"]), Error, "list_audience_unhashed_value");
  assertThrows(() => assertHashOnly([a.toUpperCase()]), Error, "list_audience_unhashed_value");
});

Deno.test("T6 Meta customer list, users and lookalike wire", async () => {
  const [a, b, c] = await hashes;
  assertEquals(buildMetaListCreate("act_123", "Mingla · Room [12345678] · Your past guests"), {
    method: "POST",
    path: "act_123/customaudiences",
    body: {
      name: "Mingla · Room [12345678] · Your past guests",
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
      description: "Mingla customer list · #4238",
    },
  });
  const session = { session_id: 7, batch_seq: 1, last_batch_flag: true, estimated_num_total: 3 };
  assertEquals(
    buildMetaUsers({ audienceId: "238", action: "add", schema: "EMAIL", hashes: [a, b, c], session }),
    {
      method: "POST",
      path: "238/users",
      body: { payload: { schema: ["EMAIL"], data: [[a], [b], [c]] }, session },
    },
  );
  assertEquals(
    buildMetaUsers({ audienceId: "238", action: "remove", schema: "PHONE", hashes: [b], session }).method,
    "DELETE",
  );
  assertThrows(() =>
    buildMetaUsers({ audienceId: "238", action: "add", schema: "EMAIL", hashes: ["ada@x.org"], session })
  );
  const lookalike = buildMetaLookalike({ accountId: "123", name: "L", originAudienceId: "238", country: "NG" });
  assertEquals(lookalike.path, "act_123/customaudiences");
  assertEquals(lookalike.body?.subtype, "LOOKALIKE");
  assertEquals(lookalike.body?.origin_audience_id, "238");
  assertEquals(JSON.parse(String(lookalike.body?.lookalike_spec)), { type: "similarity", country: "NG" });
  assertEquals(buildMetaTermsRead("act_123"), { method: "GET", path: "act_123", body: { fields: "tos_accepted" } });
  assertEquals(parseMetaTerms({ tos_accepted: { custom_audience_tos: 1 } }), "accepted");
  assertEquals(parseMetaTerms({ tos_accepted: {} }), "not_accepted");
});

Deno.test("T6 Snap segment, users and lookalike wire", async () => {
  const [a, b] = await hashes;
  assertEquals(buildSnapListCreate("acc", "N"), {
    method: "POST",
    path: "adaccounts/acc/segments",
    body: { segments: [{ name: "N", source_type: "FIRST_PARTY", retention_in_days: 9999, ad_account_id: "acc" }] },
  });
  assertEquals(buildSnapUsers({ segmentId: "s1", action: "add", schema: "EMAIL_SHA256", hashes: [a, b] }), {
    method: "POST",
    path: "segments/s1/users",
    body: { users: [{ schema: ["EMAIL_SHA256"], data: [[a], [b]] }] },
  });
  assertEquals(buildSnapUsers({ segmentId: "s1", action: "remove", schema: "PHONE_SHA256", hashes: [b] }).method, "DELETE");
  const lookalike = buildSnapLookalike({ accountId: "acc", name: "L", seedSegmentId: "s1", country: "NG" });
  const segment = (lookalike.body?.segments as Record<string, unknown>[])[0];
  assertEquals(segment.source_type, "LOOKALIKE");
  assertEquals(segment.retention_in_days, 180);
  assertEquals(segment.creation_spec, { seed_segment_id: "s1", type: "BALANCE", countries: ["NG"] });
});

Deno.test("T6 TikTok file, create, update and lookalike wire", async () => {
  const [a, b] = await hashes;
  const file = buildTikTokAudienceFile("EMAIL_SHA256", [a, b]);
  assertEquals(file.csv, `EMAIL_SHA256\n${a}\n${b}\n`);
  assertThrows(() => buildTikTokAudienceFile("PHONE_SHA256", ["+2348030004238"]));
  assertEquals(
    buildTikTokListCreate({ advertiserId: "adv", name: "x".repeat(200), calculateType: "EMAIL_SHA256", filePaths: ["f1"] }).body,
    { advertiser_id: "adv", custom_audience_name: "x".repeat(128), calculate_type: "EMAIL_SHA256", file_paths: ["f1"], retention_in_days: 365 },
  );
  assertEquals(
    buildTikTokListUpdate({ advertiserId: "adv", audienceId: "9", action: "REMOVE", filePaths: ["f2"] }).body,
    { advertiser_id: "adv", custom_audience_id: "9", action: "REMOVE", file_paths: ["f2"] },
  );
  assertEquals(
    buildTikTokLookalike({ advertiserId: "adv", name: "L", sourceAudienceId: "9", locationId: "2328926" }).body?.lookalike_spec,
    { source_audience_id: "9", location_ids: ["2328926"], audience_size: "BALANCED", include_source: false },
  );
});

Deno.test("T6 Reddit users wire is email-only and hash-only", async () => {
  const [a] = await hashes;
  assertEquals(buildRedditUsers({ audienceId: "r1", action: "ADD", hashes: [a] }), {
    method: "PATCH",
    path: "custom_audiences/r1/users",
    body: { action_type: "ADD", column_order: ["EMAIL_SHA256"], user_data: [[a]] },
  });
  assertThrows(() => buildRedditUsers({ audienceId: "r1", action: "ADD", hashes: ["ada@x.org"] }));
});

Deno.test("T7 Google refuses to build anything without a recorded terms confirmation", async () => {
  const [a, b] = await hashes;
  assertThrows(
    () =>
      buildGoogleIngest({
        action: "ingest",
        termsConfirmed: false,
        customerId: "1",
        userListId: "2",
        members: [{ email: a, phoneE164: b, country: "NG" }],
      }),
    Error,
    "google_customer_match_terms_unconfirmed",
  );
});

Deno.test("T7 Google omits EEA / UK / CH members and sends hashes only", async () => {
  const [a, b, c] = await hashes;
  const request = buildGoogleIngest({
    action: "ingest",
    termsConfirmed: true,
    customerId: "1",
    userListId: "2",
    members: [
      { email: a, phoneE164: b, country: "NG" },
      { email: c, phoneE164: null, country: "FR" },
      { email: c, phoneE164: null, country: "GB" },
    ],
  });
  const members = request.body?.audienceMembers as Record<string, unknown>[];
  assertEquals(members.length, 1);
  assertEquals(members[0].userData, { userIdentifiers: [{ emailAddress: a }, { phoneNumber: b }] });
  assertEquals(request.body?.encoding, "HEX");
  assertEquals(request.body?.termsOfService, { customerMatchTermsOfServiceStatus: "ACCEPTED" });
  assertThrows(() =>
    buildGoogleIngest({
      action: "remove",
      termsConfirmed: true,
      customerId: "1",
      userListId: "2",
      members: [{ email: "ada@x.org", phoneE164: null, country: "US" }],
    })
  );
});

Deno.test("T6 response parsers map provider states", () => {
  assertEquals(metaDeliveryState({ delivery_status: { code: 200 } }), "ready");
  assertEquals(metaDeliveryState({ delivery_status: { code: 300 } }), "too_small");
  assertEquals(metaDeliveryState({ delivery_status: { code: 400 } }), "creating");
  assertEquals(parseListFact("meta", { id: "1", delivery_status: { code: 300 } }).state, "too_small");
  assertEquals(
    parseListFact("snapchat", { segments: [{ segment: { id: "s", targetable_status: "TOO_FEW_USERS" } }] }).state,
    "too_small",
  );
  assertEquals(parseListFact("snapchat", { segments: [{ segment: { id: "s", targetable_status: "READY" } }] }).state, "ready");
  assertEquals(parseListFact("tiktok", { data: { list: [{ custom_audience_id: "9", is_valid: false }] } }).state, "too_small");
  assertEquals(parseListFact("tiktok", { data: { list: [{ custom_audience_id: "9", is_valid: true, audience_size: 999 }] } }).state, "too_small");
  assertEquals(
    listAudienceErrorState("meta", { code: 200, subcode: 1870090, message: "Custom Audience Terms Not Accepted" }),
    "terms_required",
  );
  assertEquals(
    listAudienceErrorState("google", { message: "CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE" }),
    "ineligible",
  );
  assertEquals(listAudienceErrorState("meta", { code: 17 }), "rate_limited");
  assertEquals(listAudienceErrorState("tiktok", { code: 40100 }), "rate_limited");
  // Only the code survives: the provider message body is dropped.
  assertEquals(
    listAudienceErrorCode({ code: 200, subcode: 1870090, message: "You must accept for ada@x.org" }),
    "provider_200_1870090",
  );
});

Deno.test("T6 SC-13 provider names carry the brand marker and fit the limit", () => {
  const name = audienceProviderName({
    ownerKind: "host",
    brandName: "We Go Again\u0007 Exhibition",
    brandId: "63a62d11-0000-4000-8000-000000000001",
    displayName: "Your past guests",
    platform: "meta",
  });
  assertEquals(name, "Mingla · We Go Again Exhibition [63a62d11] · Your past guests");
  assert(
    audienceProviderName({ ownerKind: "host", brandName: "B".repeat(300), brandId: "x", displayName: "Y" }).length <= 100,
  );
  assertEquals(audienceProviderName({ ownerKind: "mingla", displayName: "Everyone", country: "NG" }), "Mingla · Everyone · NG");
});

Deno.test("T6 neededCount follows the shared minimums", () => {
  assertEquals(LIST_MIN.meta, 100);
  assertEquals(neededCount("meta", "list", 79), 21);
  assertEquals(neededCount("meta", "list", 100), null);
  assertEquals(neededCount("snapchat", "list", 445), 555);
  assertEquals(neededCount("meta", "lookalike", 0, 99), 1);
  assertEquals(neededCount("meta", "lookalike", 0, 227), null);
});
