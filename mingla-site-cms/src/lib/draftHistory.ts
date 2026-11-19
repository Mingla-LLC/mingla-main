/**
 * #4453 website workspace (build contract C) — undo and redo for the draft.
 *
 * Every draft change the Website workspace or Ari makes records what each
 * thing it touched (a page, the look, the menu) was before and what it became,
 * in the `draft-changes` collection. Rows of one change share a group; a group
 * is undone and redone as a whole.
 *
 *   - Undo writes `before` back (with the target's CURRENT revision) only while
 *     the target still equals `after`; redo writes `after` back only while it
 *     still equals `before`. The comparison ignores row ids and review stamps.
 *     Anything else is CHANGED_SINCE and nothing is written.
 *   - A restored section keeps the review stamp it had in the snapshot.
 *   - A new change marks every undone group superseded (it can no longer be
 *     redone).
 *   - Typing merges: the same person editing the same field of the same
 *     section again within 30 seconds continues the previous row.
 *   - The latest 200 rows per site are kept.
 *
 * Drafts only. Nothing here publishes and nothing here is read by the builder.
 */
import type { PayloadRequest } from "payload";

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const HISTORY_ROW_CAP = 200;
export const HISTORY_LIST_MAX = 30;
export const TYPING_MERGE_MS = 30_000;
export const MAX_GROUP_LABEL = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The site's look, as one undoable thing. */
export const LOOK_KEYS = ["design", "tokens", "fonts", "radius", "button_shape", "motion"] as const;
/** The header menu, as one undoable thing. */
export const MENU_KEYS = ["items"] as const;

export type HistoryActor = "user" | "ari" | "team";
export type HistoryTarget = "page" | "look" | "menu";

export type HistoryContext = {
  req: PayloadRequest;
  /** The member's tenant-scoped request (overrideAccess false). */
  scoped: PayloadRequest;
  tenantId: string;
  userId: string;
};

export type ChangeRow = {
  target: HistoryTarget;
  targetId: string | null;
  label: string;
  before: AnyDoc | null;
  after: AnyDoc | null;
  /** Set for a typing edit: the same key within 30 s continues the previous row. */
  mergeKey?: string | null;
};

export type ChangeGroup = { groupId: string | null; groupLabel: string | null };

export class HistoryRefusal extends Error {
  constructor(code: string, readonly extra: Record<string, unknown> = {}) {
    super(code);
    this.name = "AriRefusal"; // both endpoints relay a refusal of this name with its detail
  }
}

/** `group_id` / `group_label` as a write may send them (both optional). */
export function parseChangeGroup(args: AnyDoc): ChangeGroup {
  const rawId = args.group_id;
  const rawLabel = args.group_label;
  if (rawId !== undefined && rawId !== null && (typeof rawId !== "string" || !UUID.test(rawId))) {
    throw new HistoryRefusal("VALIDATION_FAILED", { problems: ["group_id must be a uuid"] });
  }
  if (rawLabel !== undefined && rawLabel !== null &&
    (typeof rawLabel !== "string" || rawLabel.length > MAX_GROUP_LABEL || /<\s*\/?\s*[a-z!]/i.test(rawLabel))) {
    throw new HistoryRefusal("VALIDATION_FAILED", { problems: [`group_label must be plain text up to ${MAX_GROUP_LABEL} characters`] });
  }
  return {
    groupId: typeof rawId === "string" ? rawId.toLowerCase() : null,
    groupLabel: typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : null,
  };
}

// ---------------------------------------------------------------------------
// Snapshots and their comparison.
// ---------------------------------------------------------------------------

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)) as T);

/** A page as history keeps it: whether it is on, and its sections (ids and stamps included). */
export function pageSnapshot(page: AnyDoc): AnyDoc {
  return { enabled: page.enabled !== false, blocks: clone(Array.isArray(page.blocks) ? page.blocks : []) };
}

