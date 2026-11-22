// MINGLA-INVARIANT: I-4420-ARI-PHOTO-TO-OWN-SUPPORT | issue #4420 | agent-attachments copy_to_support copies only the caller's own finalized Ari image, byte-identical to what Ari verified and within the support image limits, into a support conversation the caller can see as its customer; every refusal happens before anything is registered or copied.
//
// Issue #4420 (Host polish pass, part 2 §4.6, §7, §8).
// Run: deno test --no-check --allow-read --allow-env \
//   supabase/functions/agent-attachments/__tests__/issue_4420_copy_to_support.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  copyAriAttachmentToSupport,
  type CopyToSupportDeps,
  SUPPORT_ATTACHMENT_BUCKET,
} from "../copyToSupport.ts";

const CALLER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BRAND = "33333333-3333-4333-8333-333333333333";
const ATTACHMENT = "44444444-4444-4444-8444-444444444444";
const OWN_TICKET = "55555555-5555-4555-8555-555555555555";
const OTHER_TICKET = "66666666-6666-4666-8666-666666666666";
const SUPPORT_ID = "77777777-7777-4777-8777-777777777777";
const ARI_BUCKET = "ari-chat-attachments";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

async function sha(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((v) => v.toString(16).padStart(2, "0")).join(
    "",
  );
}

interface Row {
  id: string;
  user_id: string;
  brand_id: string;
  storage_path: string;
  state: string;
  file_type: string | null;
  verified_mime: string | null;
  verified_size_bytes: number | null;
  sha256: string | null;
}

interface World {
  rows: Row[];
  objects: Map<string, Uint8Array<ArrayBuffer>>;
  viewable: Set<string>;
  brandAccess: boolean;
  registerError: { message: string } | null;
  calls: {
    downloads: string[];
    registers: Record<string, unknown>[];
    uploads: {
      bucket: string;
      path: string;
      bytes: Uint8Array;
      type: string;
    }[];
  };
}

async function world(overrides: Partial<Row> = {}): Promise<World> {
  const row: Row = {
    id: ATTACHMENT,
    user_id: CALLER,
    brand_id: BRAND,
    storage_path: `${CALLER}/${BRAND}/${ATTACHMENT}/source`,
    state: "ready",
    file_type: "image",
    verified_mime: "image/jpeg",
    verified_size_bytes: JPEG.byteLength,
    sha256: await sha(JPEG),
    ...overrides,
  };
  return {
    rows: [row],
    objects: new Map([[`${ARI_BUCKET}:${row.storage_path}`, JPEG]]),
    viewable: new Set([OWN_TICKET]),
    brandAccess: true,
    registerError: null,
    calls: { downloads: [], registers: [], uploads: [] },
  };
}

function deps(w: World): CopyToSupportDeps {
  return {
    userId: CALLER,
    ariBucket: ARI_BUCKET,
    canAccessBrand: () => Promise.resolve(w.brandAccess),
    admin: {
      from: () => ({
        select: () => {
          const filters: Record<string, string> = {};
          const chain = {
            eq(column: string, value: string) {
              filters[column] = value;
              return chain;
            },
            maybeSingle() {
              const found =
                w.rows.find((row) =>
                  Object.entries(filters).every(([key, value]) =>
                    (row as unknown as Record<string, unknown>)[key] === value
                  )
                ) ?? null;
              return Promise.resolve({ data: found, error: null });
            },
          };
          return chain;
        },
      }),
      rpc: (_fn, args) =>
        Promise.resolve({
          data: args.p_user_id === CALLER && w.viewable.has(args.p_ticket_id),
          error: null,
        }),
      storage: {
        from: (bucket: string) => ({
          download(path: string) {
            w.calls.downloads.push(`${bucket}:${path}`);
            const bytes = w.objects.get(`${bucket}:${path}`);
            return Promise.resolve(
              bytes
                ? { data: new Blob([bytes]), error: null }
                : { data: null, error: { message: "not found" } },
            );
          },
          upload(path, body, options) {
            w.calls.uploads.push({
              bucket,
              path,
              bytes: body,
              type: options.contentType,
            });
            return Promise.resolve({ data: { path }, error: null });
          },
        }),
      },
    },
    caller: {
      rpc: (_fn, args) => {
        w.calls.registers.push(args);
        if (w.registerError) {
          return Promise.resolve({ data: null, error: w.registerError });
        }
        return Promise.resolve({
          data: {
            attachment_id: SUPPORT_ID,
            bucket: SUPPORT_ATTACHMENT_BUCKET,
            storage_path: `${args.p_ticket_id}/${SUPPORT_ID}.jpg`,
            ticket_id: args.p_ticket_id,
            draft: false,
          },
          error: null,
        });
      },
    },
  };
}

function assertNothingWritten(w: World) {
  assertEquals(w.calls.registers.length, 0, "nothing registered");
  assertEquals(w.calls.uploads.length, 0, "nothing copied");
}

