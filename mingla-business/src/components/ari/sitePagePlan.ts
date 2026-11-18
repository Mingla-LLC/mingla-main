/**
 * #4453 m11 rework (spec v2.1 §3.1, tester P2-1) — what Ari's
 * `propose_site_page` plan will write, in the owner's words, before anything
 * is written: the page, each block in order with its own content or Ari's
 * question for it, the content Ari has (with where it came from) and what
 * Ari still needs. Pure: the plan sheet draws it, a test pins it.
 *
 * The block names come from the site-contracts block catalogue (one owner);
 * this module is loaded only by the plan sheet, which is a lazy chunk on web.
 */
import { BLOCK_CATALOG } from "../../../../packages/site-contracts/src/blocks.ts";

// The plan copy (SITE_PAGE_PLAN_COPY) stays in toolProposalCopy.ts and reaches the
// sheet as a prop: importing it here would put the whole Ari copy module in the
// web __common chunk (shared by the Ari and Website chunks).
export type { SitePagePlanCopy } from "./toolProposalCopy";

/** Where a piece of content came from (the tool's `have[].source`). */
export const HAVE_SOURCE_LABELS: Readonly<Record<string, string>> = {
  mingla_record: "From Mingla",
  owner_words: "Your words",
  owner_material: "What you shared",
};

export type SitePagePlanQuestion = { key: string; question: string };
export type SitePagePlanBlock = { index: number; label: string; lines: string[]; questions: SitePagePlanQuestion[] };
export type SitePagePlan = {
  title: string;
  menuLabel: string | null;
  slug: string | null;
  request: string | null;
  blocks: SitePagePlanBlock[];
  have: { text: string; source: string }[];
  questions: (SitePagePlanQuestion & { block: string | null })[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const MAX_LINES = 6;

export function blockLabel(type: string): string {
  const spec = (BLOCK_CATALOG as Readonly<Record<string, { label?: string }>>)[type];
  return spec?.label ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The block's own words, in field order (lists one row per line); never plumbing. */
function blockLines(block: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(block)) {
    if (key === "type" || key === "variant" || key === "id") continue;
    if (typeof value === "string" && value.trim() && !/^https?:\/\//.test(value) && !/(_href|_id|_url)$/.test(key)) {
      lines.push(value.trim());
    } else if (Array.isArray(value)) {
      for (const item of value) {
        const row = record(item);
        const words = row
          ? Object.entries(row)
            .filter(([child, v]) => typeof v === "string" && v.trim() && !/(_href|_id|_url|^id)$/.test(child))
            .map(([, v]) => String(v).trim())
          : typeof item === "string" && item.trim() ? [item.trim()] : [];
        if (words.length) lines.push(words.join(" · "));
      }
    }
  }
  return lines.slice(0, MAX_LINES);
}

export function sitePagePlan(args: Record<string, unknown>): SitePagePlan {
  const page = record(args.page) ?? {};
  const rawBlocks = Array.isArray(args.blocks) ? args.blocks : [];
  const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
  const questions = rawQuestions
    .map(record)
    .filter((q): q is Record<string, unknown> => q !== null && text(q.question) !== "")
    .map((q) => ({ key: text(q.key), question: text(q.question), blockIndex: typeof q.block_index === "number" ? q.block_index : -1 }));
  const blocks: SitePagePlanBlock[] = rawBlocks.map((raw, index) => {
    const block = record(raw) ?? {};
    return {
      index,
      label: blockLabel(text(block.type)),
      lines: blockLines(block),
      questions: questions.filter((q) => q.blockIndex === index).map(({ key, question }) => ({ key, question })),
    };
  });
  const have = (Array.isArray(args.have) ? args.have : [])
    .map(record)
    .filter((h): h is Record<string, unknown> => h !== null && text(h.text) !== "")
    .map((h) => ({ text: text(h.text), source: HAVE_SOURCE_LABELS[text(h.source)] ?? "" }));
  return {
    title: text(page.title) || "New page",
    menuLabel: text(page.menu_label) || null,
    slug: text(page.slug) || null,
    request: text(args.request) || null,
    blocks,
    have,
    questions: questions.map((q) => ({ key: q.key, question: q.question, block: blocks[q.blockIndex]?.label ?? null })),
  };
}
