/**
 * #4514 — Export for one page's answers (event manager and up). Wave 3: the
 * answers ride the EXISTING guest roster export (`brand-people-export`, an
 * audited export job): the roster CSV plus one column per question of the page's
 * form (§4.9; `brand_form_roster_export_answers`). There is no second exporter.
 *
 * Loaded on demand by the Responses page. It calls the export function directly
 * (the same three requests the guest list makes) instead of importing the guest
 * roster service, so no module is shared between two lazy chunks (Metro would
 * hoist it into the eager Host web chunk, #4514 bundle budget).
 */

import { Linking } from "react-native";

const getSupabase = async () => (await import("./supabase")).supabase;

export type FormAnswersExportResult = "opened" | "preparing";

const POLL_TRIES = 15;
const POLL_MS = 2_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const requestId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID !== undefined) return c.randomUUID();
  const hex = (n: number): string => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
};

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("brand-people-export", { body });
  if (error !== null) throw new Error("Couldn't prepare the export. Try again.");
  return isRecord(data) ? data : {};
}

/**
 * Start (or keep waiting on) the page's guest export, then open the file. A job
 * still running after ~30 s answers "preparing": tapping Export again checks the
 * same job (the caller keeps `pendingJobId`).
 */
export async function exportFormAnswers(input: {
  eventId: string;
  pendingJobId: string | null;
  onJob: (jobId: string | null) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<FormAnswersExportResult> {
  const wait = input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let jobId = input.pendingJobId;
  if (jobId === null) {
    const requested = await invoke({
      scope: "offering_guest_roster",
      eventId: input.eventId,
      filter: "all",
      search: null,
      sort: "action_priority",
      filterSnapshot: {},
      clientRequestId: requestId(),
    });
    jobId = typeof requested.jobId === "string" ? requested.jobId : null;
    if (jobId === null) throw new Error("Couldn't prepare the export. Try again.");
  }
  input.onJob(jobId);
  for (let attempt = 0; attempt < POLL_TRIES; attempt += 1) {
    const status = await invoke({ operation: "status", jobId });
    if (status.status === "failed" || status.status === "expired") {
      input.onJob(null);
      throw new Error("Couldn't prepare the export. Try again.");
    }
    if (status.status === "ready" && typeof status.signedUrl === "string") {
      input.onJob(null);
      await Linking.openURL(status.signedUrl);
      return "opened";
    }
    await wait(POLL_MS);
  }
  return "preparing";
}
