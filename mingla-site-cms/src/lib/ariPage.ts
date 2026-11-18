/**
 * #4453 milestone 11 (spec v2.1 §3) — "Add a page with Ari", the Studio side.
 *
 * Core reaches the two Ari actions only while SITES_ARI_ADD_PAGE covers the
 * brand (it signs `add_page` in; without it both refuse ARI_ADD_PAGE_OFF).
 *
 *   propose_site_page          applied on the owner's confirm, at the stated
 *                              draft revision: ONE disabled page marked Draft
 *                              by Ari (origin "ari", ari_draft true) with every
 *                              block Draft, the owner's request verbatim and
 *                              the owner-only questions, ONE Draft menu entry,
 *                              ONE work-log entry. All or nothing.
 *   answer_site_page_question  Ari relays the owner's answer word for word.
 *
 * The owner's own actions (the content route: "Ari needs this" Save,
 * "Publish this page", "Remove") are `runOwnerAriPageAction`.
 *
 * Nothing here is ever published: the builder copies an allowlist of page
 * keys, keeps a Draft-by-Ari page disabled, and leaves it out of every
 * artifact but the owner's private preview (I-SITES-ARI-QUESTIONS-OWNER-ONLY).
 */
import type { PayloadRequest } from "payload";
import {
  ARI_PAGE_LIMITS, ARI_QUESTION_FIELD_PATH, ariPageRefusalSentence, haveProblems, namesLegalPage, questionProblems,
  setAtFieldPath, unsellableOffer, type AriPageQuestion,
} from "../contracts/generated/ariPage.ts";
import { BLOCK_CATALOG, type FieldSpec } from "../contracts/generated/blocks.ts";
import { offersBooking } from "../contracts/generated/claims.ts";
import { MAX_NAV_ITEMS, MAX_PAGES_PER_SITE, MAX_SLUG_LENGTH } from "../contracts/generated/limits.ts";
import { isReservedSegment, SLUG_PATTERN } from "../contracts/generated/routes.ts";
import type { WorkLogCite } from "../contracts/generated/ariToolSchemas.ts";
import {
  AriRefusal, assertBlocks, assertCites, blockTexts, checkRevision, decisionOf, inTransaction, loadDraftState, ownerQuotes,
  siteDesign, writeWorkLog, type AriActionContext,
} from "./ariSiteActions";
import { findAllTenantPages } from "./tenantPages";
import { tenantPagePaths } from "./pageTree";

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const ARI_PAGE_ACTIONS: ReadonlySet<string> = new Set(["propose_site_page", "answer_site_page_question"]);

/** How long a plan in flight holds the site (one at a time); a crash frees it after this. */
export const ARI_PAGE_CLAIM_TTL_MS = 2 * 60 * 1000;

function refuse(code: string, extra: Record<string, unknown> = {}): never {
  throw new AriRefusal(code, extra);
}

const squash = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();
const plain = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !/<\s*\/?\s*[a-z!]/i.test(value);

/** The detail bases this site answers (a page may not take one: v2.1 §3.1). */
function detailBases(settings: AnyDoc | null): Set<string> {
  const routes = (settings?.routes ?? {}) as AnyDoc;
  const bases = new Set(["trips", "events", "experiences", "rooms", "sessions", "exhibitions", "workshops", "play", "destinations", "stories"]);
  for (const value of Object.values(routes)) if (typeof value === "string" && value) bases.add(value.replace(/^\/+|\/+$/g, ""));
  return bases;
}

/** The catalogue spec at a question's field path ("field" or "list.N.field"), or null. */
export function fieldSpecAt(type: string, fieldPath: string): FieldSpec | null {
  const spec = (BLOCK_CATALOG as Record<string, { fields: Readonly<Record<string, FieldSpec>> } | undefined>)[type];
  if (!spec) return null;
  const [top, , field] = fieldPath.split(".");
  const outer = spec.fields[top!];
  if (!outer) return null;
  if (field === undefined) return outer;
  return outer.kind === "list" ? outer.item[field] ?? null : null;
}

function requiredFields(type: string): readonly string[] {
  const spec = (BLOCK_CATALOG as Record<string, { fields: Readonly<Record<string, FieldSpec>> } | undefined>)[type];
  if (!spec) return [];
  return Object.entries(spec.fields).filter(([, field]) => "required" in field && field.required === true).map(([name]) => name);
}

