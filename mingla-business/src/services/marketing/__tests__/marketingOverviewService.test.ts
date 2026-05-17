/**
 * marketingOverviewService.test.ts — Phase B Overview funnel rollup tests
 * (ORCH-0863 T-01).
 *
 * The binding `rollupFunnel` helper is pure and directly testable —
 * pinning it via unit test guards against silent formula drift.
 *
 * Mocks `../../supabase` at module boundary to prevent jest from trying
 * to transform the transitive expo-constants ESM import.
 */

jest.mock("../../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { rollupFunnel } from "../marketingOverviewService";
import type { MessageStatus } from "../../../types/marketing";

describe("rollupFunnel (T-01 binding formulas pinning, ORCH-0863)", () => {
  it("sums sent across (sent, delivered, clicked, preview_skipped)", () => {
    const statuses: MessageStatus[] = [
      "sent",
      "delivered",
      "clicked",
      "preview_skipped",
      "queued",
      "failed",
      "bounced",
      "unsubscribed",
    ];
    const out = rollupFunnel(statuses, 0);
    expect(out.sent).toBe(4); // sent + delivered + clicked + preview_skipped
  });

  it("sums delivered across (delivered, clicked) only", () => {
    const statuses: MessageStatus[] = ["delivered", "clicked", "sent", "preview_skipped"];
    const out = rollupFunnel(statuses, 0);
    expect(out.delivered).toBe(2);
  });

  it("sums failed across (failed, bounced)", () => {
    const statuses: MessageStatus[] = ["failed", "bounced", "sent", "delivered"];
    const out = rollupFunnel(statuses, 0);
    expect(out.failed).toBe(2);
  });

  it("clicked is the explicit distinct-message_id count passed in (NOT inferred from status='clicked')", () => {
    const statuses: MessageStatus[] = ["sent", "sent", "sent"];
    expect(rollupFunnel(statuses, 7).clicked).toBe(7);
    expect(rollupFunnel(statuses, 0).clicked).toBe(0);
  });

  it("preview_skipped contributes to sent (so the headline doesn't undercount the dispatch volume)", () => {
    const statuses: MessageStatus[] = ["preview_skipped", "preview_skipped", "preview_skipped"];
    const out = rollupFunnel(statuses, 0);
    expect(out.sent).toBe(3);
    expect(out.delivered).toBe(0);
    expect(out.failed).toBe(0);
  });

  it("unsubscribed + queued do NOT contribute to sent / delivered / failed (orthogonal states)", () => {
    const statuses: MessageStatus[] = ["unsubscribed", "queued"];
    const out = rollupFunnel(statuses, 0);
    expect(out.sent).toBe(0);
    expect(out.delivered).toBe(0);
    expect(out.failed).toBe(0);
  });

  it("happy path matches production DB probe shape (50 messages: 35 sent + 14 preview_skipped + 0 failed)", () => {
    // From investigation §3 live DB probe (Supabase MCP 2026-05-17).
    const statuses: MessageStatus[] = [
      ...Array<MessageStatus>(35).fill("sent"),
      ...Array<MessageStatus>(14).fill("preview_skipped"),
      ...Array<MessageStatus>(1).fill("queued"),
    ];
    const out = rollupFunnel(statuses, 1);
    expect(out.sent).toBe(49); // 35 sent + 14 preview_skipped
    expect(out.delivered).toBe(0);
    expect(out.clicked).toBe(1);
    expect(out.failed).toBe(0);
  });
});
