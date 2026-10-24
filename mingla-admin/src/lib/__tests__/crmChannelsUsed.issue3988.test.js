import { describe, expect, it } from "vitest";
import { channelsUsed } from "../crmModel";

describe("#3988 CRM channels used", () => {
  it("deduplicates touch channels, preserves first/last evidence and orders recent first", () => {
    const result = channelsUsed([
      { kind: "touch", channel: "email", occurred_at: "2026-10-20T10:00:00Z" },
      { kind: "stage_move", occurred_at: "2026-10-22T10:00:00Z" },
      { kind: "touch", channel: "whatsapp", occurred_at: "2026-10-21T10:00:00Z" },
      { kind: "touch", channel: "email", occurred_at: "2026-10-22T10:00:00Z" },
    ], [
      { id: "email", label: "Email" },
      { id: "whatsapp", label: "WhatsApp" },
    ]);

    expect(result).toEqual([
      { id: "email", label: "Email", count: 2, firstUsedAt: "2026-10-20T10:00:00Z", lastUsedAt: "2026-10-22T10:00:00Z" },
      { id: "whatsapp", label: "WhatsApp", count: 1, firstUsedAt: "2026-10-21T10:00:00Z", lastUsedAt: "2026-10-21T10:00:00Z" },
    ]);
  });

  it("ignores non-touch rows and invalid dates", () => {
    expect(channelsUsed([
      { kind: "touch", channel: "email", occurred_at: "not-a-date" },
      { kind: "note", channel: "sms", occurred_at: "2026-10-22T10:00:00Z" },
    ])).toEqual([]);
  });
});
