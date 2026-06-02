// ORCH-1044 [Thumbnail generation must fit the edge compute budget + reliably
// drain] — TESTER adversarial regression suite.
//
// Attacks a DIFFERENT angle than the implementor's T-01. T-01 trips the CPU wall
// guard BETWEEN places (place-1 fully drained, place-2/3 never started) and
// asserts the batch is flagged partial. It never exercises a guard trip INSIDE a
// single multi-photo place, nor the RESUME leg, nor a double-upload check.
//
// This suite proves:
//   TA-01  Guard trips MID-PLACE (place has more photos than one guard-window
//          completes) → that place is left correctly UN-finalized
//          (thumbs_backfilled_at NOT written, succeeded=0, failed=0), partial=true.
//   TA-02  A later invocation RESUMES the same batch cleanly: the photo already
//          uploaded in round 1 is HEAD-skipped (present, NOT re-uploaded → no
//          double-upload), the remaining photos are written, the place is then
//          fully drained → thumbs_backfilled_at set, partial=false.
//   TA-03  Boundary: the guard uses `>=` so a place whose wall lands EXACTLY on
//          CPU_WALL_GUARD_MS trips (the job at the boundary does NOT start),
//          confirming the guard never lets an over-budget job begin.
//
// Migration-side adversarial angle (fresh-running batch is NOT reclaimed) is
// covered live against prod in the QA report (the predicate left 0 fresh batches
// and 2 non-thumb Photos-run batches untouched) and statically by the
// implementor's T-02 contract test; this file owns the edge-fn resume angle.

import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { processBatch } from "./index.ts";

async function makeJpegBytes(): Promise<Uint8Array> {
  const img = new Image(10, 10);
  img.fill(0xff_22_88_44);
  return await img.encodeJPEG(80);
}

