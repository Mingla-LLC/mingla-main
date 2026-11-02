/**
 * Issue #3355 — contact-list import through Ari: reading a list the owner
 * attached or pasted into name, phone (E.164) and email.
 *
 * Pure: no I/O. The flow (`contactImport.ts`) turns the kept rows into the
 * three-column CSV the existing contact import (`supabase/functions/
 * contact-import`, #1775) already accepts, so matching against existing
 * contacts, permission and saving all stay on that one path.
 *
 * Rules:
 *   - Columns are found by their header (name, full name, first + last,
 *     phone, mobile, tel, email, e-mail…). A list with no header is read by
 *     content: an "@" is an email, a run of digits is a phone, the rest is
 *     the name.
 *   - Phones follow the brand phone field's rules exactly
 *     (`websiteSetupPhone`, the shared parser in packages/phone-input) with
 *     the brand's country as the default. A row whose phone can't be read
 *     keeps its email and is listed, never dropped silently.
 *   - Rows with neither a usable phone nor a usable email are skipped and
 *     listed. Duplicates inside the list are merged and listed.
 *   - It never blocks: every problem is a listed row, never a refusal of the
 *     whole list.
 */

import { CONTACT_IMPORT_ALIASES } from "../contactImportContract.ts";
import { isUndeliverableEmailDomain } from "../undeliverableEmail.ts";
import { websiteSetupPhone } from "../agentWebsiteSetup.ts";
import { COUNTRY_DIRECTORY } from "../../../../packages/phone-input/countryDirectory.ts";

export interface ContactListRow {
  /** The row number the owner sees in their file (header row = 1). */
  row: number;
  name: string;
  email: string | null;
  phone: string | null;
}

export type ContactListProblemKind =
  | "no_contact"
  | "bad_phone_kept_email"
  | "bad_phone_skipped"
  | "bad_email_kept_phone"
  | "bad_email_skipped"
  | "duplicate_merged"
  | "duplicate_conflict";

export interface ContactListProblem {
  row: number;
  kind: ContactListProblemKind;
  /** Plain words for the owner, about this one row. */
  words: string;
  /** The row the problem row was merged into (duplicates). */
  same_as?: number;
}

export interface ParsedContactList {
  /** Rows that will be offered for import (merged, normalised). */
  rows: ContactListRow[];
  problems: ContactListProblem[];
  /** Data rows read (header excluded). */
  total: number;
  skipped: number;
  merged: number;
  had_header: boolean;
}

/** The row cap the existing import accepts (#1775 CONTACT_IMPORT_MAX_ROWS). */
export const CONTACT_LIST_MAX_ROWS = 10_000;

type Column = "full_name" | "first_name" | "last_name" | "email" | "phone";

const EXTRA_ALIASES: Readonly<Record<Column, readonly string[]>> = {
  full_name: ["guest", "guest name", "customer", "customer name", "person"],
  first_name: ["first", "given name", "forename"],
  last_name: ["last", "surname", "family name"],
  email: ["mail", "emails", "email addresses", "e mail"],
  phone: [
    "tel",
    "telephone",
    "telephone number",
    "tel no",
    "phone no",
    "mobile number",
    "mobile no",
    "cell",
    "cell number",
    "whatsapp",
    "whatsapp number",
    "phone numbers",
    "number",
  ],
};

function headerKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase()
    .replace(/[.#:*]/g, " ")
    .replace(/[\s_-]+/g, " ").trim();
}

const HEADER_INDEX: ReadonlyMap<string, Column> = (() => {
  const map = new Map<string, Column>();
  for (const [column, aliases] of Object.entries(CONTACT_IMPORT_ALIASES)) {
    for (const alias of aliases) map.set(headerKey(alias), column as Column);
  }
  for (const [column, aliases] of Object.entries(EXTRA_ALIASES)) {
    for (const alias of aliases) map.set(headerKey(alias), column as Column);
  }
  return map;
})();

const EMAIL_IN_TEXT = /[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[a-z]{2,}/i;
const EMAIL_EXACT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_IN_TEXT = /(?:\+|00)?\(?\d[\d\s().\-/]{5,}\d/;
const PHONE_SHAPED = /^(?:\+|00)?[\d\s().\-/]+$/;

function cleanEmail(value: string): string {
  return value.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "")
    .replace(/[.,;]+$/, "").toLowerCase();
}

function looksLikePhone(value: string): boolean {
  const trimmed = value.trim();
  if (!PHONE_SHAPED.test(trimmed)) return false;
  return trimmed.replace(/\D/g, "").length >= 7;
}

function cleanName(value: string): string {
  return value.replace(/["“”]/g, "").replace(/\s+/g, " ").trim()
    .replace(/^[,;\-–—|()]+|[,;\-–—|()]+$/g, "").trim().slice(0, 120);
}

function countryName(iso: string | null): string | null {
  if (!iso) return null;
  const entry = COUNTRY_DIRECTORY.find((country) => country.code === iso);
  return entry?.name ?? null;
}

/**
 * One phone, by the brand phone field's rules. A number written with its
 * country code but no "+" ("2348031234567" on a UK brand) is read with the
 * "+" only when the brand-country reading fails and the "+" reading is a
 * real number of a country the parser knows — never a different number.
 */
export function contactPhone(
  raw: string,
  brandCountry: string | null,
): { ok: true; e164: string } | { ok: false; problem: string } {
  const text = raw.trim();
  const first = websiteSetupPhone({
    text,
    countryIso: null,
    stored: null,
    brandCountryCode: brandCountry,
  });
  if (first.ok) return { ok: true, e164: first.value };
  const digits = text.replace(/\D/g, "");
  const bare = !/^\s*(?:\+|00)/.test(text) && !digits.startsWith("0") &&
    digits.length >= 11 && digits.length <= 15;
  if (bare) {
    const withPlus = websiteSetupPhone({
      text: `+${digits}`,
      countryIso: null,
      stored: null,
      brandCountryCode: brandCountry,
    });
    if (withPlus.ok) return { ok: true, e164: withPlus.value };
  }
  const where = countryName(brandCountry);
  return {
    ok: false,
    problem: brandCountry
      ? `the phone number doesn't look like a ${where ?? brandCountry} number and has no country code`
      : "the phone number has no country code, and your brand has no country set",
  };
}

/** Split one line by a delimiter, honouring double quotes. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field.trim().length === 0) {
      field = "";
      quoted = true;
    } else if (c === delimiter) {
      cells.push(field.trim());
      field = "";
    } else field += c;
  }
  cells.push(field.trim());
  return cells;
}

function chooseDelimiter(lines: string[]): string | null {
  const sample = lines.slice(0, 20);
  let best: { delimiter: string; score: number } | null = null;
  for (const delimiter of ["\t", ",", ";", "|"]) {
    const widths = sample.map((line) => splitLine(line, delimiter).length);
    const multi = widths.filter((width) => width > 1).length;
    if (multi < Math.ceil(sample.length / 2)) continue;
    const score = multi * 10 + Math.min(...widths);
    if (!best || score > best.score) best = { delimiter, score };
  }
  return best?.delimiter ?? null;
}

interface RawRow {
  row: number;
  name: string;
  emailRaw: string;
  phoneRaw: string;
}

/** A line with no columns: the email, the phone, and what's left is the name. */
function rowFromText(text: string, row: number): RawRow {
  let rest = text;
  const email = rest.match(EMAIL_IN_TEXT)?.[0] ?? "";
  if (email) rest = rest.replace(email, " ");
  const phone = rest.match(PHONE_IN_TEXT)?.[0] ?? "";
  if (phone) rest = rest.replace(phone, " ");
  return { row, name: cleanName(rest), emailRaw: email, phoneRaw: phone };
}

/** Cells with no header: each cell is read by what it looks like. */
function rowFromCells(cells: string[], row: number): RawRow {
  let emailRaw = "";
  let phoneRaw = "";
  const names: string[] = [];
  for (const cell of cells) {
    const value = cell.trim();
    if (!value) continue;
    if (!emailRaw && EMAIL_IN_TEXT.test(value)) {
      emailRaw = value.match(EMAIL_IN_TEXT)?.[0] ?? value;
    } else if (!phoneRaw && looksLikePhone(value)) {
      phoneRaw = value;
    } else if (!/^\d+$/.test(value) && !EMAIL_IN_TEXT.test(value)) {
      names.push(value);
    }
  }
  return { row, name: cleanName(names.join(" ")), emailRaw, phoneRaw };
}

function headerMap(cells: string[]): Map<Column, number> | null {
  const map = new Map<Column, number>();
  cells.forEach((cell, index) => {
    const column = HEADER_INDEX.get(headerKey(cell));
    if (column && !map.has(column)) map.set(column, index);
  });
  return map.has("email") || map.has("phone") || map.has("full_name") ||
      map.has("first_name")
    ? map
    : null;
}

/**
 * Cells under a header. A value in the wrong column (an email under Phone,
 * a phone under Name) is read for what it is.
 */
function rowFromHeader(
  cells: string[],
  map: Map<Column, number>,
  row: number,
): RawRow {
  const at = (column: Column) => {
    const index = map.get(column);
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };
  let name = at("full_name") ||
    [at("first_name"), at("last_name")].filter(Boolean).join(" ");
  const pool = [at("email"), at("phone")];
  if (EMAIL_IN_TEXT.test(name) || looksLikePhone(name)) {
    pool.push(name);
    name = "";
  }
  const emailRaw = pool.find((value) => EMAIL_IN_TEXT.test(value)) ??
    at("email");
  const phoneRaw = pool.find((value) => looksLikePhone(value)) ??
    (EMAIL_IN_TEXT.test(at("phone")) ? "" : at("phone"));
  return {
    row,
    name: cleanName(name),
    emailRaw: EMAIL_IN_TEXT.test(emailRaw)
      ? emailRaw.match(EMAIL_IN_TEXT)?.[0] ?? emailRaw
      : emailRaw,
    phoneRaw,
  };
}

function label(raw: RawRow): string {
  return raw.name ? `${raw.name} (row ${raw.row})` : `Row ${raw.row}`;
}

/**
 * Read a pasted or attached list. `brandCountry` is the brand's ISO country,
 * the default for numbers written without a country code.
 */
export function parseContactList(
  text: string,
  brandCountry: string | null,
): ParsedContactList {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
    .split("\n").map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const delimiter = chooseDelimiter(lines);
  const firstCells = delimiter ? splitLine(lines[0] ?? "", delimiter) : [];
  const map = delimiter ? headerMap(firstCells) : null;
  const firstIsData = !map && lines.length > 0 &&
    (EMAIL_IN_TEXT.test(lines[0]) || PHONE_IN_TEXT.test(lines[0]));
  const hadHeader = !!map || (!firstIsData && lines.length > 1 &&
    !EMAIL_IN_TEXT.test(lines[0]) && !PHONE_IN_TEXT.test(lines[0]));
  const dataLines = hadHeader ? lines.slice(1) : lines;
  const offset = hadHeader ? 2 : 1;

  const raws: RawRow[] = dataLines.slice(0, CONTACT_LIST_MAX_ROWS).map(
    (line, index) => {
      const row = index + offset;
      if (!delimiter) return rowFromText(line, row);
      const cells = splitLine(line, delimiter);
      return map ? rowFromHeader(cells, map, row) : rowFromCells(cells, row);
    },
  );

  const problems: ContactListProblem[] = [];
  const kept: ContactListRow[] = [];
  const byEmail = new Map<string, number>();
  const byPhone = new Map<string, number>();
  let skipped = 0;
  let merged = 0;

  for (const raw of raws) {
    let email: string | null = null;
    let emailProblem: string | null = null;
    if (raw.emailRaw.trim()) {
      const candidate = cleanEmail(raw.emailRaw);
      if (!EMAIL_EXACT.test(candidate)) {
        emailProblem = "the email address isn't complete";
      } else if (isUndeliverableEmailDomain(candidate)) {
        emailProblem = "the email address is a test address that can't get mail";
      } else email = candidate;
    }
    let phone: string | null = null;
    let phoneProblem: string | null = null;
    if (raw.phoneRaw.trim()) {
      const parsed = contactPhone(raw.phoneRaw, brandCountry);
      if (parsed.ok) phone = parsed.e164;
      else phoneProblem = parsed.problem;
    }

    if (!email && !phone) {
      skipped += 1;
      const why = phoneProblem ?? emailProblem;
      problems.push({
        row: raw.row,
        kind: why
          ? (phoneProblem ? "bad_phone_skipped" : "bad_email_skipped")
          : "no_contact",
        words: why
          ? `${label(raw)}: skipped, ${why}.`
          : `${label(raw)}: skipped, no phone number or email.`,
      });
      continue;
    }
    if (phoneProblem) {
      problems.push({
        row: raw.row,
        kind: "bad_phone_kept_email",
        words: `${label(raw)}: added with their email only — ${phoneProblem}.`,
      });
    }
    if (emailProblem) {
      problems.push({
        row: raw.row,
        kind: "bad_email_kept_phone",
        words: `${label(raw)}: added with their phone only — ${emailProblem}.`,
      });
    }

    const matches = new Set<number>();
    if (email && byEmail.has(email)) matches.add(byEmail.get(email)!);
    if (phone && byPhone.has(phone)) matches.add(byPhone.get(phone)!);
    if (matches.size > 1) {
      skipped += 1;
      problems.push({
        row: raw.row,
        kind: "duplicate_conflict",
        words:
          `${label(raw)}: skipped, its email and phone belong to two different people earlier in the list.`,
      });
      continue;
    }
    if (matches.size === 1) {
      const index = [...matches][0];
      const first = kept[index];
      const differs = email && first.email && first.email !== email
        ? "email"
        : phone && first.phone && first.phone !== phone
        ? "phone"
        : raw.name && first.name &&
            raw.name.toLowerCase() !== first.name.toLowerCase()
        ? "name"
        : null;
      if (differs) {
        // Same email or phone, but something else disagrees: two people
        // sharing a number, or a typo. Never merged on a guess.
        skipped += 1;
        problems.push({
          row: raw.row,
          kind: "duplicate_conflict",
          same_as: first.row,
          words: `${label(raw)}: skipped, same ${
            email && first.email === email ? "email" : "phone"
          } as row ${first.row} but a different ${differs} — I kept row ${first.row}.`,
        });
        continue;
      }
      merged += 1;
      if (!first.name && raw.name) first.name = raw.name;
      if (!first.email && email) {
        first.email = email;
        byEmail.set(email, index);
      }
      if (!first.phone && phone) {
        first.phone = phone;
        byPhone.set(phone, index);
      }
      problems.push({
        row: raw.row,
        kind: "duplicate_merged",
        same_as: first.row,
        words: `${label(raw)}: listed twice — merged with row ${first.row}.`,
      });
      continue;
    }
    const index = kept.length;
    kept.push({ row: raw.row, name: raw.name, email, phone });
    if (email) byEmail.set(email, index);
    if (phone) byPhone.set(phone, index);
  }

  return {
    rows: kept,
    problems,
    total: raws.length,
    skipped,
    merged,
    had_header: hadHeader,
  };
}


function csvCell(value: string): string {
  // A leading = + - @ would run as a formula when the owner opens an export.
  const safe = /^[=+\-@]/.test(value) && !/^\+\d/.test(value)
    ? `'${value}`
    : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** The kept rows as the three-column CSV the existing import reads. */
export function contactListCsv(rows: readonly ContactListRow[]): string {
  return [
    "Name,Email,Phone",
    ...rows.map((row) =>
      [row.name, row.email ?? "", row.phone ?? ""].map(csvCell).join(",")
    ),
  ].join("\n");
}
