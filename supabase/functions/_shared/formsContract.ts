// formsContract.ts — #4452 the one shared form contract (spec Part 2 §1.9, A1.3).
/*
 * Pure: no imports, no I/O. Deno (forms-submit, forms-admin, the sender) imports
 * this file; mingla-marketing/lib/forms/contract.ts is a byte-identical copy
 * (only the first line differs) and issue_4452_forms_contract_parity.test.ts
 * fails on any other difference. The SQL mirror is forms_validate_definition /
 * forms_validate_answers (20280712004452_issue_4452_forms_core.sql); the same
 * test regenerates the vectors embedded in the pg17 suite and fails on drift.
 *
 * MINGLA-INVARIANT: I-4452-ONE-FORM-RULESET | issue #4452 | page, server and SQL
 * apply the same rules with the same codes (issue_4452_forms_contract_parity).
 */

export const FIELD_TYPES = [
  "name", "email", "phone", "short", "long", "single", "multi", "dropdown",
  "social", "date", "consent",
] as const;
export type FieldType = typeof FIELD_TYPES[number];

export const LEAD_LABELS = ["host", "creator", "local"] as const;
export type LeadLabel = typeof LEAD_LABELS[number];

export const GOALS = ["call_booked", "app_signup", "approved", "none"] as const;
export type FormGoal = typeof GOALS[number];

export const PLACEMENTS = ["inline", "popup", "form_page", "book_call_details"] as const;
export type Placement = typeof PLACEMENTS[number];

export const AFTER_SUBMIT_ACTIONS = ["thank_you", "book_call", "link"] as const;
export type AfterSubmitAction = typeof AFTER_SUBMIT_ACTIONS[number];

export type AfterSubmit =
  | { action: "thank_you" }
  | { action: "book_call"; scheduler_key: string }
  | { action: "link"; url: string };

export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "youtube", "website"] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];

export interface ShowIf {
  field_key: string;
  op: "is" | "is_not" | "includes";
  value: string;
}

export interface FormField {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  required: boolean;
  locked?: boolean;
  options?: string[];
  source?: "options" | "google_city";
  show_if?: ShowIf;
  placeholder?: string;
}

export interface FormRouting {
  card: { on: boolean; pipeline?: "hosts" | "creators" };
  owner?: { mode: "unassigned" | "person" | "round_robin"; emails?: string[] };
}

export interface FormDefinition {
  v: 1;
  audience: LeadLabel;
  fields: FormField[];
  ads: { lead_on: boolean; goal: FormGoal };
  routing: FormRouting;
  after_submit?: AfterSubmit;
  design?: Record<string, unknown>;
  own_page?: {
    on: boolean;
    slug?: string;
    index?: boolean;
    h?: string;
    em?: string;
    lead?: string;
    bg?: "night" | "moss" | "clay" | "paper";
  };
}

export interface ContractError {
  path: string;
  code: string;
}

/** The label sent to ad platforms (spec §4.2), and its human name. */
export const LABEL_VALUE: Record<LeadLabel, string> = {
  host: "host_lead",
  creator: "creator_lead",
  local: "local_lead",
};
export const LABEL_NAME: Record<LeadLabel, string> = {
  host: "Host lead",
  creator: "Creator lead",
  local: "Local lead",
};
export const CALL_LABEL_VALUE: Record<LeadLabel, string> = {
  host: "host_call",
  creator: "creator_call",
  local: "local_call",
};

/** R-10: a typo domain is a blocking error with a suggestion. */
export const EMAIL_TYPO_DOMAINS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmail.co": "gmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "hotmial.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "iclod.com": "icloud.com",
};

