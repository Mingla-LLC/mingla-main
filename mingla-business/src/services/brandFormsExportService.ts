/**
 * #4514 — Export for one form's answers (event manager and up). Loaded on
 * demand by the Responses page, so the CSV helper and its dependencies stay
 * out of the eager bundle. See buildAnswersCsv for the [TRANSITIONAL] note:
 * the roster export (`brand-people-export`) does not take a form yet.
 */

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
  const { exportCsvText } = await import("../utils/guestCsvExport");
  const result = await exportCsvText(csv, answersCsvFilename(input.formName, new Date()), "Export answers");
  return result.method;
}