function bodyFrom(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// A place_pool-only db that (a) serves a configured place row UNTIL its
// thumbs_backfilled_at is set, then serves null (mirrors the production
// `.is('thumbs_backfilled_at', null)` filter — a finalized place drops out of
// the batch on the resume leg), and (b) records every storage upload path so we
// can assert NO photo is uploaded twice across rounds.
function makeResumableDb(places: Record<string, string[]>) {
  const finalized = new Set<string>();
  const updatedPlaceIds: string[] = [];
  const uploadedPaths: string[] = [];
  const db = {
    storage: {
      from() {
        return {
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/place-photos/${path}` } };
          },
          upload(path: string) {
            uploadedPaths.push(path);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
    from(table: string) {
      if (table !== "place_pool") throw new Error(`unexpected table ${table}`);
      const b: Record<string, unknown> = {};
      let selectedId: string | null = null;
      let isUpdate = false;
      b.select = () => b;
      b.is = () => b;
      b.update = () => { isUpdate = true; return b; };
      b.eq = (_col: string, val: string) => {
        if (isUpdate) {
          finalized.add(val);
          updatedPlaceIds.push(val);
          return Promise.resolve({ error: null });
        }
        selectedId = val;
        return b;
      };
      b.maybeSingle = () => {
        // A finalized place no longer matches `thumbs_backfilled_at IS NULL`.
        if (!selectedId || finalized.has(selectedId)) {
          return Promise.resolve({ data: null, error: null });
        }
        const urls = places[selectedId];
        if (!urls) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: { id: selectedId, stored_photo_urls: urls }, error: null });
      };
      return b;
    },
  };
  return { db, updatedPlaceIds, uploadedPaths };
}

// Real storage HEAD/GET fetch backed by a mutable "already-written thumbs" set:
// once a thumb path has been uploaded, its HEAD returns 200 (present) so the
// resume leg HEAD-skips it instead of re-fetching + re-encoding + re-uploading.
function installFetch(writtenThumbStems: Set<string>, jpeg: Uint8Array) {
  const headPaths: string[] = [];
  const getPaths: string[] = [];
  const prior = globalThis.fetch;
  globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "HEAD") {
      headPaths.push(url);
      const present = [...writtenThumbStems].some((stem) => url.includes(stem));
      return Promise.resolve(new Response(null, { status: present ? 200 : 404 }));
    }
    getPaths.push(url);
    return Promise.resolve(new Response(bodyFrom(jpeg), { status: 200, headers: { "content-type": "image/jpeg" } }));
  };
  return { headPaths, getPaths, restore: () => { globalThis.fetch = prior; } };
}

Deno.test("TA-01 guard trips MID-PLACE: a 3-photo place is left un-finalized (no thumbs_backfilled_at), partial=true", async () => {
  const jpeg = await makeJpegBytes();
  const written = new Set<string>(); // nothing written yet
  const f = installFetch(written, jpeg);
  // When runPhotoJob writes a thumb (upload), reflect it so a later HEAD is 200.
  try {
    const { db, updatedPlaceIds, uploadedPaths } = makeResumableDb({
      "place-big": [
        "https://x.supabase.co/storage/v1/object/public/place-photos/pb/0.jpg",
        "https://x.supabase.co/storage/v1/object/public/place-photos/pb/1.jpg",
        "https://x.supabase.co/storage/v1/object/public/place-photos/pb/2.jpg",
      ],
    });

    // Clock: call1=batchStart(0); call2=guard check photo0 (0 < 1200 → runs);
    // call3=guard check photo1 (1200 >= 1200 → TRIP, photos 1 & 2 left undone);
    // call4=console.log read.
    const clock = [0, 0, 1200, 1200];
    let i = 0;
    const nowMs = () => clock[Math.min(i++, clock.length - 1)];

    const result = await processBatch(db as unknown as Record<string, never>, ["place-big"], { nowMs });

    assertEquals(result.partial, true, "mid-place guard trip must flag the batch partial");
    // The place is NOT finalized — all-or-nothing preserved while photos remain.
    assertEquals(updatedPlaceIds, [], "place-big must NOT get thumbs_backfilled_at while photos remain undone");
    assertEquals(result.succeeded, 0, "an incompletely-drained place is neither succeeded…");
    assertEquals(result.failed, 0, "…nor failed");
    // Exactly ONE photo was uploaded this round (photo 0); photos 1 & 2 never ran.
    assertEquals(uploadedPaths, ["pb/0_thumb.jpg"], "only photo 0 uploaded before the guard tripped");
    // Only photo 0's HEAD fired; the guard stopped before photo 1's HEAD.
    assertEquals(f.headPaths.length, 1, "guard stopped before photo 1's HEAD");
    assert(f.headPaths[0].includes("pb/0_thumb.jpg"), "the one HEAD was photo 0's thumb");
  } finally {
    f.restore();
  }
});

Deno.test("TA-02 resume leg: round-1 photo is HEAD-skipped (no double-upload), rest written, place finalized, partial=false", async () => {
  const jpeg = await makeJpegBytes();
  const { db, updatedPlaceIds, uploadedPaths } = makeResumableDb({
    "place-big": [
      "https://x.supabase.co/storage/v1/object/public/place-photos/pb/0.jpg",
      "https://x.supabase.co/storage/v1/object/public/place-photos/pb/1.jpg",
      "https://x.supabase.co/storage/v1/object/public/place-photos/pb/2.jpg",
    ],
  });

  // ── Round 1: guard trips after photo 0 (as in TA-01) ──
  const written = new Set<string>();
  let f = installFetch(written, jpeg);
  // Patch upload to mark the thumb present for the next round's HEAD.
  const baseUpload = (db.storage.from() as { upload: (p: string) => Promise<unknown> }).upload;
  db.storage.from = () => ({
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/place-photos/${path}` } }),
    upload: (path: string) => { uploadedPaths.push(path); written.add(path); return Promise.resolve({ error: null }); },
  });
  void baseUpload;
  try {
    const clock1 = [0, 0, 1200, 1200];
    let i1 = 0;
    const r1 = await processBatch(db as unknown as Record<string, never>, ["place-big"], { nowMs: () => clock1[Math.min(i1++, clock1.length - 1)] });
    assertEquals(r1.partial, true, "round 1 trips mid-place");
    assertEquals(uploadedPaths, ["pb/0_thumb.jpg"], "round 1 uploads only photo 0");
  } finally {
    f.restore();
  }

  // ── Round 2: generous clock, photo 0 now present (HEAD 200) → skipped ──
  f = installFetch(written, jpeg);
  try {
    let t = 0;
    const nowMs = () => { const v = t; t += 50; return v; }; // well under 1200 for 3 checks
    const r2 = await processBatch(db as unknown as Record<string, never>, ["place-big"], { nowMs });

    assertEquals(r2.partial, false, "round 2 fully drains the place");
    // photo 0 HEAD-skipped → present; photos 1 & 2 written.
    assertEquals(r2.thumbsAlreadyPresent, 1, "photo 0 must be HEAD-skipped as already-present");
    assertEquals(r2.thumbsWritten, 2, "photos 1 & 2 written on resume");
    assertEquals(r2.succeeded, 1, "the place is fully drained → succeeded");
    // CRITICAL no-double-upload: photo 0 must NOT be uploaded a second time.
    assertEquals(uploadedPaths, ["pb/0_thumb.jpg", "pb/1_thumb.jpg", "pb/2_thumb.jpg"], "photo 0 uploaded exactly once across both rounds");
    assertEquals(updatedPlaceIds, ["place-big"], "place finalized exactly once on the resume leg");
  } finally {
    f.restore();
  }
});

Deno.test("TA-03 boundary: a job whose wall lands EXACTLY on CPU_WALL_GUARD_MS does NOT start (>= guard)", async () => {
  const jpeg = await makeJpegBytes();
  const written = new Set<string>();
  const f = installFetch(written, jpeg);
  try {
    const { db, updatedPlaceIds, uploadedPaths } = makeResumableDb({
      "place-edge": [
        "https://x.supabase.co/storage/v1/object/public/place-photos/pe/0.jpg",
        "https://x.supabase.co/storage/v1/object/public/place-photos/pe/1.jpg",
      ],
    });
    // call1=batchStart(0); call2=guard check photo0 → exactly 1200 (>= → TRIP
    // immediately; even photo 0 must NOT start). call3=console.log read.
    const clock = [0, 1200, 1200];
    let i = 0;
    const nowMs = () => clock[Math.min(i++, clock.length - 1)];

    const result = await processBatch(db as unknown as Record<string, never>, ["place-edge"], { nowMs });

    assertEquals(result.partial, true, "an exactly-at-boundary wall must trip the guard");
    assertEquals(uploadedPaths, [], "no photo job may start at >= CPU_WALL_GUARD_MS");
    assertEquals(f.headPaths.length, 0, "not even the first HEAD fires at the boundary");
    assertEquals(updatedPlaceIds, [], "nothing finalized");
  } finally {
    f.restore();
  }
});
