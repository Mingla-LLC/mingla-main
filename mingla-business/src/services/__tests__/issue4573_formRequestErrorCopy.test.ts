// MINGLA-INVARIANT: I-4573-FORM-REQUEST-CODE-HAS-COPY | issue #4573 | every code guest-roster-actions can return for a form request has its own host-facing sentence; none falls through to "Couldn't send. Try again." (SC-6).
/**
 * #4573 SC-6: the Host app has a sentence for every server code, read from
 * the edge function source so a new server code without copy turns this red.
 * Spec §5: a refusal that means the preview changed makes the sheet read the
 * preview again.
 *
 * FAILS-ON-REVERT: deleting the form_request_unavailable entry (or any §4
 * entry) from ERROR_COPY turns the SC-6 cases red.
 */
import fs from "fs";
import path from "path";

const invoke = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: jest.fn(),
  },
}));

import {
  codeOf,
  FORM_REQUEST_SERVER_CODES,
  FormRequestError,
  formRequestErrorCopy,
  sendFormRequest,
  shouldRefetchPreviewAfter,
} from "../brandFormRequestService";

const FORM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNKNOWN = "Couldn't send. Try again.";
const FN_DIR = path.resolve(__dirname, "../../../../supabase/functions/guest-roster-actions");
/** Roster preview operations only; a form request body never reaches them. */
const ROSTER_ONLY = new Set(["preview_persistence_failed", "preview_consume_failed"]);

function serverCodes(): string[] {
  const codes = new Set<string>();
  for (const file of ["formRequest.ts", "index.ts"]) {
    const src = fs.readFileSync(path.join(FN_DIR, file), "utf8");
    for (const m of src.matchAll(/code: "([a-z_]+)"/g)) codes.add(m[1]);
    const known = /const KNOWN = \[([^\]]*)\]/.exec(src);
    if (known !== null) for (const m of known[1].matchAll(/"([a-z_]+)"/g)) codes.add(m[1]);
  }
  return [...codes].filter((c) => !ROSTER_ONLY.has(c)).sort();
}

const sendOnce = () =>
  sendFormRequest({
    formId: FORM,
    eventId: EVENT,
    kind: "ask",
    audience: "unanswered",
    channels: ["email"],
    expectedCostMinor: null,
    currency: null,
  });

beforeEach(() => invoke.mockReset());

describe("#4573 SC-6: every server code has a sentence", () => {
  it("the exported list matches every code the edge function returns", () => {
    const fromSource = serverCodes();
    expect(fromSource.length).toBeGreaterThan(10);
    expect([...FORM_REQUEST_SERVER_CODES].sort()).toEqual(fromSource);
  });

  it.each([...FORM_REQUEST_SERVER_CODES])("%s maps to its own sentence, never unknown", (code) => {
    expect(codeOf({ ok: false, code })).toBe(code);
    const copy = formRequestErrorCopy(code);
    expect(copy.length).toBeGreaterThan(0);
    expect(copy).not.toBe(UNKNOWN);
  });

  it("form_request_unavailable reads the §4 sentence on a 409", async () => {
    const context = new Response(JSON.stringify({ ok: false, code: "form_request_unavailable" }), { status: 409 });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "non-2xx", context } });
    await expect(sendOnce()).rejects.toMatchObject({
      code: "form_request_unavailable",
      message: "We couldn't queue these requests. Nothing was sent. Try again in a minute.",
    });
  });

  it.each([
    ["form_not_found", "This form was deleted. Reload."],
    ["event_not_found", "This page is no longer available. Reload."],
    ["unauthorized", "Your sign-in expired. Sign in again."],
    ["invalid_request", "This app needs an update to send. Refresh the page or update the app."],
    ["invalid_json", "This app needs an update to send. Refresh the page or update the app."],
    ["method_not_allowed", "This app needs an update to send. Refresh the page or update the app."],
    ["request_too_large", "Too many guests at once. Ask in smaller groups."],
  ])("%s reads its §4 sentence", async (code, sentence) => {
    const context = new Response(JSON.stringify({ ok: false, code }), { status: 400 });
    invoke.mockResolvedValueOnce({ data: null, error: { message: "non-2xx", context } });
    await expect(sendOnce()).rejects.toMatchObject({ code, message: sentence });
  });

  it("a code the app does not know still falls back to unknown", () => {
    expect(codeOf({ ok: false, code: "brand_new_code" })).toBe("unknown");
    expect(formRequestErrorCopy("unknown")).toBe(UNKNOWN);
  });
});

describe("#4573 §5: a refusal that means the preview changed reads the preview again", () => {
  it.each(["preview_stale_cost", "forms_paused", "form_closed", "form_not_live", "form_not_on_event", "form_not_found"] as const)(
    "%s refetches",
    (code) => {
      expect(shouldRefetchPreviewAfter(new FormRequestError(code, "x"))).toBe(true);
    },
  );
  it.each(["form_request_unavailable", "network_error", "unknown", "cost_unpriced"] as const)("%s does not", (code) => {
    expect(shouldRefetchPreviewAfter(new FormRequestError(code, "x"))).toBe(false);
  });
  it("a plain error does not", () => {
    expect(shouldRefetchPreviewAfter(new Error("preview_stale_cost"))).toBe(false);
  });
});
