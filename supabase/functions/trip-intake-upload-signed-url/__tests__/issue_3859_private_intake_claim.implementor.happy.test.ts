import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";

import {
  INTAKE_UPLOAD_MAX_BYTES,
  intakeUploadBytesMatch,
  isIntakeUploadClaimAnswer,
  validateIntakeUploadCandidate,
} from "../../../../packages/offering-rendering/intakeUploadClaim.ts";
import { resolveIntakeUploadSessionId } from "../../ticket-checkout-create/intakeUploadSession.ts";
import { authenticatedUserId } from "../index.ts";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("#3859 accepts only matching bounded file metadata and actual bytes", () => {
  assertEquals(
    validateIntakeUploadCandidate({
      filename: "passport.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
    }),
    {
      ok: true,
      extension: ".pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
    },
  );
  for (
    const rejected of [
      {
        filename: "../passport.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
      },
      { filename: "passport.pdf", mimeType: "image/png", sizeBytes: 1 },
      {
        filename: "passport.pdf",
        mimeType: "application/pdf",
        sizeBytes: INTAKE_UPLOAD_MAX_BYTES + 1,
      },
    ]
  ) {
    assertFalse(validateIntakeUploadCandidate(rejected).ok);
  }
  assert(intakeUploadBytesMatch(new TextEncoder().encode("%PDF-1.7"), ".pdf"));
  assertFalse(
    intakeUploadBytesMatch(new TextEncoder().encode("not a pdf"), ".pdf"),
  );
});

Deno.test("#3859 checkout answers carry only accepted bounded claim metadata", () => {
  assert(isIntakeUploadClaimAnswer({
    claim_id: "2f83fc44-4e0f-4ab2-9f3a-a21c173265d5",
    mime_type: "application/pdf",
    size_bytes: 128,
    expires_at: "2030-01-01T00:00:00.000Z",
  }));
  assertFalse(isIntakeUploadClaimAnswer({
    claim_id: "../../escape",
    mime_type: "application/pdf",
    size_bytes: 128,
    expires_at: "2030-01-01T00:00:00.000Z",
  }));
});

Deno.test("#3859 legacy non-file intake receives a private upload draft", () => {
  const generated = "9ec51fbf-15e7-4b54-9f87-9483539d3aca";
  assertEquals(
    resolveIntakeUploadSessionId(undefined, () => generated),
    generated,
  );
  assertEquals(resolveIntakeUploadSessionId(generated), generated);
  assertEquals(resolveIntakeUploadSessionId(null), null);
  assertEquals(resolveIntakeUploadSessionId("not-a-uuid"), null);
});

Deno.test("#3859 handler rejects bad bearer auth and never returns object path", async () => {
  const source = await read(
    "supabase/functions/trip-intake-upload-signed-url/index.ts",
  );
  assert(source.includes("auth.bearerProvided && auth.userId === null"));
  assert(
    source.includes('jsonResponse({ error: "upload_auth_invalid" }, 401)'),
  );
  const mintResponse = source.slice(
    source.lastIndexOf("return jsonResponse({"),
  );
  assert(mintResponse.includes("claim_id: claimId"));
  assert(mintResponse.includes("signed_url: signed.signedUrl"));
  assertFalse(mintResponse.includes("path,"));
  assertFalse(source.includes("console.log"));
  assertFalse(source.includes("console.error"));
});

Deno.test("#3859 auth accepts only the exact platform anon key as anonymous", async () => {
  let authLookups = 0;
  const supabase = {
    auth: {
      getUser: (_token: string) => {
        authLookups += 1;
        return Promise.resolve({
          data: { user: null },
          error: new Error("invalid"),
        });
      },
    },
  };
  assertEquals(
    await authenticatedUserId(
      new Request("https://example.test", {
        headers: { authorization: "Bearer exact-anon-key" },
      }),
      supabase,
      "exact-anon-key",
    ),
    { bearerProvided: false, userId: null },
  );
  assertEquals(authLookups, 0);
  assertEquals(
    await authenticatedUserId(
      new Request("https://example.test"),
      supabase,
      "exact-anon-key",
    ),
    { bearerProvided: false, userId: null },
  );
  assertEquals(
    await authenticatedUserId(
      new Request("https://example.test", {
        headers: { authorization: "Bearer malformed-or-expired-user-token" },
      }),
      supabase,
      "exact-anon-key",
    ),
    { bearerProvided: true, userId: null },
  );
  assertEquals(authLookups, 1);
});