/** The exact client strings (R-8…R-17); the server returns the same ones. */
export const ERROR_MESSAGES: Record<string, string> = {
  "name.required": "Add your name.",
  "name.invalid": "Add your name.",
  "email.required": "Add your email so we can reply.",
  "email.invalid": "That email looks incomplete.",
  "email.typo": "Did you mean ",
  "phone.required": "Add your phone number.",
  "phone.invalid": "That number looks short. The country code is on the left.",
  "single.required": "Pick one.",
  "single.bad_option": "Pick one.",
  "dropdown.required": "Choose one.",
  "dropdown.bad_option": "Choose one.",
  "dropdown.invalid": "Choose one.",
  "multi.required": "Pick at least one.",
  "multi.bad_option": "Pick at least one.",
  "social.required": "Use @handle or paste your profile link.",
  "social.invalid": "Use @handle or paste your profile link.",
  "date.required": "Pick a date from today on.",
  "date.invalid": "Pick a date from today on.",
  "date.past_date": "Pick a date from today on.",
  "short.required": "Add an answer.",
  "short.too_long": "That answer is too long.",
  "long.required": "Add an answer.",
  "long.too_long": "That answer is too long.",
  "unknown_field": "This form was just updated. Check your answers and send again.",
  "too_large": "That's too much text for one form.",
};

export function errorMessage(type: FieldType | null, code: string, suggestion?: string): string {
  if (code === "typo" && suggestion) return `Did you mean ${suggestion}?`;
  const key = type ? `${type}.${code}` : code;
  return ERROR_MESSAGES[key] ?? ERROR_MESSAGES[code] ?? "Check this answer.";
}

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED_SLUGS = ["thanks", "booked", "preview", "api", "new"];
const SCHEDULER_KEY_RE = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/;
const SAFE_AFTER_LINK_RE = /^(?:https:\/\/[^\s]+|\/[A-Za-z0-9][^\s]*)$/;
const CHOICE_TYPES: FieldType[] = ["single", "multi", "dropdown"];
const EMAIL_RE = /^[^ \t\n\r\f\u000B@]+@[^ \t\n\r\f\u000B@]+\.[a-z]{2,}$/;
const HANDLE_RE = /^@?[A-Za-z0-9_.]{2,30}$/;
const URL_RE = /^https?:\/\//;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Code-point length (matches SQL length()). */
export function cpLength(s: string): number {
  return [...s].length;
}

/** R-22: drop control characters (keep \n only in long text), trim spaces and newlines. */
export function cleanText(raw: string, keepNewlines: boolean): string {
  const stripped = keepNewlines
    ? raw.replace(/[\u0001-\u0009\u000B-\u001F\u007F]/g, "")
    : raw.replace(/[\u0001-\u001F\u007F]/g, "");
  return stripped.replace(/^[ \n]+|[ \n]+$/g, "");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
  return typeof v === "string";
}
function textOk(v: unknown, min: number, max: number): boolean {
  return isStr(v) && cpLength(cleanText(v, false)) >= min && cpLength(cleanText(v, false)) <= max;
}
function optText(v: unknown, max: number): boolean {
  return v === undefined || v === null || (isStr(v) && cpLength(v) <= max);
}

