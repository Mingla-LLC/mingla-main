// Issue #3040 — INDEPENDENT TESTER adversarial suite for the guarded destroy
// (the "purge guard" of the shared lane) and the 1080p rendition walk.
// Written by the tester, not the implementor.
//
//   G1  every live-reference kind, alone, refuses the destroy and leaves the
//       row un-reaped (so a later tick asks again).
//   G2  every UNKNOWN answer refuses the destroy: missing RPC (PGRST202 and
//       42883), any other error, a null or non-array answer, a thrown client,
//       and a guid that is not a guid (a LIKE metacharacter never reaches SQL).
//   G3  the asking job is excluded from its own answer (p_exclude_job_id).
//   W1  64 MiB exactly is within budget: 1080p is delivered, not 720p.
//   W2  one byte over 64 MiB falls to 720p, and says so.
//   W3  a 1080p rendition the CDN serves only on the retry is still 1080p
//       (propagation lag never downgrades a video by itself).
//   W4  candidates never exceed 1080p, ignore junk tokens and duplicates.
//
// MINGLA-INVARIANT: I-VIDEO-NO-DESTROY-WHILE-REFERENCED | issue #3040 | a provider asset is destroyed only on a definite empty answer for that exact guid
// MINGLA-INVARIANT: I-VIDEO-LIMITS-PARITY | issue #3040 | the lane delivers the highest served rendition <= 1080p whose bytes are <= 67,108,864
//
// FAILS ON REVERT:
//   G1  `references.kinds.length > 0` check removed in destroyIfUnreferenced
//   G2  `!references.ok` short-circuit removed, or the guid shape check removed
//   G3  p_exclude_job_id no longer passed
//   W1  `bytes > FINAL_MAX_BYTES` loosened/tightened to `>=`
//   W2  the over-budget fallback removed
//   W3  the HEAD retries removed (attempts 3 -> 1)
//   W4  the 1080 ceiling or the `height > 0` filter removed
import { destroyIfUnreferenced } from "../coverVideoReap.ts";
import { bunnyMp4Candidates, type BunnyVideo } from "../bunnyStream.ts";
import { selectDeliverableRendition } from "../../event-cover-video-webhook/index.ts";
import { assert, makeFakeDb, withEnv, withFetch } from "./issue3040_fakeSupabase.ts";

const GUID = "guid-adversarial-3040";
const row = () => ({ id: "job-guard", provider: "bunny", source_asset_id: GUID, reaped_at: null });

const guarded = async (rpcAnswer: () => { data: unknown; error: unknown } | Promise<never>) => {
  const destroyed: string[] = [];
  const db = makeFakeDb({ event_cover_video_jobs: [row()] }, {
    cover_video_guid_live_references: () => rpcAnswer() as { data: unknown; error: unknown },
  });
  const outcome = await destroyIfUnreferenced(db.client, db.tables.event_cover_video_jobs[0] as never, {
    destroyCoverVideoAsset: (r: { source_asset_id?: unknown }) => {
      destroyed.push(String(r.source_asset_id));
      return Promise.resolve({ ok: true as const });
    },
  });
  return { outcome, destroyed, db };
};

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { warn } = console;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
};

Deno.test("G1 #3040 each live-reference kind alone refuses the destroy and leaves the row un-reaped", async () => {
  for (const kind of ["event_cover", "brand_cover", "venue_cover", "trip_day_media", "ad_creative", "active_job"]) {
    const { outcome, destroyed, db } = await quiet(() => guarded(() => ({ data: [kind], error: null })));
    assert(outcome.outcome === "referenced", `${kind}: ${JSON.stringify(outcome)}`);
    assert(destroyed.length === 0, `${kind}: a referenced asset was destroyed`);
    assert(db.tables.event_cover_video_jobs[0].reaped_at == null, `${kind}: a referenced asset was stamped reaped`);
  }
});

Deno.test("G2 #3040 every unknown reference answer refuses the destroy", async () => {
  const answers: Array<[string, () => { data: unknown; error: unknown }]> = [
    ["PGRST202", () => ({ data: null, error: { code: "PGRST202", message: "missing" } })],
    ["42883", () => ({ data: null, error: { code: "42883", message: "undefined function" } })],
    ["timeout", () => ({ data: null, error: { code: "57014", message: "statement timeout" } })],
    ["null data", () => ({ data: null, error: null })],
    ["object data", () => ({ data: { kinds: [] }, error: null })],
    ["string data", () => ({ data: "{}", error: null })],
    ["throws", () => { throw new TypeError("fetch failed"); }],
  ];
  for (const [name, answer] of answers) {
    const { outcome, destroyed } = await quiet(() => guarded(answer));
    assert(outcome.outcome === "unknown", `${name}: ${JSON.stringify(outcome)}`);
    assert(destroyed.length === 0, `${name}: destroyed on an unknown answer`);
  }
  for (const badGuid of ["%", "guid_with_underscore", "abc", "../../etc", "guid 0001 0002"]) {
    const destroyed: string[] = [];
    const db = makeFakeDb({ event_cover_video_jobs: [] }, {
      cover_video_guid_live_references: () => ({ data: [], error: null }),
    });
    const outcome = await quiet(() =>
      destroyIfUnreferenced(db.client, { id: "j", provider: "bunny", source_asset_id: badGuid }, {
        destroyCoverVideoAsset: (r: { source_asset_id?: unknown }) => {
          destroyed.push(String(r.source_asset_id));
          return Promise.resolve({ ok: true as const });
        },
      })
    );
    assert(outcome.outcome === "unknown", `${badGuid}: ${JSON.stringify(outcome)}`);
    assert(destroyed.length === 0, `${badGuid}: a malformed guid was destroyed`);
    assert(db.rpcs.length === 0, `${badGuid}: a malformed guid reached the reference query`);
  }
});