Deno.test("copy_to_support: the owner copies their own Ari photo into their own conversation, server-side, byte-identical", async () => {
  const w = await world();
  const result = await copyAriAttachmentToSupport(deps(w), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(result.status, 200);
  assertEquals(result.body, {
    support_attachment_id: SUPPORT_ID,
    ticket_id: OWN_TICKET,
  });
  assertEquals(w.calls.registers, [{
    p_ticket_id: OWN_TICKET,
    p_kind: "image",
    p_mime: "image/jpeg",
    p_bytes: JPEG.byteLength,
  }]);
  assertEquals(w.calls.uploads.length, 1);
  const upload = w.calls.uploads[0];
  assertEquals(upload.bucket, "support-attachments");
  assertEquals(upload.path, `${OWN_TICKET}/${SUPPORT_ID}.jpg`);
  assertEquals(upload.type, "image/jpeg");
  assertEquals([...upload.bytes], [...JPEG]);
});

Deno.test("copy_to_support (adversarial): someone else's Ari attachment is refused, nothing registered", async () => {
  const w = await world({
    user_id: OTHER,
    storage_path: `${OTHER}/${BRAND}/${ATTACHMENT}/source`,
  });
  const result = await copyAriAttachmentToSupport(deps(w), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(result.status, 404);
  assertEquals(result.body.code, "NOT_FOUND");
  assertNothingWritten(w);
  assertEquals(w.calls.downloads.length, 0);
});

Deno.test("copy_to_support (adversarial): a row naming the caller but a path outside their folder is refused", async () => {
  const w = await world({
    storage_path: `${OTHER}/${BRAND}/${ATTACHMENT}/source`,
  });
  const result = await copyAriAttachmentToSupport(deps(w), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(result.status, 404);
  assertNothingWritten(w);
});

Deno.test("copy_to_support (adversarial): a conversation the caller cannot see is refused, nothing registered or read", async () => {
  const w = await world();
  const result = await copyAriAttachmentToSupport(deps(w), {
    attachment_id: ATTACHMENT,
    ticket_id: OTHER_TICKET,
  });
  assertEquals(result.status, 403);
  assertEquals(result.body.code, "TICKET_FORBIDDEN");
  assertNothingWritten(w);
  assertEquals(w.calls.downloads.length, 0);
});

Deno.test("copy_to_support (adversarial): a document is refused (images only)", async () => {
  const w = await world({ file_type: "pdf", verified_mime: "application/pdf" });
  const result = await copyAriAttachmentToSupport(deps(w), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(result.status, 400);
  assertEquals(result.body.code, "UNSUPPORTED_FOR_SUPPORT");
  assertNothingWritten(w);
});

Deno.test("copy_to_support (adversarial): an image type support does not take (HEIF, GIF-like) is refused", async () => {
  for (const mime of ["image/heif", "image/gif", "image/svg+xml"]) {
    const w = await world({ verified_mime: mime });
    const result = await copyAriAttachmentToSupport(deps(w), {
      attachment_id: ATTACHMENT,
      ticket_id: OWN_TICKET,
    });
    assertEquals(result.status, 400, mime);
    assertNothingWritten(w);
  }
});

Deno.test("copy_to_support (adversarial): an 11 MB image is refused (support limit 10 MB)", async () => {
  const w = await world({ verified_size_bytes: 11 * 1024 * 1024 });
  const result = await copyAriAttachmentToSupport(deps(w), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(result.status, 400);
  assertEquals(result.body.code, "FILE_TOO_LARGE");
  assertNothingWritten(w);
});

Deno.test("copy_to_support (adversarial): not finalized, brand access lost, or bytes changed since Ari checked them: refused", async () => {
  const notReady = await world({ state: "processing" });
  const a = await copyAriAttachmentToSupport(deps(notReady), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(a.status, 409);
  assertNothingWritten(notReady);

  const noBrand = await world();
  noBrand.brandAccess = false;
  const b = await copyAriAttachmentToSupport(deps(noBrand), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(b.status, 403);
  assertNothingWritten(noBrand);

  const swapped = await world();
  swapped.objects.set(
    `${ARI_BUCKET}:${swapped.rows[0].storage_path}`,
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9, 9, 9]),
  );
  const c = await copyAriAttachmentToSupport(deps(swapped), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(c.status, 409);
  assertEquals(c.body.code, "ATTACHMENT_CHANGED");
  assertNothingWritten(swapped);
});

Deno.test("copy_to_support (adversarial): malformed ids are refused before any read", async () => {
  for (
    const body of [
      {},
      { attachment_id: ATTACHMENT },
      { ticket_id: OWN_TICKET },
      { attachment_id: "x", ticket_id: OWN_TICKET },
      { attachment_id: ATTACHMENT, ticket_id: "'; drop table" },
      { attachment_id: [ATTACHMENT], ticket_id: OWN_TICKET },
    ]
  ) {
    const w = await world();
    const result = await copyAriAttachmentToSupport(deps(w), body);
    assertEquals(result.status, 400, JSON.stringify(body));
    assertNothingWritten(w);
    assertEquals(w.calls.downloads.length, 0);
  }
});

Deno.test("copy_to_support: a register refusal (closed conversation) copies nothing", async () => {
  const w = await world();
  w.registerError = { message: "ticket_closed" };
  const result = await copyAriAttachmentToSupport(deps(w), {
    attachment_id: ATTACHMENT,
    ticket_id: OWN_TICKET,
  });
  assertEquals(result.status, 409);
  assertEquals(result.body.code, "TICKET_CLOSED");
  assertEquals(w.calls.uploads.length, 0);
});

Deno.test("agent-attachments wiring: copy_to_support routes to the checked copy with the caller's own client", () => {
  const src = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  assertStringIncludes(src, '| "copy_to_support"');
  assertStringIncludes(src, 'if (body.action === "copy_to_support") {');
  assertStringIncludes(src, "caller: userClient,");
  assertStringIncludes(src, "userId,");
  // Existing actions are unchanged: the copy branch returns before them.
  assert(
    src.indexOf('body.action === "copy_to_support"') <
      src.indexOf('if (body.action === "discard")'),
  );
});
