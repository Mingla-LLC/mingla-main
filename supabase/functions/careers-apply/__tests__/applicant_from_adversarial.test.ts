// ORCH-1226 [careers applicant email from careers@usemingla.com] — TESTER
// ADVERSARIAL regression (different angle than the implementor's happy-path).
//
// The implementor's apply_happy.test.ts asserts the POSITIVE shape: the applicant
// carries reply_to === "careers@usemingla.com" and the notify carries no reply_to.
// This test attacks the COMPLEMENT — the things that MUST NOT be true:
//
//  1. NEGATIVE-SENDER: the applicant `from` must NOT be the system/notify
//     no-reply identity ("notifications@usemingla.com" / "Mingla <…>"). Pre-fix,
//     BOTH emails shipped the SAME system `from`; a revert that re-points the
//     applicant at the notify sender is the exact regression. We prove the
//     applicant `from` is the careers identity AND distinct from the notify one.
//  2. NO-SHARED-REPLY-TO: the applicant and notify emails must never share a
//     reply_to. The applicant has the careers reply_to; the notify has NONE — so
//     `applicant.reply_to !== notify.reply_to` AND notify.reply_to is undefined.
//  3. CAREERS-IS-NOT-SETH: the careers reply_to address routes to the careers
//     inbox, NOT to seth@usemingla.com (the candidate-facing reply must not dump
//     onto Seth's personal recipient).
//  4. ENV-OVERRIDE-IS-CAREERS: the documented `RESEND_CAREERS_FROM` override (the
//     resolveCareersSender pattern, mirrored from _shared senders.ts) must resolve
//     to a careers@ identity — a source-contract assertion (resolveCareersSender
//     is module-private, so we assert against the index.ts source that the default
//     fallback address is the careers address and the override is parsed, never
//     defaulting to notifications@).
//
// Append-only, CI-runnable via Deno. Fails-on-revert proven against
// supabase/functions/careers-apply/index.ts.
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-read --allow-net \
//   supabase/functions/careers-apply/__tests__/applicant_from_adversarial.test.ts

import {
  assert,
  assertNotEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buildApplicantEmail, buildNotifyEmail } from "../index.ts";

const NOTIFY_FROM = "Mingla <notifications@usemingla.com>";
const APPLICANT_FROM = "Mingla Careers <careers@usemingla.com>";
const CAREERS_ADDR = "careers@usemingla.com";
const SETH = "seth@usemingla.com";

function applicant() {
  return buildApplicantEmail(
    "Ada Lovelace",
    "Multimedia Designer",
    "ada@example.com",
    APPLICANT_FROM,
  );
}

function notify() {
  return buildNotifyEmail(
    {
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      whatsapp_phone: "+2348031234567",
      preferred_salary: "₦200,000",
      portfolio_url: "https://ada.design",
    },
    "Multimedia Designer",
    NOTIFY_FROM,
    "2026-06-22T10:00:00.000Z",
  );
}

Deno.test("ORCH-1226 adversarial — applicant `from` is NOT the system/notify no-reply identity", () => {
  const a = applicant();
  // The applicant sender must carry the careers address...
  assert(
    a.from.includes(CAREERS_ADDR),
    `applicant from must be careers identity, got "${a.from}"`,
  );
  // ...and must NOT be the notifications@ system no-reply.
  assert(
    !a.from.includes("notifications@usemingla.com"),
    `applicant from must NOT be the notify/system sender, got "${a.from}"`,
  );
  // Distinct from the notify sender end-to-end (the pre-fix bug shared one `from`).
  assertNotEquals(
    a.from,
    notify().from,
    "applicant and notify must not ship the SAME from",
  );
});

Deno.test("ORCH-1226 adversarial — applicant + notify NEVER share a reply_to", () => {
  const a = applicant() as Record<string, unknown>;
  const n = notify() as Record<string, unknown>;
  // Notify has no reply_to at all.
  assert(n.reply_to === undefined, "notify must carry NO reply_to");
  // Applicant has a non-empty careers reply_to.
  assert(
    typeof a.reply_to === "string" && (a.reply_to as string).length > 0,
    "applicant must carry a non-empty reply_to",
  );
  // They are therefore never equal — a candidate reply can't land in the notify path.
  assertNotEquals(
    a.reply_to,
    n.reply_to,
    "applicant and notify must never share a reply_to",
  );
});

Deno.test("ORCH-1226 adversarial — careers reply_to routes to the careers inbox, NOT seth@", () => {
  // Read as a widened string so a revert that changes the literal is still caught
  // at runtime (TS would otherwise narrow the comparison away).
  const replyTo: string = String((applicant() as Record<string, unknown>).reply_to);
  // Compare against widened constants so TS does not narrow the comparison away.
  const wantCareers: string = CAREERS_ADDR;
  const notSeth: string = SETH;
  assert(
    replyTo === wantCareers,
    `applicant reply_to must be the careers inbox, got "${replyTo}"`,
  );
  assert(
    replyTo !== notSeth,
    "applicant reply_to must NOT be seth@usemingla.com (candidate replies != Seth's recipient)",
  );
});

Deno.test("ORCH-1226 adversarial — RESEND_CAREERS_FROM override resolves to a careers@ identity (source contract)", () => {
  // resolveCareersSender is module-private; assert its contract against the source.
  const src = Deno.readTextFileSync(
    new URL("../index.ts", import.meta.url),
  );
  // The override env var must be read.
  assert(
    src.includes('Deno.env.get("RESEND_CAREERS_FROM")'),
    "must read the RESEND_CAREERS_FROM override",
  );
  // The DEFAULT fallback address must be the careers address — NOT notifications@.
  assert(
    src.includes('CAREERS_REPLY_TO = "careers@usemingla.com"') ||
      src.includes('address: "careers@usemingla.com"') ||
      /address:\s*CAREERS_REPLY_TO/.test(src),
    "careers sender must default to careers@usemingla.com",
  );
  // The careers default must NOT be wired to the system no-reply.
  assert(
    !/resolveCareersSender[\s\S]{0,400}notifications@usemingla\.com/.test(src),
    "careers sender resolver must not fall back to notifications@",
  );
});