/** Owner and Ari answers: plain text, the owner's own words; never an offer Mingla can't sell, never a booking claim. */
export function answerProblem(answer: unknown, spec: FieldSpec | null): string | null {
  if (!spec || spec.kind !== "text") return "QUESTION_NOT_FOUND";
  if (!plain(answer, Math.min(spec.max, ARI_PAGE_LIMITS.answer))) return "VALIDATION_FAILED";
  if (unsellableOffer(answer)) return "UNSELLABLE_OFFER";
  if (offersBooking(answer)) return "BOOKING_THROUGH_ENQUIRY";
  return null;
}

/** Writes one answer into the page's blocks; the question is removed and the block stays Draft. */
export function pageWithAnswer(page: AnyDoc, key: string, answer: string): { blocks: AnyDoc[]; owner_questions: AriPageQuestion[] } {
  const questions = (Array.isArray(page.owner_questions) ? page.owner_questions : []) as AriPageQuestion[];
  const question = questions.find((row) => row?.key === key);
  if (!question) refuse("QUESTION_NOT_FOUND");
  const blocks = (Array.isArray(page.blocks) ? page.blocks : []) as AnyDoc[];
  const block = blocks[question.block_index];
  if (!block || !ARI_QUESTION_FIELD_PATH.test(question.field_path)) refuse("QUESTION_NOT_FOUND");
  const problem = answerProblem(answer, fieldSpecAt(String(block.blockType ?? block.type), question.field_path));
  if (problem) refuse(problem, problem === "UNSELLABLE_OFFER" ? { problems: [ariPageRefusalSentence("unsellable")] } : {});
  const next = blocks.map((row, index) => (index === question.block_index ? setAtFieldPath(row, question.field_path, answer.trim()) : row));
  return { blocks: next, owner_questions: questions.filter((row) => row.key !== key) };
}

/** Counted from the work log: ≤ 3 plans in 10 minutes and ≤ 10 a day (spec v2.1 §3.4, N6). */
async function assertRate(ctx: AriActionContext): Promise<void> {
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const count = async (ms: number) => (await ctx.req.payload.find({
    collection: "work-log", overrideAccess: true, depth: 0, limit: 0, pagination: true,
    where: { and: [{ tenant: { equals: ctx.tenantId } }, { tool: { equals: "propose_site_page" } }, { createdAt: { greater_than: since(ms) } }] },
  })).totalDocs;
  if ((await count(10 * 60 * 1000)) >= ARI_PAGE_LIMITS.plansPerTenMinutes || (await count(24 * 60 * 60 * 1000)) >= ARI_PAGE_LIMITS.plansPerDay) {
    refuse("ARI_PAGE_RATE_LIMITED");
  }
}

