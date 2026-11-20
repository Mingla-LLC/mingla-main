/**
 * #4514 CI fix — the guest link page reads its form through the edge function
 * (`brand-form-submit` {op:"link_read"}), never through anon PostgREST:
 * `brand_form_my_response` is not executable by anon (pg17 asserts 42501).
 *
 * FAILS-ON-REVERT: putting back `supabase.rpc("brand_form_my_response", …)`
 * makes the first case red (rpc called, invoke not), and an anonymous page
 * would get "permission denied" in production.
 */
const invoke = jest.fn();
const rpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
jest.mock("@mingla/form-rendering", () =>
  jest.requireActual("../../../../packages/form-rendering/brandFormRules"),
);

import { BrandFormLinkError, readLinkForm } from "../brandFormLinkService";

const FORM = "4514f000-0000-4000-8000-000000000001";
const TOKEN = "ab".repeat(32);
const READ = {
  state: "unanswered",
  recognized: true,
  identity: "Ada",
  form: { id: FORM, name: "Dietary needs", status: "live", versionId: "v1", definition: { questions: [] } },
  brand: null,
};

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
});

it("reads through brand-form-submit link_read, never an anon rpc", async () => {
  invoke.mockResolvedValue({ data: { ok: true, read: READ }, error: null });
  const read = await readLinkForm({ formId: FORM, token: TOKEN, challengeId: null });
  expect(rpc).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("brand-form-submit", {
    body: { op: "link_read", formId: FORM, token: TOKEN, challengeId: null },
  });
  expect(read.state).toBe("unanswered");
  expect(read.form.name).toBe("Dietary needs");
});

it("a refusal keeps the server's code, so the page shows the invalid-link state", async () => {
  const context = new Response(JSON.stringify({ ok: false, error: "link_revoked" }), { status: 403 });
  invoke.mockResolvedValue({ data: null, error: { context } });
  await expect(readLinkForm({ formId: FORM, token: TOKEN, challengeId: null })).rejects.toMatchObject({
    code: "link_revoked",
  });
});

it("a network failure is a retryable error, and a bad payload is read_shape", async () => {
  invoke.mockResolvedValue({ data: null, error: new Error("offline") });
  await expect(readLinkForm({ formId: FORM, token: TOKEN, challengeId: null })).rejects.toBeInstanceOf(
    BrandFormLinkError,
  );
  invoke.mockResolvedValue({ data: { ok: true, read: { nope: 1 } }, error: null });
  await expect(readLinkForm({ formId: FORM, token: TOKEN, challengeId: null })).rejects.toMatchObject({
    code: "read_shape",
  });
});
