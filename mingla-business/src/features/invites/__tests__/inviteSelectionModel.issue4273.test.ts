/**
 * #4273 wave A — the Invite step's selection model and the plan parser.
 * Sources combine; people edits fold in; methods keep at least one; a plan or
 * receipt from before #4273 parses with derived sources and no stored methods.
 */
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("../../../services/marketing/manualGroupService", () => ({ listManualGroups: jest.fn() }));
jest.mock("../../../services/peopleService", () => ({ listBrandPeople: jest.fn() }));

import {
  applyWizardInvitePeopleEdits,
  EMPTY_WIZARD_INVITE_SOURCES,
  effectiveWizardInviteChannels,
  toggleWizardInviteChannel,
  toggleWizardInviteGroup,
  toggleWizardInviteSource,
  wizardInviteChannelLine,
  wizardInviteSelection,
} from "../inviteSelectionModel";
import { getWizardInvitePlan } from "../../../services/offeringInvitePlanService";
import { supabase } from "../../../services/supabase";

const A = "00000000-4273-4000-8000-00000000000a";
const B = "00000000-4273-4000-8000-00000000000b";
const G = "00000000-4273-4000-8000-00000000000c";
const EVENT = "00000000-4273-4000-8000-00000000000e";

describe("#4273 sources combine", () => {
  test("each tick keeps every other source", () => {
    let sources = toggleWizardInviteSource(EMPTY_WIZARD_INVITE_SOURCES, "followers");
    sources = toggleWizardInviteSource(sources, "everyone");
    sources = toggleWizardInviteGroup(sources, G);
    sources = toggleWizardInviteSource(sources, "friendsOfFollowers");
    expect(sources).toEqual({
      includeEveryone: true, includeFollowers: true, includeFriendsOfFollowers: true,
      manualGroupIds: [G], personIds: [], excludedPersonIds: [],
    });
    sources = toggleWizardInviteSource(sources, "followers");
    expect(sources.includeFollowers).toBe(false);
    expect(sources.includeEveryone).toBe(true);
    expect(toggleWizardInviteGroup(sources, G).manualGroupIds).toEqual([]);
  });

  test("ticking Everyone clears earlier hand removals", () => {
    const sources = { ...EMPTY_WIZARD_INVITE_SOURCES, excludedPersonIds: [A] };
    expect(toggleWizardInviteSource(sources, "everyone").excludedPersonIds).toEqual([]);
  });

  test("people edits add on top and removals stay out of wider sources", () => {
    const everyone = { ...EMPTY_WIZARD_INVITE_SOURCES, includeEveryone: true };
    expect(applyWizardInvitePeopleEdits(everyone, [A, B], [A])).toEqual({
      ...everyone, personIds: [], excludedPersonIds: [B],
    });
    const handPicked = { ...EMPTY_WIZARD_INVITE_SOURCES, personIds: [A] };
    expect(applyWizardInvitePeopleEdits(handPicked, [A], [A, B])).toEqual({
      ...handPicked, personIds: [A, B], excludedPersonIds: [],
    });
    // Hand-picked only: removing needs no exclusion.
    expect(applyWizardInvitePeopleEdits(handPicked, [A], [])).toEqual({
      ...handPicked, personIds: [], excludedPersonIds: [],
    });
    // Re-adding a removed person lifts the exclusion.
    const removed = { ...everyone, excludedPersonIds: [B] };
    expect(applyWizardInvitePeopleEdits(removed, [A], [A, B]).excludedPersonIds).toEqual([]);
  });
});

describe("#4273 How to reach them", () => {
  test("at least one method stays ticked", () => {
    expect(toggleWizardInviteChannel(["push"], "push")).toBeNull();
    expect(toggleWizardInviteChannel(["push"], "sms")).toEqual(["push", "sms"]);
    expect(toggleWizardInviteChannel(["email", "push"], "email")).toEqual(["push"]);
  });

  test("defaults: Push + Email for a new plan; all three for a legacy plan with people", () => {
    expect(effectiveWizardInviteChannels({ deliveryChannels: null, selectedCount: 0 })).toEqual(["email", "push"]);
    expect(effectiveWizardInviteChannels({ deliveryChannels: null, selectedCount: 2 })).toEqual(["email", "push", "sms"]);
    expect(effectiveWizardInviteChannels({ deliveryChannels: ["sms"], selectedCount: 2 })).toEqual(["sms"]);
  });

  test("the payload is the 7-key shape, sorted", () => {
    expect(wizardInviteSelection({ ...EMPTY_WIZARD_INVITE_SOURCES, personIds: [B, A] }, ["push", "email"])).toEqual({
      ...EMPTY_WIZARD_INVITE_SOURCES, personIds: [A, B], deliveryChannels: ["email", "push"],
    });
  });

  test("the delivery line lists only ticked methods", () => {
    const per = { email: 3, sms: 2, push: 5 };
    expect(wizardInviteChannelLine(per, null)).toBe("Email 3 · Text 2 · Mingla 5");
    expect(wizardInviteChannelLine(per, ["push"])).toBe("Mingla 5");
    expect(wizardInviteChannelLine(per, ["email", "sms"])).toBe("Email 3 · Text 2");
  });
});

describe("#4273 plan parser", () => {
  const raw = {
    eventId: EVENT, eventType: "event", selectionRevision: 2, selectedCount: 1,
    brandPersonIds: [A], accountRecipientCount: 2, selectionHash: "a".repeat(64),
    state: "draft", publishedSelectionRevision: null, updatedAt: null,
  };
  const rpc = supabase.rpc as jest.Mock;

  test("stored sources and methods are returned", async () => {
    rpc.mockResolvedValueOnce({
      data: { ...raw, sources: { ...EMPTY_WIZARD_INVITE_SOURCES, includeEveryone: true }, deliveryChannels: ["push", "email"] },
      error: null,
    });
    const plan = await getWizardInvitePlan(EVENT);
    expect(plan.sources?.includeEveryone).toBe(true);
    expect(plan.deliveryChannels).toEqual(["email", "push"]);
    expect(plan.selectedCount).toBe(3);
  });

  test("a legacy plan or receipt parses with derived sources and no methods", async () => {
    rpc.mockResolvedValueOnce({ data: raw, error: null });
    const plan = await getWizardInvitePlan(EVENT);
    expect(plan.sources).toEqual({ ...EMPTY_WIZARD_INVITE_SOURCES, includeFollowers: true, personIds: [A] });
    expect(plan.deliveryChannels).toBeNull();
  });

  test("malformed methods are refused, never guessed", async () => {
    rpc.mockResolvedValueOnce({ data: { ...raw, deliveryChannels: ["fax"] }, error: null });
    await expect(getWizardInvitePlan(EVENT)).rejects.toMatchObject({ code: "wizard_invite_invalid_response" });
    rpc.mockResolvedValueOnce({ data: { ...raw, deliveryChannels: [] }, error: null });
    await expect(getWizardInvitePlan(EVENT)).rejects.toMatchObject({ code: "wizard_invite_invalid_response" });
    rpc.mockResolvedValueOnce({ data: { ...raw, sources: { includeEveryone: "yes" } }, error: null });
    await expect(getWizardInvitePlan(EVENT)).rejects.toMatchObject({ code: "wizard_invite_invalid_response" });
  });
});
