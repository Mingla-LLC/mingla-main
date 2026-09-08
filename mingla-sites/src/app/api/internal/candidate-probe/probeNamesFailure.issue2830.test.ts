/*
 * #2830 — a refused publish must name the gate that refused it.
 *
 * The probe ran ten checks and funnelled every one into a single `catch` and a
 * bodyless 422. A publish then failed with no way to tell a corrupt asset from
 * a bad canonical URL from a contract violation, and the only route forward was
 * to guess and re-publish. That is exactly what happened on the Gogi pilot.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const readPrivateObject = vi.fn();
vi.mock("../../../../lib/storageReader", () => ({
  readPrivateObject: (...args: unknown[]) => readPrivateObject(...args),
}));

const { verifyCandidateMedia, ProbeRejection } = await import("./route");

const KEY_A = "approved/site-a/media-a/aa/1440.webp";
const KEY_B = "approved/site-a/media-b/bb/master.mp4";
// sha256 of the single byte 0x01, so the "matching" case is a real hash.
const bytes = new Uint8Array([1]);
const DIGEST_OF_BYTES =
  "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a";

function readable(body: Uint8Array) {
  return { ok: true, arrayBuffer: async () => body.buffer.slice(0) };
}

beforeEach(() => readPrivateObject.mockReset());

describe("#2830 the probe names which media failed", () => {
  it("reports the object it could not read, not just false", async () => {
    readPrivateObject.mockResolvedValueOnce({ ok: false });
    const result = await verifyCandidateMedia(
      [{ object_key: KEY_A, integrity: DIGEST_OF_BYTES }] as never,
      "bucket",
    );
    expect(result).toEqual({
      ok: false,
      object_key: KEY_A,
      reason: "unreadable",
    });
  });

  it("distinguishes a corrupt object from a missing one", async () => {
    readPrivateObject.mockResolvedValueOnce(readable(bytes));
    const result = await verifyCandidateMedia(
      [{ object_key: KEY_B, integrity: "f".repeat(64) }] as never,
      "bucket",
    );
    expect(result).toEqual({
      ok: false,
      object_key: KEY_B,
      reason: "digest_mismatch",
    });
  });

  it("passes when every object reads back at its recorded digest", async () => {
    readPrivateObject.mockResolvedValue(readable(bytes));
    const result = await verifyCandidateMedia(
      [
        { object_key: KEY_A, integrity: DIGEST_OF_BYTES },
        { object_key: KEY_B, integrity: DIGEST_OF_BYTES },
      ] as never,
      "bucket",
    );
    expect(result).toEqual({ ok: true });
    expect(readPrivateObject).toHaveBeenCalledTimes(2);
  });

  it("stops at the first bad object rather than reading the rest", async () => {
    // 36 assets on the pilot; re-reading them all to report one failure is
    // wasted work inside a request that already has a deadline.
    readPrivateObject.mockResolvedValueOnce({ ok: false });
    await verifyCandidateMedia(
      [
        { object_key: KEY_A, integrity: DIGEST_OF_BYTES },
        { object_key: KEY_B, integrity: DIGEST_OF_BYTES },
      ] as never,
      "bucket",
    );
    expect(readPrivateObject).toHaveBeenCalledTimes(1);
  });
});

describe("#2830 ProbeRejection carries the gate name", () => {
  it("keeps the check name and any detail", () => {
    const rejection = new ProbeRejection("artifact_contract", "ARTIFACT_PAGES_MISMATCH");
    expect(rejection.check).toBe("artifact_contract");
    expect(rejection.detail).toBe("ARTIFACT_PAGES_MISMATCH");
    expect(rejection).toBeInstanceOf(Error);
  });

  it("works without detail", () => {
    expect(new ProbeRejection("artifact_unreadable").detail).toBeUndefined();
  });
});

describe("#2830 the handler still fails closed", () => {
  // Read as text so the assertions describe the SHIPPED handler. Comments are
  // stripped first: this file discusses "422" and "failed_check" by name.
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/api/internal/candidate-probe/route.ts"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("still answers 422 on any failure", () => {
    expect(source).toContain("status: 422");
    expect(source).not.toContain("status: 200, ok: false");
  });

  it("still requires every _ok check to pass", () => {
    expect(source).toContain('field.endsWith("_ok") && result !== true');
  });

  it("names the failing check in the body", () => {
    expect(source).toContain("failed_check");
  });
});
