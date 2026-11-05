// Issue #4270 (Wave 4): the brand's plan in the Host app. Reads and writes go
// through the four host functions; nothing here sees the staff plan. Errors are
// mapped by the code and token the database raised, never by HTTP status:
// PostgREST turns not_found (P0002) into a 500.
import { supabase } from "./supabase";

export type BrandPlanKind = "post" | "task" | "event" | "experience" | "trip";

export interface BrandPlanItem {
  kind: BrandPlanKind;
  id: string;
  title: string;
  on: string;
  at: string | null;
  state: string;
  state_words: string;
  link: { url: string; site: string } | null;
  live_url?: string | null;
  by: "host" | "mingla";
  mine: boolean;
  can_edit: boolean;
  revision?: number;
}

export interface BrandPlan {
  brand: { id: string; name: string };
  today: string;
  from: string;
  to: string;
  can_add: boolean;
  /** The longest title this brand's plan can hold; the form caps at it, so nothing typed is ever cut. */
  title_max: number;
  items: BrandPlanItem[];
}

export type BrandPlanErrorCode =
  | "not_found"
  | "locked"
  | "invalid"
  | "read_only"
  | "too_many"
  | "no_host_card"
  | "stale_write"
  | "network"
  | "failed";

export class BrandPlanError extends Error {
  readonly code: BrandPlanErrorCode;
  /** What the server said, e.g. invalid_date or duplicate_title. Empty when it said nothing. */
  readonly token: string;

  constructor(code: BrandPlanErrorCode, token: string, message: string) {
    super(message);
    this.name = "BrandPlanError";
    this.code = code;
    this.token = token;
  }
}

/** A database or network failure as { code, token, message }. */
export function mapBrandPlanError(cause: unknown): BrandPlanError {
  if (cause instanceof BrandPlanError) return cause;
  const raw = (cause ?? {}) as { code?: unknown; message?: unknown };
  const pgCode = typeof raw.code === "string" ? raw.code : "";
  const message = typeof raw.message === "string" ? raw.message : "";
  const token = /^([a-z_]+):/.exec(message)?.[1] ?? "";
  const make = (code: BrandPlanErrorCode): BrandPlanError => new BrandPlanError(code, token, message);
  if (token === "not_found" || pgCode === "P0002") return make("not_found");
  if (token === "stale_write") return make("stale_write");
  if (token === "locked") return make("locked");
  if (token === "read_only") return make("read_only");
  if (token === "too_many") return make("too_many");
  if (token === "no_host_card") return make("no_host_card");
  if (token.startsWith("invalid_") || token === "unknown_field" || token === "duplicate_title" || token === "title_too_long" || token.startsWith("request_key_")) {
    return make("invalid");
  }
  // No database code at all, and the words of a transport failure. The state
  // of the write is unknown, so this never reads as "offline".
  if (!pgCode && /network|fetch|timed? ?out|abort/i.test(message)) return make("network");
  return make("failed");
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: unknown };
  try {
    result = await supabase.rpc(name as never, args as never) as unknown as { data: unknown; error: unknown };
  } catch (cause) {
    throw mapBrandPlanError(cause);
  }
  if (result.error) throw mapBrandPlanError(result.error);
  return result.data as T;
}

export async function fetchBrandPlan(brandId: string, from: string, to: string): Promise<BrandPlan> {
  const plan = await call<BrandPlan>("brand_plan_for_host", { p_brand_id: brandId, p_from: from, p_to: to });
  if (!plan || !Array.isArray(plan.items)) throw new BrandPlanError("failed", "", "The plan came back empty.");
  return plan;
}

export interface BrandPlanNewItem {
  type: "post" | "task";
  title: string;
  on: string;
  link?: string;
  note?: string;
}

export interface BrandPlanAddResult {
  kind: "post" | "task";
  status: "added";
  item: BrandPlanItem;
  replayed?: boolean;
}

export function addBrandPlanItem(brandId: string, item: BrandPlanNewItem, requestKey: string): Promise<BrandPlanAddResult> {
  return call<BrandPlanAddResult>("brand_plan_host_add", { p_brand_id: brandId, p_item: item, p_request_key: requestKey });
}

export interface BrandPlanChanges {
  title?: string;
  on?: string;
  link?: string | null;
  note?: string | null;
}

export function updateBrandPlanItem(kind: "post" | "task", id: string, changes: BrandPlanChanges, revision: number): Promise<{ kind: string; item: BrandPlanItem }> {
  return call("brand_plan_host_update", { p_kind: kind, p_id: id, p_changes: changes, p_expected_revision: revision });
}

export function removeBrandPlanItem(kind: "post" | "task", id: string, revision: number): Promise<{ kind: string; id: string; removed: boolean }> {
  return call("brand_plan_host_remove", { p_kind: kind, p_id: id, p_expected_revision: revision });
}

// ---------------------------------------------------------------------------
// Pure helpers: dates, the week and month views, and the form's checks.
// ---------------------------------------------------------------------------

