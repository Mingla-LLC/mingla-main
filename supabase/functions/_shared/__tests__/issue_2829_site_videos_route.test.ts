/*
 * #2829 W6 (AD-9) — stream videos through Core (brand-site-cms-callback).
 *
 * Bunny's HTTP API is MOCKED (no real Bunny call is ever made): the real
 * shared Bunny helpers run against a fake fetch. Proves:
 *  - unconfigured Bunny: the routes are inert (no Bunny call, no row) and the
 *    capability route says standard hosting;
 *  - upload intent: validates type/size, creates the Bunny video, records the
 *    row under the site's own brand, returns a presigned TUS upload (the API
 *    key never leaves Core);
 *  - status: transcoding -> processing, finished -> ready with MP4 renditions
 *    on the CDN host and the length, error -> failed; a ready row is answered
 *    without calling Bunny;
 *  - site binding: another site's video is 404 and a URL/envelope site
 *    mismatch is refused.
 */
import {
  bunnyBinding,
  handleSiteVideoRoute,
  type SiteVideoRow,
  type SiteVideoStore,
} from "../../brand-site-cms-callback/siteVideos.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SITE_A = "aaaaaaaa-1111-4111-8111-111111111111";
const SITE_B = "bbbbbbbb-2222-4222-8222-222222222222";
const BRAND_A = "cccccccc-3333-4333-8333-333333333333";
const GUID = "dddddddd-4444-4444-8444-444444444444";
const LIB = "123456";
const KEY = "fixture-stream-key";
const CDN = "vz-fixture.b-cdn.net";

type Call = { url: string; method: string; headers: Headers };

function memoryStore(brands: Record<string, string> = { [SITE_A]: BRAND_A }) {
  const rows = new Map<string, SiteVideoRow>();
  const store: SiteVideoStore = {
    siteBrand: async (siteId) => brands[siteId] ?? null,
    insert: async (row) => {
      const full: SiteVideoRow = { id: crypto.randomUUID(), duration_ms: null, width: null, height: null, renditions: [], ...row };
      rows.set(full.id, full);
      return full;
    },
    load: async (siteId, id) => {
      const row = rows.get(id);
      return row && row.site_id === siteId ? row : null;
    },
    update: async (id, patch) => {
      const next = { ...rows.get(id)!, ...patch };
      rows.set(id, next);
      return next;
    },
  };
  return { store, rows };
}

