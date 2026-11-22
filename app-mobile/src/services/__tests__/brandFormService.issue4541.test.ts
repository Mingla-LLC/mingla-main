/* eslint-disable @typescript-eslint/no-require-imports, import/first -- jest doubles are declared before the modules they replace */
/**
 * #4541 R1.14 / R2.4 (T-43, client side) — the Explorer reads the RSVP page's
 * form the way a guest is allowed to: through `brand-form-submit`
 * `{op:"page_form"}` with the public key, never `rpc("public_brand_form_for_event")`
 * (granted to the server role only: the live bug N1). Also: the submit body
 * carries only server keys, a personal link never sends a held item beside
 * it, refusals keep their server code, and the pending list is parsed.
 *
 * Red on revert of fetchPageForm to `.rpc(`, of the token rule in
 * `submitBody`, or of the error code read. Runs under
 * app-mobile/jest.issue2774.render.cjs.
 */
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import {
  BrandFormError,
  fetchCheckoutForm,
  fetchLinkForm,
  fetchPageForm,
  parsePendingBrandForm,
  submitBody,
  submitBrandForm,
} from "../brandFormService";

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

const EVENT = "45410000-0000-4000-8000-0000000000e1";
const FORM = "45410000-0000-4000-8000-000000000004";
const VERSION = "45410000-0000-4000-8000-000000000005";
const ORDER = "45410000-0000-4000-8000-0000000000a1";
const TOKEN = "ef".repeat(32);
const definition = { questions: [{ id: "q1", position: 1, type: "short_text", label: "Diet", required: true }] };

const refused = (status: number, body: Record<string, unknown>) => ({
  data: null,
  error: { context: { status, clone: () => ({ text: async () => JSON.stringify(body) }) } },
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockRpc.mockReset();
});

describe("#4541 T-43 — the RSVP page's form goes through the edge", () => {
  it("invokes brand-form-submit page_form and never the database function", async () => {
    mockInvoke.mockResolvedValue({
      data: { active: true, mode: "required_step", formId: FORM, versionId: VERSION, name: "Guest details", definition, brand: {}, botTicket: "x" },
      error: null,
    });
    const read = await fetchPageForm(EVENT);
    expect(mockInvoke).toHaveBeenCalledWith("brand-form-submit", { body: { op: "page_form", eventId: EVENT } });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(read?.mode).toBe("required_step");
  });

  it("keeps an After-they-RSVP form as its notice, and no form as null", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { active: true, mode: "after_purchase", formId: FORM, brand: { displayName: "Harmattan" } }, error: null });
    expect((await fetchPageForm(EVENT))?.mode).toBe("after_purchase");
    mockInvoke.mockResolvedValueOnce({ data: { active: false }, error: null });
    expect(await fetchPageForm(EVENT)).toBeNull();
  });

  it("no Explorer file calls a server-only brand form database function (I-4541-NO-CLIENT-SERVICE-ROLE-RPC)", () => {
    const root = path.join(__dirname, "..", "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          if (/rpc\(\s*["']public_brand_form_for_event["']/.test(text)) offenders.push(full);
        }
      }
    };
    walk(path.join(root, "src"));
    walk(path.join(root, "app"));
    expect(offenders).toEqual([]);
  });
});

describe("#4541 R2.4 — reads and the submit", () => {
  it("a refused read keeps the server code", async () => {
    mockInvoke.mockResolvedValue(refused(403, { ok: false, error: "link_revoked" }));
    await expect(fetchLinkForm(FORM, TOKEN)).rejects.toMatchObject({ code: "link_revoked", status: 403 });
  });

  it("a network failure is `network`", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    const error = await fetchCheckoutForm(EVENT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrandFormError);
    expect((error as BrandFormError).code).toBe("network");
  });

  it("the checkout read sends the event (the bearer rides the client) and parses answeredHere", async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: true, form: { active: true, mode: "required_step", formId: FORM, versionId: VERSION, definition, brand: {}, answeredHere: true, prefill: { answers: { q1: "Vegan" }, versionId: VERSION } } },
      error: null,
    });
    const form = await fetchCheckoutForm(EVENT);
    expect(mockInvoke).toHaveBeenCalledWith("brand-form-submit", { body: { op: "checkout_form", eventId: EVENT } });
    expect(form?.answeredHere).toBe(true);
    expect(form?.prefill).toEqual({ q1: "Vegan" });
  });

  it("a personal link never sends a held item beside it; nulls are dropped", () => {
    expect(submitBody({ formId: FORM, versionId: VERSION, eventId: null, answers: {}, token: TOKEN, orderId: ORDER }))
      .toEqual({ formId: FORM, versionId: VERSION, answers: {}, token: TOKEN });
    expect(submitBody({ formId: FORM, versionId: null, eventId: EVENT, answers: { q1: "x" }, orderId: ORDER }))
      .toEqual({ formId: FORM, eventId: EVENT, answers: { q1: "x" }, orderId: ORDER });
  });

  it("a refused submit keeps its code and detail", async () => {
    mockInvoke.mockResolvedValue(refused(422, { ok: false, error: "form_answers_invalid", errors: [{ questionId: "q1", code: "required" }] }));
    const error = await submitBrandForm({ formId: FORM, versionId: VERSION, eventId: EVENT, answers: {} }).catch((e: unknown) => e) as BrandFormError;
    expect(error.code).toBe("form_answers_invalid");
    expect(error.detail?.errors).toEqual([{ questionId: "q1", code: "required" }]);
  });

  it("parses a pending row and drops a malformed one", () => {
    expect(parsePendingBrandForm({
      eventId: EVENT, eventStatus: "scheduled", subject: { kind: "order", id: ORDER }, mode: "after_purchase",
      formId: FORM, formName: "Guest details", formStatus: "live", answered: false, answeredSource: null, brand: { displayName: "H" },
    })?.subject).toEqual({ kind: "order", id: ORDER });
    expect(parsePendingBrandForm({ subject: { kind: "ticket", id: ORDER } })).toBeNull();
  });
});