/** "This page did not exist": what a page a change CREATED was before it. */
export const PAGE_ABSENT: Readonly<AnyDoc> = { exists: false };

export function pickSnapshot(doc: AnyDoc | null | undefined, keys: readonly string[]): AnyDoc {
  const out: AnyDoc = {};
  for (const key of keys) out[key] = clone(doc?.[key] ?? null);
  return out;
}

/** Content only: no row ids, no review stamps, no empty values, key order ignored. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: AnyDoc = {};
    for (const key of Object.keys(value as AnyDoc).sort()) {
      if (key === "id" || key === "review" || key === "blockName") continue;
      const next = canonical((value as AnyDoc)[key]);
      if (next === null || next === undefined) continue;
      if (Array.isArray(next) && next.length === 0) continue;
      out[key] = next;
    }
    return out;
  }
  return value;
}

export function sameContent(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function pageMatches(page: AnyDoc | undefined, snapshot: AnyDoc | null): boolean {
  if (!page || !snapshot) return false;
  if (snapshot.exists === false) return page.enabled === false;
  return sameContent(pageSnapshot(page), { enabled: snapshot.enabled !== false, blocks: snapshot.blocks ?? [] });
}

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

function tenantWhere(ctx: HistoryContext, ...more: AnyDoc[]): AnyDoc {
  return { and: [{ tenant: { equals: ctx.tenantId } }, ...more] };
}

async function findRows(ctx: HistoryContext, where: AnyDoc, options: { sort?: string; limit?: number; page?: number } = {}): Promise<AnyDoc[]> {
  const result = await ctx.req.payload.find({
    collection: "draft-changes",
    overrideAccess: true,
    depth: 0,
    sort: options.sort ?? "-seq",
    limit: options.limit ?? HISTORY_ROW_CAP,
    ...(options.page ? { page: options.page } : {}),
    where: where as never,
  });
  return result.docs as AnyDoc[];
}

/**
 * Records one change (one row per thing it touched) and returns its group id.
 * Rows whose `before` and `after` hold the same content are not recorded.
 */
export async function recordChanges(
  ctx: HistoryContext,
  actor: HistoryActor,
  rows: readonly ChangeRow[],
  group: ChangeGroup = { groupId: null, groupLabel: null },
  tool: string | null = null,
  operationId: string | null = null,
): Promise<string> {
  const groupId = group.groupId ?? crypto.randomUUID();
  const real = rows.filter((row) => !sameContent(row.before, row.after));
  if (!real.length) return groupId;
  const latest = (await findRows(ctx, tenantWhere(ctx), { limit: 1 }))[0];

  // Typing: the same person, section and field again within 30 s continues the last row.
  const only = real.length === 1 ? real[0]! : null;
  if (
    only?.mergeKey && latest && latest.state === "applied" && latest.merge_key === only.mergeKey &&
    latest.actor === actor && String(latest.actor_user_id ?? "") === ctx.userId &&
    (group.groupId === null || group.groupId === latest.group_id) &&
    Date.now() - Date.parse(String(latest.updatedAt ?? latest.createdAt ?? "")) <= TYPING_MERGE_MS
  ) {
    // A row typed back to where it started still stands as a row (undo is then a no-op the owner can see).
    await ctx.req.payload.update({
      collection: "draft-changes",
      id: latest.id,
      overrideAccess: true,
      depth: 0,
      data: { after: only.after, label: only.label.slice(0, 160) } as never,
    });
    return String(latest.group_id);
  }

  // A new change: what was undone can no longer be redone.
  await ctx.req.payload.update({
    collection: "draft-changes",
    overrideAccess: true,
    depth: 0,
    where: tenantWhere(ctx, { state: { equals: "undone" } }) as never,
    data: { state: "superseded" } as never,
  });

  let seq = Number(latest?.seq ?? 0);
  for (const row of real) {
    seq += 1;
    await ctx.req.payload.create({
      collection: "draft-changes",
      overrideAccess: true,
      depth: 0,
      data: {
        tenant: ctx.tenantId,
        group_id: groupId,
        seq,
        label: row.label.slice(0, 160),
        group_label: group.groupLabel,
        actor,
        actor_user_id: ctx.userId,
        target: row.target,
        target_id: row.targetId,
        before: row.before,
        after: row.after,
        state: "applied",
        merge_key: row.mergeKey ?? null,
        tool,
        operation_id: operationId,
      } as never,
    });
  }

  // Keep the latest 200 rows per site.
  const edge = (await findRows(ctx, tenantWhere(ctx), { limit: 1, page: HISTORY_ROW_CAP }))[0];
  if (edge && Number.isFinite(Number(edge.seq))) {
    await ctx.req.payload.delete({
      collection: "draft-changes",
      overrideAccess: true,
      where: tenantWhere(ctx, { seq: { less_than: Number(edge.seq) } }) as never,
    });
  }
  return groupId;
}

