import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildThumbPathFromObjectPath,
  extractPlacePhotoObjectPath,
  processPlaceThumbs,
} from "./index.ts";

function createDbMock() {
  const uploads: Array<{ path: string; options: Record<string, unknown> }> = [];
  const updates: Array<Record<string, unknown>> = [];

  return {
    uploads,
    updates,
    client: {
      storage: {
        from(bucket: string) {
          assertEquals(bucket, "place-photos");
          return {
            getPublicUrl(path: string) {
              return {
                data: {
                  publicUrl: `https://x.supabase.co/storage/v1/object/public/place-photos/${path}`,
                },
              };
            },
            upload(path: string, _body: unknown, options: Record<string, unknown>) {
              uploads.push({ path, options });
              return Promise.resolve({ error: null });
            },
          };
        },
      },
      from(table: string) {
        assertEquals(table, "place_pool");
        return {
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return {
              eq(column: string, value: string) {
                assertEquals(column, "id");
                assertEquals(value, "place-1");
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    },
  };
}

async function makeJpegBytes(): Promise<Uint8Array> {
  const img = new Image(12, 12);
  img.fill(0xff_99_22_44);
  return await img.encodeJPEG(80);
}

function bodyFrom(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

Deno.test("backfill helpers derive thumb paths from place-photos object URLs", () => {
  const url = "https://x.supabase.co/storage/v1/object/public/place-photos/abc/2.webp?cache=1";
  assertEquals(extractPlacePhotoObjectPath(url), "abc/2.webp");
  assertEquals(buildThumbPathFromObjectPath("abc/2.webp"), "abc/2_thumb.jpg");
});

Deno.test("T-06 backfill fetches originals through object endpoint only", async () => {
  const priorFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; method: string }> = [];
  const jpeg = await makeJpegBytes();

  globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    fetchCalls.push({ url, method });
    if (method === "HEAD") return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(bodyFrom(jpeg), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
  };

  try {
    const mock = createDbMock();
    const result = await processPlaceThumbs(mock.client as any, {
      id: "place-1",
      stored_photo_urls: ["https://x.supabase.co/storage/v1/object/public/place-photos/abc/0.jpg"],
    }, { skipDelays: true });

    assertEquals(result.success, true);
    assertEquals(result.thumbsWritten, 1);
    assertEquals(mock.uploads.map((u) => u.path), ["abc/0_thumb.jpg"]);
    assertEquals(fetchCalls.every((call) => call.url.includes("/storage/v1/object/public/")), true);
    assertEquals(fetchCalls.some((call) => call.url.includes("/render/image/")), false);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("T-07 backfill skips already-present thumbs without refetching originals", async () => {
  const priorFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), method: init?.method ?? "GET" });
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  try {
    const mock = createDbMock();
    const result = await processPlaceThumbs(mock.client as any, {
      id: "place-1",
      stored_photo_urls: ["https://x.supabase.co/storage/v1/object/public/place-photos/abc/0.jpg"],
    }, { skipDelays: true });

    assertEquals(result.success, true);
    assertEquals(result.thumbsWritten, 0);
    assertEquals(result.thumbsAlreadyPresent, 1);
    assertEquals(mock.uploads.length, 0);
    assertEquals(fetchCalls, [{
      url: "https://x.supabase.co/storage/v1/object/public/place-photos/abc/0_thumb.jpg",
      method: "HEAD",
    }]);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