function bunnyApi(videoStatus: () => Record<string, unknown>, createStatus = 200) {
  const calls: Call[] = [];
  const fetchImpl = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    if (url === `https://video.bunnycdn.com/library/${LIB}/videos` && init?.method === "POST") {
      return Promise.resolve(createStatus === 200 ? Response.json({ guid: GUID }) : new Response("no", { status: createStatus }));
    }
    if (url === `https://video.bunnycdn.com/library/${LIB}/videos/${GUID}`) {
      return Promise.resolve(Response.json({ guid: GUID, ...videoStatus() }));
    }
    return Promise.resolve(new Response("unexpected", { status: 599 }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const SAVED_CORE_ENV = {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
};
function restoreCoreEnv() {
  for (const [name, value] of Object.entries(SAVED_CORE_ENV)) if (value !== undefined) Deno.env.set(name, value);
}

function configure(on: boolean) {
  for (const [name, value] of [["BUNNY_STREAM_LIBRARY_ID", LIB], ["BUNNY_STREAM_API_KEY", KEY], ["BUNNY_STREAM_CDN_HOSTNAME", CDN]]) {
    if (on) Deno.env.set(name, value);
    else Deno.env.delete(name);
  }
  // The shared Bunny helpers also record each provider call to Core's health
  // table when Core's URL is set (other suites set it). No such write here:
  // nothing in these tests may leave the process.
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
}

const route = (
  method: string,
  path: string,
  deps: Parameters<typeof handleSiteVideoRoute>[1],
  body: Record<string, unknown> = {},
  envelopeSiteId = SITE_A,
) => handleSiteVideoRoute({ method, path, body, envelopeSiteId }, deps);

async function json(response: Response | null) {
  assert(response, "route did not answer");
  return { status: response.status, body: await response.json() };
}

const sha256Hex = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");

Deno.test("#2829 stream video routes are inert when Bunny is not configured", async () => {
  configure(false);
  const { store, rows } = memoryStore();
  const api = bunnyApi(() => ({ status: 4 }));
  const deps = { store, bunny: bunnyBinding(api.fetchImpl) };
  const capability = await json(await route("GET", `/internal/v1/sites/${SITE_A}/videos/capability`, deps));
  assert(capability.status === 200 && capability.body.data.stream_video === false && capability.body.data.cdn_host === null, "capability claims stream video");
  const intent = await json(await route("POST", `/internal/v1/sites/${SITE_A}/videos/upload-intent`, deps, { content_type: "video/mp4", bytes: 1000 }));
  assert(intent.status === 404 && intent.body.error.code === "STREAM_VIDEO_UNAVAILABLE", `intent not refused: ${JSON.stringify(intent)}`);
  const status = await json(await route("GET", `/internal/v1/sites/${SITE_A}/videos/${crypto.randomUUID()}/status`, deps));
  assert(status.status === 404 && status.body.error.code === "STREAM_VIDEO_UNAVAILABLE", "status not refused");
  assert(api.calls.length === 0, "Bunny was called while unconfigured");
  assert(rows.size === 0, "a row was written while unconfigured");
});

Deno.test("#2829 upload intent creates the Bunny video under the site's brand and presigns the upload", async () => {
  configure(true);
  const { store, rows } = memoryStore();
  const api = bunnyApi(() => ({ status: 0 }));
  const deps = { store, bunny: bunnyBinding(api.fetchImpl) };
  const result = await json(await route("POST", `/internal/v1/sites/${SITE_A}/videos/upload-intent`, deps, { content_type: "video/quicktime", bytes: 80 * 1024 * 1024 }));
  assert(result.status === 200, `intent failed: ${JSON.stringify(result)}`);
  assert(api.calls.length === 1 && api.calls[0]!.method === "POST" && api.calls[0]!.headers.get("AccessKey") === KEY, "Bunny create not called with the library key");
  const row = rows.get(result.body.data.video_id)!;
  assert(row.site_id === SITE_A && row.brand_id === BRAND_A && row.provider_guid === GUID && row.status === "uploading", `row wrong: ${JSON.stringify(row)}`);
  const upload = result.body.data.upload;
  assert(upload.endpoint === "https://video.bunnycdn.com/tusupload" && upload.video_guid === GUID && upload.library_id === LIB, "upload target wrong");
  assert(upload.signature === await sha256Hex(`${LIB}${KEY}${upload.expires_at}${GUID}`), "presign signature wrong");
  assert(!JSON.stringify(result.body).includes(KEY), "the Bunny key left Core");
});

Deno.test("#2829 upload intent refuses a wrong type or size, an unknown site, and a Bunny outage", async () => {
  configure(true);
  const { store, rows } = memoryStore();
  const api = bunnyApi(() => ({ status: 0 }));
  const deps = { store, bunny: bunnyBinding(api.fetchImpl) };
  for (const body of [{ content_type: "image/png", bytes: 10 }, { content_type: "video/mp4", bytes: 101 * 1024 * 1024 }, { content_type: "video/mp4", bytes: 0 }]) {
    const refused = await json(await route("POST", `/internal/v1/sites/${SITE_A}/videos/upload-intent`, deps, body));
    assert(refused.status === 400, `accepted ${JSON.stringify(body)}`);
  }
  const unknown = memoryStore({});
  const missing = await json(await route("POST", `/internal/v1/sites/${SITE_A}/videos/upload-intent`, { store: unknown.store, bunny: deps.bunny }, { content_type: "video/mp4", bytes: 10 }));
  assert(missing.status === 404, "unknown site accepted");
  assert(api.calls.length === 0, "Bunny called for a refused intent");
  const down = bunnyApi(() => ({}), 500);
  const outage = await json(await route("POST", `/internal/v1/sites/${SITE_A}/videos/upload-intent`, { store, bunny: bunnyBinding(down.fetchImpl) }, { content_type: "video/mp4", bytes: 10 }));
  assert(outage.status === 503 && rows.size === 0, "a Bunny outage left a row or did not say so");
});

Deno.test("#2829 status follows Bunny: transcoding, finished (renditions + length), error", async () => {
  configure(true);
  const { store } = memoryStore();
  let bunnyState: Record<string, unknown> = { status: 3, length: null, availableResolutions: null };
  const api = bunnyApi(() => bunnyState);
  const deps = { store, bunny: bunnyBinding(api.fetchImpl) };
  const row = await store.insert({ site_id: SITE_A, brand_id: BRAND_A, provider_guid: GUID, status: "uploading" });
  const path = `/internal/v1/sites/${SITE_A}/videos/${row.id}/status`;
  const processing = await json(await route("GET", path, deps));
  assert(processing.body.data.status === "processing" && processing.body.data.renditions.length === 0, "transcoding not processing");

  bunnyState = { status: 4, length: 12, availableResolutions: "720p,480p,1440p" };
  const ready = await json(await route("GET", path, deps));
  assert(ready.body.data.status === "ready", `not ready: ${JSON.stringify(ready.body)}`);
  assert(ready.body.data.duration_ms === 12000 && ready.body.data.height === 720, "length/height wrong");
  const urls = ready.body.data.renditions.map((item: { url: string }) => item.url);
  assert(
    JSON.stringify(urls) === JSON.stringify([`https://${CDN}/${GUID}/play_720p.mp4`, `https://${CDN}/${GUID}/play_480p.mp4`]),
    `renditions wrong (1440 is above the cap): ${urls}`,
  );
  assert(ready.body.data.poster_url === `https://${CDN}/${GUID}/thumbnail.jpg`, "poster wrong");
  const callsBefore = api.calls.length;
  const again = await json(await route("GET", path, deps));
  assert(again.body.data.status === "ready" && api.calls.length === callsBefore, "a ready video was re-read from Bunny");

  const failing = await store.insert({ site_id: SITE_A, brand_id: BRAND_A, provider_guid: GUID, status: "processing" });
  bunnyState = { status: 5 };
  const failed = await json(await route("GET", `/internal/v1/sites/${SITE_A}/videos/${failing.id}/status`, deps));
  assert(failed.body.data.status === "failed", "error not failed");
});

Deno.test("#2829 a finished video with no MP4 rendition stays processing (never points at nothing)", async () => {
  configure(true);
  const { store } = memoryStore();
  const api = bunnyApi(() => ({ status: 4, length: 9, availableResolutions: "" }));
  const row = await store.insert({ site_id: SITE_A, brand_id: BRAND_A, provider_guid: GUID, status: "processing" });
  const result = await json(await route("GET", `/internal/v1/sites/${SITE_A}/videos/${row.id}/status`, { store, bunny: bunnyBinding(api.fetchImpl) }));
  assert(result.body.data.status === "processing", "ready without a rendition");
});

Deno.test("#2829 stream videos are bound to the signed site", async () => {
  configure(true);
  const { store } = memoryStore({ [SITE_A]: BRAND_A, [SITE_B]: BRAND_A });
  const api = bunnyApi(() => ({ status: 4 }));
  const deps = { store, bunny: bunnyBinding(api.fetchImpl) };
  const row = await store.insert({ site_id: SITE_A, brand_id: BRAND_A, provider_guid: GUID, status: "processing" });
  const other = await json(await route("GET", `/internal/v1/sites/${SITE_B}/videos/${row.id}/status`, deps, {}, SITE_B));
  assert(other.status === 404, "another site read this site's video");
  let refused = false;
  try {
    await route("POST", `/internal/v1/sites/${SITE_B}/videos/upload-intent`, deps, { content_type: "video/mp4", bytes: 10 }, SITE_A);
  } catch (error) {
    refused = error instanceof Error && error.message === "TENANT_MISMATCH";
  }
  assert(refused, "a URL site different from the signed site was served");
  assert(api.calls.length === 0, "Bunny was called for a refused request");
  assert(await route("GET", `/internal/v1/sites/${SITE_A}/offerings`, deps) === null, "a non-video path was claimed");
  configure(false);
  restoreCoreEnv();
});
