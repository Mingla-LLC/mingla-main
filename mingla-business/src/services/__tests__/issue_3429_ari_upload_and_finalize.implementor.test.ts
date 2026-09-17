/**
 * #3429 REWORK-1 implementor proof — D-3 real upload bytes, D-5 one-file
 * sequential finalize with status polling, and SC-R1-D4-2 client copy.
 */

import fs from "fs";
import path from "path";

type InvokeBody = Record<string, unknown>;
type Invoke = (name: string, options: { body: InvokeBody }) => Promise<{ data: unknown; error: unknown }>;

const mockCalls: string[] = [];
const mockUploads: { path: string; token: string; body: unknown; options: Record<string, unknown> }[] = [];
let mockInvoke: Invoke;
const mockReadBytes = jest.fn<Promise<Uint8Array>, [{ uri: string; webFile?: Blob }]>();

jest.mock("../supabase", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-3429" } } }) },
    functions: {
      invoke: (name: string, options: { body: InvokeBody }) => {
        mockCalls.push(`${String(options.body.action)}:${String(options.body.attachment_id ?? "")}`);
        return mockInvoke(name, options);
      },
    },
    storage: {
      from: () => ({
        uploadToSignedUrl: async (storagePath: string, token: string, body: unknown, options: Record<string, unknown>) => {
          mockCalls.push(`upload:${storagePath.split("/")[2]}`);
          mockUploads.push({ path: storagePath, token, body, options });
          return { data: { path: storagePath }, error: null };
        },
      }),
    },
  },
}));
jest.mock("../ariAttachmentFileReader", () => ({
  readAriAttachmentBytes: (source: { uri: string; webFile?: Blob }) => mockReadBytes(source),
}));

import {
  ARI_ATTACHMENT_FAILURE_COPY,
  type AriAttachmentDraft,
  prepareAriAttachments,
  stableFailure,
} from "../ariAttachmentService";

function draft(localId: string, name: string, mimeType: string, sizeBytes: number, fileType: AriAttachmentDraft["fileType"]): AriAttachmentDraft {
  return {
    localId,
    attachmentId: null,
    uri: `file:///prepared/${name}`,
    name,
    mimeType,
    fileType,
    sizeBytes,
    state: "preparing",
    errorCode: null,
    errorMessage: null,
  };
}

function prepared(ids: string[]) {
  return { data: { outcomes: ids.map((id, index) => ({ attachment_id: id, filename: `f${index}`, state: "prepared", upload_token: `token-${id}` })) }, error: null };
}

