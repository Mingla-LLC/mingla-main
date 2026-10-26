import { parseBrandGroupFileMetaRows } from "../brandGroupFileMetaService";
import { parseBrandGroupMediaPage } from "../brandGroupMediaService";

jest.mock("../supabase", () => ({ supabase: { rpc: jest.fn() } }));

const row = {
  fileId: "00000000-0000-4000-8000-000000000001",
  messageId: "00000000-0000-4000-8000-000000000002",
  name: "launch.mp4",
  mime: "video/mp4",
  sizeBytes: 1536,
  createdAt: "2026-10-24T14:00:00.000Z",
  senderDisplayName: "Seth",
  senderRole: "brand",
  kind: "video",
  durationMs: 65_000,
  width: 1920,
  height: 1080,
  thumbState: "ready",
};

describe("#3988 brand-group media response parsing", () => {
  it("accepts the exact versioned page contract", () => {
    expect(parseBrandGroupMediaPage({
      schemaVersion: 1,
      totals: { media: 1, files: 0 },
      rows: [row],
      nextCursor: { createdAt: row.createdAt, id: row.fileId },
    })).toMatchObject({ rows: [row], totals: { media: 1, files: 0 } });
  });

  it("normalizes the legitimate #3720 Brand-upload null sender role", () => {
    const page = parseBrandGroupMediaPage({
      schemaVersion: 1,
      totals: { media: 1, files: 0 },
      rows: [{ ...row, senderRole: null }],
      nextCursor: null,
    });
    expect(page.rows[0]).toMatchObject({ fileId: row.fileId, senderRole: "brand" });
  });

  it.each([
    { ...row, unexpected: true },
    { ...row, width: 0 },
    { ...row, durationMs: -1 },
    { ...row, thumbState: "failed" },
  ])("rejects malformed rows instead of guessing (%#)", (malformed) => {
    expect(() => parseBrandGroupMediaPage({ schemaVersion: 1, totals: { media: 1, files: 0 }, rows: [malformed], nextCursor: null })).toThrow("brand_group_media_malformed");
  });

  it("rejects schema drift at every envelope level", () => {
    expect(() => parseBrandGroupMediaPage({ schemaVersion: 2, totals: { media: 1, files: 0 }, rows: [row], nextCursor: null })).toThrow();
    expect(() => parseBrandGroupMediaPage({ schemaVersion: 1, totals: { media: 1, files: 0, all: 1 }, rows: [row], nextCursor: null })).toThrow();
    expect(() => parseBrandGroupMediaPage({ schemaVersion: 1, totals: { media: -1, files: 0 }, rows: [row], nextCursor: null })).toThrow();
  });

  it("parses the exact RLS-authorized metadata RPC shape", () => {
    expect(parseBrandGroupFileMetaRows([{
      file_id: row.fileId,
      kind: "video",
      duration_ms: 65_000,
      width: 1920,
      height: 1080,
      thumb_state: "ready",
    }])[0]).toMatchObject({ fileId: row.fileId, kind: "video", durationMs: 65_000, thumbState: "ready" });
    expect(() => parseBrandGroupFileMetaRows([{ file_id: row.fileId, kind: "video" }])).toThrow("brand_group_media_malformed");
  });
});
