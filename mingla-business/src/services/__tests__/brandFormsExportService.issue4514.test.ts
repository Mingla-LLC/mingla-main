/**
 * #4514 wave 3 — Export on the Responses page rides the guest roster export
 * (one audited job), no second exporter: request the job, poll it, open the file.
 *
 * FAILS-ON-REVERT: sending a form scope the export function does not take, or
 * opening the file before the job is ready, turns a case red.
 */

const invoke = jest.fn();
const openURL = jest.fn();
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
jest.mock("react-native", () => ({ Linking: { openURL: (...a: unknown[]) => openURL(...a) } }));

import { exportFormAnswers } from "../brandFormsExportService";

const noWait = (): Promise<void> => Promise.resolve();

beforeEach(() => {
  invoke.mockReset();
  openURL.mockReset();
  openURL.mockResolvedValue(true);
});

describe("exportFormAnswers", () => {
  it("requests the page's guest roster export, waits for it, then opens the file", async () => {
    invoke
      .mockResolvedValueOnce({ data: { jobId: "job-1", status: "queued" }, error: null })
      .mockResolvedValueOnce({ data: { status: "running", result: null }, error: null })
      .mockResolvedValueOnce({ data: { status: "ready", signedUrl: "https://files/x.csv" }, error: null });
    const jobs: Array<string | null> = [];
    const result = await exportFormAnswers({ eventId: "e1", pendingJobId: null, onJob: (j) => jobs.push(j), wait: noWait });
    expect(result).toBe("opened");
    expect(invoke.mock.calls[0]).toEqual(["brand-people-export", { body: expect.objectContaining({
      scope: "offering_guest_roster", eventId: "e1", filter: "all", sort: "action_priority" }) }]);
    expect(Object.keys(invoke.mock.calls[0][1].body)).not.toContain("formId");
    expect(invoke.mock.calls[1]).toEqual(["brand-people-export", { body: { operation: "status", jobId: "job-1" } }]);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith("https://files/x.csv");
    expect(jobs).toEqual(["job-1", null]);
  });

  it("a job still running keeps its id so the next tap checks the same job", async () => {
    invoke.mockResolvedValue({ data: { status: "running" }, error: null });
    let pending: string | null = "job-9";
    const result = await exportFormAnswers({ eventId: "e1", pendingJobId: "job-9", onJob: (j) => { pending = j; }, wait: noWait });
    expect(result).toBe("preparing");
    expect(pending).toBe("job-9");
    expect(invoke.mock.calls.every((c) => c[1].body.operation === "status")).toBe(true);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("a failed job or a refused request throws a sentence the host can act on", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    await expect(exportFormAnswers({ eventId: "e1", pendingJobId: null, onJob: () => undefined, wait: noWait }))
      .rejects.toThrow("Couldn't prepare the export. Try again.");
    invoke.mockResolvedValueOnce({ data: { status: "failed" }, error: null });
    await expect(exportFormAnswers({ eventId: "e1", pendingJobId: "job-2", onJob: () => undefined, wait: noWait }))
      .rejects.toThrow("Couldn't prepare the export. Try again.");
  });
});