describe("#3429 D-3/D-5 client upload and finalize", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCalls.length = 0;
    mockUploads.length = 0;
    mockReadBytes.mockReset();
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch must never build an Ari upload body");
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  it("uploads exact Uint8Array bytes with the prepared MIME and finalizes one file at a time", async () => {
    mockReadBytes.mockImplementation(async (source) => new Uint8Array(source.uri.endsWith(".jpg") ? 12 : 20).fill(7));
    mockInvoke = async (_name, { body }) => {
      if (body.action === "prepare") return prepared(["id-photo", "id-menu"]);
      return {
        data: { outcome: { attachment_id: body.attachment_id, state: "ready", verified_mime: body.attachment_id === "id-photo" ? "image/jpeg" : "application/pdf", size_bytes: body.attachment_id === "id-photo" ? 12 : 20 } },
        error: null,
      };
    };
    const updates: { localId: string; patch: Partial<AriAttachmentDraft> }[] = [];
    await prepareAriAttachments({
      drafts: [
        draft("local-photo", "photo.jpg", "image/jpeg", 12, "image"),
        draft("local-menu", "menu.pdf", "application/pdf", 20, "pdf"),
      ],
      brandId: "brand-3429",
      conversationId: null,
      onUpdate: (localId, patch) => updates.push({ localId, patch }),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockCalls).toEqual([
      "prepare:",
      "upload:id-photo",
      "finalize:id-photo",
      "upload:id-menu",
      "finalize:id-menu",
    ]);
    expect(mockUploads.map((upload) => [upload.body instanceof Uint8Array, (upload.body as Uint8Array).byteLength, upload.options]))
      .toEqual([
        [true, 12, { contentType: "image/jpeg", upsert: false }],
        [true, 20, { contentType: "application/pdf", upsert: false }],
      ]);
    expect(updates.filter((update) => update.patch.state === "ready").map((update) => update.localId))
      .toEqual(["local-photo", "local-menu"]);
  });

  it("refuses to upload a body whose length differs from the declared size", async () => {
    mockReadBytes.mockResolvedValue(new Uint8Array(0));
    mockInvoke = async (_name, { body }) => body.action === "prepare"
      ? prepared(["id-empty"])
      : { data: null, error: new Error("unexpected") };
    const updates: Partial<AriAttachmentDraft>[] = [];
    await prepareAriAttachments({
      drafts: [draft("local-empty", "venue.jpg", "image/jpeg", 3_250_000, "image")],
      brandId: "brand-3429",
      conversationId: null,
      onUpdate: (_localId, patch) => updates.push(patch),
    });
    expect(mockUploads).toHaveLength(0);
    expect(mockCalls).toEqual(["prepare:"]);
    expect(updates[updates.length - 1]).toMatchObject({
      state: "failed",
      errorCode: "UPLOAD_INCOMPLETE",
      errorMessage: "venue.jpg couldn’t upload. Nothing was sent to Ari.",
    });
  });

  it("polls status after a killed finalize, fails that card PROCESSING_INTERRUPTED, and keeps the sibling Ready", async () => {
    jest.useFakeTimers();
    mockReadBytes.mockImplementation(async (source) => new Uint8Array(source.uri.endsWith(".heic.jpg") ? 30 : 10));
    let statusPolls = 0;
    mockInvoke = async (_name, { body }) => {
      if (body.action === "prepare") return prepared(["id-killed", "id-ok"]);
      if (body.action === "finalize" && body.attachment_id === "id-killed") {
        return { data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), { context: { status: 546 } }) };
      }
      if (body.action === "status") {
        statusPolls += 1;
        return statusPolls < 3
          ? { data: { outcome: { attachment_id: body.attachment_id, state: "processing" } }, error: null }
          : { data: { outcome: { attachment_id: body.attachment_id, state: "failed", code: "PROCESSING_INTERRUPTED" } }, error: null };
      }
      return { data: { outcome: { attachment_id: body.attachment_id, state: "ready", size_bytes: 10 } }, error: null };
    };
    const updates: { localId: string; patch: Partial<AriAttachmentDraft> }[] = [];
    const work = prepareAriAttachments({
      drafts: [
        draft("local-killed", "phone.heic.jpg", "image/jpeg", 30, "image"),
        draft("local-ok", "notes.jpg", "image/jpeg", 10, "image"),
      ],
      brandId: "brand-3429",
      conversationId: null,
      onUpdate: (localId, patch) => updates.push({ localId, patch }),
    });
    for (const delay of [2_000, 4_000, 8_000, 16_000, 32_000]) {
      await jest.advanceTimersByTimeAsync(delay);
    }
    await work;

    expect(statusPolls).toBe(3);
    expect(mockCalls).toEqual([
      "prepare:",
      "upload:id-killed",
      "finalize:id-killed",
      "status:id-killed",
      "status:id-killed",
      "status:id-killed",
      "upload:id-ok",
      "finalize:id-ok",
    ]);
    const finalFor = (localId: string) => updates.filter((update) => update.localId === localId).pop()?.patch;
    expect(finalFor("local-killed")).toMatchObject({
      state: "failed",
      errorCode: "PROCESSING_INTERRUPTED",
      errorMessage: "Ari couldn’t finish preparing phone.heic.jpg. Try again.",
    });
    expect(finalFor("local-ok")).toMatchObject({ state: "ready" });
    // Never a batch finalize.
    expect(mockCalls.some((call) => call.startsWith("finalize:") && call === "finalize:")).toBe(false);
  });

  it("fails PROCESSING_INTERRUPTED when every status poll is lost to transport", async () => {
    jest.useFakeTimers();
    mockReadBytes.mockResolvedValue(new Uint8Array(5));
    mockInvoke = async (_name, { body }) => {
      if (body.action === "prepare") return prepared(["id-offline"]);
      throw new Error("network down");
    };
    const updates: Partial<AriAttachmentDraft>[] = [];
    const work = prepareAriAttachments({
      drafts: [draft("local-offline", "list.csv", "text/csv", 5, "csv")],
      brandId: "brand-3429",
      conversationId: null,
      onUpdate: (_localId, patch) => updates.push(patch),
    });
    for (const delay of [2_000, 4_000, 8_000, 16_000, 32_000]) {
      await jest.advanceTimersByTimeAsync(delay);
    }
    await work;
    expect(mockCalls.filter((call) => call.startsWith("status:"))).toHaveLength(5);
    expect(updates[updates.length - 1]).toMatchObject({ state: "failed", errorCode: "PROCESSING_INTERRUPTED" });
  });
});

describe("#3429 SC-R1-D4-2 client failure copy", () => {
  it("equals the committed server snapshot and only ENCRYPTED_FILE mentions passwords", () => {
    const snapshot = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, "../../../../supabase/functions/_shared/__tests__/issue_3429_ari_failure_copy.snapshot.json"),
      "utf8",
    )) as Record<string, string>;
    expect({ ...ARI_ATTACHMENT_FAILURE_COPY }).toEqual(snapshot);
    for (const [code, copy] of Object.entries(ARI_ATTACHMENT_FAILURE_COPY)) {
      expect({ code, mentionsPassword: /password/i.test(copy) }).toEqual({ code, mentionsPassword: code === "ENCRYPTED_FILE" });
    }
    expect(stableFailure("SOMETHING_UNKNOWN", "menu.pdf")).not.toMatch(/password/i);
    expect(stableFailure("DUPLICATE_FILE", "menu.pdf")).toBe("menu.pdf is already attached.");
  });
});
