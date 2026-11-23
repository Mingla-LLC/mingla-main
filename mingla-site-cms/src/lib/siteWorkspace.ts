/**
 * #4453 website workspace (build contract B) — Ari's three workspace actions.
 *
 *   get_site_workspace      one compact snapshot to plan from: every page with
 *                           its sections (what each holds and which layouts
 *                           this design draws), the look and its readability
 *                           warnings, the menu, the section types that can be
 *                           added, the owner's approved photos and videos, and
 *                           the Mingla facts Core signed in. Under 24 KB: long
 *                           words are cut at 280 characters and flagged.
 *   apply_site_change       ONE typed step, applied to the draft as Ari: the
 *                           same checks as the owner's own section actions,
 *                           plus Ari's rules (copy cites its source and is
 *                           truth-checked, a layout must be one this design
 *                           draws, a photo must be ready, a button never links
 *                           a booking off Mingla, colours stay readable). The
 *                           section it touches is stamped Draft, by Ari. Each
 *                           step reads the current revision itself and tries
 *                           once more when it clashes.
 *   undo_site_change_group  takes back every step of one change set (a run
 *                           that failed part-way leaves nothing half-applied).
 *
 * Core is the only caller, after it checked the member's rank and signed the
 * evidence. Drafts only: nothing here publishes.
 */
import { isBlockType } from "../contracts/generated/blocks.ts";
import { ENQUIRY_LABEL_FIELDS, BOOKING_THROUGH_ENQUIRY, offersBooking } from "../contracts/generated/claims.ts";
import type { WorkLogCite } from "../contracts/generated/ariToolSchemas.ts";
import { relationId } from "./pageTree";
import {
  AriRefusal, assertAriBookingLock, assertBacked, assertCites, decisionOf, loadDraftState,
  ownerQuotes, siteDesign, tokensView, writeWorkLog, type AriActionContext,
} from "./ariSiteActions";
import { parseChangeGroup, undoRedo, type HistoryContext } from "./draftHistory";
import { isClaimDuplicate } from "./designPass";
import { createHash } from "node:crypto";
import {
  addSection, describeSections, editSection, moveSection, removeSection, sectionCatalog, setLook, setMenuItems,
  setPageEnabled, setSectionMedia, workspacePages, type SectionContext,
} from "./sectionActions";

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SITE_WORKSPACE_ACTIONS: ReadonlySet<string> = new Set(["get_site_workspace", "apply_site_change", "undo_site_change_group"]);

/** The snapshot's size limit, in bytes of JSON. */
export const WORKSPACE_MAX_BYTES = 24 * 1024;
export const WORKSPACE_VALUE_MAX = 280;

function refuse(code: string, extra: Record<string, unknown> = {}): never {
  throw new AriRefusal(code, extra);
}

function sectionContext(ctx: AriActionContext, group: SectionContext["group"]): SectionContext {
  return {
    req: ctx.req,
    scoped: ctx.scoped,
    tenantId: ctx.tenantId,
    userId: ctx.userId.toLowerCase(),
    actor: "ari",
    group,
    bookingBlocks: ctx.scoped.context?.minglaBookingBlocks === true,
    operationId: ctx.operationId ?? null,
  };
}

const historyContext = (ctx: AriActionContext): HistoryContext => ({ req: ctx.req, scoped: ctx.scoped, tenantId: ctx.tenantId, userId: ctx.userId.toLowerCase() });

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

// ---------------------------------------------------------------------------
// get_site_workspace
// ---------------------------------------------------------------------------

function cut(value: string, max: number): { value: string; truncated?: true } {
  return value.length > max ? { value: `${value.slice(0, max - 1)}…`, truncated: true } : { value };
}

/** The snapshot at one level of detail (0 is the fullest); each level drops what planning needs least. */
/** #4572 item 9 — Home's cover as the workspace knows it: none (a colour panel), a photo, a photo and a video. */
export function homeCoverFacts(pages: readonly AnyDoc[]): { available: boolean; has_photo: boolean; has_video: boolean } {
  const home = pages.find((page) => !page.parent && (page.slug ?? "") === "");
  const hero = (Array.isArray(home?.blocks) ? (home!.blocks as AnyDoc[]) : []).find((block) => block.blockType === "hero");
  if (!hero) return { available: false, has_photo: false, has_video: false };
  return { available: true, has_photo: Boolean(relationId(hero.media)), has_video: Boolean(relationId(hero.video)) };
}