/** One plan in flight per site: an atomic claim on gateway-nonces (UNIQUE nonce), released after; expires on a crash. */
async function claimPlan(ctx: AriActionContext): Promise<string> {
  const nonce = `ari-page:${ctx.tenantId}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await ctx.req.payload.create({
        collection: "gateway-nonces", overrideAccess: true,
        data: { nonce, direction: "core_to_cms", site_id: ctx.siteId, operation_id: "propose_site_page", expires_at: new Date(Date.now() + ARI_PAGE_CLAIM_TTL_MS).toISOString() } as never,
      });
      return nonce;
    } catch (error) {
      const found = await ctx.req.payload.find({ collection: "gateway-nonces", overrideAccess: true, depth: 0, limit: 1, pagination: false, where: { nonce: { equals: nonce } } });
      const expires = Date.parse(String((found.docs[0] as AnyDoc | undefined)?.expires_at ?? ""));
      if (!found.docs.length) {
        console.error("[ari-page] claim failed", error);
        refuse("SERVICE_TEMPORARILY_UNAVAILABLE");
      }
      if (attempt > 0 || !Number.isFinite(expires) || expires > Date.now()) refuse("ARI_PAGE_RATE_LIMITED");
      await ctx.req.payload.delete({ collection: "gateway-nonces", overrideAccess: true, where: { nonce: { equals: nonce }, expires_at: { less_than: new Date().toISOString() } } });
    }
  }
  return refuse("ARI_PAGE_RATE_LIMITED");
}

async function releasePlan(ctx: AriActionContext, nonce: string): Promise<void> {
  try {
    await ctx.req.payload.delete({ collection: "gateway-nonces", overrideAccess: true, where: { nonce: { equals: nonce } } });
  } catch (error) {
    // Logged, never swallowed silently: the claim expires on its own after ARI_PAGE_CLAIM_TTL_MS.
    console.error("[ari-page] could not release the claim", nonce, error);
  }
}

/** Where the Draft entry goes: after `menu_after`, else before About, else last. */
function menuIndex(items: AnyDoc[], idByPath: Map<string, string>, menuAfter: unknown): number {
  if (typeof menuAfter === "string" && menuAfter) {
    const id = idByPath.get(menuAfter.replace(/^\/+|\/+$/g, ""));
    const at = id ? items.findIndex((item) => String(item.page?.id ?? item.page ?? "") === id) : -1;
    if (at < 0) refuse("PAGE_NOT_FOUND", { page_path: menuAfter });
    return at + 1;
  }
  const about = items.findIndex((item) => /^about\b/i.test(String(item.label ?? "")));
  return about >= 0 ? about : items.length;
}

async function proposeSitePage(args: AnyDoc, ctx: AriActionContext): Promise<Record<string, unknown>> {
  const decision = decisionOf(args.why);
  const cites = await assertCites(ctx, args.cites);
  const owner = ownerQuotes(cites);
  const request = args.request;
  if (!plain(request, ARI_PAGE_LIMITS.request)) refuse("VALIDATION_FAILED", { problems: [`request is the owner's words, up to ${ARI_PAGE_LIMITS.request} characters`] });
  // The request is the owner's words verbatim, and is cited as such.
  if (!owner.some((quote) => squash(quote) === squash(request))) refuse("CITATION_REQUIRED", { problem: "Cite the owner's request word for word as owner_words." });
  const page = (args.page ?? {}) as AnyDoc;
  const problems: string[] = [];
  if (!plain(page.title, ARI_PAGE_LIMITS.title)) problems.push("page.title");
  if (!plain(page.menu_label, ARI_PAGE_LIMITS.menuLabel)) problems.push("page.menu_label");
  const slug = String(page.slug ?? "");
  if (!SLUG_PATTERN.test(slug) || slug.length > MAX_SLUG_LENGTH) problems.push("page.slug");
  const seo = (page.seo ?? {}) as AnyDoc;
  if (seo.title !== undefined && !plain(seo.title, ARI_PAGE_LIMITS.seoTitle)) problems.push("page.seo.title");
  if (seo.description !== undefined && !plain(seo.description, ARI_PAGE_LIMITS.seoDescription)) problems.push("page.seo.description");
  if (!Array.isArray(args.blocks) || args.blocks.length < 1 || args.blocks.length > ARI_PAGE_LIMITS.blocksPerPage) problems.push(`blocks is a list of 1 to ${ARI_PAGE_LIMITS.blocksPerPage}`);
  if (problems.length) refuse("VALIDATION_FAILED", { problems });
  const have = haveProblems(args.have);
  if (have) refuse(have.code, { problems: [have.problem] });
  const known = new Set([ctx.brandId.toLowerCase(), ...(ctx.evidence?.offerings ?? []).map((row) => row.id.toLowerCase())]);
  for (const [n, row] of ((args.have ?? []) as AnyDoc[]).entries()) {
    if (row.source === "mingla_record" && !known.has(String(row.ref).toLowerCase())) refuse("HAVE_WITHOUT_SOURCE", { problems: [`have[${n}] names a Mingla record that isn't this brand's`] });
    if (row.source === "owner_words" && !owner.some((quote) => squash(quote).includes(squash(String(row.text))))) {
      refuse("HAVE_WITHOUT_SOURCE", { problems: [`have[${n}] must be the owner's words, cited`] });
    }
  }
  const rawBlocks = args.blocks as AnyDoc[];
  const qProblems = questionProblems(args.questions, rawBlocks, requiredFields);
  for (const [n, row] of ((Array.isArray(args.questions) ? args.questions : []) as AnyDoc[]).entries()) {
    const block = rawBlocks[row.block_index];
    if (block && typeof row.field_path === "string" && fieldSpecAt(String(block.type), row.field_path)?.kind !== "text") qProblems.push(`questions[${n}].field_path must be an optional text field or list row`);
  }
  if (qProblems.length) refuse("VALIDATION_FAILED", { problems: qProblems.slice(0, 20) });

  // Refusals with one sentence (spec v2.1 §3.4): offers Mingla can't sell, legal pages, duplicates, bad slugs.
  const allTexts = [request, page.title, page.menu_label, slug.replace(/-/g, " "), seo.title, seo.description, ...rawBlocks.flatMap(blockTexts), ...((args.have ?? []) as AnyDoc[]).map((row) => row.text)]
    .filter((text): text is string => typeof text === "string");
  if (allTexts.some((text) => unsellableOffer(text))) refuse("UNSELLABLE_OFFER", { problems: [ariPageRefusalSentence("unsellable")] });
  if ([page.title, page.menu_label, slug.replace(/-/g, " ")].some((text) => typeof text === "string" && namesLegalPage(text))) {
    // Ari writes no legal text; owner-pasted text may be placed word for word.
    const texts = rawBlocks.flatMap(blockTexts);
    if (!texts.length || texts.some((text) => !owner.some((quote) => squash(quote).includes(squash(text))))) {
      refuse("ARI_PAGE_NOT_ALLOWED", { problems: [ariPageRefusalSentence("legal")] });
    }
  }

  const draft = await loadDraftState(ctx.req, ctx.scoped, ctx.tenantId);
  checkRevision(draft.digest, args.expected_site_revision);
  const paths = tenantPagePaths(draft.pages as never);
  const byPath = new Map(draft.pages.map((row) => [paths.get(String(row.id)) ?? "", row]));
  let parent: AnyDoc | null = null;
  if (typeof page.parent_path === "string" && page.parent_path) {
    parent = byPath.get(page.parent_path.replace(/^\/+|\/+$/g, "")) ?? null;
    if (!parent) refuse("PAGE_NOT_FOUND", { page_path: page.parent_path });
    if (parent.parent) refuse("VALIDATION_FAILED", { problems: ["Ari pages sit at the top level or under one top-level page"] });
  }
  const fullPath = parent ? `${paths.get(String(parent.id))}/${slug}` : slug;
  if (!parent && (isReservedSegment(slug) || detailBases(draft.settings).has(slug))) refuse("VALIDATION_FAILED", { problems: ["page.slug is a reserved address"] });
  if (byPath.has(fullPath)) refuse("PATH_COLLISION");
  const same = draft.pages.find((row) => (row.slug && row.slug === slug) || squash(String(row.title ?? "")) === squash(String(page.title)));
  if (same) refuse("ARI_PAGE_DUPLICATE", { problems: [ariPageRefusalSentence("duplicate", String(same.title ?? same.slug))] });
  // Limits (N6): 10 Ari pages per site, 3 open Drafts, the site's own page and menu caps.
  const ariPages = draft.pages.filter((row) => row.origin === "ari");
  if (ariPages.length >= ARI_PAGE_LIMITS.pagesPerSite || draft.pages.length >= MAX_PAGES_PER_SITE) refuse("ARI_PAGE_LIMIT");
  if (ariPages.filter((row) => row.ari_draft === true).length >= ARI_PAGE_LIMITS.openDrafts) refuse("ARI_DRAFT_PAGES_OPEN");
  const items = (Array.isArray(draft.navigation?.items) ? draft.navigation!.items : []) as AnyDoc[];
  if (!parent && items.length >= MAX_NAV_ITEMS) refuse("VALIDATION_FAILED", { problems: [`the menu already has ${MAX_NAV_ITEMS} items; remove one first`] });
  await assertRate(ctx);

  const design = siteDesign(draft.settings);
  const blocks = await assertBlocks(ctx, rawBlocks, design, "blocks", owner);
  const questions = ((args.questions ?? []) as AnyDoc[]).map((row) => ({
    key: String(row.key), question: String(row.question).trim(), block_index: Number(row.block_index), field_path: String(row.field_path),
    ...(typeof row.placeholder === "string" && row.placeholder ? { placeholder: row.placeholder } : {}),
  }));

  const claim = await claimPlan(ctx);
  try {
    const result = await inTransaction(ctx, async (req) => {
      // Every block Draft by Ari (v1 §4.3); the Ari page fields only through this action.
      const writing = { ...req, context: { ...req.context, minglaReviewSource: "ari", minglaAriPage: true } } as PayloadRequest;
      const created = await ctx.req.payload.create({
        collection: "pages", req: writing, overrideAccess: false, draft: true, depth: 0,
        data: {
          tenant: ctx.tenantId,
          title: String(page.title).trim(),
          slug,
          ...(parent ? { parent: parent.id } : {}),
          kind: "standard",
          enabled: false,
          blocks,
          ...(seo.title || seo.description ? { seo: { ...(seo.title ? { title: seo.title } : {}), ...(seo.description ? { description: seo.description } : {}) } } : {}),
          origin: "ari",
          ari_draft: true,
          ari_request: request,
          owner_questions: questions,
        } as never,
      }) as AnyDoc;
      if (!parent) {
        const navigation = (await ctx.req.payload.find({ collection: "navigation", req, overrideAccess: false, draft: true, depth: 0, limit: 1, where: { tenant: { equals: ctx.tenantId } } })).docs[0] as AnyDoc | undefined;
        if (!navigation) refuse("NOT_FOUND");
        const current = ((navigation.items ?? []) as AnyDoc[]).map(({ id: _row, ...rest }) => rest);
        const idByPath = new Map([...byPath.entries()].map(([path, row]) => [path, String(row.id)]));
        const at = menuIndex(current, idByPath, page.menu_after);
        current.splice(at, 0, { label: String(page.menu_label).trim(), target_type: "page", page: String(created.id), draft: true });
        await ctx.req.payload.update({ collection: "navigation", id: navigation.id, req, overrideAccess: false, draft: true, depth: 0, data: { items: current } as never });
      }
      const workLogId = await writeWorkLog(ctx, {
        part: "composition", decision, cites, tool: "propose_site_page", target: `page:${fullPath}`.slice(0, 200), revision: String(created.revision ?? ""), req,
      });
      return { created, workLogId };
    });
    const after = await loadDraftState(ctx.req, ctx.scoped, ctx.tenantId);
    return {
      previous_site_revision: draft.digest,
      site_revision: after.digest,
      page_path: fullPath,
      page_id: String(result.created.id),
      enabled: false,
      draft_by_ari: true,
      questions: questions.map((row) => row.key),
      work_log_id: result.workLogId,
      draft_only: true,
      review_required: true,
    };
  } finally {
    await releasePlan(ctx, claim);
  }
}

