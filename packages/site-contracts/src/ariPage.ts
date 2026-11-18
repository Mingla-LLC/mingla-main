/**
 * #4453 milestone 11 (spec v2.1 §3) — "Add a page with Ari": the pure rules
 * shared by Core (the tool declarations and error copy), Studio (the apply)
 * and the Host app (the plan card and the Pages section).
 *
 * Ari only proposes; the owner confirms; the page is written as a hidden
 * Draft by Ari (`origin: "ari"`, `ari_draft: true`, `enabled: false`) with
 * every block Draft, and only the owner ever sees its questions.
 */

/** Spec v2.1 §3.1 / §3.4 and decision N6. */
export const ARI_PAGE_LIMITS = {
  /** Ari-added pages a site may hold (accepted or not). */
  pagesPerSite: 10,
  /** Unaccepted Draft-by-Ari pages at once. */
  openDrafts: 3,
  blocksPerPage: 12,
  have: 10,
  questions: 6,
  plansPerTenMinutes: 3,
  plansPerDay: 10,
  request: 500,
  title: 80,
  menuLabel: 16,
  seoTitle: 70,
  seoDescription: 160,
  haveText: 120,
  question: 160,
  placeholder: 80,
  answer: 500,
  /** Ari pages sit at the top level or under one top-level page. */
  maxDepth: 2,
} as const;

/** The refusal codes milestone 11 adds (each carries one plain sentence to the owner). */
export const ARI_PAGE_CODES = [
  "ARI_ADD_PAGE_OFF",
  "ARI_PAGE_LIMIT",
  "ARI_DRAFT_PAGES_OPEN",
  "ARI_PAGE_RATE_LIMITED",
  "HAVE_WITHOUT_SOURCE",
  "UNSELLABLE_OFFER",
  "ARI_PAGE_NOT_ALLOWED",
  "ARI_PAGE_DUPLICATE",
  "QUESTION_NOT_FOUND",
  "PAGE_NOT_ARI_DRAFT",
] as const;
export type AriPageCode = (typeof ARI_PAGE_CODES)[number];

/** Plain owner-facing sentences (Core's error copy and the Host app's toasts). */
export const ARI_PAGE_MESSAGES: Readonly<Record<AriPageCode, string>> = {
  ARI_ADD_PAGE_OFF: "Adding pages with Ari isn't switched on for this brand yet.",
  ARI_PAGE_LIMIT: "This website already has 10 pages added by Ari. Edit one of them, or remove one first.",
  ARI_DRAFT_PAGES_OPEN: "There are already 3 Draft pages from Ari waiting for review. Publish or remove one first.",
  ARI_PAGE_RATE_LIMITED: "Ari has planned several pages just now. Try again in a few minutes.",
  HAVE_WITHOUT_SOURCE: "Every piece of content in the plan must say where it came from: a Mingla record, the owner's own words or the owner's own material.",
  UNSELLABLE_OFFER: "Mingla can't sell gift cards, vouchers, memberships or passes yet, so a website page can't offer them.",
  ARI_PAGE_NOT_ALLOWED: "Ari can't write that page.",
  ARI_PAGE_DUPLICATE: "That page already exists. Ari can change that page instead.",
  QUESTION_NOT_FOUND: "That question was already answered or removed.",
  PAGE_NOT_ARI_DRAFT: "That page isn't a Draft page from Ari.",
};

/** The Host app's starting chips (decision N7: no "Gift ideas" chip). */
export const ARI_PAGE_CHIPS: readonly string[] = ["Private hire", "Our team", "Weddings and celebrations", "Group bookings"];

/** The words a chip (or the owner's own topic) puts in Ari's composer. */
export function ariPagePrompt(topic: string): string {
  const clean = topic.replace(/\s+/g, " ").trim().slice(0, 120);
  return clean ? `Add a page to my website about ${clean.charAt(0).toLowerCase()}${clean.slice(1)}` : "Add a page to my website";
}

/** `have` sources (spec v2.1 §3.1). */
export const ARI_PAGE_HAVE_SOURCES = ["mingla_record", "owner_words", "owner_material"] as const;
export type AriPageHaveSource = (typeof ARI_PAGE_HAVE_SOURCES)[number];

/*
 * v2 §8 / I-SITES-NO-UNSELLABLE-OFFERS (G1, G2, decision N7) — Mingla cannot
 * sell these yet, so no Ari page may offer them.
 */
const UNSELLABLE = /\b(gift[\s-]*cards?|gift[\s-]*vouchers?|vouchers?|gift[\s-]*ideas?|memberships?|season[\s-]*pass(es)?|annual[\s-]*pass(es)?|day[\s-]*pass(es)?|passes)\b/i;

/** v2.1 §3.4 — Ari writes no legal text (it may place the owner's pasted text verbatim). */
const LEGAL = /\b(privacy|terms(\s+(and|&)\s+conditions)?|terms\s+of\s+(use|service)|refund\s+polic(y|ies)|cancellation\s+polic(y|ies)|cookie\s+polic(y|ies)|legal|gdpr|disclaimer)\b/i;

