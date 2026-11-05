import React from "react";

// #4273 wave A — the creation-wizard Invite step: sources are tick boxes that
// COMBINE (today each Select replaced the last), "How to reach them" chips pick
// the methods (at least one stays on), and the Invite delivery card follows
// the ticked methods. Everything else on the step is unchanged.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

const mockUseOfferingInvitePlan = jest.fn();

jest.mock("../../../hooks/useBrandFollowerCount", () => ({
  useBrandFollowerCount: () => ({ data: 1, isError: false }),
}));
jest.mock("../../../hooks/useOfferingInvitePlan", () => ({
  useOfferingInvitePlan: (...args: unknown[]) => mockUseOfferingInvitePlan(...args),
}));
jest.mock("../../../features/invites/wizardInviteAnalytics", () => ({
  captureWizardInvite: jest.fn(),
}));
jest.mock("../../../services/offeringInvitePlanService", () => {
  function MockWizardInvitePlanError(code: string, retryable: boolean) {
    const error = new Error(code) as Error & { code: string; retryable: boolean; currentRevision: null };
    Object.setPrototypeOf(error, MockWizardInvitePlanError.prototype);
    error.code = code;
    error.retryable = retryable;
    error.currentRevision = null;
    return error;
  }
  MockWizardInvitePlanError.prototype = Object.create(Error.prototype);
  return {
    WizardInvitePlanError: MockWizardInvitePlanError,
    createWizardInviteRequestId: () => "00000000-0000-4000-8000-000000004273",
    formatWizardInviteMoney: (minor: number, currency: string) => `${currency} ${minor / 100}`,
  };
});
jest.mock("../../ui/ConfirmDialog", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { ConfirmDialog: (props: Record<string, unknown>) => ReactModule.createElement("confirm-dialog", props) };
});
jest.mock("../../ui/Button", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { Button: (props: Record<string, unknown>) => ReactModule.createElement("button", props) };
});
jest.mock("../../ui/Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { Sheet: (props: Record<string, unknown>) => ReactModule.createElement("sheet", props) };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return { ScrollView: (props: Record<string, unknown>) => ReactModule.createElement("scroll-view", props) };
});

import fs from "node:fs";
import path from "node:path";

import {
  FRIENDS_OF_FOLLOWERS_EMPTY,
  InvitePeoplePublishConfirmation,
  InvitePeopleStep,
  InvitePlanReviewSummary,
  InviteQuoteCard,
} from "../InvitePeopleStep";
import { WizardInvitePlanError } from "../../../services/offeringInvitePlanService";

const EVENT_ID = "00000000-4273-4000-8000-000000000001";
const BRAND_ID = "00000000-4273-4000-8000-000000000002";
const AVERY = "00000000-4273-4000-8000-000000000003";
const BLAKE = "00000000-4273-4000-8000-000000000004";
const GROUP_ID = "00000000-4273-4000-8000-000000000005";

const NO_SOURCES = {
  includeEveryone: false,
  includeFollowers: false,
  includeFriendsOfFollowers: false,
  manualGroupIds: [] as string[],
  personIds: [] as string[],
  excludedPersonIds: [] as string[],
};

