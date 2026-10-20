// MINGLA-INVARIANT: I-3697-SNAP-IMAGE-PREPARED-BEFORE-CREATE | issue #3697 | a Snapchat image plan gets a READY ad_creative_platform_refs row (snapchat, lane, account, external_kind image, content_hash, Snap media id) from admin-ad-creative-prepare before the paused create; platforms that use the hosted image refuse image preparation
/**
 * Issue #3697 — a Mingla Snapchat campaign with an IMAGE creative could not be
 * created: admin-ad-create-campaign requires a READY snapchat platform ref,
 * and admin-ad-creative-prepare refused every non-video creative, so nothing
 * ever uploaded the image to Snap.
 *
 * FAILS ON REVERT: restore the `creative.kind !== "video"` refusal in
 * admin-ad-creative-prepare (or delete adCreativeImagePrepare.ts) and the
 * structural test plus every outcome test below fail.
 *
 * No live provider call: every fetch is an in-test fake.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import type { AdConnectionRow, Lane, Platform } from "../adChannel.ts";
import type {
  AcquireRefLockRow,
  AdCreativeRow,
  CreativeRefDb,
  CreativeRefRow,
  CreativeUploadedRef,
} from "../adCreative.ts";
import { sha256Hex } from "../adCreativeProbe.ts";
import {
  IMAGE_PREPARATION_PLATFORMS,
  isImagePreparationPlatform,
  prepareCreativeImageRef,
} from "../adCreativeImagePrepare.ts";

const CREATIVE_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "snap-acct-1";
const MASTER_URL = "https://cdn.example.com/femzy.jpg";
const VARIANT_URL = "https://cdn.example.com/femzy-9x16.jpg";
const MASTER_BYTES = new TextEncoder().encode("femzy-master-jpeg-bytes");
const VARIANT_BYTES = new TextEncoder().encode("femzy-variant-9x16-bytes");
const NO_SLEEP = () => Promise.resolve();

async function imageCreative(
  patch: Partial<AdCreativeRow> = {},
): Promise<AdCreativeRow> {
  return {
    id: CREATIVE_ID,
    kind: "image",
    name: "femzy",
    source_url: MASTER_URL,
    storage_bucket: null,
    storage_path: null,
    bunny_video_id: null,
    poster_url: null,
    mp4_master_url: null,
    place_id: null,
    brand_id: null,
    width: 1080,
    height: 1920,
    aspect_ratio: 0.5625,
    duration_seconds: null,
    mime_type: "image/jpeg",
    byte_size: MASTER_BYTES.byteLength,
    has_audio: null,
    content_hash: await sha256Hex(MASTER_BYTES),
    ai_generated: false,
    variants: {},
    status: "active",
    ...patch,
  };
}

function connection(platform: Platform = "snapchat"): AdConnectionRow {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    platform,
    lane: "consumer",
    external_account_id: ACCOUNT,
    connected: true,
    status: "connected",
    token_env_var: "SNAPCHAT_REFRESH_TOKEN",
    extra: {},
  } as unknown as AdConnectionRow;
}

/** In-memory ref store with the real resolver's lock semantics. */
function memoryDb(seed: CreativeRefRow[] = []) {
  const rows = new Map<string, CreativeRefRow>();
  const key = (c: string, p: Platform, l: Lane, a: string) => `${c}|${p}|${l}|${a}`;
  for (const row of seed) {
    rows.set(key(row.creative_id, row.platform, row.lane, row.external_account_id), row);
  }
  let seq = 0;
  const db: CreativeRefDb = {
    getConnection: () => Promise.reject(new Error("prepare must pass the plan connection")),
    getCreative: () => Promise.reject(new Error("prepare must pass the gated creative")),
    getRef: (c, p, l, a) => Promise.resolve(rows.get(key(c, p, l, a)) ?? null),
    tryAcquireRefLock: (row: AcquireRefLockRow) => {
      const k = key(row.creative_id, row.platform, row.lane, row.external_account_id);
      const current = rows.get(k);
      if (
        current && current.status === "uploading"
      ) return Promise.resolve(false);
      if (current && current.status === "ready" && current.content_hash === row.content_hash) {
        return Promise.resolve(false);
      }
      rows.set(k, {
        id: current?.id ?? `ref-${++seq}`,
        external_ref: null,
        external_ref_extra: {},
        error: null,
        uploaded_at: null,
        updated_at: new Date().toISOString(),
        ...current,
        ...row,
        status: "uploading",
      } as CreativeRefRow);
      return Promise.resolve(true);
    },
    upsertRefUploading: () => Promise.reject(new Error("legacy path must not run")),
    markRefReady: (c, p, l, a, ref: CreativeUploadedRef, hash) => {
      const k = key(c, p, l, a);
      rows.set(k, {
        ...rows.get(k)!,
        status: "ready",
        external_ref: ref.external_ref,
        external_ref_extra: ref.external_ref_extra,
        external_kind: ref.external_kind,
        external_account_id: ref.external_account_id,
        content_hash: hash,
        error: null,
      });
      return Promise.resolve();
    },
    markRefFailed: (c, p, l, a, error) => {
      const k = key(c, p, l, a);
      rows.set(k, { ...rows.get(k)!, status: "failed", error });
      return Promise.resolve();
    },
  };
  return { db, rows };
}