Deno.test("G3 #3040 the asking job is excluded from its own reference answer", async () => {
  const { db } = await guarded(() => ({ data: [], error: null }));
  const call = db.rpcs.find((rpc) => rpc.name === "cover_video_guid_live_references");
  assert(call?.args.p_guid === GUID && call?.args.p_exclude_job_id === "job-guard", JSON.stringify(call?.args));
});

const FINAL = 67_108_864;
const CDN = "vz-3040-adv.b-cdn.net";
const sized = (sizes: Record<string, number | "missing">) => (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const height = Object.keys(sizes).find((h) => url.endsWith(`/play_${h}p.mp4`));
  const size = height === undefined ? "missing" : sizes[height];
  if (size === "missing") return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(null, { status: 200, headers: { "content-length": String(size) } }));
};
const candidates = [
  { url: `https://${CDN}/g/play_1080p.mp4`, heightP: 1080 },
  { url: `https://${CDN}/g/play_720p.mp4`, heightP: 720 },
  { url: `https://${CDN}/g/play_480p.mp4`, heightP: 480 },
];

Deno.test("W1 #3040 exactly 64 MiB at 1080p is within budget", async () => {
  let picked: number | undefined;
  await withFetch(sized({ "1080": FINAL, "720": 30_000_000, "480": 10_000_000 }), async () => {
    picked = (await quiet(() => selectDeliverableRendition(candidates, { jobId: "j", videoGuid: "g" })))?.heightP;
  });
  assert(picked === 1080, `64 MiB exactly picked ${picked}`);
});

Deno.test("W2 #3040 one byte over 64 MiB falls to 720p and logs the fallback", async () => {
  let picked: number | undefined;
  const lines: string[] = [];
  const { warn, log } = console;
  console.warn = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.log = () => {};
  try {
    await withFetch(sized({ "1080": FINAL + 1, "720": 30_000_000, "480": 10_000_000 }), async () => {
      picked = (await selectDeliverableRendition(candidates, { jobId: "j", videoGuid: "g" }))?.heightP;
    });
  } finally {
    console.warn = warn;
    console.log = log;
  }
  assert(picked === 720, `64 MiB + 1 picked ${picked}`);
  assert(lines.some((line) => line.includes("rendition_over_budget_fallback")), `no fallback log: ${lines.join("\n")}`);
});

Deno.test("W3 #3040 a 1080p rendition the CDN serves only on the second HEAD is still delivered at 1080p", async () => {
  // CDN propagation lag: the first HEAD of play_1080p.mp4 is a 404, the retry
  // answers. The walk must use its retries before judging the rendition.
  let headsOf1080 = 0;
  let picked: number | undefined;
  await withFetch((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/play_1080p.mp4")) {
      headsOf1080 += 1;
      if (headsOf1080 === 1) return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(new Response(null, { status: 200, headers: { "content-length": "40000000" } }));
    }
    return Promise.resolve(new Response(null, { status: 200, headers: { "content-length": "20000000" } }));
  }, async () => {
    picked = (await quiet(() => selectDeliverableRendition(candidates, { jobId: "j", videoGuid: "g" })))?.heightP;
  });
  assert(picked === 1080, `a lagging 1080p rendition was not retried: picked ${picked}`);
  assert(headsOf1080 === 2, `1080p was asked ${headsOf1080} times`);
});

Deno.test("W4 #3040 candidates never exceed 1080p and ignore junk and duplicates", async () => {
  const video = (availableResolutions: string): BunnyVideo => ({
    guid: "g",
    status: 4,
    length: 30,
    storageSize: 1,
    availableResolutions,
    encodeProgress: 100,
  });
  await withEnv({ BUNNY_STREAM_CDN_HOSTNAME: CDN }, () => {
    const heights = bunnyMp4Candidates(video("2160p,1440p,1080p,1080p,720P, 480p ,0p,-360p,abc,,p")).map((c) => c.heightP);
    assert(JSON.stringify(heights) === JSON.stringify([1080, 720, 480]), `got ${JSON.stringify(heights)}`);
    assert(bunnyMp4Candidates(video("2160p,1440p")).length === 0, "a 4K-only list produced a candidate above 1080p");
    return Promise.resolve();
  });
});
