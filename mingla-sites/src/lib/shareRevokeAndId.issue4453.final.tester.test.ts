/*
 * #4453 final pass — tester adversarial (angles the implementor's tests do not take).
 *
 * Share-asset lookups (P3-1): the implementor proves "revoked -> 404 on the next request" through the
 * route. Here the loader itself is attacked: concurrent requests may share ONE in-flight Core lookup,
 * but nothing survives its settling (no time hold), a failed lookup is never remembered, and the
 * link's own expiry is still checked for a request that joined a shared lookup.
 *
 * Share id (P4-1): the share view's id is a one-way digest — distinct previews never collide, the
 * digest is keyed (not a bare sha256 of the preview id), and the client-reachable module no longer
 * exports the derivation or imports node:crypto.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { clearSharedAssetCache, sharedArtifactForAsset } from "./previewMedia";
import * as previewPublication from "./previewPublication";
import { sharedViewPublicationId } from "./sharedView";
import type { SiteArtifact } from "./siteArtifact";

const TOKEN = "T".repeat(20) + "_-" + "k".repeat(21);
const HOST = "brand-a.sites.usemingla.com";
const NOW = Date.parse("2026-11-17T12:00:00Z");
const artifact = (id: string) => ({ publication_id: id, media: [] }) as unknown as SiteArtifact;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("#4453 final — share-asset lookups hold nothing once Core has answered", () => {
  beforeEach(() => clearSharedAssetCache());

  it("concurrent requests share one in-flight lookup, and the next request after it settles asks Core again", async () => {
    let calls = 0;
    const gate = deferred<{ artifact: SiteArtifact; expiresAt: string | null }>();
    const load = async () => { calls += 1; return gate.promise; };
    const a = sharedArtifactForAsset(TOKEN, HOST, NOW, load as never);
    const b = sharedArtifactForAsset(TOKEN, HOST, NOW, load as never);
    gate.resolve({ artifact: artifact(`preview-${"a".repeat(32)}`), expiresAt: null });
    await Promise.all([a, b]);
    expect(calls).toBe(1);
    // Revoked between requests: Core now refuses, and the very next request must see that.
    const revoked = async () => { calls += 1; throw new Error("NOT_FOUND"); };
    await expect(sharedArtifactForAsset(TOKEN, HOST, NOW + 1, revoked as never)).rejects.toThrow("NOT_FOUND");
    expect(calls).toBe(2);
  });

  it("a failed lookup is never remembered: the next request asks again and can succeed", async () => {
    let calls = 0;
    const failing = async () => { calls += 1; throw new Error("CORE_DOWN"); };
    await expect(sharedArtifactForAsset(TOKEN, HOST, NOW, failing as never)).rejects.toThrow();
    const ok = async () => { calls += 1; return { artifact: artifact(`preview-${"b".repeat(32)}`), expiresAt: null }; };
    await expect(sharedArtifactForAsset(TOKEN, HOST, NOW, ok as never)).resolves.toBeTruthy();
    expect(calls).toBe(2);
  });

  it("a request that joins a shared lookup still checks the link's expiry at its own time", async () => {
    const gate = deferred<{ artifact: SiteArtifact; expiresAt: string | null }>();
    const load = async () => gate.promise;
    const expiresAt = new Date(NOW + 1000).toISOString();
    const early = sharedArtifactForAsset(TOKEN, HOST, NOW, load as never);
    const late = sharedArtifactForAsset(TOKEN, HOST, NOW + 5000, load as never);
    gate.resolve({ artifact: artifact(`preview-${"c".repeat(32)}`), expiresAt });
    await expect(early).resolves.toBeTruthy();
    await expect(late).rejects.toThrow("NOT_FOUND");
  });

  it("a malformed token never reaches Core", async () => {
    let calls = 0;
    const load = async () => { calls += 1; return { artifact: artifact("x"), expiresAt: null }; };
    await expect(sharedArtifactForAsset("short", HOST, NOW, load as never)).rejects.toThrow("NOT_FOUND");
    expect(calls).toBe(0);
  });
});

describe("#4453 final — the share view id is a keyed one-way digest", () => {
  it("distinct previews give distinct share ids, and the digest is not a bare sha256 of the preview id", () => {
    const ids = Array.from({ length: 200 }, (_, n) => `preview-${n.toString(16).padStart(32, "0")}`);
    const shared = new Set(ids.map(sharedViewPublicationId));
    expect(shared.size).toBe(ids.length);
    const id = ids[7];
    const bare = createHash("sha256").update(id).digest("hex").slice(0, 32);
    const bareHex = createHash("sha256").update(id.replace(/^preview-/, "")).digest("hex").slice(0, 32);
    expect(sharedViewPublicationId(id).endsWith(bare)).toBe(false);
    expect(sharedViewPublicationId(id).endsWith(bareHex)).toBe(false);
  });

  it("the client-reachable previewPublication module neither exports the derivation nor imports node:crypto", () => {
    expect("sharedViewPublicationId" in previewPublication).toBe(false);
    const source = readFileSync(join(__dirname, "previewPublication.ts"), "utf8");
    expect(source).not.toMatch(/node:crypto|from "crypto"/);
  });
});
