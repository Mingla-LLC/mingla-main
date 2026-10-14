/**
 * #3720 Phase 0 Slice A — adversarial pins.
 *
 * Attacks:
 *   A. create hook must not call notify-support with a user JWT
 *   B. SupportThreadCore must not import postPlannerMessage
 *   C. notify-support staff→host title must use Veronica
 *   D. migration must install the AFTER INSERT notify trigger
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

  test("C. notify-support uses Veronica for staff→host push titles", () => {
    const src = fs.readFileSync(
      path.join(REPO, "supabase/functions/notify-support/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/SUPPORT_HOST_FACING_AGENT/);
    expect(src).toMatch(/senderIsStaff === true/);
    expect(src).toMatch(/replied/);
  });

  test("D. migration installs tg_support_ticket_notify_staff on support_tickets", () => {
    const mig = fs.readFileSync(
      path.join(
        REPO,
        "supabase/migrations/20270829003720_issue_3720_support_new_ticket_notify.sql",
      ),
      "utf8",
    );
    expect(mig).toMatch(/tg_support_ticket_notify_staff/);
    expect(mig).toMatch(/AFTER INSERT ON public\.support_tickets/);
    expect(mig).toMatch(/notify-support/);
    expect(mig).toMatch(/new_ticket/);
    expect(mig).toMatch(/service_role_key/);
  });
});
