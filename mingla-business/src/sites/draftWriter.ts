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
import type { SectionEdit } from "./contentApi";

export const AUTOSAVE_IDLE_MS = 600;

export type DraftJob =
  | { kind: "edit"; pageId: string; sectionId: string; edits: SectionEdit[]; label: string }
  | { kind: "layout"; pageId: string; sectionId: string; layout: string; label: string }
  | { kind: "move"; pageId: string; sectionId: string; toIndex: number; label: string }
  | { kind: "remove"; pageId: string; sectionId: string; label: string }
  | { kind: "add"; pageId: string; type: string; afterSectionId: string | null; label: string }
  | { kind: "media"; pageId: string; sectionId: string; slot: string; mediaId: string; label: string }
  | { kind: "reviewed"; pageId: string; sectionIds: string[] | "all"; label: string };

export type SaveState = "idle" | "waiting" | "saving" | "saved" | "error";

export type DraftWriterDeps = {
  /** Sends one job against `revision`; resolves with the page's new revision (null: unchanged/unknown). */
  send: (job: DraftJob, revision: string) => Promise<string | null>;
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
  /** Any other change: typing waiting on the same page is sent first, in order. */
  enqueue: (job: DraftJob) => Promise<void>;
  /** Send everything now (leaving the panel, opening Publish). */
  flush: () => Promise<void>;
  pending: () => number;
  dispose: () => void;
};

type Typing = { pageId: string; sectionId: string; label: string; edits: Map<string, string>; timer: ReturnType<typeof setTimeout> | null };

export function createDraftWriter(deps: DraftWriterDeps): DraftWriter {
  const idleMs = deps.idleMs ?? AUTOSAVE_IDLE_MS;
  const typing = new Map<string, Typing>();
  const queues = new Map<string, DraftJob[]>();
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
        const job = queue?.shift();
        if (!job) break;
        const revision = deps.getRevision(pageId);
        if (revision === null) {
          const dropped = queue?.length ?? 0;
          queues.delete(pageId);
          failed = true;
          deps.onError(new Error("PAGE_NOT_LOADED"), job, dropped);
          break;
        }
        try {
          const next = await deps.send(job, revision);
          if (disposed) return;
          if (typeof next === "string" && next.length > 0) deps.setRevision(pageId, next);
          failed = false;
          deps.onSaved(job);
        } catch (error) {
          if (disposed) return;
          // Whatever was queued behind it was made against a draft that no
          // longer exists: drop it rather than write over a teammate.
          const dropped = queue?.length ?? 0;
          queues.delete(pageId);
          failed = true;
          deps.onError(error, job, dropped);
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

  const push = (job: DraftJob): Promise<void> => {
    const queue = queues.get(job.pageId) ?? [];
    queue.push(job);
    queues.set(job.pageId, queue);
    return drain(job.pageId);
  };

  const sendTyping = (id: string): Promise<void> => {
    const entry = typing.get(id);
    if (!entry) return Promise.resolve();
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
      if (disposed) return Promise.resolve();
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