// ---------------------------------------------------------------------------
// Definition rules (R-1…R-7, R-25, R-26 and the field shape)
// ---------------------------------------------------------------------------
export function validateDefinition(def: unknown): ContractError[] {
  const errors: ContractError[] = [];
  const push = (path: string, code: string) => errors.push({ path, code });
  if (!isObj(def)) return [{ path: "", code: "not_object" }];
  if (!LEAD_LABELS.includes(def.audience as LeadLabel)) push("audience", "bad_audience"); // R-5
  const fields = def.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 40) {
    push("fields", "bad_fields");
    return errors;
  }
  const seen = new Set<string>();
  const typeOf = new Map<string, FieldType>();
  const optionsOf = new Map<string, string[]>();
  let emails = 0;
  let names = 0;
  let phones = 0;
  let consents = 0;
  fields.forEach((f: unknown, i: number) => {
    const p = `fields[${i}]`;
    if (!isObj(f)) {
      push(p, "bad_field");
      return;
    }
    const key = f.key;
    const type = f.type as FieldType;
    if (!isStr(key) || !KEY_RE.test(key)) push(`${p}.key`, "bad_key");
    else if (seen.has(key)) push(`${p}.key`, "duplicate_key"); // R-7
    if (!FIELD_TYPES.includes(type)) {
      push(`${p}.type`, "bad_type");
      return;
    }
    if (!textOk(f.label, 1, 120)) push(`${p}.label`, "bad_label");
    if (!optText(f.help, 200)) push(`${p}.help`, "bad_help");
    if (!optText(f.placeholder, 60)) push(`${p}.placeholder`, "bad_placeholder");
    if (typeof f.required !== "boolean") push(`${p}.required`, "bad_required");
    if (f.locked !== undefined && typeof f.locked !== "boolean") push(`${p}.locked`, "bad_locked");
    if (f.locked === true && f.required !== true) push(`${p}.required`, "locked_field"); // R-6
    if (type === "email") {
      emails += 1;
      if (f.required !== true) push(`${p}.required`, "email_not_required"); // R-1
    }
    if (type === "name") names += 1;
    if (type === "phone") phones += 1;
    if (type === "consent") {
      consents += 1;
      if (f.required === true) push(`${p}.required`, "consent_required"); // R-3
    }
    const isCity = type === "dropdown" && f.source === "google_city";
    if (type === "dropdown" && f.source !== undefined && f.source !== "options" && f.source !== "google_city") {
      push(`${p}.source`, "bad_source");
    }
    if (CHOICE_TYPES.includes(type) && !isCity) {
      const opts = f.options;
      const ok = Array.isArray(opts) && opts.length >= 1 && opts.length <= 20 &&
        opts.every((o) => textOk(o, 1, 60)) &&
        new Set(opts.map((o) => cleanText(String(o), false))).size === opts.length;
      if (!ok) push(`${p}.options`, "bad_options");
      else if (isStr(key)) optionsOf.set(key, (opts as string[]).map((o) => cleanText(o, false)));
    } else if (f.options !== undefined && !isCity) {
      push(`${p}.options`, "bad_options");
    }
    if (f.show_if !== undefined) {
      const s = f.show_if;
      const target = isObj(s) && isStr(s.field_key) ? s.field_key : null;
      if (!isObj(s) || !target || !["is", "is_not", "includes"].includes(String(s.op)) || !textOk(s.value, 1, 60)) {
        push(`${p}.show_if`, "bad_show_if");
      } else if (!typeOf.has(target)) {
        push(`${p}.show_if`, "show_if_order"); // R-7: an earlier field only
      } else {
        const tt = typeOf.get(target) as FieldType;
        if (!CHOICE_TYPES.includes(tt) || !optionsOf.has(target)) push(`${p}.show_if`, "show_if_type");
      }
    }
    if (isStr(key) && KEY_RE.test(key) && !seen.has(key)) {
      seen.add(key);
      typeOf.set(key, type);
    }
  });
  if (emails !== 1) push("fields", "email_field_count"); // R-1
  if (names > 1 || phones > 1 || consents > 1) push("fields", "duplicate_singleton"); // R-2
  if (def.audience === "host" && (phones !== 1 || !(fields as FormField[]).some((f) => f.type === "phone" && f.required === true))) {
    push("fields", "host_phone_required");
  }

  const ads = def.ads;
  if (!isObj(ads) || typeof ads.lead_on !== "boolean" || !GOALS.includes(ads.goal as FormGoal)) {
    push("ads", "bad_ads");
  }
  const routing = def.routing;
  if (!isObj(routing) || !isObj(routing.card) || typeof routing.card.on !== "boolean") {
    push("routing", "bad_routing");
  } else {
    const card = routing.card;
    if (card.on === true) {
      if (def.audience === "local") push("routing.card", "card_local"); // R-25
      else if (card.pipeline !== "hosts" && card.pipeline !== "creators") push("routing.card", "card_needs_pipeline");
      else if ((def.audience === "host") !== (card.pipeline === "hosts")) push("routing.card", "card_pipeline_mismatch");
    } else if (card.pipeline !== undefined && card.pipeline !== "hosts" && card.pipeline !== "creators") {
      push("routing.card", "card_needs_pipeline");
    }
    const owner = routing.owner;
    if (owner !== undefined && owner !== null) {
      if (card.on !== true) push("routing.owner", "owner_without_card"); // R-26
      else if (!isObj(owner) || !["unassigned", "person", "round_robin"].includes(String(owner.mode))) {
        push("routing.owner", "bad_owner");
      } else {
        const em = owner.emails;
        const list = Array.isArray(em) ? em : [];
        const okList = list.every((e) => isStr(e) && EMAIL_RE.test(e.toLowerCase()) && e.length <= 254) &&
          list.length <= 10;
        if (!okList || (owner.mode === "person" && list.length !== 1) ||
          (owner.mode === "round_robin" && list.length < 2) || (owner.mode === "unassigned" && list.length > 0)) {
          push("routing.owner", "bad_owner");
        }
      }
    }
  }
  const after = def.after_submit;
  if (after !== undefined && after !== null) {
    if (!isObj(after) || !AFTER_SUBMIT_ACTIONS.includes(after.action as AfterSubmitAction)) {
      push("after_submit", "bad_after_submit");
    } else if (after.action === "book_call") {
      if (!isStr(after.scheduler_key) || !SCHEDULER_KEY_RE.test(after.scheduler_key)) {
        push("after_submit.scheduler_key", "bad_after_submit");
      }
    } else if (after.action === "link") {
      if (!isStr(after.url) || cpLength(after.url) > 500 || !SAFE_AFTER_LINK_RE.test(after.url)) {
        push("after_submit.url", "bad_after_submit");
      }
    }
  }
  const own = def.own_page;
  if (own !== undefined && own !== null) {
    if (!isObj(own) || typeof own.on !== "boolean") push("own_page", "bad_own_page");
    else {
      if (own.on === true && (!isStr(own.slug) || !SLUG_RE.test(own.slug) || RESERVED_SLUGS.includes(own.slug))) {
        push("own_page.slug", "bad_slug");
      }
      if (!optText(own.h, 28) || !optText(own.em, 24) || !optText(own.lead, 160)) push("own_page", "bad_own_page");
      if (own.bg !== undefined && !["night", "moss", "clay", "paper"].includes(String(own.bg))) {
        push("own_page.bg", "bad_own_page");
      }
      if (own.index !== undefined && typeof own.index !== "boolean") push("own_page.index", "bad_own_page");
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Answer rules (R-8…R-24)
// ---------------------------------------------------------------------------
export interface AnswerResult {
  ok: boolean;
  errors: Array<{ key: string; code: string }>;
  values: Record<string, unknown>;
  email: string | null;
  name: string | null;
  first_name: string | null;
  phone_e164: string | null;
  phone_country: string | null;
  consent: boolean;
}

/** R-19 / show_if: is this field shown, given the answers so far? */
export function isVisible(field: FormField, fields: FormField[], answers: Record<string, unknown>): boolean {
  const s = field.show_if;
  if (!s) return true;
  const target = fields.find((f) => f.key === s.field_key);
  if (!target || !isVisible(target, fields, answers)) return false;
  const v = answers[s.field_key];
  const has = Array.isArray(v) ? v.includes(s.value) : v === s.value;
  if (s.op === "is_not") return !has;
  return has;
}

function emailOf(raw: string): { value: string; code: string | null; suggestion?: string } {
  const value = cleanText(raw, false).toLowerCase();
  if (value === "") return { value, code: "required" };
  if (cpLength(value) > 254 || !EMAIL_RE.test(value)) return { value, code: "invalid" };
  const domain = value.slice(value.lastIndexOf("@") + 1);
  const fix = EMAIL_TYPO_DOMAINS[domain];
  if (fix) return { value, code: "typo", suggestion: fix };
  return { value, code: null };
}

/** R-11: {country, dial, number} → E.164. Returns null when invalid. */
export function phoneE164(v: unknown): { e164: string; country: string } | null {
  if (!isObj(v) || !isStr(v.country) || !isStr(v.dial) || !isStr(v.number)) return null;
  if (!/^[A-Z]{2}$/.test(v.country) || !/^\+[1-9][0-9]{0,3}$/.test(v.dial)) return null;
  const raw = v.number.replace(/\(0\)/g, "");
  let digits: string;
  if (/^[ ]*\+/.test(raw)) digits = raw.replace(/[^0-9]/g, "");
  else digits = v.dial.slice(1) + raw.replace(/[^0-9]/g, "").replace(/^0+/, "");
  if (!/^[1-9][0-9]{6,14}$/.test(digits)) return null;
  return { e164: `+${digits}`, country: v.country };
}

function socialOf(v: unknown): string | null {
  if (!isObj(v) || !SOCIAL_PLATFORMS.includes(v.platform as SocialPlatform) || !isStr(v.value)) return null;
  const value = cleanText(v.value, false);
  if (URL_RE.test(value)) return cpLength(value) <= 300 ? value : null;
  if (v.platform === "website") return null;
  if (!HANDLE_RE.test(value)) return null;
  const h = value.replace(/^@/, "");
  if (v.platform === "instagram") return `https://instagram.com/${h}`;
  if (v.platform === "tiktok") return `https://tiktok.com/@${h}`;
  return `https://youtube.com/@${h}`;
}

function realDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1900) return false;
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Serialised size in bytes (R-21). The SQL mirror cannot reproduce
 * JSON.stringify, so it keeps a looser 20 KB backstop on the jsonb text; the
 * edge function and the page enforce this exact 16 KB limit first.
 */
export function answersBytes(answers: unknown): number {
  return new TextEncoder().encode(JSON.stringify(answers)).length;
}

/**
 * Validate a visitor's answers against a definition. `today` is the visitor's
 * local date (YYYY-MM-DD) for R-17. Unknown keys are rejected (R-20); hidden
 * fields are dropped (R-19).
 */
export function validateAnswers(def: FormDefinition, answers: unknown, today: string): AnswerResult {
  const out: AnswerResult = {
    ok: false, errors: [], values: {}, email: null, name: null, first_name: null,
    phone_e164: null, phone_country: null, consent: false,
  };
  const err = (key: string, code: string) => out.errors.push({ key, code });
  if (!isObj(answers)) {
    err("_", "not_object");
    return out;
  }
  if (answersBytes(answers) > 16384) {
    err("_", "too_large");
    return out;
  }
  const fields = Array.isArray(def.fields) ? def.fields : [];
  const known = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(answers).sort()) {
    if (!known.has(k)) err(k, "unknown_field");
  }
  for (const f of fields) {
    if (!isVisible(f, fields, answers)) continue;
    const v = answers[f.key];
    const empty = v === undefined || v === null || (isStr(v) && cleanText(v, f.type === "long") === "") ||
      (Array.isArray(v) && v.length === 0);
    if (f.type === "consent") {
      out.consent = v === true; // R-18: only a real boolean true counts
      out.values[f.key] = v === true;
      continue;
    }
    if (empty) {
      if (f.required) err(f.key, "required");
      continue;
    }
    switch (f.type) {
      case "name": {
        const s = isStr(v) ? cleanText(v, false) : "";
        if (cpLength(s) < 2 || cpLength(s) > 80) err(f.key, "invalid");
        else {
          out.values[f.key] = s;
          out.name = s;
          out.first_name = s.split(" ")[0] ?? s;
        }
        break;
      }
      case "email": {
        if (!isStr(v)) {
          err(f.key, "invalid");
          break;
        }
        const e = emailOf(v);
        if (e.code) err(f.key, e.code);
        else {
          out.values[f.key] = e.value;
          out.email = e.value;
        }
        break;
      }
      case "phone": {
        const p = phoneE164(v);
        if (!p) err(f.key, "invalid");
        else {
          out.values[f.key] = p.e164;
          out.phone_e164 = p.e164;
          out.phone_country = p.country;
        }
        break;
      }
      case "short":
      case "long": {
        const s = isStr(v) ? cleanText(v, f.type === "long") : null;
        if (s === null) err(f.key, "invalid");
        else if (cpLength(s) > (f.type === "short" ? 120 : 2000)) err(f.key, "too_long");
        else out.values[f.key] = s;
        break;
      }
      case "single":
      case "dropdown": {
        if (f.type === "dropdown" && f.source === "google_city") {
          if (!isObj(v) || !isStr(v.label)) {
            err(f.key, "invalid");
            break;
          }
          const label = cleanText(v.label, false);
          const parts = ["city", "region", "country"].map((k) => v[k]);
          if (cpLength(label) < 2 || cpLength(label) > 120 || !parts.every((x) => x === undefined || x === null || (isStr(x) && cpLength(x) <= 80))) {
            err(f.key, "invalid");
            break;
          }
          const city: Record<string, unknown> = { label };
          for (const k of ["city", "region", "country"]) {
            if (isStr(v[k])) city[k] = cleanText(v[k] as string, false);
          }
          if (v.free === true) city.free = true;
          out.values[f.key] = city;
          break;
        }
        if (!isStr(v) || !(f.options ?? []).includes(v)) err(f.key, "bad_option");
        else out.values[f.key] = v;
        break;
      }
      case "multi": {
        if (!Array.isArray(v) || !v.every((x) => isStr(x) && (f.options ?? []).includes(x)) || new Set(v).size !== v.length) {
          err(f.key, "bad_option");
        } else out.values[f.key] = v;
        break;
      }
      case "social": {
        const url = socialOf(v);
        if (!url) err(f.key, "invalid");
        else out.values[f.key] = { platform: (v as Record<string, unknown>).platform, url };
        break;
      }
      case "date": {
        const from = isStr(v) ? v : isObj(v) && isStr(v.from) ? v.from : null;
        const to = isObj(v) && isStr(v.to) ? v.to : null;
        if (!from || !realDate(from) || (to !== null && (!realDate(to) || to < from))) err(f.key, "invalid");
        else if (from < today) err(f.key, "past_date");
        else out.values[f.key] = to ? { from, to } : { from };
        break;
      }
    }
  }
  out.errors.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.code < b.code ? -1 : 1));
  out.ok = out.errors.length === 0;
  if (!out.ok) {
    out.values = {};
    out.email = null;
    out.name = null;
    out.first_name = null;
    out.phone_e164 = null;
    out.phone_country = null;
    out.consent = false;
  }
  return out;
}

