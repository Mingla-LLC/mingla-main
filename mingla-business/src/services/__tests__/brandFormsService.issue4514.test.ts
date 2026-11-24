/**
 * #4514 wave 2 — brandFormsService: the RPC mapping and the error mapping.
 *
 * FAILS-ON-REVERT: changing an RPC name or a parameter name, or deleting the
 * PT409 branch of mapBrandFormsError, turns a case below red.
 */

const rpc = jest.fn();
const from = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } }));

import {
  archiveBrandForm,
  attachBrandForm,
  BrandFormsError,
  closeBrandForm,
  createBrandForm,
  detachBrandForm,
  fetchBrandFormExport,
  fetchBrandFormResponses,
  mapBrandFormsError,
  publishBrandForm,
  reopenBrandForm,
  saveBrandFormDraft,
  setBrandFormDoorFullAnswers,
  STALE_DRAFT_MESSAGE,
} from "../brandFormsService";
import { BRAND_FORM_SCHEMA, type BrandFormDefinition } from "../../utils/brandFormDefinition";

const def: BrandFormDefinition = { schema: BRAND_FORM_SCHEMA, title: "Open mic", questions: [] };

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

const ok = (data: unknown): void => {
  rpc.mockResolvedValueOnce({ data, error: null });
};
const fail = (error: Record<string, unknown>): void => {
  rpc.mockResolvedValueOnce({ data: null, error });
};

describe("RPC mapping", () => {
  it("creates a form with the brand, name and optional draft", async () => {
    ok({ formId: "f1", draftRev: 1, status: "draft" });
    await expect(createBrandForm("b1", "Open mic")).resolves.toEqual({ formId: "f1", draftRev: 1 });
    expect(rpc).toHaveBeenCalledWith("biz_brand_form_create", { p_brand_id: "b1", p_name: "Open mic", p_draft: null });
  });

  it("saves a draft with its revision and name", async () => {
    ok({ draftRev: 4 });
    await expect(saveBrandFormDraft({ formId: "f1", draft: def, draftRev: 3, name: "Renamed" })).resolves.toEqual({ draftRev: 4 });
    expect(rpc).toHaveBeenCalledWith("biz_brand_form_save_draft", {
      p_form_id: "f1",
      p_draft: def,
      p_draft_rev: 3,
      p_name: "Renamed",
    });
  });

  it("publishes with the draft revision and returns the attached pages", async () => {
    ok({ versionId: "v1", version: 2, status: "live", attachedEventIds: ["e1"] });
    await expect(publishBrandForm("f1", 5)).resolves.toEqual({
      versionId: "v1",
      version: 2,
      status: "live",
      attachedEventIds: ["e1"],
      // wave 3: an older server without the field reads as no earlier guests.
      earlierGuests: [],
    });
    expect(rpc).toHaveBeenCalledWith("biz_brand_form_publish", { p_form_id: "f1", p_draft_rev: 5 });
  });

  it("closes, reopens and archives through their own RPCs", async () => {
    ok({ status: "closed" });
    await expect(closeBrandForm("f1")).resolves.toBe("closed");
    ok({ status: "live" });
    await expect(reopenBrandForm("f1")).resolves.toBe("live");
    ok({ status: "archived" });
    await expect(archiveBrandForm("f1")).resolves.toBe("archived");
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "biz_brand_form_close",
      "biz_brand_form_reopen",
      "biz_brand_form_archive",
    ]);
  });

  it("sets the door full-answers switch", async () => {
    ok({ doorFullAnswers: false });
    await expect(setBrandFormDoorFullAnswers("f1", false)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("biz_brand_form_set_door_full_answers", { p_form_id: "f1", p_on: false });
  });

  it("attaches with the mode and the attachment the screen saw", async () => {
    ok({
      attachmentId: "a2", mode: "required_step", formStatus: "live", existingGuests: 12, replacedAttachmentId: "a1",
      autoRemind: true, autoRemindChannels: ["push", "sms", "email"],
    });
    const result = await attachBrandForm({ formId: "f1", eventId: "e1", mode: "required_step", expectedAttachmentId: "a1" });
    expect(result).toEqual({
      attachmentId: "a2",
      mode: "required_step",
      existingGuests: 12,
      earlierGuests: 0,
      formStatus: "live",
      replacedAttachmentId: "a1",
      // Wave 4 review: the earlier-guests sheet shows the stored reminder (push dropped).
      autoRemind: true,
      autoRemindChannels: ["sms", "email"],
    });
    expect(rpc).toHaveBeenCalledWith("biz_brand_form_attach", {
      p_form_id: "f1",
      p_event_id: "e1",
      p_mode: "required_step",
      p_auto_remind: false,
      p_expected_attachment_id: "a1",
    });
  });

  it("detaches by attachment id", async () => {
    ok({ ok: true });
    await detachBrandForm("a1");
    expect(rpc).toHaveBeenCalledWith("biz_brand_form_detach", { p_attachment_id: "a1" });
  });

  it("reads responses for one page and the export feed", async () => {
    ok({
      form: { id: "f1", name: "Open mic", status: "live", liveVersionId: "v1", doorFullAnswers: true },
      mode: "required_step",
      versions: { v1: { version: 1, definition: def } },
      total: 2,
      counts: { q1: { o1: 2 } },
      rows: [],
      notAnswered: [{ kind: "rsvp", id: "r1", name: "Amara N.", addedByHost: false }],
    });
    const page = await fetchBrandFormResponses({ formId: "f1", eventId: "e1", filter: "all" });
    expect(page.total).toBe(2);
    expect(page.counts.q1?.o1).toBe(2);
    expect(page.notAnswered[0]?.name).toBe("Amara N.");
    expect(rpc).toHaveBeenLastCalledWith("biz_brand_form_responses", {
      p_form_id: "f1",
      p_event_id: "e1",
      p_filter: "all",
      p_limit: 50,
      p_offset: 0,
      // #4541 R4.7 (added on purpose): the owner filter and hidden toggle, defaults.
      p_owner: "all",
      p_show_hidden: false,
    });
    ok({ columns: [{ key: "1:q1", version: 1, questionId: "q1", label: "Are you performing?", type: "single_choice" }], rows: [] });
    const feed = await fetchBrandFormExport("f1", "e1");
    expect(feed.columns[0]?.label).toBe("Are you performing?");
    expect(rpc).toHaveBeenLastCalledWith("biz_brand_form_responses_export", { p_form_id: "f1", p_event_id: "e1" });
  });
});

