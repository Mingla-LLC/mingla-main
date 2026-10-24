import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GoogleDriveClient } from "./drive.ts";
import { finalize, openThumbnail } from "./index.ts";

const serviceAccount = {
  client_email: "drive@example.iam.gserviceaccount.com",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nunused-in-test\n-----END PRIVATE KEY-----",
  shared_drive_id: "shared-drive",
  host_details_folder_id: "host-details",
};

function driveClient(fetcher: typeof fetch): GoogleDriveClient {
  const drive = new GoogleDriveClient(
    serviceAccount,
    "shared-drive",
    "host-details",
    fetcher,
  );
  const internal = drive as unknown as {
    accessToken: string;
    accessTokenExpiresAt: number;
  };
  internal.accessToken = "test-token";
  internal.accessTokenExpiresAt = Date.now() + 3_600_000;
  return drive;
}

async function responseCode(response: Response): Promise<string> {
  return String((await response.json() as { code?: unknown }).code ?? "");
}

Deno.test("#3988 Drive media metadata and thumbnail proxy use bounded fields and an authenticated s480 image", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    if (url.includes("/drive/v3/files/provider-file?")) {
      assertStringIncludes(
        decodeURIComponent(url),
        "videoMediaMetadata(width,height,durationMillis)",
      );
      return new Response(
        JSON.stringify({
          hasThumbnail: true,
          thumbnailLink:
            "https://drive.google.com/thumbnail/provider-file=s220",
          videoMediaMetadata: {
            width: "1080",
            height: 1920,
            durationMillis: "65000",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    });
  }) as typeof fetch;
  const drive = driveClient(fetcher);

  assertEquals(await drive.mediaInfo("provider-file"), {
    hasThumbnail: true,
    thumbnailLink: "https://drive.google.com/thumbnail/provider-file=s220",
    width: 1080,
    height: 1920,
    durationMs: 65000,
  });
  const thumbnail = await drive.thumbnail(
    "https://drive.google.com/thumbnail/provider-file=s220",
  );
  assertEquals(thumbnail.status, 200);
  assertEquals(calls[1], {
    url: "https://drive.google.com/thumbnail/provider-file=s480",
    authorization: "Bearer test-token",
  });
});

Deno.test("#3988 thumbnail endpoint hides unauthorized and non-media files", async () => {
  let driveCalls = 0;
  const drive = {
    mediaInfo: async () => {
      driveCalls += 1;
      throw new Error("unexpected");
    },
  } as unknown as GoogleDriveClient;
  const unauthorized = {
    rpc: async () => ({ data: null, error: { message: "not allowed" } }),
  };
  const hidden = await openThumbnail(
    unauthorized as never,
    drive,
    "39880000-0000-4000-b800-000000000001",
    "39880000-0000-4000-b900-000000000001",
  );
  assertEquals(hidden.status, 404);
  assertEquals(await responseCode(hidden), "FILE_UNAVAILABLE");

  const nonMedia = {
    rpc: async () => ({
      data: { provider_file_id: "provider-file", mime_type: "application/pdf" },
      error: null,
    }),
  };
  const unavailable = await openThumbnail(
    nonMedia as never,
    drive,
    "39880000-0000-4000-b800-000000000001",
    "39880000-0000-4000-b900-000000000001",
  );
  assertEquals(unavailable.status, 404);
  assertEquals(await responseCode(unavailable), "THUMB_UNAVAILABLE");
  assertEquals(driveCalls, 0);
});

Deno.test("#3988 pending Drive thumbnails stay pending while ready thumbnails stream privately", async () => {
  const setterStates: string[] = [];
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "issue_3720_authorize_brand_group_file") {
        return {
          data: { provider_file_id: "provider-file", mime_type: "video/mp4" },
          error: null,
        };
      }
      if (name === "issue_3988_file_thumb_state") {
        return {
          data: {
            thumbState: "pending",
            thumbCheckedAt: null,
            width: null,
            height: null,
            durationMs: null,
          },
          error: null,
        };
      }
      if (name === "issue_3988_set_brand_group_file_media") {
        setterStates.push(String(args.p_thumb_state));
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const pendingDrive = {
    mediaInfo: async () => ({
      hasThumbnail: false,
      thumbnailLink: null,
      width: 1080,
      height: 1920,
      durationMs: 65000,
    }),
  } as unknown as GoogleDriveClient;
  const pending = await openThumbnail(
    admin as never,
    pendingDrive,
    "39880000-0000-4000-b800-000000000001",
    "39880000-0000-4000-b900-000000000001",
  );
  assertEquals(pending.status, 404);
  assertEquals(await responseCode(pending), "THUMB_UNAVAILABLE");
  assertEquals(setterStates, ["pending"]);

  const readyDrive = {
    mediaInfo: async () => ({
      hasThumbnail: true,
      thumbnailLink: "https://drive.google.com/thumb=s220",
      width: 1080,
      height: 1920,
      durationMs: 65000,
    }),
    thumbnail: async () =>
      new Response("jpeg", {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Content-Length": "4" },
      }),
  } as unknown as GoogleDriveClient;
  const ready = await openThumbnail(
    admin as never,
    readyDrive,
    "39880000-0000-4000-b800-000000000001",
    "39880000-0000-4000-b900-000000000001",
  );
  assertEquals(ready.status, 200);
  assertEquals(ready.headers.get("Cache-Control"), "private, max-age=86400");
  assertEquals(ready.headers.get("Content-Type"), "image/jpeg");
  assertEquals(setterStates, ["pending", "ready"]);
});

Deno.test("#3988 finalize succeeds when Drive media metadata is not ready", async () => {
  const rpcCalls: string[] = [];
  const bytes = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);
  const admin = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === "issue_3720_claim_brand_group_file") {
        return {
          data: {
            state: "transferring",
            file_id: "39880000-0000-4000-b900-000000000001",
            name: "portrait.png",
            mime_type: "image/png",
            size_bytes: bytes.length,
            storage_path: "staging/portrait.png",
            target_folder_id: "host-uploads",
          },
          error: null,
        };
      }
      if (name === "issue_3720_complete_brand_group_file") {
        return { data: "39880000-0000-4000-ba00-000000000001", error: null };
      }
      if (name === "issue_3720_fail_brand_group_file") {
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([bytes], { type: "image/png" }),
          error: null,
        }),
        remove: async () => ({ data: null, error: null }),
      }),
    },
  };
  const drive = {
    upload: async () => ({
      id: "provider-file",
      size: String(bytes.length),
      mimeType: "image/png",
    }),
    mediaInfo: async () => {
      throw new Error("DRIVE_TEMPORARY");
    },
  } as unknown as GoogleDriveClient;

  const result = await finalize(
    admin as never,
    drive,
    "39880000-0000-4000-b900-000000000001",
    "39880000-0000-4000-b800-000000000001",
  );
  assertEquals(result.status, 200);
  assertEquals((await result.json() as { ok: boolean }).ok, true);
  assert(!rpcCalls.includes("issue_3988_set_brand_group_file_media"));
  assert(!rpcCalls.includes("issue_3720_fail_brand_group_file"));
});

Deno.test("#3988 GET routing rejects unknown variants and preserves the unqualified open-file path", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertStringIncludes(source, 'variant !== null && variant !== "thumb"');
  assertStringIncludes(source, 'json(400, { code: "BAD_VARIANT" })');
  assertStringIncludes(
    source,
    'if (variant === "thumb") return await openThumbnail',
  );
  assertStringIncludes(
    source,
    "return await openFile(request, clients.admin, drive, userId, fileId)",
  );
});