async function answerSitePageQuestion(args: AnyDoc, ctx: AriActionContext): Promise<Record<string, unknown>> {
  const decision = decisionOf(args.why);
  const cites = await assertCites(ctx, args.cites);
  const answer = String(args.answer ?? "");
  // Ari relays the owner's words verbatim (owner_words cite), never its own.
  if (!ownerQuotes(cites).some((quote) => squash(quote).includes(squash(answer)) && answer.trim())) {
    refuse("CITATION_REQUIRED", { problem: "Cite the owner's answer word for word as owner_words." });
  }
  const pages = (await findAllTenantPages(ctx.scoped, ctx.tenantId)) as AnyDoc[];
  const paths = tenantPagePaths(pages as never);
  const page = pages.find((row) => paths.get(String(row.id)) === String(args.page_path ?? "").replace(/^\/+|\/+$/g, ""));
  if (!page) refuse("PAGE_NOT_FOUND");
  // #4453 m11 rework (tester P3-1) — once the owner has published the page it is theirs: Ari never writes into it.
  if (page.origin !== "ari" || page.ari_draft !== true) refuse("PAGE_NOT_ARI_DRAFT");
  const next = pageWithAnswer(page, String(args.question_key ?? ""), answer);
  const writing = { ...ctx.scoped, context: { ...ctx.scoped.context, minglaReviewSource: "ari", minglaAriPage: true } } as PayloadRequest;
  const updated = await ctx.req.payload.update({
    collection: "pages", id: page.id, req: writing, overrideAccess: false, draft: true, depth: 0,
    data: { ...next, revision: page.revision } as never,
  }) as AnyDoc;
  const id = await writeWorkLog(ctx, { part: "copy", decision, cites, tool: "answer_site_page_question", target: `page:${paths.get(String(page.id))}`, revision: String(updated.revision ?? "") });
  return { page_path: paths.get(String(page.id)) ?? null, remaining_questions: next.owner_questions.length, work_log_id: id, draft_only: true };
}

