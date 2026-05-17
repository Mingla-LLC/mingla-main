/**
 * marketingTemplateService.tester-adversarial.test.ts — ORCH-0863 QA gate.
 *
 * Tester-AUTHORED adversarial regression suite per ORCH-0840 Step-0.5 gate
 * (canonical tester-side test, separate file from implementor's T-04 + T-08).
 *
 * Attacks DIFFERENT angles than the implementor's tests:
 *   - TA-01 (duplicate hostile body) — bodies containing SQL-injection-shaped
 *     strings + null bytes + escaped braces survive byte-identical through
 *     duplicateTemplate. Implementor's T-03 tested well-formed tokens; this
 *     tests adversarial inputs to guard against any future "input sanitizer"
 *     being added on the duplicate path.
 *
 *   - TA-02 (duplicate-from-starter ALWAYS sets is_starter_pack=false on the
 *     created row, regardless of source row's flag) — defense-in-depth on the
 *     duplicate path. Implementor's T-08 covers update/delete starter-pack
 *     guards but does NOT verify the duplicate path can't accidentally clone
 *     a starter-pack row's is_starter_pack=true flag forward. This test
 *     attacks that specific gap.
 *
 *   - TA-03 (createUserTemplate hardcodes is_starter_pack=false in the insert
 *     payload — caller cannot override) — verifies the service prevents a
 *     buggy caller from passing is_starter_pack=true and creating a phantom
 *     starter row outside the migration seed.
 */

jest.mock("../../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import {
  createUserTemplate,
  duplicateTemplate,
} from "../marketingTemplateService";
import { supabase } from "../../supabase";

type FromMock = jest.Mock;

const ACCOUNT_UUID = "00000000-0000-0000-0000-0000000000aa";
const BRAND_UUID = "00000000-0000-0000-0000-0000000000bb";
const STARTER_UUID = "00000815-0001-0000-0000-000000000001";

interface MockResult<T> {
  data: T | null;
  error: { message: string } | null;
}

describe("TA-01 (tester-adversarial) duplicateTemplate preserves bodies with hostile content byte-for-byte", () => {
  beforeEach(() => {
    (supabase.from as FromMock).mockReset();
  });

  it("body containing SQL-injection-shaped literal + escaped braces + control chars survives verbatim", async () => {
    const hostileBody =
      "Hi {first_name},\n\nDROP TABLE marketing_templates; --\n\n" +
      "\\u0000\\x00 control bytes test\n" +
      "Triple-brace edge: {{{event:abc}}}\n" +
      "Unbalanced: { open and } close\n" +
      "Token at EOF: {{event:def}}";

    let capturedInsertPayload: Record<string, unknown> | undefined;

    (supabase.from as FromMock)
      // 1st call: getTemplate (source row read)
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async (): Promise<MockResult<unknown>> => ({
              data: {
                id: STARTER_UUID,
                account_id: null,
                brand_id: null,
                name: "Hostile-body template",
                channel: "email",
                subject_template: null,
                body_template: hostileBody,
                is_starter_pack: true,
                created_at: "2026-05-17T00:00:00Z",
                updated_at: "2026-05-17T00:00:00Z",
              },
              error: null,
            }),
          }),
        }),
      })
      // 2nd call: createUserTemplate insert
      .mockReturnValueOnce({
        insert: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
          capturedInsertPayload = payload;
          return {
            select: () => ({
              maybeSingle: async (): Promise<MockResult<unknown>> => ({
                data: {
                  id: "00000000-0000-0000-0000-0000000000ff",
                  account_id: ACCOUNT_UUID,
                  brand_id: BRAND_UUID,
                  name: "Hostile-body template (copy)",
                  channel: "email",
                  subject_template: null,
                  body_template: hostileBody,
                  is_starter_pack: false,
                  created_at: "2026-05-17T00:00:00Z",
                  updated_at: "2026-05-17T00:00:00Z",
                },
                error: null,
              }),
            }),
          };
        }),
      });

    await duplicateTemplate({
      source_template_id: STARTER_UUID,
      account_id: ACCOUNT_UUID,
      brand_id: BRAND_UUID,
    });

    expect(capturedInsertPayload).toBeDefined();
    // Body bytes survive end-to-end — no sanitizer, no escape, no normalization.
    expect(capturedInsertPayload?.body_template).toBe(hostileBody);
  });
});

