/* eslint-disable import/first */
/**
 * #4382 Wave 4 — Host app support requests (implementor).
 *
 * Replaces supportService.test.ts, which pinned the retired
 * create_support_ticket(p_subject, p_brand_id) call.
 *
 * Pins:
 *   - create: issue_4382_create_customer_ticket with p_app 'host', topic,
 *     summary, details, attachment ids, brand and client_meta; client_meta
 *     carries only app/device keys, never a location;
 *   - screenshots: register (issue_4382_register_support_attachment, kind
 *     image, the backend's MIME) then upload to exactly the returned path in
 *     the private support-attachments bucket; more than 10, over 10 MB or a
 *     non-image never reach the server;
 *   - "My requests" is filtered to requester = me (staff who are also hosts
 *     no longer see the whole queue) and never lists an internal ticket;
 *   - send: text, screenshots or both through support-send; a 409 from a
 *     closed request becomes a ticket_closed error;
 *   - the thread's composer is replaced by "Start a new request" when the
 *     request is closed; the banner follows status and the next update.
 *
 *   - Product banner: issue_4382_ticket_product_stage drives "Passed to our
 *     product team", "Product team: being built" and "Product team: final
 *     checks"; a stage the server does not send (shipped, told) shows none.
 *
 * FAILS-ON-REVERT: dropping `.eq("requester_user_id", userId)` from
 * listOwnSupportTickets, adding a location key through buildSupportClientMeta,
 * changing p_app away from 'host', or returning "composer" for a closed
 * request turns this red.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

type DbResult = Promise<{ data: unknown; error: unknown }>;
const rpcMock = jest.fn<(...args: unknown[]) => DbResult>();
const invokeMock = jest.fn<(...args: unknown[]) => DbResult>();
const uploadMock = jest.fn<(...args: unknown[]) => DbResult>();
const storageFromMock = jest.fn((..._a: unknown[]) => ({ upload: uploadMock }));
const calls: { method: string; args: unknown[] }[] = [];
let listResult: { data: unknown; error: unknown } = { data: [], error: null };

function chain(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "not", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.order = (...args: unknown[]) => {
    calls.push({ method: "order", args });
    return Promise.resolve(listResult);
  };
  return builder;
}
const fromMock = jest.fn((...args: unknown[]) => {
  calls.push({ method: "from", args });
  return chain();
});

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (...args: unknown[]) => fromMock(...args),
    storage: { from: (...args: unknown[]) => storageFromMock(...args) },
  },
}));

import {
  SupportSendError,
  createSupportTicket,
  getSupportProductStage,
  listOwnSupportTickets,
  sendSupportMessage,
  uploadSupportImage,
} from "../supportService";
import {
  MAX_SUPPORT_IMAGES,
  addSupportImages,
  buildHostCreateTicketArgs,
  buildSupportClientMeta,
  keepOwnTickets,
  parseSupportProductStage,
  supportComposerMode,
  supportProductBannerKeys,
  supportCopy,
  supportStatusBanner,
  type SupportPickedImage,
} from "../../components/support/supportRequestModel";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const ROOT = path.resolve(__dirname, "../../..");

beforeEach(() => {
  rpcMock.mockReset();
  invokeMock.mockReset();
  uploadMock.mockReset();
  storageFromMock.mockClear();
  fromMock.mockClear();
  calls.length = 0;
  listResult = { data: [], error: null };
});

describe("#4382 Host new request", () => {
  test("create calls issue_4382_create_customer_ticket with p_app host and the whole form", async () => {
    rpcMock.mockResolvedValue({ data: REQUEST, error: null });
    const id = await createSupportTicket({
      clientRequestId: REQUEST,
      topic: "payouts",
      summary: "  Payout balance shows 0  ",
      details: " Since Friday my balance shows 0. ",
      attachmentIds: ["a1", "a2"],
      clientMeta: { app_version: "1.4.0", os: "ios", os_version: "18.1", device_model: "iPhone", source_screen: "account/support" },
      brandId: "brand-1",
    });
    expect(id).toBe(REQUEST);
    expect(rpcMock).toHaveBeenCalledWith("issue_4382_create_customer_ticket", {
      p_client_request_id: REQUEST,
      p_app: "host",
      p_topic: "payouts",
      p_subject: "Payout balance shows 0",
      p_message: "Since Friday my balance shows 0.",
      p_attachment_ids: ["a1", "a2"],
      p_client_meta: { app_version: "1.4.0", os: "ios", os_version: "18.1", device_model: "iPhone", source_screen: "account/support" },
      p_brand_id: "brand-1",
      p_visibility: "person",
    });
  });

  test("client_meta never carries a location or any other key", () => {
    const meta = buildSupportClientMeta({
      app_version: "1.4.0",
      os: "android",
      os_version: 34,
      device_model: "Pixel 8",
      source_screen: "account/support",
      latitude: 6.45,
      longitude: 3.39,
      location: "Lagos",
      device_os: "android",
    });
    expect(Object.keys(meta).sort()).toEqual(["app_version", "device_model", "os", "os_version", "source_screen"]);
    expect(meta.os_version).toBe("34");
    expect(JSON.stringify(meta)).not.toMatch(/lat|lon|location/i);
    expect(buildSupportClientMeta({ device_model: "unknown", os: "" })).toEqual({});
  });

  test("an unknown topic and a blank form never reach the server", async () => {
    expect(() =>
      buildHostCreateTicketArgs({
        clientRequestId: REQUEST,
        topic: "broken" as never,
        summary: "x",
        details: "y",
        attachmentIds: [],
        clientMeta: {},
        brandId: null,
      }),
    ).toThrow("invalid_topic");
    await expect(
      createSupportTicket({ clientRequestId: REQUEST, topic: "events", summary: "  ", details: "y", attachmentIds: [], clientMeta: {}, brandId: null }),
    ).rejects.toThrow();
    await expect(
      createSupportTicket({ clientRequestId: REQUEST, topic: "events", summary: "s", details: "  ", attachmentIds: [], clientMeta: {}, brandId: null }),
    ).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("a database refusal is thrown, never swallowed", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not_brand_member" } });
    await expect(
      createSupportTicket({ clientRequestId: REQUEST, topic: "venue", summary: "s", details: "d", attachmentIds: [], clientMeta: {}, brandId: "b" }),
    ).rejects.toThrow("not_brand_member");
  });
});

describe("#4382 Host screenshots", () => {
  const image = (n: number, extra: Partial<SupportPickedImage> = {}): SupportPickedImage => ({
    uri: `file:///shot-${n}.jpg`,
    name: `shot-${n}.jpg`,
    mimeType: "image/jpeg",
    size: 1000,
    ...extra,
  });

  test("at most 10 images; over 10 MB and non-images are refused", () => {
    const nine = Array.from({ length: 9 }, (_, i) => image(i));
    const next = addSupportImages(nine, [image(9), image(10), image(11, { size: 11 * 1024 * 1024 }), image(12, { mimeType: "video/mp4", name: "clip.mp4" })]);
    expect(next.images).toHaveLength(MAX_SUPPORT_IMAGES);
    expect(next.refusals.sort()).toEqual(["too_large", "too_many", "wrong_type"]);
  });

  test("register then upload to the exact returned path in the private bucket", async () => {
    rpcMock.mockResolvedValue({
      data: { attachment_id: "att-1", bucket: "support-attachments", storage_path: `${REQUEST}/abc.png`, ticket_id: REQUEST, draft: true },
      error: null,
    });
    uploadMock.mockResolvedValue({ data: {}, error: null });
    const id = await uploadSupportImage(REQUEST, image(1, { mimeType: "image/png", name: "a.png", size: 2048, width: 100, height: 200 }));
    expect(id).toBe("att-1");
    expect(rpcMock).toHaveBeenCalledWith("issue_4382_register_support_attachment", {
      p_ticket_id: REQUEST,
      p_kind: "image",
      p_mime: "image/png",
      p_bytes: 2048,
      p_width: 100,
      p_height: 200,
      p_duration_ms: null,
      p_is_internal: false,
    });
    expect(storageFromMock).toHaveBeenCalledWith("support-attachments");
    expect(uploadMock.mock.calls[0][0]).toBe(`${REQUEST}/abc.png`);
    expect(uploadMock.mock.calls[0][2]).toEqual({ contentType: "image/png", upsert: false });
  });

  test("an oversized or wrong-type image is refused before it is registered", async () => {
    await expect(uploadSupportImage(REQUEST, image(1, { size: 10 * 1024 * 1024 + 1 }))).rejects.toThrow();
    await expect(uploadSupportImage(REQUEST, image(2, { mimeType: "application/pdf", name: "x.pdf" }))).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("#4382 My requests = requester is me", () => {
  test("the query filters on requester_user_id and hides internal tickets", async () => {
    listResult = {
      data: [
        { id: "t1", requester_user_id: ME, visibility: "person" },
        { id: "t2", requester_user_id: OTHER, visibility: "person" },
        { id: "t3", requester_user_id: ME, visibility: "internal" },
      ],
      error: null,
    };
    const rows = await listOwnSupportTickets(ME);
    expect(calls).toContainEqual({ method: "eq", args: ["requester_user_id", ME] });
    expect(calls).toContainEqual({ method: "neq", args: ["visibility", "internal"] });
    expect(rows.map((row) => row.id)).toEqual(["t1"]);
  });

  test("keepOwnTickets drops someone else's and internal rows", () => {
    expect(
      keepOwnTickets(
        [
          { requester_user_id: ME, visibility: "brand" },
          { requester_user_id: null, visibility: "internal" },
          { requester_user_id: OTHER, visibility: "person" },
        ],
        ME,
      ),
    ).toEqual([{ requester_user_id: ME, visibility: "brand" }]);
  });

  test("a DB error throws (no silent empty list)", async () => {
    listResult = { data: null, error: { message: "rls denied" } };
    await expect(listOwnSupportTickets(ME)).rejects.toThrow("rls denied");
  });
});

describe("#4382 Host thread", () => {
  test("a closed request swaps the composer for Start a new request", () => {
    expect(supportComposerMode("closed")).toBe("start_new");
    for (const status of ["new", "open", "pending", "resolved"]) {
      expect(supportComposerMode(status)).toBe("composer");
    }
  });

  test("the banner follows status and shows only a future next update", () => {
    const now = Date.parse("2026-11-10T10:00:00Z");
    expect(supportStatusBanner({ status: "open", next_update_at: "2026-11-11T12:00:00Z" }, now)).toEqual({ kind: "waiting_mingla", nextUpdateAt: "2026-11-11T12:00:00Z" });
    expect(supportStatusBanner({ status: "pending", next_update_at: "2026-11-09T12:00:00Z" }, now)).toEqual({ kind: "waiting_you", nextUpdateAt: null });
    expect(supportStatusBanner({ status: "resolved" }, now).kind).toBe("resolved");
    expect(supportStatusBanner({ status: "closed", next_update_at: "2026-11-11T12:00:00Z" }, now)).toEqual({ kind: "closed", nextUpdateAt: null });
  });

  test("send carries screenshots and the requester mode; images alone are allowed", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, message_id: "m1", status: "open", reopened: true }, error: null });
    const result = await sendSupportMessage("ticket-1", "  ", { attachmentIds: ["a1"] });
    expect(invokeMock).toHaveBeenCalledWith("support-send", {
      body: { ticketId: "ticket-1", content: "", actorMode: "requester", attachmentIds: ["a1"] },
    });
    expect(result).toEqual({ messageId: "m1", status: "open", reopened: true });
  });

  test("a requester can never send an internal note", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    await sendSupportMessage("ticket-1", "hi", { isInternal: true });
    expect((invokeMock.mock.calls[0][1] as { body: Record<string, unknown> }).body.isInternal).toBeUndefined();
    await sendSupportMessage("ticket-1", "note", { actorMode: "staff", isInternal: true });
    expect((invokeMock.mock.calls[1][1] as { body: Record<string, unknown> }).body).toEqual({
      ticketId: "ticket-1", content: "note", actorMode: "staff", isInternal: true,
    });
  });

  test("a 409 from a closed request is a ticket_closed error", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: { status: 409, json: async () => ({ error: "ticket_closed", message: "This request is closed." }) },
      },
    });
    const failure = sendSupportMessage("ticket-1", "hello").catch((err: unknown) => err);
    const err = await failure;
    expect(err).toBeInstanceOf(SupportSendError);
    expect((err as SupportSendError).code).toBe("ticket_closed");
  });

  test("the thread renders images, internal notes and the closed state", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/components/support/SupportThreadCore.tsx"), "utf8");
    expect(src).toContain("supportComposerMode(ticket?.status)");
    expect(src).toContain('supportCopy("thread.start_new")');
    expect(src).toContain("SupportImageViewer");
    expect(src).toContain("message.is_internal");
    const inbox = fs.readFileSync(path.join(ROOT, "app/support/inbox.tsx"), "utf8");
    expect(inbox).toContain("?mode=staff");
  });

  test("every support copy key used resolves to English text", () => {
    const files = [
      "src/components/support/SupportThreadCore.tsx",
      "src/components/support/SupportTabPanel.tsx",
      "src/components/support/SupportNewRequestForm.tsx",
      "src/components/support/SupportMedia.tsx",
      "app/support/inbox.tsx",
    ];
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const match of src.matchAll(/supportCopy\("([a-z_.]+)"/g)) {
        expect(supportCopy(match[1])).not.toBe(match[1]);
      }
    }
    expect(supportCopy("form.images_hint", { max: 10 })).toBe("Optional. Up to 10 images, 10 MB each.");
  });
});

describe("#4382 Host Product banner", () => {
  test("reads the customer-safe stage RPC for this ticket", async () => {
    rpcMock.mockResolvedValueOnce({ data: { stage: "being_built", board_status_label: "In Progress" }, error: null });
    await expect(getSupportProductStage(REQUEST)).resolves.toBe("being_built");
    expect(rpcMock).toHaveBeenCalledWith("issue_4382_ticket_product_stage", { p_ticket_id: REQUEST });
  });

  test("no stage (shipped, told, stranger) means no banner; a failed read throws", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(getSupportProductStage(REQUEST)).resolves.toBeNull();
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getSupportProductStage(REQUEST)).rejects.toThrow("permission denied");
    expect(parseSupportProductStage({ stage: "told" })).toBeNull();
    expect(parseSupportProductStage("being_built")).toBeNull();
    expect(parseSupportProductStage([])).toBeNull();
  });

  test("each stage has the approved wording", () => {
    const words = (stage: "passed_to_product" | "being_built" | "final_checks") => {
      const keys = supportProductBannerKeys(stage);
      return [supportCopy(keys.title), supportCopy(keys.body)];
    };
    expect(words("passed_to_product")).toEqual([
      "Passed to our product team",
      "This needs a change to the app. We'll tell you here when it's fixed.",
    ]);
    expect(words("being_built")).toEqual(["Product team: being built", "Updated automatically"]);
    expect(words("final_checks")).toEqual(["Product team: final checks", "Updated automatically"]);
  });

  test("the thread shows the Product banner and never lets it block the thread", () => {
    const core = fs.readFileSync(path.join(ROOT, "src/components/support/SupportThreadCore.tsx"), "utf8");
    expect(core).toContain("getSupportProductStage(ticket.id)");
    expect(core).toMatch(/productStage !== null && !isInternalTicket/);
    expect(core).toMatch(/catch \(err\) \{\s*console\.warn\("\[support\] reading the Product stage failed"/);
  });
});