type Group = { id: string; rows: AnyDoc[]; state: "applied" | "undone" | "superseded"; label: string; actor: HistoryActor; userId: string | null; at: string; top: number; low: number };

function groupsOf(rows: readonly AnyDoc[]): Group[] {
  const byId = new Map<string, AnyDoc[]>();
  for (const row of rows) {
    const id = String(row.group_id);
    byId.set(id, [...(byId.get(id) ?? []), row]);
  }
  const groups: Group[] = [];
  for (const [id, members] of byId) {
    const ordered = [...members].sort((a, b) => Number(a.seq) - Number(b.seq));
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const state = ordered.some((row) => row.state === "applied") ? "applied" : ordered.some((row) => row.state === "undone") ? "undone" : "superseded";
    groups.push({
      id,
      rows: ordered,
      state,
      label: String(first.group_label || first.label || "Change"),
      actor: first.actor === "ari" ? "ari" : first.actor === "team" ? "team" : "user",
      userId: typeof first.actor_user_id === "string" ? first.actor_user_id : null,
      at: String(last.updatedAt ?? last.createdAt ?? ""),
      top: Number(last.seq),
      low: Number(first.seq),
    });
  }
  return groups.sort((a, b) => b.top - a.top);
}

async function allGroups(ctx: HistoryContext): Promise<Group[]> {
  return groupsOf(await findRows(ctx, tenantWhere(ctx)));
}

const nextUndo = (groups: readonly Group[]) => groups.find((group) => group.state === "applied") ?? null;
const nextRedo = (groups: readonly Group[]) => [...groups].filter((group) => group.state === "undone").sort((a, b) => a.low - b.low)[0] ?? null;

/** What the undo and redo buttons would do right now. */
export async function historySummary(ctx: HistoryContext): Promise<{ can_undo: boolean; can_redo: boolean; undo_label: string | null; redo_label: string | null }> {
  const groups = await allGroups(ctx);
  const undo = nextUndo(groups);
  const redo = nextRedo(groups);
  return { can_undo: undo !== null, can_redo: redo !== null, undo_label: undo?.label ?? null, redo_label: redo?.label ?? null };
}

/** The newest 30 changes, each as the owner reads it. */
export async function listHistory(ctx: HistoryContext): Promise<{ entries: Array<{ group_id: string; label: string; actor: "you" | "teammate" | "ari" | "team"; at: string; state: "applied" | "undone" }> }> {
  const groups = (await allGroups(ctx)).filter((group) => group.state !== "superseded").slice(0, HISTORY_LIST_MAX);
  return {
    entries: groups.map((group) => ({
      group_id: group.id,
      label: group.label,
      actor: group.actor === "user" ? (group.userId === ctx.userId ? "you" : "teammate") : group.actor,
      at: group.at,
      state: group.state as "applied" | "undone",
    })),
  };
}