describe("TA-02 (tester-adversarial) duplicateTemplate ALWAYS produces is_starter_pack=false on the new row, regardless of source", () => {
  beforeEach(() => {
    (supabase.from as FromMock).mockReset();
  });

  it("source row has is_starter_pack=true → insert payload still has is_starter_pack=false (DB CHECK + RLS would block otherwise; service guards defensively)", async () => {
    let capturedInsertPayload: Record<string, unknown> | undefined;

    (supabase.from as FromMock)
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async (): Promise<MockResult<unknown>> => ({
              data: {
                id: STARTER_UUID,
                account_id: null,
                brand_id: null,
                name: "Starter source",
                channel: "email",
                subject_template: "S",
                body_template: "B",
                is_starter_pack: true, // hostile: source row IS starter
                created_at: "2026-05-17T00:00:00Z",
                updated_at: "2026-05-17T00:00:00Z",
              },
              error: null,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        insert: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
          capturedInsertPayload = payload;
          return {
            select: () => ({
              maybeSingle: async (): Promise<MockResult<unknown>> => ({
                data: {
                  id: "00000000-0000-0000-0000-0000000000fe",
                  account_id: ACCOUNT_UUID,
                  brand_id: BRAND_UUID,
                  name: "Starter source (copy)",
                  channel: "email",
                  subject_template: "S",
                  body_template: "B",
                  is_starter_pack: false,
                  created_at: "2026-05-17T00:00:00Z",
                  updated_at: "2026-05-17T00:00:00Z",
                },
                error: null,
              }),
            }),
          };
        }),
      });

    await duplicateTemplate({
      source_template_id: STARTER_UUID,
      account_id: ACCOUNT_UUID,
      brand_id: BRAND_UUID,
    });

    expect(capturedInsertPayload).toBeDefined();
    // Critical defense-in-depth assertion:
    expect(capturedInsertPayload?.is_starter_pack).toBe(false);
    // account_id MUST be the caller's, not the source's null.
    expect(capturedInsertPayload?.account_id).toBe(ACCOUNT_UUID);
  });
});

describe("TA-03 (tester-adversarial) createUserTemplate hardcodes is_starter_pack=false (caller cannot inject a phantom starter row)", () => {
  beforeEach(() => {
    (supabase.from as FromMock).mockReset();
  });

  it("createUserTemplate input shape has NO is_starter_pack key — and the insert payload always sets false", async () => {
    let capturedInsertPayload: Record<string, unknown> | undefined;

    (supabase.from as FromMock).mockReturnValueOnce({
      insert: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
        capturedInsertPayload = payload;
        return {
          select: () => ({
            maybeSingle: async (): Promise<MockResult<unknown>> => ({
              data: {
                id: "00000000-0000-0000-0000-0000000000fd",
                account_id: ACCOUNT_UUID,
                brand_id: null,
                name: "User row",
                channel: "email",
                subject_template: null,
                body_template: "Hello",
                is_starter_pack: false,
                created_at: "2026-05-17T00:00:00Z",
                updated_at: "2026-05-17T00:00:00Z",
              },
              error: null,
            }),
          }),
        };
      }),
    });

    await createUserTemplate({
      account_id: ACCOUNT_UUID,
      brand_id: null,
      name: "User row",
      subject_template: null,
      body_template: "Hello",
    });

    expect(capturedInsertPayload).toBeDefined();
    // The service hardcodes is_starter_pack: false in the insert payload.
    expect(capturedInsertPayload?.is_starter_pack).toBe(false);
    // Channel is locked to "email" by the service (Phase B email-only).
    expect(capturedInsertPayload?.channel).toBe("email");
  });
});