/** A key for one add: 8 to 80 letters, digits, - or _. A retry reuses it. */
export function brandPlanRequestKey(): string {
  return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** The device's own date, YYYY-MM-DD. */
export function localIsoDay(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(iso: string): string {
  const day = iso.slice(0, 10);
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addIsoDays(day, -weekday);
}

export interface BrandPlanWeek {
  key: string;
  /** "this", "next" or "later" (any other week, which says "Week of"). */
  label: "this" | "next" | "later";
  items: BrandPlanItem[];
  /** Where the Today line goes in this week's list; -1 in every other week. */
  todayIndex: number;
}

/** The plan by week, in order. This week is always there, for the Today line. */
export function brandPlanWeeks(items: readonly BrandPlanItem[], today: string): BrandPlanWeek[] {
  const thisMonday = mondayOf(today);
  const nextMonday = addIsoDays(thisMonday, 7);
  const weeks = new Map<string, BrandPlanItem[]>([[thisMonday, []]]);
  for (const item of items) {
    const key = mondayOf(item.on);
    weeks.set(key, [...(weeks.get(key) ?? []), item]);
  }
  return [...weeks.keys()].sort().map((key) => {
    const list = weeks.get(key) ?? [];
    return {
      key,
      label: key === thisMonday ? "this" : key === nextMonday ? "next" : "later",
      items: list,
      todayIndex: key === thisMonday ? list.filter((item) => item.on < today).length : -1,
    };
  });
}

/** The days a month grid shows, Monday first, whole weeks only. */
export function brandPlanMonthGrid(month: string): string[] {
  const first = `${month}-01`;
  const start = mondayOf(first);
  const nextMonth = addMonths(month, 1);
  const days: string[] = [];
  for (let day = start; day < nextMonth + "-01" || days.length % 7 !== 0; day = addIsoDays(day, 1)) days.push(day);
  return days;
}

/** "2026-11" plus some months. */
export function addMonths(month: string, count: number): string {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + count, 1, 12));
  return date.toISOString().slice(0, 7);
}

// The same characters the server refuses (brand_plan_link_hidden): control
// characters, unusual spaces and invisible formatting characters, so the site
// name on a link's button always reads as the site it opens.
const LINK_HIDDEN = /[\u0000-\u0020\u007F-\u00A0\u00AD\u034F\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/u;

// The same site rule as the server (brand_plan_link_host): there must be a site,
// short enough to be an address, that stays one site once a browser folds it.
function hasBrandPlanSite(value: string): boolean {
  const raw = /^https:\/\/([^/?#:]+)/.exec(value)?.[1];
  if (!raw || [...raw].length > 253) return false;
  const host = raw.toLowerCase().normalize("NFKC").toLowerCase().replace(/\u3002/g, ".");
  return !/[/?#@:\\\s]/.test(host) && /[^.]/.test(host);
}

/** https only, in lower case as the server wants it, with a site, nothing hidden and nothing before the site name. */
export function isBrandPlanLink(value: string): boolean {
  return /^https:\/\/[^\s]+$/.test(value)
    && value.length >= 9
    && value.length <= 2000
    && !LINK_HIDDEN.test(value)
    && !/^https:\/\/[^/?#]*[@\\]/.test(value)
    && hasBrandPlanSite(value);
}

export interface BrandPlanFormValues {
  type: "post" | "task";
  title: string;
  on: string;
  link: string;
  note: string;
}

export type BrandPlanFormField = "title" | "on" | "link" | "note";

/** The most a title can be anywhere; a plan's own title_max is what its form uses. */
export const BRAND_PLAN_TITLE_LIMIT = 160;

/** Problems in the order the fields appear; `key` is under plan. in the copy. */
export function brandPlanFormProblems(form: BrandPlanFormValues, today: string, titleMax: number = BRAND_PLAN_TITLE_LIMIT): { field: BrandPlanFormField; key: string }[] {
  const out: { field: BrandPlanFormField; key: string }[] = [];
  const title = form.title.trim();
  if (!title) out.push({ field: "title", key: "err_title" });
  else if (title.length > titleMax) out.push({ field: "title", key: "err_title_long" });
  else if (form.type === "task" && title.length < 3) out.push({ field: "title", key: "err_title_length" });
  if (!form.on) out.push({ field: "on", key: "err_date" });
  else if (form.on < today) out.push({ field: "on", key: "err_date_past" });
  const link = form.link.trim();
  if (link && !isBrandPlanLink(link)) out.push({ field: "link", key: "err_link" });
  if (form.note.trim().length > 500) out.push({ field: "note", key: "err_note" });
  return out;
}

/** What brand_plan_host_add receives: only the keys it accepts, none empty. */
export function brandPlanNewItem(form: BrandPlanFormValues): BrandPlanNewItem {
  const item: BrandPlanNewItem = { type: form.type, title: form.title.trim(), on: form.on };
  const link = form.link.trim();
  const note = form.note.trim();
  if (link) item.link = link;
  if (note) item.note = note;
  return item;
}

/** The limit the server gave when it refused a title as too long (the brand's name changed), or null. */
export function brandPlanTitleLimit(error: BrandPlanError): number | null {
  if (error.token !== "title_too_long") return null;
  const found = /(\d+)/.exec(error.message)?.[1];
  return found ? Number(found) : null;
}

/** The copy key under plan. for a write that failed. */
export function brandPlanErrorKey(error: BrandPlanError, fallback: "add_failed" | "save_failed"): string {
  switch (error.code) {
    case "not_found": return "err_gone";
    case "locked": return "err_locked";
    case "read_only": return "err_read_only";
    case "no_host_card": return "err_no_host_card";
    case "stale_write": return "stale";
    case "too_many": return error.message.includes("an hour") ? "err_changes" : "err_too_many";
    case "invalid":
      if (error.token === "duplicate_title") return "err_duplicate";
      if (error.token === "title_too_long") return "err_title_long";
      if (error.token === "invalid_link") return "err_link";
      if (error.token === "invalid_note") return "err_note";
      if (error.token === "invalid_title") return "err_title_length";
      if (error.token === "invalid_date") return "err_date_past";
      return fallback;
    case "network":
    case "failed":
      return fallback;
    default: {
      const unreachable: never = error.code;
      return unreachable;
    }
  }
}