/** The typo suggestion for the "Fix it" button (R-10), or null. */
export function emailTypoFix(raw: string): string | null {
  const e = emailOf(raw);
  if (e.code !== "typo" || !e.suggestion) return null;
  return e.value.slice(0, e.value.lastIndexOf("@") + 1) + e.suggestion;
}

// ---------------------------------------------------------------------------
// Automation flow (spec §5.2, F-1…F-12)
// ---------------------------------------------------------------------------
export const FLOW_FROM = ["creators", "locals", "hosts", "seth"] as const;
export const FLOW_TEAM_TO = ["creators_inbox", "locals_inbox", "hosts_inbox", "owner", "seth"] as const;
export const ACTION_BARS = ["auto", "host", "creator", "local", "off"] as const;
export const BASE_TOKENS = ["first_name", "name", "page", "spot", "utm_source", "utm_campaign", "form_name"];

export interface FlowStep {
  id: string;
  type: "email" | "team" | "wait" | "branch" | "stage";
  [k: string]: unknown;
}
export interface AutomationFlow {
  v: 1;
  steps: FlowStep[];
}

/** Every merge token a form offers (`{answers.<key>}` for each field except consent). */
export function formTokens(def: FormDefinition): string[] {
  const answerKeys = (def.fields ?? []).filter((f) => f.type !== "consent").map((f) => `answers.${f.key}`);
  return [...BASE_TOKENS, ...answerKeys];
}

