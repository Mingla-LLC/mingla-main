/**
 * #4111 — brand-enquiry-guest-digest: emails brand replies to web guests who
 * have no Mingla account yet, batched to at most one email per thread every
 * 10 minutes. Invoked by pg_cron (issue_4111_enquiry_guest_digest) with the
 * service-role bearer. verify_jwt = false; the bearer is checked in code.
 *
 * Each email carries a FRESH access link: a new 32-byte token whose SHA-256
 * is stored only after the provider accepted the email. Raw tokens never
 * reach the database. If a send fails the thread's claim is released so the
 * next run retries.
 *
 * POST {}  (Authorization: Bearer <service role key>)
 *   200 { claimed, sent, failed }
 *   401 { error:"unauthorized" }
 */
import { replyDigestEmail, sha256Hex } from "../_shared/brandEnquiry.ts";
import type { PublicEnquiryDeps } from "../_shared/brandEnquiryRuntime.ts";

type DigestDeps = Pick<PublicEnquiryDeps, "rpc" | "sendEmail" | "makeToken" | "log"> & {
  serviceRoleKey: string;
};

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0;
}

interface DigestClaim {
  enquiry_id: string;
  previous_emailed_at: string | null;
  guest_email: string;
  guest_name: string;
  brand_name: string;
  messages: Array<{ display?: string; body?: string }>;
}

export function createGuestDigestHandler(deps: DigestDeps) {
  return async function handle(req: Request): Promise<Response> {
    const reply = (status: number, body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (!deps.serviceRoleKey) return reply(500, { error: "server_misconfigured" });
    if (!constantTimeEqual(req.headers.get("Authorization") ?? "", `Bearer ${deps.serviceRoleKey}`)) {
      return reply(401, { error: "unauthorized" });
    }
    const { data, error } = await deps.rpc("issue_4111_claim_guest_digests", { p_limit: 25 });
    if (error) {
      deps.log("error", "[brand-enquiry-guest-digest] claim_failed", { code: error.code ?? null });
      return reply(500, { error: "claim_failed" });
    }
    const claims = Array.isArray(data) ? data as DigestClaim[] : [];
    let sent = 0;
    let failed = 0;
    for (const claim of claims) {
      const token = deps.makeToken();
      let ok = false;
      try {
        const email = replyDigestEmail({
          brandName: claim.brand_name,
          guestName: claim.guest_name,
          replies: (claim.messages ?? []).map((m) => ({
            display: typeof m.display === "string" ? m.display : "",
            body: typeof m.body === "string" ? m.body : "",
          })),
          token,
        });
        const result = await deps.sendEmail({ to: claim.guest_email, ...email });
        ok = result.ok;
        if (!ok) deps.log("error", "[brand-enquiry-guest-digest] send_failed", { error: result.error ?? "unknown" });
      } catch (err) {
        deps.log("error", "[brand-enquiry-guest-digest] send_threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const { error: completeError } = await deps.rpc("issue_4111_complete_guest_digest", {
        p_enquiry_id: claim.enquiry_id,
        p_token_hash: ok ? await sha256Hex(token) : null,
        p_sent: ok,
        p_previous_emailed_at: claim.previous_emailed_at,
      });
      if (completeError) {
        deps.log("error", "[brand-enquiry-guest-digest] complete_failed", { code: completeError.code ?? null });
      }
      if (ok) sent++;
      else failed++;
    }
    return reply(200, { claimed: claims.length, sent, failed });
  };
}
