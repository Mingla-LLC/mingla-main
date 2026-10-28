/*
 * #2829 W11 — listObjects (ListObjectsV2) for the rendition retention sweep:
 * a signed GET with the query in the canonical request, every page followed,
 * and any error or unreadable answer refused (so a sweep never acts on a
 * partial list).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  cmsConfig: () => ({
    storageEndpoint: "https://storage.example.invalid/storage/v1/s3",
    storageRegion: "local",
    storageAccessKeyId: "AKIDEXAMPLE",
    storageSecretAccessKey: "secret",
  }),
}));

import { listObjects } from "./objectStore";

const page = (keys: string[], next: string | null) => `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name>
${keys.map((key) => `<Contents><Key>${key}</Key><LastModified>2026-10-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>`).join("")}
<IsTruncated>${next ? "true" : "false"}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}</ListBucketResult>`;

let calls: Array<{ url: string; headers: Record<string, string> }> = [];
let answers: Array<Response> = [];

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal("fetch", async (url: URL, init: { headers: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init.headers });
    return answers.shift() ?? new Response("", { status: 500 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("#2829 W11 listObjects", () => {
  it("signs the query and follows every page", async () => {
    answers = [new Response(page(["approved/s/a.webp", "approved/s/b&amp;c.webp"], "tok+1/=")), new Response(page(["approved/s/z.webp"], null))];
    const listed = await listObjects("approved-bucket", "approved/s/");
    expect(listed.map((object) => object.key)).toEqual(["approved/s/a.webp", "approved/s/b&c.webp", "approved/s/z.webp"]);
    expect(listed[0]!.lastModified).toBe("2026-10-01T00:00:00.000Z");
    expect(calls[0]!.url).toBe("https://storage.example.invalid/storage/v1/s3/approved-bucket/?list-type=2&max-keys=1000&prefix=approved%2Fs%2F");
    expect(calls[1]!.url).toContain("continuation-token=tok%2B1%2F%3D");
    expect(calls[0]!.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/local\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });

  it("refuses an error, an answer that isn't a listing, and a truncated page without a token", async () => {
    answers = [new Response("denied", { status: 403 })];
    await expect(listObjects("b", "p/")).rejects.toThrow("STORAGE_UNAVAILABLE");
    answers = [new Response("<Error><Code>NoSuchBucket</Code></Error>")];
    await expect(listObjects("b", "p/")).rejects.toThrow("STORAGE_UNAVAILABLE");
    answers = [new Response(page(["p/a"], null).replace("<IsTruncated>false", "<IsTruncated>true"))];
    await expect(listObjects("b", "p/")).rejects.toThrow("STORAGE_UNAVAILABLE");
  });

  it("refuses rather than return a partial list when there are more pages than allowed", async () => {
    answers = [new Response(page(["p/a"], "t1")), new Response(page(["p/b"], "t2"))];
    await expect(listObjects("b", "p/", 2)).rejects.toThrow("STORAGE_UNAVAILABLE");
  });
});