/** The `{token}` names used in a string, in order of first use. */
export function tokensIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** F-6: confirmation before any wait on its path, otherwise follow-up; team is always team_alert. */
export function emailKinds(flow: AutomationFlow): Record<string, "confirmation" | "follow_up" | "team_alert"> {
  const out: Record<string, "confirmation" | "follow_up" | "team_alert"> = {};
  const walk = (steps: FlowStep[], waited: boolean) => {
    let w = waited;
    for (const s of steps) {
      if (s.type === "wait") w = true;
      else if (s.type === "email") out[s.id] = w ? "follow_up" : "confirmation";
      else if (s.type === "team") out[s.id] = "team_alert";
      else if (s.type === "branch") {
        walk(Array.isArray(s.yes) ? s.yes as FlowStep[] : [], w);
        walk(Array.isArray(s.no) ? s.no as FlowStep[] : [], w);
      }
    }
  };
  walk(Array.isArray(flow?.steps) ? flow.steps : [], false);
  return out;
}

function docText(doc: unknown): string[] {
  // A composer document is a list of blocks; text lives in string props.
  const out: string[] = [];
  const visit = (x: unknown) => {
    if (isStr(x)) out.push(x);
    else if (Array.isArray(x)) x.forEach(visit);
    else if (isObj(x)) Object.values(x).forEach(visit);
  };
  visit(doc);
  return out;
}

