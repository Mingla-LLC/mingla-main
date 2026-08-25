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

/** #2510 — rollupFunnel takes rows now; delivery is an event, not a status. */
const rows = (statuses: MessageStatus[]) => statuses.map((status) => ({ status }));

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
    const out = rollupFunnel(rows(statuses), 0);
    expect(out.sent).toBe(4); // sent + delivered + clicked + preview_skipped
  });

  /**
   * [TEST-MOD-APPROVED #2510]
   *
   * SUPERSEDED ASSERTION, named explicitly: "sums delivered across
   * (delivered, clicked) only".
   *
   * That rule IS the defect. Nothing ever wrote `status='delivered'`, so
   * counting `delivered|clicked` made the Delivered tile the CLICK count under
   * a Delivered label — the We Go Again organiser was shown "DELIVERED 3
   * (1.5%)" for a campaign where 189 emails were accepted.
   *
   * Delivery is an EVENT now (`email.delivered` → `delivered_at`), so the
   * replacement asserts the honest rule and that the old one is dead.
   */
  it("counts delivered from delivery EVENTS, not from status (#2510)", () => {
    const out = rollupFunnel(
      [
        { status: "sent", delivered_at: "2026-08-25T00:00:00Z" },
        { status: "clicked", delivered_at: null },
        { status: "delivered", delivered_at: null },
        { status: "preview_skipped" },
      ],
      0,
    );
    // Only the row with a real delivery event counts — a `clicked` row with no
    // delivery event does NOT, which is precisely what the old rule got wrong.
    expect(out.delivered).toBe(1);
  });

  it("opens are counted from opened_at, and coverage is honest (#2510)", () => {
    const none = rollupFunnel([{ status: "sent" }, { status: "sent" }], 0);
    expect(none.opened).toBe(0);
    // No event ever arrived — the screen must render unknown, not 0%.
    expect(none.hasEventCoverage).toBe(false);

    const some = rollupFunnel(
      [
        { status: "sent", delivered_at: "2026-08-25T00:00:00Z", opened_at: "2026-08-25T00:01:00Z" },
        { status: "sent", delivered_at: "2026-08-25T00:00:00Z", opened_at: null },
      ],
      0,
    );
    expect(some.opened).toBe(1);
    expect(some.hasEventCoverage).toBe(true);
  });

  it("sums failed across (failed, bounced)", () => {
    const statuses: MessageStatus[] = ["failed", "bounced", "sent", "delivered"];
    const out = rollupFunnel(rows(statuses), 0);
    expect(out.failed).toBe(2);
  });

  it("clicked is the explicit distinct-message_id count passed in (NOT inferred from status='clicked')", () => {
    const statuses: MessageStatus[] = ["sent", "sent", "sent"];
    expect(rollupFunnel(rows(statuses), 7).clicked).toBe(7);
    expect(rollupFunnel(rows(statuses), 0).clicked).toBe(0);
  });

  it("preview_skipped contributes to sent (so the headline doesn't undercount the dispatch volume)", () => {
    const statuses: MessageStatus[] = ["preview_skipped", "preview_skipped", "preview_skipped"];
    const out = rollupFunnel(rows(statuses), 0);
    expect(out.sent).toBe(3);
    expect(out.delivered).toBe(0);
    expect(out.failed).toBe(0);
  });

  it("unsubscribed + queued do NOT contribute to sent / delivered / failed (orthogonal states)", () => {
    const statuses: MessageStatus[] = ["unsubscribed", "queued"];
    const out = rollupFunnel(rows(statuses), 0);
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
    const out = rollupFunnel(rows(statuses), 1);
    expect(out.sent).toBe(49); // 35 sent + 14 preview_skipped
    expect(out.delivered).toBe(0);
    expect(out.clicked).toBe(1);
    expect(out.failed).toBe(0);
  });
});
