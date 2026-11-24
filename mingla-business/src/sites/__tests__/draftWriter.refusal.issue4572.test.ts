/*
 * #4572 item 11 (F-3) — a refused typing save used to drop every change
 * queued behind it (a layout picked after the caption) and roll the page back,
 * so the next keystroke saved "s" over the heading. A refusal leaves the
 * revision where it was: the queue now keeps draining, and the refused job
 * reports "refused". A conflict (the page moved) and PAGE_NOT_LOADED still
 * drop the rest.
 * FAILS-ON-REVERT: without `keepsQueue` the layout job is never sent and the
 * error reports "conflict" with one dropped job.
 */
import { createDraftWriter, type DraftJob } from "../draftWriter";

class Refused extends Error {}
class Conflict extends Error {}
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function harness(refuse: (job: DraftJob) => Error | null) {
  const sent: DraftJob[] = [];
  const errors: { job: DraftJob; dropped: number; kind: string }[] = [];
  let counter = 0;
  const revisions = new Map<string, string>([["p1", "r0"]]);
  const writer = createDraftWriter({
    send: async (job) => {
      const failure = refuse(job);
      if (failure) throw failure;
      sent.push(job);
      counter += 1;
      return `r${counter}`;
    },
    getRevision: (pageId) => revisions.get(pageId) ?? null,
    setRevision: (pageId, revision) => { revisions.set(pageId, revision); },
    onState: () => undefined,
    onSaved: () => undefined,
    onError: (_error, job, dropped, kind) => errors.push({ job, dropped, kind }),
    keepsQueue: (error) => error instanceof Refused,
    idleMs: 1,
  });
  return { writer, sent, errors };
}

describe("#4572 item 11 — a refused save never loses the changes behind it", () => {
  it("a refused caption edit keeps the queue: the layout picked after it is still sent", async () => {
    const { writer, sent, errors } = harness((job) => (job.kind === "edit" ? new Refused("VALIDATION_FAILED") : null));
    writer.typeField("p1", "g1", "heading", "Exhibition", "Edit Photos");
    writer.typeField("p1", "g1", "images.0.caption", "Opening night", "Edit Photos");
    const layout = writer.enqueue({ kind: "layout", pageId: "p1", sectionId: "g1", layout: "pinned", label: "Change Photos layout" });
    await settle();
    await expect(layout).resolves.toBe(true);
    expect(sent.map((job) => job.kind)).toEqual(["layout"]);
    expect(errors).toEqual([expect.objectContaining({ kind: "refused", dropped: 0 })]);
    const refused = errors[0]!.job;
    expect(refused.kind === "edit" && refused.edits.map((edit) => [edit.key, edit.value])).toEqual([["heading", "Exhibition"], ["images.0.caption", "Opening night"]]);
  });

  it("the next keystroke sends the whole kept text the field shows ('Exhibitions', never 's')", async () => {
    let refuseOnce = true;
    const { writer, sent } = harness((job) => (job.kind === "edit" && refuseOnce ? ((refuseOnce = false), new Refused("x")) : null));
    writer.typeField("p1", "g1", "heading", "Exhibition", "Edit Photos");
    await writer.flush();
    await settle();
    // The field reads the kept words ("Exhibition"), so the keystroke is "Exhibition" + "s".
    writer.typeField("p1", "g1", "heading", "Exhibitions", "Edit Photos");
    await writer.flush();
    await settle();
    const last = sent.at(-1)!;
    expect(last.kind === "edit" && last.edits).toEqual([{ key: "heading", value: "Exhibitions" }]);
  });

  it("a conflict still drops the rest (never written over a teammate)", async () => {
    const { writer, sent, errors } = harness((job) => (job.kind === "edit" ? new Conflict("REVISION_CONFLICT") : null));
    writer.typeField("p1", "g1", "heading", "Exhibition", "Edit Photos");
    const layout = writer.enqueue({ kind: "layout", pageId: "p1", sectionId: "g1", layout: "pinned", label: "Change Photos layout" });
    await settle();
    await expect(layout).resolves.toBe(false);
    expect(sent).toEqual([]);
    expect(errors).toEqual([expect.objectContaining({ kind: "conflict", dropped: 1 })]);
  });

  it("PAGE_NOT_LOADED still stops the queue (reported as a conflict, never drained past)", async () => {
    const { writer, errors } = harness(() => null);
    const job = writer.enqueue({ kind: "layout", pageId: "unknown", sectionId: "g1", layout: "pinned", label: "x" });
    await settle();
    await expect(job).resolves.toBe(false);
    expect(errors[0]).toEqual(expect.objectContaining({ kind: "conflict" }));
    expect((errors[0] as unknown as { job: { kind: string } }).job.kind).toBe("layout");
  });
});