/** The words in `text` that offer something Mingla cannot sell, or null. */
export function unsellableOffer(text: string): string | null {
  const match = UNSELLABLE.exec(text);
  return match ? match[0] : null;
}

/** True when `text` names a legal page. */
export function namesLegalPage(text: string): boolean {
  return LEGAL.test(text);
}

/** One sentence to the owner, naming the nearest page Ari may write. */
export function ariPageRefusalSentence(kind: "unsellable" | "legal" | "duplicate", nearest?: string | null): string {
  if (kind === "unsellable") return `${ARI_PAGE_MESSAGES.UNSELLABLE_OFFER} Ari can write a page about ${nearest ?? "private hire or group bookings"} instead.`;
  if (kind === "legal") return "Ari won't write legal text. Paste your own policy and Ari can place it on a page word for word.";
  return nearest ? `The ${nearest} page already covers that. Ari can change that page instead.` : ARI_PAGE_MESSAGES.ARI_PAGE_DUPLICATE;
}

/** A field path a question may target: `field` or `list.N.field` (an optional field or one list row). */
export const ARI_QUESTION_FIELD_PATH = /^[a-z][a-z0-9_]{0,40}(\.[0-9]{1,2}\.[a-z][a-z0-9_]{0,40})?$/;
export const ARI_QUESTION_KEY = /^[a-z][a-z0-9_]{0,31}$/;

export type AriPageQuestion = { key: string; question: string; block_index: number; field_path: string; placeholder?: string };
export type AriPageHave = { text: string; source: AriPageHaveSource; ref?: string };

const str = (value: unknown): value is string => typeof value === "string";

/** Shape problems in `have` (HAVE_WITHOUT_SOURCE is its own code). */
export function haveProblems(value: unknown): { code: "VALIDATION_FAILED" | "HAVE_WITHOUT_SOURCE"; problem: string } | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > ARI_PAGE_LIMITS.have) return { code: "VALIDATION_FAILED", problem: `have is a list of at most ${ARI_PAGE_LIMITS.have}` };
  for (const [n, row] of value.entries()) {
    const item = (row ?? {}) as Record<string, unknown>;
    if (!str(item.text) || !item.text.trim() || item.text.length > ARI_PAGE_LIMITS.haveText) return { code: "VALIDATION_FAILED", problem: `have[${n}].text` };
    if (!(ARI_PAGE_HAVE_SOURCES as readonly unknown[]).includes(item.source) || (item.source !== "owner_words" && (!str(item.ref) || !item.ref.trim()))) {
      return { code: "HAVE_WITHOUT_SOURCE", problem: `have[${n}] needs a source` };
    }
  }
  return null;
}

/** Shape problems in `questions` against the proposed blocks (each must target an OPTIONAL field or list row). */
export function questionProblems(value: unknown, blocks: readonly Record<string, unknown>[], requiredFields: (type: string) => readonly string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ARI_PAGE_LIMITS.questions) return [`questions is a list of at most ${ARI_PAGE_LIMITS.questions}`];
  const problems: string[] = [];
  const keys = new Set<string>();
  value.forEach((row, n) => {
    const item = (row ?? {}) as Record<string, unknown>;
    if (!str(item.key) || !ARI_QUESTION_KEY.test(item.key) || keys.has(item.key)) problems.push(`questions[${n}].key`);
    else keys.add(item.key);
    if (!str(item.question) || !item.question.trim() || item.question.length > ARI_PAGE_LIMITS.question) problems.push(`questions[${n}].question`);
    if (item.placeholder !== undefined && (!str(item.placeholder) || item.placeholder.length > ARI_PAGE_LIMITS.placeholder)) problems.push(`questions[${n}].placeholder`);
    const index = item.block_index;
    const block = typeof index === "number" && Number.isInteger(index) ? blocks[index] : undefined;
    if (!block) problems.push(`questions[${n}].block_index`);
    if (!str(item.field_path) || !ARI_QUESTION_FIELD_PATH.test(item.field_path)) problems.push(`questions[${n}].field_path`);
    else if (block) {
      const top = item.field_path.split(".")[0]!;
      const isRow = item.field_path.includes(".");
      // A required top-level field is never asked about: Ari asks in chat first and proposes only what it knows.
      if (!isRow && requiredFields(String(block.type)).includes(top)) problems.push(`questions[${n}].field_path targets a required field`);
    }
  });
  return problems;
}

/** Writes `answer` at `fieldPath` ("field" or "list.N.field") of a plain block object; returns a new object. */
export function setAtFieldPath(block: Record<string, unknown>, fieldPath: string, answer: string): Record<string, unknown> {
  const [top, rowIndex, field] = fieldPath.split(".");
  if (rowIndex === undefined || field === undefined) return { ...block, [top!]: answer };
  const list = Array.isArray(block[top!]) ? [...(block[top!] as Record<string, unknown>[])] : [];
  const index = Number(rowIndex);
  while (list.length <= index) list.push({});
  list[index] = { ...(list[index] ?? {}), [field]: answer };
  return { ...block, [top!]: list };
}
