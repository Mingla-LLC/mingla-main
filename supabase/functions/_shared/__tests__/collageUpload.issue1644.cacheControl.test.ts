// Issue #1644 Stage 2 — the collage GENERATOR must write immutable-cacheable objects.
//
// WHY THIS EXISTS
// ---------------
// Stage 2 re-encodes 34,024 stored collages to WebP and writes them with a
// one-year TTL. That fix decays to nothing the moment the intelligence pipeline
// runs again, because `handleComposeCollage` passed NO `cacheControl` at all and
// Supabase Storage therefore defaulted every collage to `max-age=3600` — while
// `place-photos` next door serve `max-age=31536000`. Verified on production
// objects before this change: `cache-control: public, max-age=3600`.
//
// The keys are content fingerprints (`<placeId>/<sha256-of-source-urls>.png`), so
// the bytes at a key can never change and a photo rotation mints a NEW key. These
// objects are genuinely immutable; the short TTL was pure wasted egress on every
// Gemini read and every admin-console render.
//
// This suite drives the REAL `handleComposeCollage` against a fake storage client
// and a local photo server, and asserts the options it actually passes to
// `upload()`. It does not read the source for a substring — issue #1584 records
// what source-substring assertions are worth once the source moves.
//
// It also pins the ORDERING of the Stage 0 storage guardrail relative to the
// fingerprint cache-hit, which nothing previously covered at runtime: an
// idempotent cache hit must stay free (no 214 MiB seq scan of storage.objects),
// and a refusal must happen BEFORE any CPU is burned composing an image we are
// about to decline to store.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

import { COLLAGE_CACHE_CONTROL_SECONDS } from "../imageCollage.ts";
import { resetStorageHeadroomCache } from "../storageHeadroomGuard.ts";
import { handleComposeCollage } from "../../run-place-intelligence-trial/index.ts";

const PLACE_ID = "00038388-9d54-426f-b8e8-d358bef6ef1e";

interface UploadCall {
  path: string;
  bytes: number;
  options: Record<string, unknown>;
}

interface FakeState {
  uploads: UploadCall[];
  poolUpdates: Array<Record<string, unknown>>;
  rpcCalls: string[];
  storageTotalBytes: number;
  place: Record<string, unknown>;
}

/**
 * A supabase-js stand-in covering exactly the surface `handleComposeCollage`
 * touches. Everything chains and every terminal is thenable, which is what lets
 * the real function run unmodified.
 */
