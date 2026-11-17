/**
 * #4453 milestone 7 (spec v2 §6.2-§6.6) — Ari's design pass, the Studio side.
 *
 * Core reaches these only while SITES_ARI_DESIGN_PASS covers the brand (it
 * checks the flag and signs `design_pass` in; with no signed inputs every
 * action refuses DESIGN_PASS_OFF).
 *
 *   get_site_design_brief     the format, the ten styles with their fixed fit
 *                             and reason and whether a live site already looks
 *                             like it, the recipe and page set with what is
 *                             eligible, every layout per block type, and the
 *                             Mingla actions that exist. Read-only.
 *   propose_site_design_pass  ONE automatic pass per draft: the chosen style,
 *                             composed by composer v2 from Mingla's facts and
 *                             the owner's own answers (Ari writes no section
 *                             text), into the DRAFT, every block Draft. A style
 *                             the fit table marks "avoid" is refused from Ari
 *                             (STYLE_DOES_NOT_FIT); a look within distance 1 of
 *                             a live site only warns (SIMILAR_TO_LIVE_SITE).
 *   propose_site_chrome       the header layout (one the design offers), the
 *                             phone booking bar, and the header button (the
 *                             format's own short label to its booking page).
 */
import {
  FORMAT_PAGE_SETS, FORMAT_PRIMARY_ACTION, FORMAT_RECIPES, SIMILAR_TO_LIVE_SITE, SIMILAR_TO_LIVE_SITE_MESSAGE, STYLE_KEYS,
  UNIQUE_MIN_DISTANCE, isStyleKey, similarLiveSites, skippedLine, styleFit, styleFitLevel, type FormatKey,
} from "../contracts/generated/formats.ts";
import { ARI_DESIGN_KEYS, DESIGNS, HEADER_VARIANTS, type DesignKey } from "../contracts/generated/designs.ts";
import { BLOCK_TYPES } from "../contracts/generated/blocks.ts";
import { sectionEligibility } from "../contracts/generated/sectionSources.ts";
import { composeFormatSite, type ComposeV2Input, type ComposeV2Result } from "./composeFormat";
import { inventoryAndSources, loadStudioRecords, type SignedDesignPass } from "./designPassInputs";
import { pageAllDraft, writeComposition } from "./designPassWrite";
import { findAllTenantPages } from "./tenantPages";
import { AriRefusal, type AriActionContext } from "./ariSiteActions";
import type { WorkLogCite } from "../contracts/generated/ariToolSchemas.ts";
import type { PayloadRequest } from "payload";

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const DESIGN_PASS_ACTIONS: ReadonlySet<string> = new Set(["get_site_design_brief", "propose_site_design_pass", "propose_site_chrome"]);

/** The designs Ari may name on the design pass: the ten styles with the style library on, else Atelier and Voyage. */
export function designPassStyles(styleLibrary: boolean): readonly DesignKey[] {
  return styleLibrary ? STYLE_KEYS : ARI_DESIGN_KEYS.filter((key) => key !== "atelier");
}

type Deps = {
  currentSettings: (ctx: AriActionContext, req?: PayloadRequest) => Promise<AnyDoc>;
  writeWorkLog: (ctx: AriActionContext, entry: { part: string; decision: string; cites: readonly WorkLogCite[]; tool: string; target: string | null; revision: string | null }) => Promise<string>;
  assertCites: (ctx: AriActionContext, cites: unknown) => Promise<WorkLogCite[]>;
  decisionOf: (value: unknown) => string;
};

function refuse(code: string, extra: Record<string, unknown> = {}): never {
  throw new AriRefusal(code, extra);
}

/** When the current draft began: the site's last successful publish (null = never published, so the whole history is one draft). */
async function currentDraftSince(ctx: AriActionContext): Promise<string | null> {
  const last = await ctx.req.payload.find({
    collection: "publication-jobs", overrideAccess: true, depth: 0, limit: 1, sort: "-updatedAt",
    where: { and: [{ tenant: { equals: ctx.tenantId } }, { status: { equals: "published" } }] },
  });
  const at = (last.docs[0] as AnyDoc | undefined)?.updatedAt;
  return typeof at === "string" && at.length > 0 ? at : null;
}

