/*
 * #4572 item 12 (D12) — the same file uploaded again reuses the photo already
 * there: the new UPLOADING row is tombstoned, its quarantine copy deleted,
 * and the existing item returned. Another tenant's identical file, or a
 * different declared type, is never reused (the query is scoped by both).
 * FAILS-ON-REVERT: without existingReadyCopy every repeat upload is a copy.
 */
import { describe, expect, it, vi } from "vitest";

const deleteObject = vi.fn(async () => undefined);
vi.mock("./objectStore", () => ({ deleteObject, readObject: vi.fn(), writeObject: vi.fn(), objectExists: vi.fn() }));
vi.mock("./config", () => ({ cmsConfig: () => ({ quarantineBucket: "q" }) }));

const { existingReadyCopy } = await import("./mediaPipeline");
const SUM = "a".repeat(64);

function req(found: Record<string, unknown>[]) {
  const find = vi.fn(async () => ({ docs: found }));
  const update = vi.fn(async () => ({}));
  return { r: { payload: { find, update } } as never, find, update };
}

describe("#4572 D12 — repeat uploads reuse the existing photo", () => {
  it("same tenant, type and checksum: returns the existing item and tombstones the new row", async () => {
    const { r, find, update } = req([{ id: "old", state: "READY" }]);
    const result = await existingReadyCopy(r, { id: "new", tenant: "t1", declared_mime: "image/jpeg", quarantine_key: "quarantine/new" }, SUM);
    expect(result).toMatchObject({ id: "old" });
    const where = (find.mock.calls[0] as unknown as [{ where: { and: Record<string, unknown>[] } }])[0].where.and;
    expect(where).toEqual(expect.arrayContaining([
      { tenant: { equals: "t1" } }, { state: { equals: "READY" } }, { declared_mime: { equals: "image/jpeg" } }, { checksum: { equals: SUM } }, { id: { not_equals: "new" } },
    ]));
    expect(deleteObject).toHaveBeenCalledWith("q", "quarantine/new");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: "new", data: expect.objectContaining({ state: "TOMBSTONED", quarantine_key: null }) }));
  });

  it("nothing matching (another tenant's file, another type): no reuse, nothing tombstoned", async () => {
    const { r, update } = req([]);
    expect(await existingReadyCopy(r, { id: "new", tenant: { id: "t2" }, declared_mime: "video/mp4", quarantine_key: "k" }, SUM)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("a row without a tenant is never matched", async () => {
    const { r, find } = req([{ id: "old" }]);
    expect(await existingReadyCopy(r, { id: "new", tenant: null, declared_mime: "image/jpeg" }, SUM)).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });
});
