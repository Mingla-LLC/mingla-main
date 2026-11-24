/**
 * #4514 — Export on the Responses page: one page's answers, event manager and
 * up (contract correction C5). It reads the answers-only feed
 * (`biz_brand_form_responses_export`, event_manager+) and never the guest
 * roster export: that runs `biz_export_brand_people`, which needs brand_admin,
 * and C5 widens no roster RPC. (The brand-admin roster export carries the same
 * answers as one column per question, through `brand_form_roster_export_answers`.)
 *
 * Loaded with the Responses page (lazy). The file is delivered locally: the
 * shared roster CSV helper pulls the orders and money graph into the eager Host
 * web chunk as soon as a second lazy screen imports it (bundle budget, #4514).
 */

import { Platform, Share } from "react-native";

import { fetchBrandFormExport, fetchBrandFormResponses, type BrandFormExport } from "./brandFormsService";
import { subjectName } from "../utils/brandFormResponses";

const PAGE = 200;
const MAX_PAGES = 25;

export type FormAnswersExportMethod = "downloaded" | "shared" | "dismissed";

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** A spreadsheet reads a leading = + - @, tab or carriage return as a formula; keep it text. */
const safeCell = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

/**
 * One header column per question and version, one row per response. #4541
 * R4.7: an Unknown Blast reply's name is "Unknown", a Blast recipient's is the
 * name at send; the Campaign column names the Blast (empty for a page answer).
 */
export function buildAnswersCsv(feed: BrandFormExport, names: ReadonlyMap<string, string>): string {
  const header = [
    "Name",
    "Campaign",
    "Answered",
    "Updated",
    "Form version",
    "Verified",
    ...feed.columns.map((c) => `${c.label} (v${c.version})`),
  ];
  const lines = [header.map((c) => csvCell(safeCell(c))).join(",")];
  for (const row of feed.rows) {
    const cells = [
      row.name ?? names.get(row.responseId) ?? "",
      row.campaign ?? "",
      row.submittedAt,
      row.updatedAt,
      String(row.version),
      row.verified ? "Yes" : "No",
      ...feed.columns.map((c) => row.values[c.key] ?? ""),
    ];
    lines.push(cells.map((c) => csvCell(safeCell(c))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export const answersCsvFilename = (formName: string, now: Date): string => {
  const slug = formName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${slug.length > 0 ? slug : "form"}-answers-${y}-${m}-${d}.csv`;
};

export async function exportFormAnswers(input: {
  formId: string;
  formName: string;
  /** null: All pages (Blast replies included). */
  eventId: string | null;
}): Promise<FormAnswersExportMethod> {
  const feed = await fetchBrandFormExport(input.formId, input.eventId);
  const names = new Map<string, string>();
  let offset = 0;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await fetchBrandFormResponses({
      formId: input.formId,
      eventId: input.eventId,
      filter: "all",
      limit: PAGE,
      offset,
    });
    for (const row of page.rows) names.set(row.responseId, subjectName(row));
    offset += PAGE;
    if (offset >= page.total || page.rows.length === 0) break;
  }
  return deliverCsv(buildAnswersCsv(feed, names), answersCsvFilename(input.formName, new Date()));
}

/** Web downloads the file; the apps open the share sheet with the CSV text. */
async function deliverCsv(csv: string, filename: string): Promise<FormAnswersExportMethod> {
  if (Platform.OS === "web") {
    const g = globalThis as { Blob?: typeof Blob; URL?: typeof URL; document?: Document };
    if (g.Blob === undefined || g.URL === undefined || g.document === undefined) {
      throw new Error("Web download is not available in this browser.");
    }
    const url = g.URL.createObjectURL(new g.Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = g.document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    g.document.body.appendChild(anchor);
    anchor.click();
    g.document.body.removeChild(anchor);
    g.URL.revokeObjectURL(url);
    return "downloaded";
  }
  // SHARE-NON-CONTENT:file-export
  const result = await Share.share({ message: csv, title: filename }, { dialogTitle: "Export answers", subject: filename });
  return result.action === "sharedAction" ? "shared" : "dismissed";
}