describe("error mapping", () => {
  it("shows the stale-draft message and keeps the server's revision", async () => {
    fail({ message: "form_draft_conflict", code: "PT409", details: JSON.stringify({ draftRev: 9 }) });
    const err = await saveBrandFormDraft({ formId: "f1", draft: def, draftRev: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BrandFormsError);
    expect((err as BrandFormsError).code).toBe("form_draft_conflict");
    expect((err as BrandFormsError).message).toBe("Someone else changed this form. Reload.");
    expect(STALE_DRAFT_MESSAGE).toBe("Someone else changed this form. Reload.");
    expect((err as BrandFormsError).currentDraftRev).toBe(9);
  });

  it("maps a stale attach to a reload message and keeps the server's attachment", () => {
    const err = mapBrandFormsError(
      { message: "attachment_conflict", code: "PT409", details: JSON.stringify({ attachmentId: "a9" }) },
      "x",
    );
    expect(err.code).toBe("attachment_conflict");
    expect(err.currentAttachmentId).toBe("a9");
  });

  it("maps a refused rank to a plain sentence, never the raw code", () => {
    const err = mapBrandFormsError({ message: "brand_form_forbidden", code: "42501" }, "x");
    expect(err.code).toBe("forbidden");
    expect(err.message).not.toContain("brand_form_forbidden");
  });

  it("names the first invalid-definition problem in words", () => {
    const err = mapBrandFormsError(
      {
        message: "invalid_definition",
        code: "22023",
        details: JSON.stringify([{ path: "questions", code: "too_many_door_questions" }]),
      },
      "x",
    );
    expect(err.message).toBe("A form can show at most 3 questions at the door.");
  });

  it("maps no_questions on publish", () => {
    const err = mapBrandFormsError(
      { message: "invalid_definition", code: "22023", details: JSON.stringify([{ path: "questions", code: "no_questions" }]) },
      "x",
    );
    expect(err.code).toBe("no_questions");
  });

  it("keeps trips on their own questions step", () => {
    expect(mapBrandFormsError({ message: "trip_uses_intake", code: "22023" }, "x").code).toBe("trip_uses_intake");
  });

  it("falls back to the caller's friendly sentence for an unknown failure", () => {
    expect(mapBrandFormsError({ message: "something odd", code: "XX000" }, "Couldn't do it. Try again.").message).toBe(
      "Couldn't do it. Try again.",
    );
  });

  it("reports offline as its own code", () => {
    expect(mapBrandFormsError(new TypeError("Failed to fetch"), "x").code).toBe("network_error");
  });

  it("throws on a malformed payload instead of returning an empty list", async () => {
    ok({ rows: "nope" });
    await expect(fetchBrandFormResponses({ formId: "f1", eventId: null, filter: "all" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
