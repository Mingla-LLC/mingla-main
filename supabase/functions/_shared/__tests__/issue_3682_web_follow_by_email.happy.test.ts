/**
 * #3682 Wave 2.5 — web follow-by-email tokens, bodies, and edge wiring (m→n→o).
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  renderFollowConfirmEmail,
  renderFollowConfirmedEmail,
  renderFollowInviteEmail,
} from "../email/followByEmailBodies.ts";

Deno.test("#3682 Wave 2.5 happy: confirm / confirmed / invite email bodies", () => {
  const confirm = renderFollowConfirmEmail({
    brandName: "Lantern Room",
    confirmUrl: "https://example.test/confirm/tok",
  });
  assertEquals(confirm.subject, "Confirm you want to follow Lantern Room");
  assertStringIncludes(confirm.html, "Yes, follow Lantern Room");
  assertStringIncludes(confirm.html, "https://example.test/confirm/tok");
  assertStringIncludes(confirm.text, "24 hours");

  const confirmed = renderFollowConfirmedEmail({
    brandName: "Lantern Room",
    brandUrl: "https://host.usemingla.com/b/lanternroom",
  });
  assertEquals(confirmed.subject, "You now follow Lantern Room");
  assertStringIncludes(confirmed.html, "See their page");

  const invite = renderFollowInviteEmail({
    brandName: "Lantern Room",
    oneLinkUrl: "https://go.usemingla.com/w36m?deep_link_value=follow_invite",
  });
  assertEquals(invite.subject, "Lantern Room invited you to Mingla");
  assertStringIncludes(invite.html, "deep_link_value=follow_invite");
  assertStringIncludes(invite.html, "Get the app");
});

Deno.test("#3682 Wave 2.5 happy: webFollowEmailTokens roundtrip + URLs", async () => {
  Deno.env.set(
    "UNSUBSCRIBE_TOKEN_SECRET",
    "0123456789abcdef0123456789abcdef",
  );
  Deno.env.delete("BRAND_FOLLOW_TOKEN_SECRET");
  const {
    signWebFollowEmailToken,
    verifyWebFollowEmailToken,
    hashWebFollowToken,
    webFollowConfirmPublicUrl,
    webFollowInviteOneLinkUrl,
  } = await import("../webFollowEmailTokens.ts");

  const confirmTok = await signWebFollowEmailToken({
    kind: "confirm",
    brand_id: "11111111-1111-4111-8111-111111111111",
    subject: "22222222-2222-4222-8222-222222222222",
  });
  const confirmPayload = await verifyWebFollowEmailToken(confirmTok);
  assertEquals(confirmPayload.kind, "confirm");
  assertEquals(confirmPayload.brand_id, "11111111-1111-4111-8111-111111111111");
  assertEquals(
    confirmPayload.subject,
    "22222222-2222-4222-8222-222222222222",
  );

  const inviteTok = await signWebFollowEmailToken({
    kind: "invite",
    brand_id: "11111111-1111-4111-8111-111111111111",
    subject: "Ada@Example.COM",
  });
  const invitePayload = await verifyWebFollowEmailToken(inviteTok);
  assertEquals(invitePayload.kind, "invite");
  assertEquals(invitePayload.subject, "ada@example.com");

  const hash = await hashWebFollowToken(confirmTok);
  assertEquals(hash.length, 64);

  Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
  assertEquals(
    webFollowConfirmPublicUrl("abc.tok"),
    "https://proj.supabase.co/functions/v1/public-follow-confirm/abc.tok",
  );
  const oneLink = webFollowInviteOneLinkUrl("invite.tok");
  assertStringIncludes(oneLink, "deep_link_value=follow_invite");
  assertStringIncludes(oneLink, "deep_link_sub1=invite.tok");
});

Deno.test("#3682 Wave 2.5 happy: edge functions wired (no account leak + GET/POST)", async () => {
  const requestSrc = await Deno.readTextFile(
    new URL("../../public-follow-request/index.ts", import.meta.url),
  );
  assert(requestSrc.includes("FLOOR_MS = 600"));
  assert(requestSrc.includes("status: 202"));
  assert(requestSrc.includes('{ status: "sent" }'));
  assert(requestSrc.includes("renderFollowConfirmEmail"));
  assert(requestSrc.includes("renderFollowInviteEmail"));
  assert(requestSrc.includes("brand_follow_email_pending"));
  assert(requestSrc.includes("signWebFollowEmailToken"));
  assert(requestSrc.includes('biz_web_follow_rate_hit'));
  assert(requestSrc.includes('.eq("email", email)'));
  assert(!requestSrc.includes(".ilike("));
  assert(requestSrc.includes("crypto.randomUUID"));
  assert(requestSrc.includes("upsertErr"));
  assert(requestSrc.includes("sent.ok"));
  // Invalid email is the one client-visible error (M2).
  assert(requestSrc.includes("invalid_email"));
  assert(requestSrc.includes("status: 400"));

  const confirmSrc = await Deno.readTextFile(
    new URL("../../public-follow-confirm/index.ts", import.meta.url),
  );
  assert(confirmSrc.includes('if (req.method === "GET")'));
  assert(confirmSrc.includes("htmlConfirm"));
  assert(confirmSrc.includes('method="POST"'));
  assert(confirmSrc.includes('p_source: "web_email"'));
  assert(confirmSrc.includes("renderFollowConfirmedEmail"));
  assert(confirmSrc.includes("sent.ok"));
  const getIdx = confirmSrc.indexOf('if (req.method === "GET")');
  const followIdx = confirmSrc.indexOf("biz_auto_follow_brand");
  assert(getIdx > 0 && followIdx > getIdx);

  const inviteSrc = await Deno.readTextFile(
    new URL("../../resolve-follow-invite/index.ts", import.meta.url),
  );
  assert(inviteSrc.includes("biz_claim_web_follow_invite"));
  assert(inviteSrc.includes('if (req.method === "POST" && !userId)'));
  assert(inviteSrc.includes("unauthorized"));
  assert(inviteSrc.includes("emailMismatch"));

  const config = await Deno.readTextFile(
    new URL("../../../config.toml", import.meta.url),
  );
  assert(config.includes("[functions.public-follow-request]\nverify_jwt = false"));
  assert(config.includes("[functions.public-follow-confirm]\nverify_jwt = false"));
  assert(config.includes("[functions.resolve-follow-invite]\nverify_jwt = false"));

  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270807003682_issue_3682_web_follow_by_email.sql",
      import.meta.url,
    ),
  );
  assert(migration.includes("brand_follow_email_pending"));
  assert(migration.includes("biz_web_follow_rate_hit"));
  assert(migration.includes("biz_claim_web_follow_invite"));
  assert(migration.includes("'web_follow_invite'"));
  assert(migration.includes("'web_email'"));
});
