/**
 * #4453 Website workspace — autosave. Typing is saved 600 ms after the owner
 * stops; every other change (layout, move, remove, add, photo) is saved at
 * once. Writes to one page run strictly one after another, each stating the
 * revision the last one returned, so two quick changes can never clash with
 * each other. A real clash (a teammate saved first) stops the queue, drops
 * what was waiting and is reported once, so nothing is written over.
 *
 * No React here: the workspace hook owns one writer per site.
 */
import type { SectionEdit, SectionListOp } from "./contentApi";

export const AUTOSAVE_IDLE_MS = 600;

export type DraftJob =
  | { kind: "edit"; pageId: string; sectionId: string; edits: SectionEdit[]; label: string }
  | { kind: "list"; pageId: string; sectionId: string; ops: SectionListOp[]; label: string }
  | { kind: "layout"; pageId: string; sectionId: string; layout: string; label: string }
  | { kind: "move"; pageId: string; sectionId: string; toIndex: number; label: string }
  | { kind: "remove"; pageId: string; sectionId: string; label: string }
  | { kind: "add"; pageId: string; type: string; afterSectionId: string | null; mediaId?: string | null; label: string }
  | { kind: "media"; pageId: string; sectionId: string; slot: string; mediaId: string | null; label: string }
  | { kind: "reviewed"; pageId: string; sectionIds: string[] | "all"; label: string };

export type SaveState = "idle" | "waiting" | "saving" | "saved" | "error";

export type DraftWriterDeps = {
  /**
   * Sends one job against `revision`; resolves with the page's new revision (null: unchanged/unknown).
   * `revision` is null only for a job that states none (`needsRevision` false).
   */
  send: (job: DraftJob, revision: string | null) => Promise<string | null>;
  getRevision: (pageId: string) => string | null;
  setRevision: (pageId: string, revision: string) => void;
  onState: (state: SaveState) => void;
  onSaved: (job: DraftJob) => void;
  onError: (error: unknown, job: DraftJob, dropped: number) => void;
  idleMs?: number;
};

export type DraftWriter = {
  /** A keystroke: coalesced per section and key, sent after the idle delay. */
  typeField: (pageId: string, sectionId: string, key: string, value: string, label: string) => void;
  /** Any other change: typing waiting on the same page is sent first, in order. Resolves true only when it was saved. */
  enqueue: (job: DraftJob) => Promise<boolean>;
  /** Send everything now (leaving the panel, opening Publish). */
  flush: () => Promise<void>;
  pending: () => number;
  dispose: () => void;
};

/**
 * "Looks good" is the one change the server takes without a revision
 * (`mark_reviewed` reads the page itself), so it can be sent for a page whose
 * sections were never opened here: the Publish panel's read-first list and
 * Ari's "Looks good" span every page, not only the one on screen.
 */
export function needsRevision(job: DraftJob): boolean {
  return job.kind !== "reviewed";
}

type Typing = { pageId: string; sectionId: string; label: string; edits: Map<string, string>; timer: ReturnType<typeof setTimeout> | null };

export function createDraftWriter(deps: DraftWriterDeps): DraftWriter {
  const idleMs = deps.idleMs ?? AUTOSAVE_IDLE_MS;
  const typing = new Map<string, Typing>();
  const queues = new Map<string, { job: DraftJob; done: (saved: boolean) => void }[]>();
  const running = new Map<string, Promise<void>>();
  let disposed = false;
  let failed = false;

  const waitingCount = () => typing.size + [...queues.values()].reduce((sum, queue) => sum + queue.length, 0);
  const report = () => {
    if (disposed) return;
    if (running.size > 0) deps.onState("saving");
    else if (typing.size > 0) deps.onState("waiting");
    else deps.onState(failed ? "error" : "saved");
  };

  const drain = (pageId: string): Promise<void> => {
    const existing = running.get(pageId);
    if (existing) return existing;
    const run = (async () => {
      for (;;) {
        const queue = queues.get(pageId);
        const entry = queue?.shift();
        if (!entry) break;
        const { job, done } = entry;
        const dropRest = (): number => {
          const rest = queue ?? [];
          queues.delete(pageId);
          rest.forEach((waiting) => waiting.done(false));
          return rest.length;
        };
        const revision = deps.getRevision(pageId);
        if (revision === null && needsRevision(job)) {
          failed = true;
          done(false);
          deps.onError(new Error("PAGE_NOT_LOADED"), job, dropRest());
          break;
        }
        try {
          const next = await deps.send(job, revision);
          if (disposed) {
            done(true);
            return;
          }
          if (typeof next === "string" && next.length > 0) deps.setRevision(pageId, next);
          failed = false;
          deps.onSaved(job);
          done(true);
        } catch (error) {
          done(false);
          if (disposed) return;
          // Whatever was queued behind it was made against a draft that no
          // longer exists: drop it rather than write over a teammate.
          failed = true;
          deps.onError(error, job, dropRest());
          break;
        }
      }
    })().finally(() => {
      running.delete(pageId);
      report();
    });
    running.set(pageId, run);
    report();
    return run;
  };

  const push = (job: DraftJob): Promise<boolean> => new Promise<boolean>((resolve) => {
    const queue = queues.get(job.pageId) ?? [];
    queue.push({ job, done: resolve });
    queues.set(job.pageId, queue);
    void drain(job.pageId);
  });

  const sendTyping = (id: string): Promise<boolean> => {
    const entry = typing.get(id);
    if (!entry) return Promise.resolve(true);
    if (entry.timer) clearTimeout(entry.timer);
    typing.delete(id);
    const edits = [...entry.edits.entries()].map(([key, value]) => ({ key, value }));
    return push({ kind: "edit", pageId: entry.pageId, sectionId: entry.sectionId, edits, label: entry.label });
  };

  const flushPage = (pageId: string | null): Promise<void> => {
    const sends = [...typing.entries()].filter(([, entry]) => pageId === null || entry.pageId === pageId).map(([id]) => sendTyping(id));
    return Promise.all(sends).then(() => undefined);
  };

  return {
    typeField(pageId, sectionId, key, value, label) {
      if (disposed) return;
      const id = `${pageId}:${sectionId}`;
      const entry = typing.get(id) ?? { pageId, sectionId, label, edits: new Map<string, string>(), timer: null };
      entry.edits.set(key, value);
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => { void sendTyping(id); }, idleMs);
      typing.set(id, entry);
      report();
    },
    enqueue(job) {
      if (disposed) return Promise.resolve(false);
      void flushPage(job.pageId);
      return push(job);
    },
    async flush() {
      await flushPage(null);
      await Promise.all([...running.values()]);
    },
    pending: waitingCount,
    dispose() {
      disposed = true;
      queues.forEach((queue) => queue.forEach((waiting) => waiting.done(false)));
      for (const entry of typing.values()) if (entry.timer) clearTimeout(entry.timer);
      typing.clear();
      queues.clear();
    },
  };
}

/** "Saved", "Saving…" and friends, under the brand name. */
export function saveStateLine(state: SaveState, readOnly: boolean): string {
  if (readOnly) return "Website · view only";
  switch (state) {
    case "waiting":
    case "saving": return "Website · saving…";
    case "error": return "Website · not saved";
    case "saved":
    case "idle": return "Website · saved";
  }
}
