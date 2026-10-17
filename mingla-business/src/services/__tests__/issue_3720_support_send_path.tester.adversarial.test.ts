/**
 * #3720 Phase 0 Slice A — adversarial pins.
 *
 * Attacks:
 *   A. create hook must not call notify-support with a user JWT
 *   B. SupportThreadCore must not import postPlannerMessage
 *   C. notify-support staff→host title must use the real sender snapshot
 *   D. reliability cutover must remove the AFTER INSERT network trigger
 */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const REPO = path.resolve(ROOT, "..");

describe("#3720 support notify path (adversarial)", () => {
  test("A. useCreateSupportTicket does not call notifyNewSupportTicket / invoke notify-support", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/hooks/useSupportTickets.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/notifyNewSupportTicket/);
    // Comments may name the edge function; the hook must not invoke it.
    expect(src).not.toMatch(/functions\.invoke\(\s*["']notify-support["']/);
    expect(src).not.toMatch(/invoke\(\s*["']notify-support["']/);
  });

  test("B. SupportThreadCore has no postPlannerMessage import or call", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/components/support/SupportThreadCore.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/postPlannerMessage/);
    expect(src).toMatch(/sendSupportMessage\(ticket\.id/);
  });

  // [TEST-MOD-APPROVED #3720] Fictional Support identity removed in Wave 2.
  test("C. notify-support uses the real staff name with a neutral fallback", () => {
    const src = fs.readFileSync(
      path.join(REPO, "supabase/functions/notify-support/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/senderDisplayName/);
    expect(src).toMatch(/SUPPORT_HOST_FACING_AGENT/);
    expect(src).toMatch(/senderIsStaff === true/);
    expect(src).toMatch(/replied/);
  });

  // [TEST-MOD-APPROVED #3720] Durable outbox replaced the best-effort trigger.
  test("D. reliability migration removes the network trigger and enqueues durably", () => {
    const mig = fs.readFileSync(
      path.join(
        REPO,
        "supabase/migrations/20271020003720_issue_3720_notification_reliability.sql",
      ),
      "utf8",
    );
    expect(mig).toMatch(/DROP TRIGGER IF EXISTS tg_support_ticket_notify_staff/);
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.create_support_ticket/);
    expect(mig).toMatch(/INSERT INTO public\.notification_outbox/);
    expect(mig).toMatch(/business\.support_new_ticket/);
    expect(mig).not.toMatch(/net\.http_post/);
  });
});
