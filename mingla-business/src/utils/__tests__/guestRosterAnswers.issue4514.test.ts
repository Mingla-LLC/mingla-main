/**
 * #4514 wave 3 — the answers chip on event, experience and trip guest lists.
 *
 * FAILS-ON-REVERT: dropping the signed-in holder match (an Explorer answer would
 * read as "Not answered"), or letting an unverified open-link answer count as a
 * guest's answer, turns a case red.
 */

import type { BrandFormResponseRow, BrandFormResponsesPage } from "../../services/brandFormsService";
import { chipForRow, chipLabel, indexRosterAnswers, loadRosterAnswers } from "../guestRosterAnswers";
import { brandFormKeys } from "../../hooks/brandFormKeys";
import * as fs from "fs";
import * as path from "path";

const row = (over: Partial<BrandFormResponseRow>): BrandFormResponseRow => ({
  responseId: "r",
  versionId: "v1",
  version: 1,
  earlierVersion: false,
  answers: {},
  source: "link",
  verified: true,
  viaLink: false,
  editCount: 0,
  submittedAt: "2026-11-19T10:00:00Z",
  updatedAt: "2026-11-19T10:00:00Z",
  subject: { kind: "rsvp", id: "rsvp-1", name: "Amara" },
  holder: null,
  ...over,
});

const page = (rows: BrandFormResponseRow[], notAnswered: BrandFormResponsesPage["notAnswered"]): BrandFormResponsesPage => ({
  form: { id: "f1", name: "Open mic", status: "live", liveVersionId: "v1", doorFullAnswers: true },
  mode: "required_step",
  versions: {},
  total: rows.length,
  counts: {},
  rows,
  notAnswered,
});

describe("guest list answers chip", () => {
  const index = indexRosterAnswers("Open mic", page(
    [
      row({ responseId: "a", subject: { kind: "rsvp", id: "rsvp-1", name: "Amara" }, viaLink: true }),
      row({ responseId: "b", subject: { kind: "order", id: "order-1", name: "Gus" } }),
      row({ responseId: "c", subject: { kind: "user", id: "user-9", name: null }, holder: { rsvpId: null, orderIds: ["order-9"] } }),
      row({ responseId: "d", subject: { kind: "contact", id: null, name: "Stranger" }, verified: false }),
    ],
    [
      { kind: "rsvp", id: "rsvp-2", name: "Val", addedByHost: false },
      { kind: "order", id: "order-door", name: "Door buyer", addedByHost: true },
    ],
  ));

  it("an RSVP's own answer, through a link", () => {
    const s = chipForRow(index, { rsvpId: "rsvp-1", orderIds: [] });
    expect(chipLabel(s)).toBe("Answered · via link");
  });

  it("a buyer's order answer, and a signed-in answer tied to the buyer's order", () => {
    expect(chipLabel(chipForRow(index, { rsvpId: null, orderIds: ["order-1"] }))).toBe("Answered");
    expect(chipLabel(chipForRow(index, { rsvpId: null, orderIds: ["order-x", "order-9"] }))).toBe("Answered");
  });

  it("not answered, and added by the host", () => {
    expect(chipLabel(chipForRow(index, { rsvpId: "rsvp-2", orderIds: [] }))).toBe("Not answered");
    expect(chipLabel(chipForRow(index, { rsvpId: null, orderIds: ["order-door"] }))).toBe("Added by you");
  });

  it("an unverified open-link answer never shows on a guest; an invitee with nothing draws no chip", () => {
    expect(chipForRow(index, { rsvpId: null, orderIds: [] })).toEqual({ kind: "none" });
    expect(chipLabel({ kind: "none" })).toBeNull();
    expect([...index.byRsvp.values(), ...index.byOrder.values()].some((r) => r.responseId === "d")).toBe(false);
  });
});

// Fix wave (review finding 2): the guest list used to read only the first 200
// answers, so guests after row 200 silently showed no chip.
// FAILS-ON-REVERT: reading one page only leaves rsvp-449 without "Answered".
describe("more than 200 answers", () => {
  const many = (n: number): BrandFormResponseRow[] =>
    Array.from({ length: n }, (_, i) => row({ responseId: `r${i}`, subject: { kind: "rsvp", id: `rsvp-${i}`, name: `G${i}` } }));
  const pager = (all: BrandFormResponseRow[]) => {
    const calls: Array<[number, number]> = [];
    const fetchPage = (offset: number, limit: number): Promise<BrandFormResponsesPage> => {
      calls.push([offset, limit]);
      return Promise.resolve({ ...page(all.slice(offset, offset + limit), []), total: all.length });
    };
    return { calls, fetchPage };
  };

  it("reads every page, so a guest after row 200 shows Answered", async () => {
    const all = many(450);
    const { calls, fetchPage } = pager(all);
    const index = await loadRosterAnswers("Open mic", fetchPage);
    expect(calls).toEqual([[0, 200], [200, 200], [400, 200]]);
    expect(index.truncated).toBe(false);
    expect(index.byRsvp.size).toBe(450);
    expect(chipLabel(chipForRow(index, { rsvpId: "rsvp-449", orderIds: [] }))).toBe("Answered");
    expect(chipForRow(index, { rsvpId: "rsvp-nobody", orderIds: [] })).toEqual({ kind: "none" });
  });

  it("past the read cap the list says so: an unmatched guest is 'Answer not loaded', never blank", async () => {
    const { calls, fetchPage } = pager(many(450));
    const index = await loadRosterAnswers("Open mic", fetchPage, 2);
    expect(calls).toHaveLength(2);
    expect(index.truncated).toBe(true);
    expect(chipLabel(chipForRow(index, { rsvpId: "rsvp-399", orderIds: [] }))).toBe("Answered");
    const past = chipForRow(index, { rsvpId: "rsvp-449", orderIds: [] });
    expect(past).toEqual({ kind: "not_loaded" });
    expect(chipLabel(past)).toBe("Answer not loaded");
  });
});

// Fix wave (review finding 7): no inline fallback keys; every brand forms key
// comes from the factory.
describe("brand forms query keys", () => {
  it("the idle keys come from brandFormKeys and the hooks write none inline", () => {
    expect(brandFormKeys.idle("counts")).toEqual(["brand-forms", "counts", "none"]);
    expect(brandFormKeys.idle("roster-answers")).toEqual(["brand-forms", "roster-answers", "none"]);
    const hooks = fs.readFileSync(path.join(__dirname, "../../hooks/useBrandForms.ts"), "utf8");
    expect(hooks).not.toMatch(/\[\s*"brand-forms"/);
  });
});
