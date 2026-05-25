import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { downloadAndStorePhotos } from "./photoStorageService.ts";

function createSupabaseMock() {
  const uploads: Array<{ path: string; body: unknown; options: Record<string, unknown> }> = [];
  const updates: Array<Record<string, unknown>> = [];

  return {
    uploads,
    updates,
    client: {
      storage: {
        from(bucket: string) {
          assertEquals(bucket, "place-photos");
          return {
            upload(path: string, body: unknown, options: Record<string, unknown>) {
              uploads.push({ path, body, options });
              return Promise.resolve({ error: null });
            },
            getPublicUrl(path: string) {
              return {
                data: {
                  publicUrl: `https://x.supabase.co/storage/v1/object/public/place-photos/${path}`,
                },
              };
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
                assertEquals(column, "google_place_id");
                assertEquals(value, "place:abc");
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
  const img = new Image(8, 8);
  img.fill(0xff_44_88_cc);
  return await img.encodeJPEG(80);
}

function bodyFrom(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

Deno.test("downloadAndStorePhotos writes original, thumb, and thumbs_backfilled_at on successful thumb generation", async () => {
  const priorFetch = globalThis.fetch;
  const jpeg = await makeJpegBytes();
  globalThis.fetch = () => Promise.resolve(new Response(bodyFrom(jpeg), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  }));

  try {
    const mock = createSupabaseMock();
    const urls = await downloadAndStorePhotos(
      mock.client as any,
      "place:abc",
      [{ name: "places/abc/photos/1" }],
      "api-key",
    );

    assertEquals(urls, ["https://x.supabase.co/storage/v1/object/public/place-photos/place_abc/0.jpg"]);
    assertEquals(mock.uploads.map((u) => u.path), ["place_abc/0.jpg", "place_abc/0_thumb.jpg"]);
    assertEquals(mock.uploads[1].options.contentType, "image/jpeg");
    assertEquals(mock.uploads[1].options.upsert, true);
    assertExists(mock.updates[0].thumbs_backfilled_at);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("downloadAndStorePhotos leaves thumbs_backfilled_at unset when thumb generation fails after original upload", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  }));

  try {
    const mock = createSupabaseMock();
    const urls = await downloadAndStorePhotos(
      mock.client as any,
      "place:abc",
      [{ name: "places/abc/photos/1" }],
      "api-key",
    );

    assertEquals(urls, ["https://x.supabase.co/storage/v1/object/public/place-photos/place_abc/0.jpg"]);
    assertEquals(mock.uploads.map((u) => u.path), ["place_abc/0.jpg"]);
    assertEquals(mock.updates[0].stored_photo_urls, urls);
    assertEquals("thumbs_backfilled_at" in mock.updates[0], false);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