const basePlan = {
  eventId: EVENT_ID,
  eventType: "rsvp",
  selectionRevision: 3,
  selectedCount: 2,
  bookSelectedCount: 1,
  accountRecipientCount: 1,
  brandPersonIds: [AVERY],
  selectionHash: "a".repeat(64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: "2026-11-04T12:00:00.000Z",
  sources: { ...NO_SOURCES, includeFollowers: true },
  deliveryChannels: ["email", "push"],
};

const quote = {
  selectionRevision: 3,
  selectedCount: 2,
  reachableCount: 2,
  suppressedCount: 0,
  canReceiveCount: 2,
  skippedCount: 0,
  perChannelReachable: { email: 1, sms: 4, push: 2 },
  estimatedCostMinor: 250,
  currency: "USD",
  quoteHash: "b".repeat(64),
  selectionHash: "a".repeat(64),
};

const person = (personId: string, displayName: string) => ({
  personId,
  displayName,
  contacts: [{ id: `${personId}-c`, channel: "email", value: "x***@example.test", isPrimary: true }],
});

const readyCircle = (followers: number, extended: number) => ({
  state: "ready",
  counts: { followers, extended, total: followers + extended },
  availability: {
    followers: { state: "ready", reason: null, refreshedAt: "2026-11-04T00:00:00Z", expiresAt: "2026-11-04T01:00:00Z" },
    extended: { state: "ready", reason: null, refreshedAt: "2026-11-04T00:00:00Z", expiresAt: "2026-11-04T01:00:00Z" },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function model(overrides: Record<string, unknown> = {}, planOverrides: Record<string, unknown> = {}): any {
  const plan = { ...basePlan, ...planOverrides };
  return {
    plan: { data: plan, isPending: false, isError: false, error: null },
    quote: { data: quote, isPending: false, isFetching: false, isError: false, failureCount: 0, error: null },
    people: {
      data: { pages: [{ rows: [person(AVERY, "Avery"), person(BLAKE, "Blake")], bookTotal: 2, filteredTotal: 2, nextCursor: null }] },
      isPending: false, isError: false, isFetchingNextPage: false, hasNextPage: false,
      fetchNextPage: jest.fn(), refetch: jest.fn(),
    },
    groups: {
      data: [{ groupId: GROUP_ID, name: "Launch circle", memberCount: 1 }],
      isPending: false, isError: false, error: null, refetch: jest.fn(),
    },
    circle: { data: readyCircle(0, 0), isPending: false, isError: false },
    replace: { isPending: false, mutateAsync: jest.fn(async () => plan) },
    clear: { isPending: false, mutateAsync: jest.fn(async () => plan) },
    refreshAuthoritative: jest.fn(async () => ({ plan, quote })),
    ...overrides,
  };
}

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

function renderStep() {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(<InvitePeopleStep eventId={EVENT_ID} brandId={BRAND_ID} eventType="rsvp" />);
  });
  return renderer;
}

const byTestId = (renderer: any, testID: string): any =>
  renderer.root.findAll((node: any) => node.props.testID === testID &&
    node.props.accessibilityRole === "checkbox" && typeof node.props.onPress === "function")[0];
const button = (renderer: any, label: RegExp): any =>
  renderer.root.findAllByType("button").find((node: any) => typeof node.props.label === "string" && label.test(node.props.label));

async function press(node: any) {
  await act(async () => {
    node.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("#4273 sources combine instead of replacing each other", () => {
  beforeEach(() => jest.clearAllMocks());

  test("ticking Everyone keeps Followers ticked and keeps the methods", async () => {
    const m = model();
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep();
    const followers = byTestId(renderer, "invite-source-followers");
    expect(followers.props.accessibilityRole).toBe("checkbox");
    expect(followers.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    await press(byTestId(renderer, "invite-source-everyone"));
    expect(m.replace.mutateAsync).toHaveBeenCalledTimes(1);
    expect(m.replace.mutateAsync.mock.calls[0][0]).toEqual(expect.objectContaining({
      expectedRevision: 3,
      selection: {
        includeEveryone: true,
        includeFollowers: true,
        includeFriendsOfFollowers: false,
        manualGroupIds: [],
        personIds: [],
        excludedPersonIds: [],
        deliveryChannels: ["email", "push"],
      },
    }));
  });

  test("a saved group adds to the other sources; unticking it removes only the group", async () => {
    const m = model({}, { sources: { ...NO_SOURCES, includeEveryone: true, personIds: [BLAKE] } });
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep();
    await press(byTestId(renderer, `invite-source-group-${GROUP_ID}`));
    expect(m.replace.mutateAsync.mock.calls[0][0].selection).toEqual(expect.objectContaining({
      includeEveryone: true, manualGroupIds: [GROUP_ID], personIds: [BLAKE],
    }));

    const ticked = model({}, { sources: { ...NO_SOURCES, includeEveryone: true, manualGroupIds: [GROUP_ID] } });
    mockUseOfferingInvitePlan.mockReturnValue(ticked);
    const again = renderStep();
    const group = byTestId(again, `invite-source-group-${GROUP_ID}`);
    expect(group.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    await press(group);
    expect(ticked.replace.mutateAsync.mock.calls[0][0].selection).toEqual(expect.objectContaining({
      includeEveryone: true, manualGroupIds: [],
    }));
  });

  test("Choose people adds on top and an unticked person stays out of Everyone", async () => {
    const m = model({}, {
      sources: { ...NO_SOURCES, includeEveryone: true },
      brandPersonIds: [AVERY, BLAKE], selectedCount: 2, bookSelectedCount: 2, accountRecipientCount: 0,
    });
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep();
    await press(button(renderer, /^Edit selection$/));
    const blake = renderer.root.findAll((node: any) =>
      node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel?.startsWith("Blake") &&
      typeof node.props.onPress === "function")[0];
    await press(blake);
    await press(button(renderer, /^Done · 1 selected$/));
    expect(m.replace.mutateAsync.mock.calls[0][0].selection).toEqual(expect.objectContaining({
      includeEveryone: true, personIds: [], excludedPersonIds: [BLAKE],
    }));
  });

  test("Clear all empties every source but keeps the methods", async () => {
    const m = model();
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep();
    await press(button(renderer, /^Clear all$/));
    expect(m.replace.mutateAsync.mock.calls[0][0].selection).toEqual({
      ...NO_SOURCES, deliveryChannels: ["email", "push"],
    });
  });

  test("a legacy plan with no stored sources still shows its people as chosen", () => {
    const m = model({}, { sources: undefined, deliveryChannels: undefined });
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep();
    expect(byTestId(renderer, "invite-source-followers").props.accessibilityState)
      .toEqual(expect.objectContaining({ checked: true }));
    // People and no stored methods: Mingla still picks automatically, so all three show ticked.
    for (const channel of ["push", "email", "sms"]) {
      expect(byTestId(renderer, `invite-method-${channel}`).props.accessibilityState)
        .toEqual(expect.objectContaining({ checked: true }));
    }
  });
});

describe("#4273 empty and explained rows", () => {
  beforeEach(() => jest.clearAllMocks());

  test("followers who are all in Your Book say so; Friends of followers with nobody yet is disabled", () => {
    mockUseOfferingInvitePlan.mockReturnValue(model({}, { sources: NO_SOURCES }));
    const renderer = renderStep();
    const text = treeText(renderer.toJSON());
    expect(text).toContain("All 1 follower · also in Your Book");
    expect(text).toContain(FRIENDS_OF_FOLLOWERS_EMPTY);
    expect(FRIENDS_OF_FOLLOWERS_EMPTY).toBe("0 so far · grows as guests opt in");
    const friends = byTestId(renderer, "invite-source-friends-of-followers");
    expect(friends.props.disabled).toBe(true);
  });

  test("followers outside Your Book keep the plain count; friends with people are tickable", () => {
    mockUseOfferingInvitePlan.mockReturnValue(model({ circle: { data: readyCircle(1, 2), isPending: false, isError: false } }));
    const renderer = renderStep();
    const text = treeText(renderer.toJSON());
    expect(text).toContain("All 1 follower");
    expect(text).not.toContain("also in Your Book");
    expect(byTestId(renderer, "invite-source-friends-of-followers").props.disabled).toBe(false);
  });
});

describe("#4273 How to reach them", () => {
  beforeEach(() => jest.clearAllMocks());

  test("a new plan starts with Push and Email; ticking SMS saves all three", async () => {
    const m = model({}, {
      selectionRevision: 0, selectedCount: 0, bookSelectedCount: 0, accountRecipientCount: 0,
      brandPersonIds: [], sources: NO_SOURCES, deliveryChannels: null,
    });
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep();
    const text = treeText(renderer.toJSON());
    expect(text).toContain("HOW TO REACH THEM");
    expect(byTestId(renderer, "invite-method-push").props.accessibilityLabel).toBe("Push · free");
    expect(byTestId(renderer, "invite-method-push").props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(byTestId(renderer, "invite-method-email").props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(byTestId(renderer, "invite-method-sms").props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    await press(byTestId(renderer, "invite-method-sms"));
    expect(m.replace.mutateAsync.mock.calls[0][0].selection.deliveryChannels).toEqual(["email", "push", "sms"]);
  });

  test("the last ticked method cannot be unticked", async () => {
    const m = model({}, { deliveryChannels: ["push"] });
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep();
    const push = byTestId(renderer, "invite-method-push");
    expect(push.props.disabled).toBe(true);
    expect(push.props.accessibilityState).toEqual(expect.objectContaining({ checked: true, disabled: true }));
    await press(push);
    expect(m.replace.mutateAsync).not.toHaveBeenCalled();
    await press(byTestId(renderer, "invite-method-email"));
    expect(m.replace.mutateAsync.mock.calls[0][0].selection.deliveryChannels).toEqual(["email", "push"]);
  });

  test("the Invite delivery card line and text cost follow the ticked methods", () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<InviteQuoteCard quote={quote as never} loading={false} error={false}
        channels={["email", "push"]} />);
    });
    let text = treeText(renderer.toJSON());
    expect(text).toContain("Email 1 · Mingla 2");
    expect(text).not.toContain("Text 4");
    expect(text).toContain("No paid-channel cost");
    act(() => {
      renderer.update(<InviteQuoteCard quote={quote as never} loading={false} error={false}
        channels={["email", "push", "sms"]} />);
    });
    text = treeText(renderer.toJSON());
    expect(text).toContain("Email 1 · Text 4 · Mingla 2");
    expect(text).toContain("Estimated text cost USD 2.5");
  });
});

describe("#4273 unchanged on the step", () => {
  beforeEach(() => jest.clearAllMocks());

  test("Nothing sends yet, the selection summary and the follower line stay", () => {
    mockUseOfferingInvitePlan.mockReturnValue(model());
    const text = treeText(renderStep().toJSON()).replace(/\s+/g, " ");
    expect(text).toContain("Nothing sends yet");
    expect(text).toContain("Your selections stay with this draft.");
    expect(text).toContain("Choose who to invite. Nothing sends until this RSVP is published.");
    expect(text).toContain("2 selected");
    expect(text).toContain("Includes 1 follower reached through Mingla. Their contact details stay private.");
    expect(text).toContain("Invite delivery");
  });

  test("the 500-person limit message is unchanged", async () => {
    const tooLarge = new WizardInvitePlanError("wizard_invite_selection_too_large", false);
    const m = model({
      replace: { isPending: false, mutateAsync: jest.fn(async () => { throw tooLarge; }) },
    });
    mockUseOfferingInvitePlan.mockReturnValue(m);
    const renderer = renderStep();
    await press(byTestId(renderer, "invite-source-everyone"));
    const text = treeText(renderer.toJSON());
    expect(text).toContain("You can invite up to 500 people. Remove someone before adding more.");
    expect(text).toContain("Unsaved Everyone in Your Book selection");
  });

  test("a locked plan disables every tick box and chip", () => {
    mockUseOfferingInvitePlan.mockReturnValue(model({}, { state: "locked", publishedSelectionRevision: 3 }));
    const renderer = renderStep();
    for (const id of ["invite-source-everyone", "invite-source-followers", "invite-method-email", "invite-method-push"]) {
      expect(byTestId(renderer, id).props.disabled).toBe(true);
    }
  });
});

describe("#4273 unchanged around the step", () => {
  const source = (relative: string): string =>
    fs.readFileSync(path.join(__dirname, "..", "..", relative), "utf8");
  const position = (titles: string[]): string =>
    `${titles.indexOf("Invite people") + 1} of ${titles.length}`;

  test("the Invite step keeps its position in all four wizards", () => {
    const titlesOf = (text: string, pattern: RegExp): string[] =>
      [...text.matchAll(pattern)].map((match) => match[1]);
    const event = source("event/EventCreatorWizard.tsx");
    const eventSteps = event.slice(event.indexOf("const STEP_DEFS"), event.indexOf("const TOTAL_STEPS"));
    expect(position(titlesOf(eventSteps, /\{ title: "([^"]+)"/g))).toBe("7 of 8");
    const rsvp = source("rsvp/RsvpCreatorWizard.tsx");
    const rsvpSteps = rsvp.slice(rsvp.indexOf("const STEP_DEFS"), rsvp.indexOf("const TOTAL_STEPS"));
    expect(position(titlesOf(rsvpSteps, /\{ title: "([^"]+)"/g))).toBe("6 of 7");
    const experience = source("experience/ExperienceCreatorWizard.tsx");
    const live = experience.slice(experience.indexOf("const LIVE_EDIT_STEPS"), experience.indexOf("const CREATION_STEPS"));
    const creation = experience.slice(experience.indexOf("const CREATION_STEPS"), experience.indexOf("const RPC_ERROR_COPY"));
    expect(position([
      ...titlesOf(live, /label: "([^"]+)"/g),
      ...titlesOf(creation, /label: "([^"]+)"/g),
    ])).toBe("6 of 7");
    const trip = source("trip/TripCreatorWizard.tsx");
    const tripSteps = trip.slice(trip.indexOf("const STEP_TITLES"), trip.indexOf("const STEP_SUBTITLES"));
    expect(position(titlesOf(tripSteps, /\d: "([^"]+)"/g))).toBe("7 of 8");
  });

  test("the review summary and the publish confirmation copy are unchanged", () => {
    const plan = { ...basePlan, selectedCount: 3 };
    const q = { ...quote, selectedCount: 3, canReceiveCount: 2, skippedCount: 1 };
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<InvitePlanReviewSummary plan={plan as never} quote={q as never} />);
    });
    const text = treeText(renderer.toJSON());
    expect(text).toContain("2 can receive");
    expect(text).toContain("1 skipped · 3 selected");
    act(() => {
      renderer = TestRenderer.create(<InvitePeoplePublishConfirmation visible eventType="rsvp"
        plan={plan as never} quote={q as never} publishing={false} onClose={jest.fn()} onConfirm={jest.fn()} />);
    });
    const dialog = renderer.root.findByType("confirm-dialog");
    expect(dialog.props.title).toBe("Publish RSVP and send 2 invites?");
    expect(dialog.props.confirmLabel).toBe("Publish & invite 2");
    expect(dialog.props.description).toContain("2 invites are queued only after publication succeeds; 1 selected person is skipped.");
  });
});
