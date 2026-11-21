/**
 * #4420 — "Talk to a person": Ari's last question and photos reach the
 * host's support conversation (spec part 2, 4.6; server action
 * `copy_to_support`, agent-attachments/copyToSupport.ts).
 *
 * FAILS-ON-REVERT: dropping the "already delivered" guard in
 * runSupportHandover double-sends on retry (block 4); letting one refused
 * photo abort the hand-over loses the text (block 3); carrying Ari's reply
 * instead of the host's message fails block 1.
 */
import {
  COPY_REFUSAL_CODES,
  HandoverError,
  asCopyRefusalCode,
  handOverPayloadFromMessages,
  photoReasonKey,
  runSupportHandover,
  type CopyPhotoResult,
  type HandoverDeps,
} from "../supportHandover";

const wording = {
  fromAri: (text: string) => `From my chat with Ari: ${text}`,
  photoOnlySubject: "Photo from a chat with Ari",
  photoOnlyMessage: "From my chat with Ari: I sent a photo.",
};

function image(id: string) {
  return { id, file_type: "image", original_filename: `${id}.jpg` };
}

interface Calls {
  create: { clientRequestId: string; subject: string; message: string }[];
  copy: [string, string][];
  send: [string, string, string[]][];
}

function fakeDeps(options: {
  openId?: string | null;
  copy?: (ariId: string) => CopyPhotoResult | Promise<CopyPhotoResult>;
  sendFails?: number;
  findFails?: boolean;
} = {}): { deps: HandoverDeps; calls: Calls } {
  const calls: Calls = { create: [], copy: [], send: [] };
  let sendFailures = options.sendFails ?? 0;
  let requestCounter = 0;
  const deps: HandoverDeps = {
    findOpenConversation: async () => {
      if (options.findFails) throw new Error("offline");
      return options.openId ?? null;
    },
    createConversation: async (input) => {
      calls.create.push(input);
      // Idempotent on the client request id, like the RPC.
      return `ticket-${input.clientRequestId}`;
    },
    copyPhoto: async (ariId, ticketId) => {
      calls.copy.push([ariId, ticketId]);
      return options.copy ? options.copy(ariId) : { ok: true, supportAttachmentId: `s-${ariId}` };
    },
    send: async (ticketId, content, ids) => {
      calls.send.push([ticketId, content, [...ids]]);
      if (sendFailures > 0) {
        sendFailures -= 1;
        throw new Error("support-send failed");
      }
    },
    newRequestId: () => `req-${++requestCounter}`,
  };
  return { deps, calls };
}

