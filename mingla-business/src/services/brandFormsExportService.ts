/**
 * #4514 — Export for one form's answers (event manager and up). Loaded on
 * demand by the Responses page, so the CSV helper and its dependencies stay
 * out of the eager bundle. See buildAnswersCsv for the [TRANSITIONAL] note:
 * the roster export (`brand-people-export`) does not take a form yet.
 */

import { Platform, Share } from "react-native";

import { fetchBrandFormExport, fetchBrandFormResponses } from "./brandFormsService";
import { answersCsvFilename, buildAnswersCsv, subjectName } from "../utils/brandFormResponses";

const PAGE = 200;
const MAX_PAGES = 25;

export type FormAnswersExportMethod = "downloaded" | "shared" | "dismissed";

export async function exportFormAnswers(input: {
  formId: string;
  formName: string;
  eventId: string;
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
    if (offset >= page.total) break;
  }
  const csv = buildAnswersCsv(feed, names);
  return deliverCsv(csv, answersCsvFilename(input.formName, new Date()));
}

/**
 * Hand the file to the host. Web downloads it; the apps open the share sheet
 * with the CSV text. A small local delivery on purpose: the shared roster CSV
 * helper pulls the whole orders and money graph into the eager Host web chunk
 * as soon as a second lazy screen imports it (bundle budget, #4514).
 * [TRANSITIONAL] Replaced when the roster export takes a form scope.
 */
async function deliverCsv(csv: string, filename: string): Promise<FormAnswersExportMethod> {
  if (Platform.OS === "web") {
    const g = globalThis as unknown as { Blob?: typeof Blob; URL?: typeof URL; document?: Document };
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