function snapFetch(opts: { failUpload?: boolean } = {}) {
  const calls: string[] = [];
  const uploadedBodies: Uint8Array[] = [];
  const fetchImpl = (async (input: URL | Request | string, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === MASTER_URL) return new Response(MASTER_BYTES, { status: 200 });
    if (url === VARIANT_URL) return new Response(VARIANT_BYTES, { status: 200 });
    if (url.includes("accounts.snapchat.com")) {
      return new Response(JSON.stringify({ access_token: "minted-Bearer-AAAAAAAAAAAAAAAA" }), { status: 200 });
    }
    if (url.endsWith(`/adaccounts/${ACCOUNT}/media`)) {
      const body = JSON.parse(String(init?.body));
      assertEquals(body.media[0].type, "IMAGE");
      return new Response(JSON.stringify({
        request_status: "SUCCESS",
        media: [{ sub_request_status: "SUCCESS", media: { id: "snap-media-42", media_status: "PENDING_UPLOAD" } }],
      }), { status: 200 });
    }
    if (url.endsWith("/media/snap-media-42/upload")) {
      if (opts.failUpload) {
        return new Response(JSON.stringify({ request_status: "ERROR", debug_message: "Bearer minted-Bearer-AAAAAAAAAAAAAAAA bad" }), { status: 400 });
      }
      assert(init?.body instanceof FormData, "Snap upload is multipart");
      const file = (init.body as FormData).get("file") as Blob;
      uploadedBodies.push(new Uint8Array(await file.arrayBuffer()));
      return new Response(JSON.stringify({ request_status: "SUCCESS" }), { status: 200 });
    }
    if (url.endsWith("/media/snap-media-42")) {
      return new Response(JSON.stringify({
        request_status: "SUCCESS",
        media: [{ sub_request_status: "SUCCESS", media: { id: "snap-media-42", media_status: "READY" } }],
      }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls, uploadedBodies };
}

function withSnapEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const names = ["SNAPCHAT_REFRESH_TOKEN", "SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET"];
    const prior = names.map((n) => [n, Deno.env.get(n)] as const);
    Deno.env.set("SNAPCHAT_REFRESH_TOKEN", "refresh-tok-XYZXYZXYZXYZ");
    Deno.env.set("SNAPCHAT_CLIENT_ID", "client-id-1");
    Deno.env.set("SNAPCHAT_CLIENT_SECRET", "client-secret-SSSSSSSSSSSS");
    try {
      await fn();
    } finally {
      for (const [name, value] of prior) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  };
}

Deno.test("#3697 only Snapchat prepares an image; Meta/Reddit/TikTok/Google use their create-time path", () => {
  assertEquals([...IMAGE_PREPARATION_PLATFORMS], ["snapchat"]);
  assert(isImagePreparationPlatform("snapchat"));
  for (const platform of ["meta", "reddit", "tiktok", "google", "snap"]) {
    assertEquals(isImagePreparationPlatform(platform), false, platform);
  }
});

Deno.test(
  "#3697 Snapchat image start uploads once and writes the READY snapchat ref create looks up",
  withSnapEnv(async () => {
    const creative = await imageCreative();
    const { db, rows } = memoryDb();
    const fake = snapFetch();
    const outcome = await prepareCreativeImageRef(db, {
      action: "start",
      creative,
      connection: connection(),
      platform: "snapchat",
      lane: "consumer",
    }, { fetchImpl: fake.fetchImpl, sleep: NO_SLEEP });
    assertEquals(outcome.kind, "ready");
    const [ref] = [...rows.values()];
    // Exactly the filter admin-ad-create-campaign uses for the Snap image ref.
    assertEquals(ref.platform, "snapchat");
    assertEquals(ref.lane, "consumer");
    assertEquals(ref.external_account_id, ACCOUNT);
    assertEquals(ref.external_kind, "image");
    assertEquals(ref.content_hash, creative.content_hash);
    assertEquals(ref.status, "ready");
    assertEquals(ref.external_ref, "snap-media-42");
    assertEquals(fake.uploadedBodies.length, 1);
    assertEquals(fake.uploadedBodies[0], MASTER_BYTES);
    assertEquals(fake.calls.filter((c) => c === `GET ${MASTER_URL}`).length, 1, "the image is fetched once");

    // Resume (status first, then start) reuses the READY ref with no provider call.
    const again = snapFetch();
    for (const action of ["status", "start"] as const) {
      const cached = await prepareCreativeImageRef(db, {
        action,
        creative,
        connection: connection(),
        platform: "snapchat",
        lane: "consumer",
      }, { fetchImpl: again.fetchImpl, sleep: NO_SLEEP });
      assertEquals(cached.kind, "ready");
      assert(cached.kind === "ready" && cached.cached);
    }
    assertEquals(again.calls, []);
  }),
);

Deno.test("#3697 status with no ref says not_started so the client starts it", async () => {
  const { db } = memoryDb();
  const fake = snapFetch();
  const outcome = await prepareCreativeImageRef(db, {
    action: "status",
    creative: await imageCreative(),
    connection: connection(),
    platform: "snapchat",
    lane: "consumer",
  }, { fetchImpl: fake.fetchImpl });
  assertEquals(outcome.kind, "not_started");
  assertEquals(fake.calls, []);
});

Deno.test("#3697 an image is refused on a platform that uses the hosted image, before any I/O", async () => {
  for (const platform of ["meta", "reddit", "tiktok"] as Platform[]) {
    const { db, rows } = memoryDb();
    const fake = snapFetch();
    const outcome = await prepareCreativeImageRef(db, {
      action: "start",
      creative: await imageCreative(),
      connection: connection(platform),
      platform,
      lane: "consumer",
    }, { fetchImpl: fake.fetchImpl });
    assertEquals(outcome.kind, "failed");
    assert(outcome.kind === "failed");
    assertEquals(outcome.code, "image_preparation_not_supported");
    assertEquals(outcome.httpStatus, 422);
    assertEquals(fake.calls, []);
    assertEquals(rows.size, 0);
  }
});

Deno.test("#3697 changed image bytes are refused before any Snap call", async () => {
  const { db, rows } = memoryDb();
  const fake = snapFetch();
  const outcome = await prepareCreativeImageRef(db, {
    action: "start",
    creative: await imageCreative({ content_hash: "f".repeat(64) }),
    connection: connection(),
    platform: "snapchat",
    lane: "consumer",
  }, { fetchImpl: fake.fetchImpl });
  assert(outcome.kind === "failed");
  assertEquals(outcome.code, "creative_identity_changed");
  assertEquals(fake.calls, [`GET ${MASTER_URL}`]);
  assertEquals(rows.size, 0);
});

Deno.test(
  "#3697 a non-9:16 master with a 9:16 variant sends the variant, keyed on the master hash",
  withSnapEnv(async () => {
    const creative = await imageCreative({
      width: 1080,
      height: 1080,
      aspect_ratio: 1,
      variants: {
        "9:16": {
          source_url: VARIANT_URL,
          width: 1080,
          height: 1920,
          content_hash: await sha256Hex(VARIANT_BYTES),
        },
      },
    });
    const { db, rows } = memoryDb();
    const fake = snapFetch();
    const outcome = await prepareCreativeImageRef(db, {
      action: "start",
      creative,
      connection: connection(),
      platform: "snapchat",
      lane: "consumer",
    }, { fetchImpl: fake.fetchImpl, sleep: NO_SLEEP });
    assertEquals(outcome.kind, "ready");
    assertEquals(fake.uploadedBodies[0], VARIANT_BYTES);
    assertEquals([...rows.values()][0].content_hash, creative.content_hash);
  }),
);

Deno.test(
  "#3697 a Snap upload failure records a failed, retryable ref with scrubbed text; retry then succeeds",
  withSnapEnv(async () => {
    const creative = await imageCreative();
    const { db, rows } = memoryDb();
    const logs: string[] = [];
    const outcome = await prepareCreativeImageRef(db, {
      action: "start",
      creative,
      connection: connection(),
      platform: "snapchat",
      lane: "consumer",
    }, { fetchImpl: snapFetch({ failUpload: true }).fetchImpl, sleep: NO_SLEEP, log: (m) => logs.push(m) });
    assert(outcome.kind === "failed");
    assertEquals(outcome.code, "provider_image_upload_failed");
    assertEquals(outcome.httpStatus, 502);
    assertEquals(outcome.retryable, true);
    const [ref] = [...rows.values()];
    assertEquals(ref.status, "failed");
    assert(!String(ref.error).includes("minted-Bearer-AAAA"), "no token in the stored error");
    assert(!logs.join("\n").includes("minted-Bearer-AAAA"), "no token in the log");

    const status = await prepareCreativeImageRef(db, {
      action: "status",
      creative,
      connection: connection(),
      platform: "snapchat",
      lane: "consumer",
    });
    assert(status.kind === "failed" && status.cached && status.retryable);

    const retried = await prepareCreativeImageRef(db, {
      action: "retry",
      creative,
      connection: connection(),
      platform: "snapchat",
      lane: "consumer",
    }, { fetchImpl: snapFetch().fetchImpl, sleep: NO_SLEEP });
    assertEquals(retried.kind, "ready");
    assertEquals([...rows.values()][0].external_ref, "snap-media-42");
  }),
);

Deno.test("#3697 a fresh upload lock is reported in progress without a second upload", async () => {
  const creative = await imageCreative();
  const { db } = memoryDb([{
    id: "ref-locked",
    creative_id: CREATIVE_ID,
    platform: "snapchat",
    lane: "consumer",
    external_account_id: ACCOUNT,
    external_kind: "image",
    external_ref: null,
    external_ref_extra: {},
    content_hash: creative.content_hash,
    status: "uploading",
    error: null,
    uploaded_at: null,
    updated_at: new Date().toISOString(),
  }]);
  const fake = snapFetch();
  const outcome = await prepareCreativeImageRef(db, {
    action: "start",
    creative,
    connection: connection(),
    platform: "snapchat",
    lane: "consumer",
  }, { fetchImpl: fake.fetchImpl });
  assert(outcome.kind === "in_progress" && !outcome.stale);
  assertEquals(fake.calls, []);
});

Deno.test("#3697 the prepare endpoint accepts Snapchat images behind every existing gate", async () => {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  // The old blanket refusal of every non-video creative is gone.
  assert(!/\|\|\s*creative\.kind !== "video"\s*\)/.test(src), "images must not be refused outright");
  assertStringIncludes(src, "isImagePreparationPlatform(platform)");
  assertStringIncludes(src, 'error: "image_preparation_not_supported"');
  assertStringIncludes(src, "prepareCreativeImageRef(");
  assertStringIncludes(src, 'platform === "snapchat" && creative.kind === "video" &&');
  // Order: auth/binding → launchable → connection → ownership → fit → image branch → video begin.
  const order = [
    "creativePreparationBindingError({",
    '"ad_plan_assert_launchable"',
    '.from("ad_connections")',
    "adCreativeOwnershipError({",
    "creativeFitGateFailure(",
    "prepareCreativeImageRef(",
    '"ad_creative_prepare_begin"',
  ].map((needle) => src.indexOf(needle));
  for (let i = 1; i < order.length; i++) {
    assert(order[i - 1] >= 0 && order[i] > order[i - 1], `gate order broken at step ${i}`);
  }
});