// deno-lint-ignore no-explicit-any
function makeFakeDb(state: FakeState): any {
  // deno-lint-ignore no-explicit-any
  const query = (table: string): any => {
    let op: "select" | "update" = "select";
    // deno-lint-ignore no-explicit-any
    const result = (): any => {
      if (table === "place_pool" && op === "select") return { data: state.place, error: null };
      if (table === "place_pool" && op === "update") return { data: null, error: null };
      if (table === "place_external_reviews") return { data: [], error: null };
      return { data: null, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: () => chain,
      update: (patch: Record<string, unknown>) => {
        op = "update";
        if (table === "place_pool") state.poolUpdates.push(patch);
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(result()),
      single: () => Promise.resolve(result()),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return chain;
  };

  return {
    from: query,
    rpc: (fn: string) => {
      state.rpcCalls.push(fn);
      return Promise.resolve({ data: state.storageTotalBytes, error: null });
    },
    storage: {
      from: () => ({
        upload: (path: string, bytes: Uint8Array, options: Record<string, unknown>) => {
          state.uploads.push({ path, bytes: bytes.length, options });
          return Promise.resolve({ data: { path }, error: null });
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/place-collages/${path}` },
        }),
      }),
    },
  };
}

/**
 * Copy bytes into a plain `ArrayBuffer` for `new Response(...)`.
 *
 * imagescript and the WebP encoder hand back `Uint8Array<ArrayBufferLike>`, and
 * lib.dom's `BodyInit` admits neither that nor a `Blob` built from it (the
 * `ArrayBufferLike` union includes `SharedArrayBuffer`). Copying into a freshly
 * constructed `ArrayBuffer` satisfies the type exactly, with no cast and no `any`.
 */
function asResponseBody(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

/** Serve real, decodable photo bytes so `composeCollage` runs for real. */
async function startPhotoServer(): Promise<{ base: string; stop: () => Promise<void> }> {
  const tile = new Image(256, 256);
  tile.fill(0x30_80_c0_ff);
  const png = await tile.encode();

  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    () => new Response(asResponseBody(png), { headers: { "content-type": "image/png" } }),
  );
  const port = (server.addr as Deno.NetAddr).port;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: async () => {
      ac.abort();
      await server.finished;
    },
  };
}

function baseState(base: string, overrides: Partial<FakeState> = {}): FakeState {
  return {
    uploads: [],
    poolUpdates: [],
    rpcCalls: [],
    storageTotalBytes: 10 * 1024 * 1024 * 1024, // 10 GiB — comfortably under the 85 GiB ceiling
    place: {
      id: PLACE_ID,
      // Five photos: the exact shape that produced the 44.444% transparent
      // signature in the stored corpus (3x3 grid, four cells unfilled).
      stored_photo_urls: [1, 2, 3, 4, 5].map((i) => `${base}/photo${i}.png`),
      photo_collage_url: null,
      photo_collage_fingerprint: null,
    },
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────
Deno.test("collage upload carries a one-year cache-control and image/png", async () => {
  resetStorageHeadroomCache();
  const srv = await startPhotoServer();
  try {
    const state = baseState(srv.base);
    const res = await handleComposeCollage(makeFakeDb(state), { place_pool_id: PLACE_ID });
    assertEquals(res.status, 200, await res.clone().text());

    assertEquals(state.uploads.length, 1, "exactly one collage object should be written");
    const up = state.uploads[0];

    assertEquals(
      up.options.cacheControl,
      String(COLLAGE_CACHE_CONTROL_SECONDS),
      "collage keys are content fingerprints — they must be served immutable, not on a 1-hour TTL",
    );
    assertEquals(up.options.cacheControl, "31536000");
    assertEquals(up.options.contentType, "image/png");
    assertEquals(up.options.upsert, true);
    assert(up.bytes > 0, "a zero-byte collage must never be uploaded");

    // The key must stay content-addressed — the long TTL is only safe because of it.
    assert(
      /^[0-9a-f-]{36}\/[0-9a-f]{12}\.png$/.test(up.path),
      `collage key must remain <placeId>/<12-hex fingerprint>.png, got ${up.path}`,
    );
    assertEquals(up.path.split("/")[0], PLACE_ID);

    // And the pool write must be the single-owner write, fingerprint included.
    assertEquals(state.poolUpdates.length, 1);
    assert(typeof state.poolUpdates[0].photo_collage_url === "string");
    assert(typeof state.poolUpdates[0].photo_collage_fingerprint === "string");
  } finally {
    await srv.stop();
  }
});

// ───────────────────────────────────────────────────────────────────────────
Deno.test("the storage guardrail is consulted before composing, and refusing writes nothing", async () => {
  resetStorageHeadroomCache();
  const srv = await startPhotoServer();
  try {
    const state = baseState(srv.base, { storageTotalBytes: 90 * 1024 * 1024 * 1024 }); // over the 85 GiB ceiling
    const res = await handleComposeCollage(makeFakeDb(state), { place_pool_id: PLACE_ID });

    assertEquals(res.status, 507, "an over-ceiling compose must refuse with Insufficient Storage");
    assertEquals(state.uploads.length, 0, "a refused compose must not write an object");
    assertEquals(state.poolUpdates.length, 0, "a refused compose must not move the pool URL");
    assert(
      state.rpcCalls.includes("issue_1644_storage_total_bytes"),
      "the guard must actually measure, not assume",
    );
  } finally {
    await srv.stop();
  }
});

// ───────────────────────────────────────────────────────────────────────────
Deno.test("an idempotent cache hit stays free — no storage measurement, no upload", async () => {
  resetStorageHeadroomCache();
  const srv = await startPhotoServer();
  try {
    // First pass computes the real fingerprint for this photo set.
    const warm = baseState(srv.base);
    await handleComposeCollage(makeFakeDb(warm), { place_pool_id: PLACE_ID });
    const fingerprint = warm.poolUpdates[0].photo_collage_fingerprint as string;
    const url = warm.poolUpdates[0].photo_collage_url as string;

    resetStorageHeadroomCache();
    const cached = baseState(srv.base);
    cached.place.photo_collage_fingerprint = fingerprint;
    cached.place.photo_collage_url = url;

    const res = await handleComposeCollage(makeFakeDb(cached), { place_pool_id: PLACE_ID });
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body.cached, true, "a matching fingerprint must short-circuit");
    assertEquals(cached.uploads.length, 0, "a cache hit must not re-upload");
    assertEquals(
      cached.rpcCalls.length,
      0,
      "a cache hit must not pay for a full seq scan of storage.objects — the guard is " +
        "deliberately placed AFTER the fingerprint check",
    );
  } finally {
    await srv.stop();
  }
});