Deno.test("#3859 exact claims attach atomically only after session creation", async () => {
  const edge = await read("supabase/functions/ticket-checkout-create/index.ts");
  const migration = await read(
    "supabase/migrations/20271017003859_issue_3859_intake_upload_claims.sql",
  );
  const session = edge.indexOf('"biz_ticket_checkout_create_session"');
  const attach = edge.indexOf('"issue_3859_attach_intake_snapshot"');
  const freeFinalize = edge.indexOf('"biz_ticket_checkout_finalize"');
  const provider = edge.indexOf("requires_paystack_redirect");
  assert(
    session >= 0 &&
      attach > session &&
      freeFinalize > attach &&
      provider > attach,
  );
  assert(edge.includes("intake_upload_session_id"));
  assert(edge.includes("resolveIntakeUploadSessionId"));
  assert(edge.includes("intakeFormData: canonicalIntakeFormData"));

  const prepareStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_3859_prepare_intake_upload_claims",
  );
  const attachStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_3859_attach_intake_snapshot",
  );
  const prepare = migration.slice(prepareStart, attachStart);
  const attachSql = migration.slice(attachStart);
  assertFalse(prepare.includes("SET state = 'claimed'"));
  assert(prepare.includes("'path', v_claim.object_path"));
  assertFalse(prepare.includes("'filename'"));
  assert(attachSql.includes("claim.id = ANY(v_claim_ids)"));
  assert(attachSql.includes("v_bound_count <> v_claim_count"));
  assert(attachSql.includes("checkout_session_id = p_checkout_session_id"));
  assert(
    attachSql.includes(
      "buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id",
    ),
  );
  assertFalse(
    attachSql.includes("WHERE checkout_claim_key = p_checkout_claim_key"),
  );
});

Deno.test("#3859 mint retries retire only unaccepted attempts", async () => {
  const edge = await read(
    "supabase/functions/trip-intake-upload-signed-url/index.ts",
  );
  const migration = await read(
    "supabase/migrations/20271017003859_issue_3859_intake_upload_claims.sql",
  );
  assert(edge.includes('"issue_3859_mint_intake_upload_claim"'));
  assert(edge.includes("orphanedPaths"));
  const mintStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_3859_mint_intake_upload_claim",
  );
  const acceptStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_3859_accept_intake_upload_claim",
  );
  const mint = migration.slice(mintStart, acceptStart);
  assert(mint.includes("AND state = 'issued'"));
  assert(mint.includes("AND state = 'accepted'"));
  assert(mint.includes("'error', 'upload_limit_reached'"));
  assertFalse(
    mint.includes("SET state = 'orphaned'\n    WHERE id = p_replaces_claim_id"),
  );
});

Deno.test("#3859 Explorer and buyer web submit the same upload draft as intake", async () => {
  const native = await read("app-mobile/src/payments/nativeCheckoutFlow.ts");
  const cart = await read(
    "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
  );
  const web = await read(
    "mingla-business/src/services/ticketCheckoutService.ts",
  );
  const webCart = await read(
    "mingla-business/src/components/checkout/CartContext.tsx",
  );
  assert(
    native.includes("intake_upload_session_id: input.intakeUploadSessionId"),
  );
  assert(cart.includes("uploadTripIntakeFile"));
  assert(cart.includes("revokeTripIntakeFileClaim"));
  assert(web.includes("intake_upload_session_id: input.intakeUploadSessionId"));
  assert(
    webCart.includes("intakeUploadSessionId: intakeUploadSessionRef.current"),
  );
});