describe("#4420 Ari to a person hand-over", () => {
  test("1. the payload is the host's LAST message, never Ari's reply", () => {
    const payload = handOverPayloadFromMessages([
      { role: "user", content: { text: "old question" } },
      { role: "assistant", content: { text: "an answer" } },
      { role: "user", content: { text: " My payout is late ", attachments: [image("a1"), { id: "d1", file_type: "pdf" }] } },
      { role: "assistant", content: { text: "Ari's reply" } },
      { role: "tool", content: {} },
    ]);
    expect(payload).toEqual({ text: "My payout is late", ariImageIds: ["a1"], skippedFiles: 1 });
    expect(handOverPayloadFromMessages([{ role: "assistant", content: { text: "hi" } }])).toBeNull();
    expect(handOverPayloadFromMessages([])).toBeNull();
    // A photo-only turn shows "1 attachment" in Ari: not the host's words.
    expect(handOverPayloadFromMessages([{ role: "user", content: { text: "1 attachment", attachments: [image("a2")] } }])).toEqual({
      text: null,
      ariImageIds: ["a2"],
      skippedFiles: 0,
    });
    // Junk content never throws; at most 10 images ride along.
    const many = Array.from({ length: 12 }, (_, i) => image(`m${i}`));
    expect(handOverPayloadFromMessages([{ role: "user", content: { text: "x", attachments: [...many, null, 7, { id: "" }] } }])?.ariImageIds).toHaveLength(10);
    expect(handOverPayloadFromMessages([{ role: "user", content: null }])).toBeNull();
  });

  test("2. no open conversation: create one with the text, then send only the photos", async () => {
    const { deps, calls } = fakeDeps({ openId: null });
    const outcome = await runSupportHandover({ text: "My payout is late", ariImageIds: ["a1"], skippedFiles: 0 }, deps, wording, null);
    expect(calls.create).toEqual([{ clientRequestId: "req-1", subject: "My payout is late", message: "From my chat with Ari: My payout is late" }]);
    expect(calls.copy).toEqual([["a1", "ticket-req-1"]]);
    expect(calls.send).toEqual([["ticket-req-1", "", ["s-a1"]]]);
    expect(outcome).toMatchObject({ ticketId: "ticket-req-1", createdConversation: true, photosSent: 1, photoFailures: [] });

    // An open conversation is reused: one message with the words and the photo.
    const reuse = fakeDeps({ openId: "open-1" });
    await runSupportHandover({ text: "Door scanner froze", ariImageIds: ["a9"], skippedFiles: 0 }, reuse.deps, wording, null);
    expect(reuse.calls.create).toEqual([]);
    expect(reuse.calls.send).toEqual([["open-1", "From my chat with Ari: Door scanner froze", ["s-a9"]]]);

    // Photo only, nothing open: the conversation says it came from Ari.
    const photoOnly = fakeDeps({ openId: null });
    await runSupportHandover({ text: null, ariImageIds: ["p1"], skippedFiles: 0 }, photoOnly.deps, wording, null);
    expect(photoOnly.calls.create[0]).toMatchObject({ subject: "Photo from a chat with Ari", message: "From my chat with Ari: I sent a photo." });
    expect(photoOnly.calls.send).toEqual([["ticket-req-1", "", ["s-p1"]]]);

    // Long questions are cut to a 120-character subject; the message keeps all of it.
    const long = fakeDeps({ openId: null });
    const text = "x".repeat(300);
    await runSupportHandover({ text, ariImageIds: [], skippedFiles: 0 }, long.deps, wording, null);
    expect(long.calls.create[0].subject).toHaveLength(120);
    expect(long.calls.create[0].message).toBe(`From my chat with Ari: ${text}`);
    expect(long.calls.send).toEqual([]);
  });

  test("3. every copy_to_support refusal keeps the text and the other photos", async () => {
    for (const code of COPY_REFUSAL_CODES) {
      const { deps, calls } = fakeDeps({
        openId: "open-1",
        copy: (ariId) => (ariId === "bad" ? { ok: false, code } : { ok: true, supportAttachmentId: `s-${ariId}` }),
      });
      const outcome = await runSupportHandover({ text: "Help", ariImageIds: ["good", "bad"], skippedFiles: 0 }, deps, wording, null);
      expect(calls.send).toEqual([["open-1", "From my chat with Ari: Help", ["s-good"]]]);
      expect(outcome.photoFailures).toEqual([{ ariAttachmentId: "bad", code }]);
      expect(typeof photoReasonKey(code)).toBe("string");
    }
    // A thrown copy (network) is a refusal too, never an abort.
    const thrown = fakeDeps({ openId: "open-1", copy: () => Promise.reject(new Error("offline")) });
    const outcome = await runSupportHandover({ text: "Help", ariImageIds: ["a1"], skippedFiles: 0 }, thrown.deps, wording, null);
    expect(outcome.photoFailures).toEqual([{ ariAttachmentId: "a1", code: "NETWORK" }]);
    expect(thrown.calls.send).toEqual([["open-1", "From my chat with Ari: Help", []]]);
    // Unknown codes read as network failures; the reason copy is grouped.
    expect(asCopyRefusalCode("SOMETHING_NEW")).toBe("NETWORK");
    expect(asCopyRefusalCode("FILE_TOO_LARGE")).toBe("FILE_TOO_LARGE");
    expect(photoReasonKey("FILE_TOO_LARGE")).toBe("type_or_size");
    expect(photoReasonKey("UNSUPPORTED_FOR_SUPPORT")).toBe("type_or_size");
    expect(photoReasonKey("ATTACHMENT_NOT_READY")).toBe("not_ready");
    expect(photoReasonKey("TICKET_FORBIDDEN")).toBe("unavailable");
    expect(photoReasonKey("TICKET_CLOSED")).toBe("closed");
    expect(photoReasonKey("TOO_MANY_UPLOADS")).toBe("too_many");
    expect(photoReasonKey("COPY_FAILED")).toBe("failed");
  });

  test("4. a retry never sends anything twice", async () => {
    // Send fails after the conversation was created with the text and the photo copied.
    const { deps, calls } = fakeDeps({ openId: null, sendFails: 1 });
    const payload = { text: "My payout is late", ariImageIds: ["a1"], skippedFiles: 0 };
    let progress = null;
    try {
      await runSupportHandover(payload, deps, wording, null);
      throw new Error("expected a failure");
    } catch (error) {
      expect(error).toBeInstanceOf(HandoverError);
      expect((error as HandoverError).stage).toBe("send");
      progress = (error as HandoverError).progress;
    }
    const outcome = await runSupportHandover(payload, deps, wording, progress);
    expect(calls.create).toHaveLength(1); // not created again
    expect(calls.copy).toHaveLength(1); // not copied again
    expect(calls.send).toEqual([
      ["ticket-req-1", "", ["s-a1"]],
      ["ticket-req-1", "", ["s-a1"]],
    ]);
    // A third tap after success sends nothing.
    await runSupportHandover(payload, deps, wording, outcome.progress);
    expect(calls.send).toHaveLength(2);

    // Text to an open conversation that failed to send is sent once on retry.
    const open = fakeDeps({ openId: "open-1", sendFails: 1 });
    const first = await runSupportHandover({ text: "Hi", ariImageIds: [], skippedFiles: 0 }, open.deps, wording, null).catch((e: HandoverError) => e);
    expect(first).toBeInstanceOf(HandoverError);
    const done = await runSupportHandover({ text: "Hi", ariImageIds: [], skippedFiles: 0 }, open.deps, wording, (first as HandoverError).progress);
    await runSupportHandover({ text: "Hi", ariImageIds: [], skippedFiles: 0 }, open.deps, wording, done.progress);
    expect(open.calls.send.filter(([, content]) => content.length > 0)).toHaveLength(2);
    expect(open.calls.send).toHaveLength(2);
  });

  test("5. nothing reachable: the failure says where it stopped, nothing was sent", async () => {
    const { deps, calls } = fakeDeps({ findFails: true });
    const error = await runSupportHandover({ text: "Hi", ariImageIds: ["a1"], skippedFiles: 0 }, deps, wording, null).catch((e: HandoverError) => e);
    expect(error).toBeInstanceOf(HandoverError);
    expect((error as HandoverError).stage).toBe("find");
    expect(calls).toEqual({ create: [], copy: [], send: [] });
  });
});