async function composeInput(ctx: AriActionContext, signed: SignedDesignPass, design: DesignKey, settings: AnyDoc): Promise<ComposeV2Input> {
  if (!signed.plan) refuse("VALIDATION_FAILED", { problems: ["the website plan is not set up yet"] });
  const brand = ctx.evidence?.brand;
  const description = (brand?.description ?? "").trim();
  const [tagline, ...rest] = description.split(/\n\s*\n/);
  const records = await loadStudioRecords(ctx.req, ctx.tenantId);
  const pages = await findAllTenantPages(ctx.scoped, ctx.tenantId, { overrideAccess: true });
  const composeBrand = {
    name: brand?.name ?? "",
    tagline: tagline?.trim() ? tagline.trim().slice(0, 300) : null,
    bio: rest.join("\n\n").trim() || null,
    contact_email: brand?.contact_email ?? null,
    city: brand?.city ?? null,
  };
  const home = pages.find((page) => !page.parent && (page.slug ?? "") === "");
  const heroMedia = (Array.isArray(home?.blocks) ? home!.blocks as AnyDoc[] : []).find((block) => block.blockType === "hero")?.media;
  const coverId = heroMedia ? String(typeof heroMedia === "object" ? heroMedia.id : heroMedia) : null;
  const { inventory, sources } = inventoryAndSources({ signed, records, offerings_selected: signed.plan.offerings_selected, brand: composeBrand, cover_media_id: coverId });
  return {
    plan: signed.plan,
    answers: signed.answers,
    brand: composeBrand,
    design,
    inventory,
    sources,
    existing: pages.map((page) => ({
      id: String(page.id),
      slug: typeof page.slug === "string" ? page.slug : "",
      topLevel: !page.parent,
      blockCount: Array.isArray(page.blocks) ? page.blocks.length : 0,
      allDraft: pageAllDraft(page as unknown as AnyDoc),
    })),
    currentWordmark: null,
    replaceDrafts: true,
    colors: { primary: settings?.tokens?.colors?.primary ?? null, accent: settings?.tokens?.colors?.accent ?? null },
  };
}

/** Per style: is every candidate look within distance 1 of a live site of this format? */
function takenStyles(base: ComposeV2Input, styles: readonly DesignKey[], live: SignedDesignPass["live_fingerprints"]): Set<DesignKey> {
  const taken = new Set<DesignKey>();
  if (!live.length) return taken;
  for (const style of styles) {
    const result = composeFormatSite({ ...base, design: style });
    if (result && similarLiveSites(result.fingerprint, live) > 0) taken.add(style);
  }
  return taken;
}

