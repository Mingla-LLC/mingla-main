/**
 * marketingTemplateService.test.ts — ORCH-0863 Phase B template-CRUD tests.
 *
 * Covers:
 *   - T-03 duplicateTemplate preserves both {var} and {{event:id}} grammars
 *   - T-04 (HAPPY, Step 0.5 implementor test) — updateUserTemplate token-roundtrip
 *           guards against any regex strip / transform of the body field.
 *   - T-08 (ADVERSARIAL, Step 0.5 tester pre-write) — defense-in-depth
 *           starter-pack guard fires BEFORE any UPDATE/DELETE round-trip,
 *           independent of RLS. Different angle than T-04 (security guard
 *           vs token preservation).
 */

jest.mock("../../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import {
  createUserTemplate,
  deleteUserTemplate,
  duplicateTemplate,
  updateUserTemplate,
} from "../marketingTemplateService";
import { supabase } from "../../supabase";

type FromMock = jest.Mock;

const ACCOUNT_UUID = "00000000-0000-0000-0000-0000000000aa";
const BRAND_UUID = "00000000-0000-0000-0000-0000000000bb";
const STARTER_UUID = "00000815-0001-0000-0000-000000000001";
const USER_TEMPLATE_UUID = "00000000-0000-0000-0000-0000000000cc";

const STARTER_BODY =
  "Hi {first_name},\n\nJust a heads up — only {spots_left} tickets left for {event_name} on {event_date}. See you there.\n\n{{event:{event_id}}}\n\n— {brand_name} via Mingla";

interface MockResult<T> {
  data: T | null;
  error: { message: string } | null;
}

function makeStarterRowBuilder(): {
  from: FromMock;
  reset: () => void;
} {
  const fromMock = supabase.from as FromMock;
  fromMock.mockReset();
  return { from: fromMock, reset: () => fromMock.mockReset() };
}

describe("duplicateTemplate (T-03 token preservation)", () => {
  beforeEach(() => {
    (supabase.from as FromMock).mockReset();
  });

  it("copies subject_template + body_template byte-for-byte (preserves both token grammars)", async () => {
    // 1st .from() call (getTemplate) — return the starter row
    // 2nd .from() call (createUserTemplate insert) — return new row
    const insertSpy = jest.fn().mockReturnValue({
      select: () => ({
        maybeSingle: async (): Promise<MockResult<unknown>> => ({
          data: {
            id: "00000000-0000-0000-0000-0000000000ff",
            account_id: ACCOUNT_UUID,
            brand_id: BRAND_UUID,
            name: "Last call — N spots left (copy)",
            channel: "email",
            subject_template: "Last {spots_left} tickets — see you {event_date_short}",
            body_template: STARTER_BODY,
            is_starter_pack: false,
            created_at: "2026-05-17T00:00:00Z",
            updated_at: "2026-05-17T00:00:00Z",
          },
          error: null,
        }),
      }),
    });
    (supabase.from as FromMock)
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async (): Promise<MockResult<unknown>> => ({
              data: {
                id: STARTER_UUID,
                account_id: null,
                brand_id: null,
                name: "Last call — N spots left",
                channel: "email",
                subject_template: "Last {spots_left} tickets — see you {event_date_short}",
                body_template: STARTER_BODY,
                is_starter_pack: true,
                created_at: "2026-05-12T21:48:37Z",
                updated_at: "2026-05-12T21:48:37Z",
              },
              error: null,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({ insert: insertSpy });

    const out = await duplicateTemplate({
      source_template_id: STARTER_UUID,
      account_id: ACCOUNT_UUID,
      brand_id: BRAND_UUID,
    });

    // Assert the insert payload contained the body verbatim (no transform).
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertArg = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.body_template).toBe(STARTER_BODY);
    expect(insertArg.subject_template).toBe(
      "Last {spots_left} tickets — see you {event_date_short}",
    );
    expect(insertArg.is_starter_pack).toBe(false);
    expect(insertArg.account_id).toBe(ACCOUNT_UUID);
    expect(insertArg.name).toBe("Last call — N spots left (copy)");
    // Returned row carries the same body.
    expect(out.body_template).toBe(STARTER_BODY);
  });
});

describe("updateUserTemplate (T-04 HAPPY — Step 0.5 implementor test: token-roundtrip preservation)", () => {
  beforeEach(() => {
    (supabase.from as FromMock).mockReset();
  });

  it("UPDATE call passes body_template verbatim (no regex strip / no escape / no normalization)", async () => {
    const body = "Hi {first_name}, see {{event:00000000-0000-0000-0000-00000000aaaa}}";

    const updateSpy = jest.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          maybeSingle: async (): Promise<MockResult<unknown>> => ({
            data: {
              id: USER_TEMPLATE_UUID,
              account_id: ACCOUNT_UUID,
              brand_id: BRAND_UUID,
              name: "My template",
              channel: "email",
              subject_template: "Subj {first_name}",
              body_template: body,
              is_starter_pack: false,
              created_at: "2026-05-17T00:00:00Z",
              updated_at: "2026-05-17T00:00:01Z",
            },
            error: null,
          }),
        }),
      }),
    });
    (supabase.from as FromMock)
      // 1st: assertNotStarterPack pre-check
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async (): Promise<MockResult<unknown>> => ({
              data: { is_starter_pack: false },
              error: null,
            }),
          }),
        }),
      })
      // 2nd: the UPDATE itself
      .mockReturnValueOnce({ update: updateSpy });

    const out = await updateUserTemplate({
      template_id: USER_TEMPLATE_UUID,
      name: "My template",
      subject_template: "Subj {first_name}",
      body_template: body,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const patch = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    // Both token grammars survive the call boundary intact.
    expect(patch.body_template).toBe(body);
    expect((patch.body_template as string).includes("{first_name}")).toBe(true);
    expect((patch.body_template as string).includes("{{event:00000000-0000-0000-0000-00000000aaaa}}")).toBe(true);
    // Returned row also carries identical body (round-trip).
    expect(out.body_template).toBe(body);
  });
});