export async function runAriPageAction(action: string, args: AnyDoc, ctx: AriActionContext): Promise<Record<string, unknown>> {
  if (ctx.addPage !== true) refuse("ARI_ADD_PAGE_OFF");
  return action === "propose_site_page" ? proposeSitePage(args, ctx) : answerSitePageQuestion(args, ctx);
}

/*
 * The owner's own actions (Core's content route, rank ≥ the content minimum).
 */
export type OwnerAriPageContext = { req: PayloadRequest; scoped: PayloadRequest; tenantId: string; userId: string; brandId: string };

async function ownerWorkLog(ctx: OwnerAriPageContext, tool: string, decision: string, cites: WorkLogCite[], target: string): Promise<void> {
  await ctx.req.payload.create({
    collection: "work-log", overrideAccess: true, depth: 0,
    data: { tenant: ctx.tenantId, part: "composition", decision: decision.slice(0, 300), cites, actor: "user", actor_user_id: ctx.userId, tool, target: target.slice(0, 200), revision: null } as never,
  });
}

export async function runOwnerAriPageAction(action: "ari_page_answer" | "ari_page_accept" | "ari_page_remove", args: AnyDoc, ctx: OwnerAriPageContext): Promise<Record<string, unknown>> {
  const pageId = String(args.page_id ?? "");
  const pages = (await findAllTenantPages(ctx.scoped, ctx.tenantId)) as AnyDoc[];
  const page = pages.find((row) => String(row.id) === pageId);
  if (!page) refuse("NOT_FOUND");
  // #4453 m11 rework (tester P3-1) — every owner action, the answer included, needs a page that is still a Draft by Ari.
  if (page.origin !== "ari" || page.ari_draft !== true) refuse("PAGE_NOT_ARI_DRAFT");
  const title = String(page.title ?? "Page");
  const ariWrite = (extra: Record<string, unknown> = {}) => ({ ...ctx.scoped, context: { ...ctx.scoped.context, minglaAriPage: true, ...extra } } as PayloadRequest);

  if (action === "ari_page_answer") {
    const answer = String(args.answer ?? "");
    const next = pageWithAnswer(page, String(args.question_key ?? ""), answer);
    // The owner's words go in as they typed them; the block stays Draft until "Publish this page".
    const updated = await ctx.req.payload.update({ collection: "pages", id: page.id, req: ariWrite({ minglaReviewSource: "ari" }), overrideAccess: false, draft: true, depth: 0, data: { ...next, revision: page.revision } as never }) as AnyDoc;
    await ownerWorkLog(ctx, "ari_page_answer", `Answered Ari's question on ${title}`, [{ kind: "owner_words", quote: answer.slice(0, 500) }], `page:${pageId}`);
    return { page_id: pageId, revision: updated.revision, remaining_questions: next.owner_questions.length };
  }

  const navigation = (await ctx.req.payload.find({ collection: "navigation", req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, limit: 1, where: { tenant: { equals: ctx.tenantId } } })).docs[0] as AnyDoc | undefined;
  const items = ((navigation?.items ?? []) as AnyDoc[]).map(({ id: _row, ...rest }) => rest);
  const isThisPage = (item: AnyDoc) => item.target_type !== "url" && String(item.page?.id ?? item.page ?? "") === pageId;

  if (action === "ari_page_accept") {
    // "Publish this page": every block reviewed, the page on, the Draft marks cleared. The site publish runs next, as normal.
    const updated = await ctx.req.payload.update({
      collection: "pages", id: page.id, req: ariWrite({ minglaMarkReviewed: "all" }), overrideAccess: false, draft: true, depth: 0,
      // #4453 m11 rework (tester P3-1) — publishing closes Ari's open questions (their rows stay hidden, N8).
      data: { blocks: page.blocks, enabled: true, ari_draft: false, owner_questions: [], revision: page.revision } as never,
    }) as AnyDoc;
    if (navigation && items.some(isThisPage)) {
      await ctx.req.payload.update({ collection: "navigation", id: navigation.id, req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, data: { items: items.map((item) => (isThisPage(item) ? { ...item, draft: false } : item)) } as never });
    }
    await ownerWorkLog(ctx, "ari_page_accept", `Page added with Ari: ${title}`, [{ kind: "mingla_record", record_id: ctx.brandId }], `page:${pageId}`);
    const unanswered = Array.isArray(page.owner_questions) ? page.owner_questions.length : 0;
    return { page_id: pageId, revision: updated.revision, enabled: true, unanswered, history_line: `Page added with Ari: ${title}` };
  }

  // "Remove": the Draft page and its menu entry (Payload versions keep the history).
  if (pages.some((row) => String(row.parent?.id ?? row.parent ?? "") === pageId)) refuse("VALIDATION_FAILED", { problems: ["move the pages under it first"] });
  if (navigation && items.some(isThisPage)) {
    await ctx.req.payload.update({ collection: "navigation", id: navigation.id, req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, data: { items: items.filter((item) => !isThisPage(item)) } as never });
  }
  await ctx.req.payload.delete({ collection: "pages", id: page.id, req: ctx.scoped, overrideAccess: false });
  await ownerWorkLog(ctx, "ari_page_remove", `Removed the Draft page from Ari: ${title}`, [{ kind: "mingla_record", record_id: ctx.brandId }], `page:${pageId}`);
  return { page_id: pageId, removed: true };
}
