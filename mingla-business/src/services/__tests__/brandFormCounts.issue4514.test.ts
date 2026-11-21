/**
 * #4514 wave 3 — one counts read (biz_brand_form_counts) for the forms list cards
 * and the manage tile; publish and attach report the earlier guests (C12).
 *
 * FAILS-ON-REVERT: renaming the counts RPC or its parameter, or dropping
 * the earlier-guests mapping, turns a case red.
 */

const rpc = jest.fn();
const from = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));

import { attachBrandForm, fetchBrandFormCounts, publishBrandForm } from "../brandFormsService";
import { formCountsLine } from "../../components/forms/brandFormsCopy";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("counts", () => {
  it("calls biz_brand_form_counts once for the brand and maps forms and pages", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        forms: [{ formId: "f1", answered: 4, toAnswer: 2, pages: 1 }],
        pages: [{ eventId: "e1", formId: "f1", formStatus: "live", answered: 4, toAnswer: 2 }],
      },
      error: null,
    });
    const out = await fetchBrandFormCounts("b1");
    expect(rpc).toHaveBeenCalledWith("biz_brand_form_counts", { p_brand_id: "b1" });
    expect(out).toEqual({
      forms: [{ formId: "f1", answered: 4, toAnswer: 2, pages: 1 }],
      // #4541 R1.2 (added on purpose): `notAsked` is null when the server sends none.
      pages: [{ eventId: "e1", formId: "f1", answered: 4, toAnswer: 2, notAsked: null }],
    });
  });

  it("a refusal throws (never an empty list)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "brand_form_forbidden" } });
    await expect(fetchBrandFormCounts("b1")).rejects.toBeInstanceOf(Error);
  });

  it("the card line reads answered and to answer", () => {
    expect(formCountsLine({ answered: 4, toAnswer: 2 })).toBe("4 answered · 2 to answer");
    expect(formCountsLine({ answered: 4, toAnswer: 0 })).toBe("4 answered");
    expect(formCountsLine(undefined)).toBeNull();
  });
});

describe("earlier guests (C12)", () => {
  it("publish reports each live page's earlier guests", async () => {
    rpc.mockResolvedValueOnce({
      data: { versionId: "v2", version: 2, status: "live", attachedEventIds: ["e1"], earlierGuests: [{ eventId: "e1", count: 3 }] },
      error: null,
    });
    const out = await publishBrandForm("f1", 4);
    expect(out.earlierGuests).toEqual([{ eventId: "e1", count: 3 }]);
  });

  it("attach reports the page's earlier guests", async () => {
    rpc.mockResolvedValueOnce({
      data: { attachmentId: "a1", mode: "required_step", existingGuests: 5, earlierGuests: 3, formStatus: "live", replacedAttachmentId: null },
      error: null,
    });
    const out = await attachBrandForm({ formId: "f1", eventId: "e1", mode: "required_step", expectedAttachmentId: null });
    expect(out.earlierGuests).toBe(3);
    expect(out.existingGuests).toBe(5);
  });
});