describe("updateUserTemplate / deleteUserTemplate (T-08 ADVERSARIAL — Step 0.5 starter-pack guard, defense-in-depth)", () => {
  beforeEach(() => {
    (supabase.from as FromMock).mockReset();
  });

  it("updateUserTemplate THROWS BEFORE the UPDATE round-trip when target is starter-pack", async () => {
    // assertNotStarterPack pre-check returns is_starter_pack: true.
    const updateSpy = jest.fn();
    (supabase.from as FromMock).mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: async (): Promise<MockResult<unknown>> => ({
            data: { is_starter_pack: true },
            error: null,
          }),
        }),
      }),
    });

    await expect(
      updateUserTemplate({
        template_id: STARTER_UUID,
        name: "Trying to overwrite starter",
        subject_template: "evil",
        body_template: "evil",
      }),
    ).rejects.toThrow(/Cannot modify starter-pack template/);

    // Critical: the UPDATE chain was NEVER called — guard fired pre-round-trip.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("deleteUserTemplate THROWS BEFORE the DELETE round-trip when target is starter-pack", async () => {
    const deleteSpy = jest.fn();
    (supabase.from as FromMock).mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: async (): Promise<MockResult<unknown>> => ({
            data: { is_starter_pack: true },
            error: null,
          }),
        }),
      }),
    });

    await expect(
      deleteUserTemplate({ template_id: STARTER_UUID }),
    ).rejects.toThrow(/Cannot modify starter-pack template/);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe("createUserTemplate input validation", () => {
  beforeEach(() => {
    (supabase.from as FromMock).mockReset();
  });

  it("throws on empty name", async () => {
    await expect(
      createUserTemplate({
        account_id: ACCOUNT_UUID,
        brand_id: null,
        name: "",
        subject_template: null,
        body_template: "Body",
      }),
    ).rejects.toThrow(/name is required/);
  });

  it("throws on empty body", async () => {
    await expect(
      createUserTemplate({
        account_id: ACCOUNT_UUID,
        brand_id: null,
        name: "Title",
        subject_template: null,
        body_template: "",
      }),
    ).rejects.toThrow(/body_template is required/);
  });
});