export async function runDesignPassAction(action: string, args: AnyDoc, ctx: AriActionContext, deps: Deps): Promise<Record<string, unknown>> {
  const signed = ctx.designPass ?? null;
  if (!signed) refuse("DESIGN_PASS_OFF");
  const settings = await deps.currentSettings(ctx);
  const currentDesign = (typeof settings?.design === "string" && settings.design in DESIGNS ? settings.design : "atelier") as DesignKey;
  const styles = designPassStyles(signed.style_library);

  if (action === "get_site_design_brief") {
    const base = await composeInput(ctx, signed, styles.includes(currentDesign) ? currentDesign : styles[0]!, settings);
    const composed = composeFormatSite(base);
    if (!composed) refuse("VALIDATION_FAILED", { problems: ["tick what the brand offers in the website plan first"] });
    const format: FormatKey = composed.format;
    const taken = takenStyles(base, styles, signed.live_fingerprints);
    const fit = styleFit(format, { venue_descriptor: signed.plan?.venue_descriptor ?? null, taken }).filter((entry) => styles.includes(entry.style));
    const verdict = (type: string, options: AnyDoc = {}) => sectionEligibility(type, base.inventory, options);
    return {
      format,
      secondary_formats: composed.secondary,
      primary_action: FORMAT_PRIMARY_ACTION[format],
      styles: fit.map((entry) => ({ ...entry, pickable_by_ari: entry.fit !== "avoid" })),
      skipped_line: skippedLine(format),
      current_design: currentDesign,
      recipe: FORMAT_RECIPES[format].map((section) => ({ type: section.type, ...(section.role ? { role: section.role } : {}), ...verdictOf(verdict(section.type, section.options ?? {})) })),
      page_set: FORMAT_PAGE_SETS[format].map((entry) => ({
        slug: entry.slug,
        label: entry.label,
        placed: composed.pages.some((page) => page.slug === entry.slug),
      })),
      variants_by_type: Object.fromEntries(BLOCK_TYPES.map((type) => [type, [...DESIGNS[base.design].variants[type]]])),
      header_variants: [...DESIGNS[base.design].chrome.header],
      booking: {
        venue: Object.keys(signed.facts.venue_id),
        upcoming: signed.facts.upcoming,
        stays: signed.facts.live_stay_offerings > 0,
        ticket_tiers: signed.facts.public_ticket_tiers > 0,
      },
      rules: "Pick a style whose fit is pick or fits (never avoid); prefer a style that is not taken. The pass composes every section itself from Mingla's data and the owner's answers; you write no section text.",
    };
  }

  if (action === "propose_site_design_pass") {
    const decision = deps.decisionOf(args.why);
    const cites = await deps.assertCites(ctx, args.cites);
    const design = args.design_key;
    if (!isStyleKey(design) || !styles.includes(design)) refuse("VALIDATION_FAILED", { problems: ["design_key is not one of the styles Ari may use"] });
    const base = await composeInput(ctx, signed, design, settings);
    const composed: ComposeV2Result | null = composeFormatSite(base);
    if (!composed) refuse("VALIDATION_FAILED", { problems: ["tick what the brand offers in the website plan first"] });
    // I-SITES-ARI-NEVER-PICKS-AVOID — Ari never proposes an avoid style; owners may (Your look, with a warning).
    if (styleFitLevel(composed.format, design) === "avoid") refuse("STYLE_DOES_NOT_FIT", { problems: [skippedLine(composed.format)] });
    // At most one automatic pass per DRAFT (Seth's decision): a second needs the owner, section by section.
    // The current draft starts at the site's last publish, so a new draft after a publish gets one fresh pass.
    const draftSince = await currentDraftSince(ctx);
    const earlier = await ctx.req.payload.find({
      collection: "work-log", overrideAccess: true, depth: 0, limit: 1,
      where: { and: [
        { tenant: { equals: ctx.tenantId } },
        { tool: { equals: "propose_site_design_pass" } },
        ...(draftSince ? [{ createdAt: { greater_than: draftSince } }] : []),
      ] },
    });
    if (earlier.docs.length > 0) refuse("DESIGN_PASS_ALREADY_RUN");
    const similar = similarLiveSites(composed.fingerprint, signed.live_fingerprints);
    if (design !== currentDesign) {
      await ctx.req.payload.update({ collection: "site-settings", id: settings.id, req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, data: { design } as never });
    }
    const written = await writeComposition(ctx.req, ctx.scoped, ctx.tenantId, composed);
    const id = await deps.writeWorkLog(ctx, { part: "composition", decision, cites, tool: "propose_site_design_pass", target: `design:${design}`, revision: null });
    return {
      design,
      format: composed.format,
      pages: composed.pages.map((page) => page.slug),
      created: written.created,
      replaced: written.replaced,
      kept: composed.pages.filter((page) => !composed.create.includes(page) && !composed.replace.some((entry) => entry.page === page) && composed.fillHome !== page).map((page) => page.slug),
      left_out: composed.left_out_pages,
      skipped: composed.skipped,
      ...(similar > 0 ? { warnings: [{ code: SIMILAR_TO_LIVE_SITE, message: SIMILAR_TO_LIVE_SITE_MESSAGE, min_distance: UNIQUE_MIN_DISTANCE }] } : {}),
      fingerprint: composed.fingerprint,
      work_log_id: id,
      draft_only: true,
      review_required: true,
    };
  }

  // propose_site_chrome
  const decision = deps.decisionOf(args.why);
  const cites = await deps.assertCites(ctx, args.cites);
  const offered = DESIGNS[currentDesign].chrome.header;
  const changes: AnyDoc = {};
  if (args.header_variant !== undefined) {
    if (!(HEADER_VARIANTS as readonly string[]).includes(String(args.header_variant)) || !offered.includes(args.header_variant)) {
      refuse("VARIANT_NOT_IN_DESIGN", { variants: [...offered] });
    }
    changes.header_variant = args.header_variant;
  }
  if (args.sticky_booking !== undefined) {
    if (typeof args.sticky_booking !== "boolean") refuse("VALIDATION_FAILED", { problems: ["sticky_booking"] });
    changes.sticky_booking = args.sticky_booking;
  }
  if (args.header_button === true) {
    const base = await composeInput(ctx, signed, currentDesign, settings);
    const composed = composeFormatSite(base);
    const pages = await findAllTenantPages(ctx.scoped, ctx.tenantId, { overrideAccess: true });
    const target = composed?.header_cta ? pages.find((page) => !page.parent && page.slug === composed.header_cta!.slug) : undefined;
    if (!composed?.header_cta || !target) refuse("PAGE_NOT_FOUND", { problems: ["the booking page is not on this website yet"] });
    changes.header_cta = { label: composed.header_cta.label, target_type: "page", page: String(target.id) };
  }
  if (!Object.keys(changes).length) refuse("VALIDATION_FAILED", { problems: ["nothing to change"] });
  const navigation = (await ctx.req.payload.find({
    collection: "navigation", overrideAccess: true, draft: true, depth: 0, limit: 1, where: { tenant: { equals: ctx.tenantId } },
  })).docs[0] as AnyDoc | undefined;
  if (!navigation) refuse("NOT_FOUND");
  await ctx.req.payload.update({ collection: "navigation", id: navigation.id, overrideAccess: true, req: ctx.scoped, draft: true, data: changes as never });
  const id = await deps.writeWorkLog(ctx, { part: "variant", decision, cites, tool: "propose_site_chrome", target: "chrome", revision: null });
  return { changed: Object.keys(changes), work_log_id: id, draft_only: true };
}

function verdictOf(verdict: { eligible: boolean; reason: string | null }): { eligible: boolean; reason?: string } {
  return verdict.eligible ? { eligible: true } : { eligible: false, reason: verdict.reason ?? "NO_SOURCE" };
}
