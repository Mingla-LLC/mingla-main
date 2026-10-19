// Issue #3040 — shared harness for the #3040 upload-intent suites: a replay of
// an already-allocated job (so the request reaches the transport response), a
// capturing database stand-in and the full dependency set.
// deno-lint-ignore-file no-explicit-any
import { handleEventCoverVideoUploadIntent } from "../index.ts";

export const USER = "44a18413-bfbf-4087-9ba7-45f70deba0f3";
export const BRAND = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
export const EVENT = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
export const OP = "33a18413-bfbf-4087-9ba7-45f70deba0f3";
export const EXPIRE = 2_000_000_000;

export const baseBody = (overrides: Record<string, unknown> = {}) => ({
  applyMode: "published_manual",
  brandId: BRAND,
  eventId: EVENT,
  clientOperationId: OP,
  sourceBytes: 6_000_000,
  sourceDurationMs: 12_000,
  sourceFileName: "cover.mp4",
  sourceMimeType: "video/mp4",
  sourceExtension: "mp4",
  sourceSha256: "c".repeat(64),
  trimStartMs: 0,
  trimEndMs: 12_000,
  ...overrides,
});

export const request = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request("https://test/intent", {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

export const allocatedJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-3040-intent",
  status: "source_uploading",
  provider: "bunny",
  brand_id: BRAND,
  event_id: EVENT,
  target_kind: "event",
  apply_mode: "published_manual",
  source_bytes: 6_000_000,
  source_asset_id: "guid-intent-3040",
  tus_resource_url: "https://video.bunnycdn.com/tusupload/resource-3040",
  tus_upload_offset: 0,
  ...overrides,
});

export type Captured = {
  rpcs: Array<{ name: string; args: Record<string, any> }>;
};

export const makeDeps = (options: {
  job?: Record<string, any> | null;
  rpc?: Record<string, (args: Record<string, any>) => { data: any; error: any }>;
  extendTransportLease?: unknown;
  readTusTransfer?: unknown;
  requireCoverVideoTargetManager?: unknown;
  captured?: Captured;
}) => {
  const captured = options.captured ?? { rpcs: [] };
  const client = {
    rpc: (name: string, args: Record<string, any>) => {
      captured.rpcs.push({ name, args });
      const custom = options.rpc?.[name];
      if (custom) return Promise.resolve(custom(args));
      if (name === "cover_video_create_or_replay_job") {
        return Promise.resolve({ data: options.job === undefined ? allocatedJob() : options.job, error: null });
      }
      return Promise.resolve({ data: null, error: { code: "PGRST202", message: `no ${name}` } });
    },
    from: () => {
      throw new Error("the #3040 intent harness does not expect table reads");
    },
  };
  const deps: Record<string, unknown> = {
    bunnyCreateVideo: () => Promise.reject(new Error("no create on replay")),
    bunnyFindVideoByTitle: () => Promise.reject(new Error("no lookup on replay")),
    bunnyPresignTusUpload: (videoId: string) =>
      Promise.resolve({
        tusEndpoint: "https://video.bunnycdn.com/tusupload",
        libraryId: "lib",
        videoId,
        authorizationSignature: "sig",
        authorizationExpire: EXPIRE,
      }),
    checkBunnyCapacity: () => Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
    providerConfigured: () => true,
    reapSupersededBunnyAssets: () => Promise.resolve(),
    requireCoverVideoTargetManager: options.requireCoverVideoTargetManager ??
      (() => Promise.resolve({ target: {} })),
    requireBrandCoverManager: () => Promise.resolve({ brandId: BRAND }),
    requireEventManager: () => Promise.resolve({ event: {} }),
    requireUserId: () => Promise.resolve(USER),
    serviceRoleClient: () => client,
    sleep: () => Promise.resolve(),
  };
  if (options.extendTransportLease !== undefined) deps.extendTransportLease = options.extendTransportLease;
  if (options.readTusTransfer !== undefined) deps.readTusTransfer = options.readTusTransfer;
  return { deps, captured };
};

export const call = (body: Record<string, unknown>, deps: Record<string, unknown>, headers?: Record<string, string>) =>
  handleEventCoverVideoUploadIntent(request(body, headers), deps as never);

export const captureWarnings = async (fn: () => Promise<void>): Promise<string[]> => {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
};

export const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