function snapshotAt(level: number, input: { draft: Awaited<ReturnType<typeof loadDraftState>>; navigation: AnyDoc | null; ctx: AriActionContext }): AnyDoc {
  const { draft, navigation, ctx } = input;
  const settings = draft.settings ?? {};
  const design = siteDesign(settings);
  const look = tokensView(settings);
  const valueMax = level >= 1 ? 120 : WORKSPACE_VALUE_MAX;
  const rows = workspacePages(draft.pages, navigation);
  const byId = new Map(draft.pages.map((page) => [String(page.id), page]));
  const pages = rows.map((row, at) => {
    // Past the size limit, pages further down the menu keep their sections but not the words in them
    // (then not their fields); only then does the first page lose its words too.
    const wordless = (level >= 3 && at > 0) || level >= 5;
    const fieldless = (level >= 4 && at > 0) || level >= 6;
    const sections = describeSections(byId.get(row.id)!, design, "ari").map((section) => ({
      id: section.id,
      index: section.index,
      type: section.type,
      label: section.label,
      layout: section.layout,
      ...(level >= 2 ? {} : { layouts: section.layouts.map((layout) => layout.key) }),
      feed: section.feed,
      review: section.review,
      fields: section.fields.map((field) => (wordless ? { key: field.key } : { key: field.key, ...cut(field.value, valueMax) })),
      // Lists whose rows a step may add, remove or move (`list_ops`), with the fields of one row.
      ...(section.lists.length && level < 5 ? { lists: section.lists.map((list) => ({ name: list.name, min: list.min, max: list.max, count: list.count, fields: list.fields.map((field) => field.key) })) } : {}),
      // Every photo spot, the empty ones too (`media_id: null`): a step names a spot by its slot, so Ari
      // can only fill a spot it has been shown.
      ...(section.media.length ? { media: section.media.map((slot) => ({ slot: slot.slot, media_id: slot.media_id })) } : {}),
    }));
    return { id: row.id, title: row.title, path: row.path, enabled: row.enabled, in_menu: row.in_menu, ari_draft: row.ari_draft, sections: fieldless ? sections.map(({ fields: _fields, ...rest }) => rest) : sections };
  });
  const menu = ((Array.isArray(navigation?.items) ? navigation!.items : []) as AnyDoc[])
    .filter((item) => item.target_type !== "url" && relationId(item.page))
    .map((item) => ({ page_id: relationId(item.page), label: String(item.label ?? "") }));
  const mediaMax = level >= 2 ? 20 : 60;
  const offeringMax = level >= 2 ? 12 : 40;
  const brand = ctx.evidence?.brand;
  return {
    draft_digest: draft.digest,
    truncated_at: valueMax,
    ...(level > 0 ? { compacted: true } : {}),
    pages,
    look: {
      design,
      tokens: look.tokens,
      fonts: look.fonts,
      readability_warnings: look.readability_warnings.map((warning) => ({ sentence: warning.sentence, nearest_readable: warning.suggestion })),
    },
    menu,
    // #4572 item 9 — whether Home has a cover Ari may talk about (Design → Cover).
    home_cover: homeCoverFacts(draft.pages),
    addable_sections: sectionCatalog(design, "ari").map((entry) => ({ type: entry.type, label: entry.label, needs_photo: entry.needs_photo })),
    media: draft.media.slice(0, mediaMax).map((item) => ({
      id: String(item.id),
      kind: String(item.detected_mime ?? "").startsWith("video/") ? "video" : "photo",
      caption: cut(String(item.original_filename_safe ?? ""), 80).value,
    })),
    facts: {
      brand: brand ? { id: brand.id, name: brand.name, city: brand.city, description: brand.description ? cut(brand.description, valueMax).value : null } : null,
      offerings: (ctx.evidence?.offerings ?? []).slice(0, offeringMax).map((row) => ({
        id: row.id, kind: row.kind ?? null, title: row.title ? cut(row.title, 120).value : null,
        start_at: row.start_at ?? null, min_price_minor: row.min_price_minor ?? null, currency: row.currency ?? null,
      })),
    },
  };
}