/** F-1…F-12. `cardOn` and `stages` come from the form (F-4); `hasConsent` is R-4 / F-7. */
export function validateFlow(
  flow: unknown,
  ctx: { def: FormDefinition; cardOn: boolean; stages: string[] },
): ContractError[] {
  const errors: ContractError[] = [];
  const push = (path: string, code: string) => errors.push({ path, code });
  if (!isObj(flow) || !Array.isArray(flow.steps)) return [{ path: "", code: "bad_flow" }];
  const ids = new Set<string>();
  const tokens = formTokens(ctx.def);
  const choiceKeys = new Map<string, string[]>();
  for (const f of ctx.def.fields ?? []) {
    if (CHOICE_TYPES.includes(f.type) && f.source !== "google_city") choiceKeys.set(f.key, f.options ?? []);
  }
  let count = 0;
  const walk = (steps: unknown[], path: string, depth: number, waitDays: number) => {
    let days = waitDays;
    steps.forEach((raw, i) => {
      const p = `${path}[${i}]`;
      count += 1;
      if (!isObj(raw)) {
        push(p, "bad_step");
        return;
      }
      const s = raw as FlowStep;
      if (!isStr(s.id) || !/^[a-z0-9_-]{2,40}$/.test(s.id)) push(`${p}.id`, "bad_id");
      else if (ids.has(s.id)) push(`${p}.id`, "duplicate_id"); // F-2
      else ids.add(s.id);
      switch (s.type) {
        case "email": {
          if (!textOk(s.name, 1, 60)) push(`${p}.name`, "bad_name");
          if (s.to !== "person") push(`${p}.to`, "bad_to");
          if (!FLOW_FROM.includes(s.from as typeof FLOW_FROM[number])) push(`${p}.from`, "bad_from"); // F-5
          if (s.reply_to !== "team" && s.reply_to !== "owner") push(`${p}.reply_to`, "bad_reply_to");
          if (!textOk(s.subject, 1, 80)) push(`${p}.subject`, "bad_subject"); // F-8
          const texts = docText(s.doc).filter((t) => cleanText(t, true) !== "");
          if (!Array.isArray(s.doc) || texts.length === 0) push(`${p}.doc`, "empty_doc"); // F-8
          if (s.button !== undefined && s.button !== null && (!isObj(s.button) || !textOk(s.button.text, 1, 28))) {
            push(`${p}.button`, "bad_button");
          }
          if (typeof s.show_answers !== "boolean") push(`${p}.show_answers`, "bad_show_answers");
          if (s.action_bar !== undefined && !ACTION_BARS.includes(s.action_bar as typeof ACTION_BARS[number])) {
            push(`${p}.action_bar`, "bad_action_bar"); // F-12
          }
          const used = [...(isStr(s.subject) ? tokensIn(s.subject) : []), ...docText(s.doc).flatMap(tokensIn)];
          for (const t of used) if (!tokens.includes(t)) push(`${p}`, `unknown_token:${t}`); // F-9
          break;
        }
        case "team":
          if (!textOk(s.name, 1, 60)) push(`${p}.name`, "bad_name");
          if (!FLOW_TEAM_TO.includes(s.to as typeof FLOW_TEAM_TO[number])) push(`${p}.to`, "bad_to"); // F-5
          if (typeof s.include_answers !== "boolean") push(`${p}.include_answers`, "bad_include_answers");
          break;
        case "wait": {
          const n = s.n;
          if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 60) push(`${p}.n`, "bad_wait");
          if (!["hours", "days", "weeks"].includes(String(s.unit))) push(`${p}.unit`, "bad_wait");
          if (typeof s.at10 !== "boolean" || typeof s.skip_weekends !== "boolean") push(p, "bad_wait");
          if (typeof n === "number") {
            days += s.unit === "hours" ? n / 24 : s.unit === "weeks" ? n * 7 : n;
          }
          if (days > 90) push(p, "waits_over_90_days"); // F-10
          break;
        }
        case "branch": {
          if (depth >= 3) push(p, "branch_too_deep"); // F-1
          const c = s.cond;
          if (!isObj(c) || !["answer", "booked", "opened_last", "clicked_last", "lead_label"].includes(String(c.on))) {
            push(`${p}.cond`, "bad_cond");
          } else {
            if (!["is", "is_not", "contains"].includes(String(c.op)) || !(c.value === undefined || optText(c.value, 60))) {
              push(`${p}.cond`, "bad_cond");
            }
            if (c.on === "answer" && (!isStr(c.field_key) || !choiceKeys.has(c.field_key))) {
              push(`${p}.cond`, "bad_branch_field"); // F-3
            }
          }
          walk(Array.isArray(s.yes) ? s.yes : [], `${p}.yes`, depth + 1, days);
          walk(Array.isArray(s.no) ? s.no : [], `${p}.no`, depth + 1, days);
          if (!Array.isArray(s.yes) || !Array.isArray(s.no)) push(p, "bad_branch");
          break;
        }
        case "stage":
          if (!ctx.cardOn) push(p, "stage_needs_card"); // F-4 / A1
          else if (!isStr(s.stage) || !ctx.stages.includes(s.stage)) push(`${p}.stage`, "bad_stage");
          break;
        default:
          push(`${p}.type`, "bad_type");
      }
    });
  };
  walk(flow.steps, "steps", 0, 0);
  if (count > 30) push("steps", "too_many_steps"); // F-1
  const kinds = emailKinds(flow as unknown as AutomationFlow);
  const hasFollowUp = Object.values(kinds).includes("follow_up");
  if (hasFollowUp && !(ctx.def.fields ?? []).some((f) => f.type === "consent")) {
    push("steps", "follow_up_needs_consent"); // F-7 / R-4
  }
  return errors;
}

/** The five publish checks shown in the builder (design `checks()`). */
export function publishChecks(
  def: FormDefinition,
  flow: AutomationFlow | null,
  testedAt: string | null,
): Array<{ id: string; ok: boolean }> {
  const fields = def.fields ?? [];
  const kinds = flow ? emailKinds(flow) : {};
  const hasFollowUp = Object.values(kinds).includes("follow_up");
  // #4452 B22: "Send me a test" has nothing to send when no email reaches the person.
  const sendsEmail = Object.values(kinds).some((k) => k === "confirmation" || k === "follow_up");
  return [
    { id: "email_required", ok: fields.some((f) => f.type === "email" && f.required) },
    { id: "consent_for_follow_ups", ok: !hasFollowUp || fields.some((f) => f.type === "consent") },
    { id: "consent_optional", ok: !fields.some((f) => f.type === "consent" && f.required) },
    { id: "lead_label_set", ok: LEAD_LABELS.includes(def.audience) },
    { id: "tested", ok: testedAt !== null || !sendsEmail },
  ];
}