/** The state of the latest group a tool made (the design pass asks whether its last run was undone). */
export async function latestToolGroup(ctx: Pick<HistoryContext, "req" | "tenantId">, tool: string, since: string | null): Promise<{ state: "applied" | "undone" | "superseded"; changed_at: string } | null> {
  const result = await ctx.req.payload.find({
    collection: "draft-changes",
    overrideAccess: true,
    depth: 0,
    sort: "-seq",
    limit: 1,
    where: { and: [
      { tenant: { equals: ctx.tenantId } },
      { tool: { equals: tool } },
      ...(since ? [{ createdAt: { greater_than: since } }] : []),
    ] } as never,
  });
  const row = result.docs[0] as AnyDoc | undefined;
  if (!row) return null;
  return { state: row.state, changed_at: String(row.updatedAt ?? row.createdAt ?? "") };
}

// ---------------------------------------------------------------------------
// Undo / redo.
// ---------------------------------------------------------------------------

export type UndoResult = { group_id: string; label: string | null; pages: string[]; look: boolean; menu: boolean };

async function one(ctx: HistoryContext, collection: "site-settings" | "navigation", req = ctx.scoped): Promise<AnyDoc | null> {
  return ((await ctx.req.payload.find({
    collection, req, overrideAccess: false, draft: true, depth: 0, limit: 1, where: { tenant: { equals: ctx.tenantId } },
  })).docs[0] as AnyDoc | undefined) ?? null;
}

function stripRowIds(items: unknown): AnyDoc[] {
  return (Array.isArray(items) ? items as AnyDoc[] : []).map(({ id: _id, children, ...rest }) => ({
    ...rest,
    ...(Array.isArray(children) ? { children: children.map(({ id: _child, ...child }: AnyDoc) => child) } : {}),
  }));
}

async function inTransaction<T>(ctx: HistoryContext, work: (req: PayloadRequest) => Promise<T>): Promise<T> {
  const db = ctx.req.payload.db as unknown as {
    beginTransaction?: () => Promise<string | number | null>;
    commitTransaction?: (id: string | number) => Promise<void>;
    rollbackTransaction?: (id: string | number) => Promise<void>;
  } | undefined;
  const id = db?.beginTransaction ? await db.beginTransaction() : null;
  if (id === null || id === undefined) return work(ctx.scoped);
  try {
    const result = await work({ ...ctx.scoped, transactionID: id } as PayloadRequest);
    await db!.commitTransaction!(id);
    return result;
  } catch (error) {
    await db!.rollbackTransaction!(id).catch(() => undefined);
    throw error;
  }
}

/**
 * Undo or redo one group (the latest undoable / redoable one when none is
 * named). Every target is checked before anything is written.
 */