export async function getSiteWorkspace(ctx: AriActionContext): Promise<AnyDoc> {
  const draft = await loadDraftState(ctx.req, ctx.scoped, ctx.tenantId);
  const navigation = draft.navigation;
  let snapshot: AnyDoc = {};
  for (let level = 0; level <= 6; level += 1) {
    snapshot = snapshotAt(level, { draft, navigation, ctx });
    if (bytes(snapshot) <= WORKSPACE_MAX_BYTES) return snapshot;
  }
  // Still too big (a very large site): keep whole pages from the top until it fits, and say what was left out.
  const pages = snapshot.pages as AnyDoc[];
  const kept: AnyDoc[] = [];
  const left: AnyDoc[] = [];
  for (const page of pages) {
    const stub = { id: page.id, title: page.title, path: page.path, enabled: page.enabled, in_menu: page.in_menu, ari_draft: page.ari_draft, sections_omitted: true };
    if (!left.length && bytes({ ...snapshot, pages: [...kept, page, ...pages.slice(kept.length + 1).map(() => stub)] }) <= WORKSPACE_MAX_BYTES) kept.push(page);
    else left.push(stub);
  }
  snapshot = { ...snapshot, pages: [...kept, ...left] };
  while (bytes(snapshot) > WORKSPACE_MAX_BYTES && (snapshot.media.length || snapshot.facts.offerings.length)) {
    snapshot = { ...snapshot, media: snapshot.media.slice(0, Math.floor(snapshot.media.length / 2)), facts: { ...snapshot.facts, offerings: snapshot.facts.offerings.slice(0, Math.floor(snapshot.facts.offerings.length / 2)) } };
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// apply_site_change
// ---------------------------------------------------------------------------

const STEP_OPS = ["edit_section", "move_section", "remove_section", "add_section", "set_section_media", "set_look", "set_menu", "set_page_enabled"] as const;
type StepOp = (typeof STEP_OPS)[number];

const STEP_KEYS: Readonly<Record<StepOp, readonly string[]>> = {
  edit_section: ["page_id", "section_id", "edits", "layout", "list_ops"],
  move_section: ["page_id", "section_id", "to_index"],
  remove_section: ["page_id", "section_id"],
  add_section: ["page_id", "type", "after_section_id", "edits", "media_id"],
  set_section_media: ["page_id", "section_id", "slot", "media_id"],
  set_look: ["design", "tokens", "fonts", "radius", "button_shape", "motion"],
  set_menu: ["items"],
  set_page_enabled: ["page_id", "enabled"],
};

const WORK_LOG_PART: Readonly<Record<StepOp, string>> = {
  edit_section: "copy", move_section: "composition", remove_section: "composition", add_section: "composition",
  set_section_media: "imagery", set_look: "tokens", set_menu: "composition", set_page_enabled: "composition",
};

/** Does this step write words a visitor reads? Those must cite their source. */
function writesCopy(op: StepOp, step: AnyDoc): boolean {
  if (op === "set_menu") return true;
  if (op === "edit_section" && Array.isArray(step.list_ops) && step.list_ops.some((row: AnyDoc) => row?.op === "add")) return true;
  return (op === "edit_section" || op === "add_section") && Array.isArray(step.edits) && step.edits.length > 0;
}

function parseStep(value: unknown): { op: StepOp; step: AnyDoc } {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("VALIDATION_FAILED", { problems: ["step is required"] });
  const step = value as AnyDoc;
  const op = step.op as StepOp;
  if (!(STEP_OPS as readonly unknown[]).includes(op)) refuse("VALIDATION_FAILED", { problems: [`step.op must be one of ${STEP_OPS.join(", ")}`] });
  const unknown = Object.keys(step).filter((key) => key !== "op" && !STEP_KEYS[op].includes(key));
  // A step never names a revision: it reads the current one itself.
  if (unknown.length) refuse("VALIDATION_FAILED", { problems: unknown.slice(0, 8).map((key) => `step.${key} is not part of ${op}`) });
  return { op, step };
}

async function runStep(op: StepOp, step: AnyDoc, sections: SectionContext, ctx: AriActionContext, cites: readonly WorkLogCite[]): Promise<AnyDoc> {
  const owner = ownerQuotes(cites);
  // Copy: nothing the feed, the brand's own words or a cited owner source can't back; no booking off Mingla.
  const checkCopy = (block: AnyDoc, texts: string[]) => {
    assertBacked(ctx, texts, owner);
    const type = String(block.blockType ?? "");
    if (!isBlockType(type)) return;
    for (const field of ENQUIRY_LABEL_FIELDS[type] ?? []) {
      if (typeof block[field] === "string" && offersBooking(block[field])) refuse(BOOKING_THROUGH_ENQUIRY, { problems: [`${field} offers a booking on a question form`] });
    }
    assertAriBookingLock(ctx, [{ ...block, type }], "section");
  };
  switch (op) {
    case "edit_section": {
      const done = await editSection(sections, step, checkCopy);
      return { page_revision: done.pageRevision, touched: { page_id: String(done.page.id), section_id: done.sectionId } };
    }
    case "move_section": {
      const done = await moveSection(sections, step);
      return { page_revision: done.pageRevision, touched: { page_id: String(done.page.id), section_id: done.sectionId } };
    }
    case "remove_section": {
      const done = await removeSection(sections, step);
      return { page_revision: done.pageRevision, touched: { page_id: String(done.page.id) } };
    }
    case "add_section": {
      const done = await addSection(sections, step, checkCopy);
      return { page_revision: done.pageRevision, touched: { page_id: String(done.page.id), section_id: done.sectionId } };
    }
    case "set_section_media": {
      const done = await setSectionMedia(sections, step);
      return { page_revision: done.pageRevision, touched: { page_id: String(done.page.id), section_id: done.sectionId } };
    }
    case "set_look": {
      const done = await setLook(sections, step);
      return { look_revision: done.look_revision, warnings: done.warnings.map((warning) => warning.sentence), touched: {} };
    }
    case "set_menu": {
      if (Array.isArray(step.items)) assertBacked(ctx, (step.items as AnyDoc[]).map((item) => String(item?.label ?? "")), owner);
      const done = await setMenuItems(sections, step);
      return { menu_revision: done.menu_revision, touched: {} };
    }
    case "set_page_enabled": {
      const done = await setPageEnabled(sections, step);
      return { page_revision: done.pageRevision, touched: { page_id: String(done.page.id) } };
    }
  }
}

/*
 * A step runs once per operation id. Ari's executor names each step (Core
 * signs the id into the envelope) and may send it again after a timeout:
 *   - the step already ran: the repeat answers with the FIRST result, and
 *     nothing is applied again (the result is kept on the step's history rows);
 *   - the first try is still running: STEP_IN_PROGRESS (retryable), never a
 *     second copy of the change;
 *   - the first try was refused or failed: its claim is given back, so the
 *     repeat simply runs.
 * The claim is a row in the same ledger that refuses replayed Core calls
 * (`gateway-nonces.nonce` is UNIQUE), kept for ten minutes.
 */
export const STEP_CLAIM_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stepClaimKey = (ctx: AriActionContext, operationId: string) =>
  `site-step:${createHash("sha256").update(`${ctx.tenantId}|${operationId}`).digest("hex").slice(0, 48)}`;

async function firstResult(ctx: AriActionContext, operationId: string): Promise<{ found: boolean; result: AnyDoc | null }> {
  const rows = (await ctx.req.payload.find({
    collection: "draft-changes", overrideAccess: true, depth: 0, limit: 1, sort: "seq",
    where: { and: [{ tenant: { equals: ctx.tenantId } }, { operation_id: { equals: operationId } }] } as never,
  })).docs as AnyDoc[];
  const result = rows[0]?.result;
  return { found: rows.length > 0, result: result && typeof result === "object" ? result as AnyDoc : null };
}

async function releaseStep(ctx: AriActionContext, nonce: string): Promise<void> {
  try {
    await ctx.req.payload.delete({ collection: "gateway-nonces", overrideAccess: true, where: { nonce: { equals: nonce } } });
  } catch (error) {
    // Not swallowed: logged. The claim then expires on its own and the step can run again.
    console.error("[site-workspace] could not release a step claim", nonce, error);
  }
}

/** Runs `work` once for this operation id; a repeat gets the first result. */
async function oncePerOperation(ctx: AriActionContext, work: () => Promise<AnyDoc>): Promise<AnyDoc> {
  const operationId = typeof ctx.operationId === "string" && UUID.test(ctx.operationId) ? ctx.operationId.toLowerCase() : null;
  // No id (an older Core): the step runs as it always did.
  if (!operationId) return work();
  const nonce = stepClaimKey(ctx, operationId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await firstResult(ctx, operationId);
    if (before.result) return { ...before.result, repeated: true };
    try {
      await ctx.req.payload.create({
        collection: "gateway-nonces",
        overrideAccess: true,
        data: { nonce, direction: "core_to_cms", site_id: ctx.siteId, operation_id: "apply_site_change", expires_at: new Date(Date.now() + STEP_CLAIM_TTL_MS).toISOString() } as never,
      });
      break;
    } catch (error) {
      if (!isClaimDuplicate(error)) throw error;
      // Claimed already. An expired claim was left behind by a try that never finished: clear it once.
      const held = (await ctx.req.payload.find({ collection: "gateway-nonces", overrideAccess: true, depth: 0, limit: 1, where: { nonce: { equals: nonce } } })).docs[0] as AnyDoc | undefined;
      const expires = Date.parse(String(held?.expires_at ?? ""));
      if (attempt === 0 && Number.isFinite(expires) && expires <= Date.now()) {
        await ctx.req.payload.delete({ collection: "gateway-nonces", overrideAccess: true, where: { nonce: { equals: nonce }, expires_at: { less_than: new Date().toISOString() } } });
        continue;
      }
      refuse("STEP_IN_PROGRESS", { retryable: true });
    }
  }
  let result: AnyDoc;
  try {
    result = await work();
  } catch (error) {
    await releaseStep(ctx, nonce);
    throw error;
  }
  const stored = await ctx.req.payload.update({
    collection: "draft-changes", overrideAccess: true, depth: 0,
    where: { and: [{ tenant: { equals: ctx.tenantId } }, { operation_id: { equals: operationId } }] } as never,
    data: { result } as never,
  }) as unknown as { docs?: unknown[] };
  // A step that changed nothing left no row to answer a repeat from; running it again changes nothing either.
  if (!stored?.docs?.length) await releaseStep(ctx, nonce);
  return result;
}

const isClash = (error: unknown) => error instanceof Error && error.message === "REVISION_CONFLICT";

export async function applySiteChange(args: AnyDoc, ctx: AriActionContext): Promise<AnyDoc> {
  const group = parseChangeGroup(args);
  if (!group.groupId) refuse("VALIDATION_FAILED", { problems: ["group_id is required"] });
  if (!group.groupLabel) refuse("VALIDATION_FAILED", { problems: ["group_label is required"] });
  const decision = decisionOf(args.why);
  const { op, step } = parseStep(args.step);
  const cited = Array.isArray(args.cites) && args.cites.length > 0;
  // Words need a source; a move, a removal or a photo swap may go without one.
  if (!cited && writesCopy(op, step)) refuse("CITATION_REQUIRED", { problem: "cites needs at least one citation" });
  const cites = cited ? await assertCites(ctx, args.cites) : [];
  const sections = sectionContext(ctx, group);
  return oncePerOperation(ctx, () => applyOnce({ op, step, sections, ctx, cites, decision, groupId: group.groupId! }));
}

async function applyOnce(input: { op: StepOp; step: AnyDoc; sections: SectionContext; ctx: AriActionContext; cites: WorkLogCite[]; decision: string; groupId: string }): Promise<AnyDoc> {
  const { op, step, sections, ctx, cites, decision } = input;
  let result: AnyDoc;
  try {
    result = await runStep(op, step, sections, ctx, cites);
  } catch (error) {
    // Someone saved between this step's read and its write: read again, once.
    if (!isClash(error)) throw error;
    try {
      result = await runStep(op, step, sections, ctx, cites);
    } catch (again) {
      if (isClash(again) && !(again instanceof AriRefusal)) refuse("REVISION_CONFLICT");
      throw again;
    }
  }
  if (cites.length) {
    const touched = (result.touched ?? {}) as AnyDoc;
    await writeWorkLog(ctx, {
      part: WORK_LOG_PART[op],
      decision,
      cites,
      tool: "apply_site_change",
      target: touched.page_id ? `page:${touched.page_id}${touched.section_id ? `#${touched.section_id}` : ""}` : op === "set_look" ? "design" : "menu",
      revision: String(result.page_revision ?? result.look_revision ?? result.menu_revision ?? ""),
    });
  }
  return { ok: true, group_id: input.groupId, ...result, draft_only: true };
}

// ---------------------------------------------------------------------------
// undo_site_change_group
// ---------------------------------------------------------------------------

export async function undoSiteChangeGroup(args: AnyDoc, ctx: AriActionContext): Promise<AnyDoc> {
  const group = parseChangeGroup(args);
  if (!group.groupId) refuse("VALIDATION_FAILED", { problems: ["group_id is required"] });
  // A run whose first step failed recorded nothing: rolling it back is then done already.
  const result = await undoRedo(historyContext(ctx), "undo", group.groupId, { missingIsNoop: true });
  return { ...result, undone: result.pages.length > 0 || result.look || result.menu, draft_only: true };
}

export async function runSiteWorkspaceAction(action: string, args: AnyDoc, ctx: AriActionContext): Promise<AnyDoc> {
  if (action === "get_site_workspace") return getSiteWorkspace(ctx);
  if (action === "apply_site_change") return applySiteChange(args, ctx);
  return undoSiteChangeGroup(args, ctx);
}