export async function undoRedo(ctx: HistoryContext, direction: "undo" | "redo", groupId: string | null, options: { missingIsNoop?: boolean } = {}): Promise<UndoResult> {
  const groups = await allGroups(ctx);
  const wanted = direction === "undo" ? "applied" : "undone";
  const nothing = direction === "undo" ? "NOTHING_TO_UNDO" : "NOTHING_TO_REDO";
  const group = groupId ? groups.find((candidate) => candidate.id === groupId.toLowerCase()) ?? null : direction === "undo" ? nextUndo(groups) : nextRedo(groups);
  if (!group || group.state !== wanted) {
    if (options.missingIsNoop && groupId) return { group_id: groupId.toLowerCase(), label: group?.label ?? null, pages: [], look: false, menu: false };
    throw new HistoryRefusal(nothing);
  }

  // One chain per target: several steps of one group may touch the same page.
  type Chain = { target: HistoryTarget; targetId: string | null; from: AnyDoc | null; to: AnyDoc | null };
  const chains = new Map<string, Chain>();
  for (const row of group.rows) {
    const key = `${row.target}:${row.target_id ?? ""}`;
    const chain = chains.get(key);
    if (chain) chain.to = row.after ?? null;
    else chains.set(key, { target: row.target, targetId: row.target_id ?? null, from: row.before ?? null, to: row.after ?? null });
  }
  // Undo: the thing must still be what the change left (`to`), and goes back to `from`. Redo: the reverse.
  const plan = [...chains.values()].map((chain) => (direction === "undo" ? { ...chain, must: chain.to, write: chain.from } : { ...chain, must: chain.from, write: chain.to }));

  const pageIds = plan.filter((step) => step.target === "page").map((step) => String(step.targetId));
  const pages = pageIds.length
    ? ((await ctx.req.payload.find({
        collection: "pages", req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, pagination: false,
        where: { and: [{ tenant: { equals: ctx.tenantId } }, { id: { in: pageIds } }] },
      })).docs as AnyDoc[])
    : [];
  const pageById = new Map(pages.map((page) => [String(page.id), page]));
  const settings = plan.some((step) => step.target === "look") ? await one(ctx, "site-settings") : null;
  const navigation = plan.some((step) => step.target === "menu") ? await one(ctx, "navigation") : null;

  for (const step of plan) {
    const same = step.target === "page"
      ? pageMatches(pageById.get(String(step.targetId)), step.must)
      : step.target === "look"
        ? settings !== null && step.must !== null && sameContent(pickSnapshot(settings, Object.keys(step.must)), step.must)
        : navigation !== null && step.must !== null && sameContent(pickSnapshot(navigation, Object.keys(step.must)), step.must);
    if (!same || step.write === null) {
      throw new HistoryRefusal("CHANGED_SINCE", { target: step.target, ...(step.target === "page" ? { page_id: step.targetId } : {}) });
    }
  }

  try {
    await inTransaction(ctx, async (req) => {
      // The snapshot's own stamps come back; a booking section that was on the page is not "new".
      const restoring = { ...req, context: { ...req.context, minglaRestoreStamps: true, minglaBookingBlocks: true, minglaReviewSource: undefined, minglaOwnerEdit: undefined } } as PayloadRequest;
      for (const step of plan) {
        const write = step.write!;
        if (step.target === "page") {
          const page = pageById.get(String(step.targetId))!;
          const data = write.exists === false ? { enabled: false } : { enabled: write.enabled !== false, blocks: write.blocks ?? [] };
          await ctx.req.payload.update({
            collection: "pages", id: page.id, req: restoring, overrideAccess: false, draft: true, depth: 0,
            data: { ...data, revision: page.revision } as never,
          });
        } else if (step.target === "look") {
          await ctx.req.payload.update({
            collection: "site-settings", id: settings!.id, req, overrideAccess: false, draft: true, depth: 0, data: write as never,
          });
        } else {
          const data = { ...write, ...("items" in write ? { items: stripRowIds(write.items) } : {}) };
          await ctx.req.payload.update({
            collection: "navigation", id: navigation!.id, req, overrideAccess: false, draft: true, depth: 0, data: data as never,
          });
        }
      }
      await ctx.req.payload.update({
        collection: "draft-changes",
        overrideAccess: true,
        depth: 0,
        req,
        where: tenantWhere(ctx, { group_id: { equals: group.id } }) as never,
        data: { state: direction === "undo" ? "undone" : "applied" } as never,
      });
    });
  } catch (error) {
    if (error instanceof HistoryRefusal) throw error;
    // The page moved under us, or a photo it used has gone: nothing is half-restored inside a transaction.
    if (error instanceof Error && (error.message === "REVISION_CONFLICT" || error.name === "ValidationError" || error.message === "MEDIA_REJECTED")) {
      throw new HistoryRefusal("CHANGED_SINCE");
    }
    throw error;
  }
  return {
    group_id: group.id,
    label: group.label,
    pages: [...new Set(pageIds)],
    look: plan.some((step) => step.target === "look"),
    menu: plan.some((step) => step.target === "menu"),
  };
}
