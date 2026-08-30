import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../ui/Avatar", () => ({
  Avatar: (props: any) => React.createElement("MockAvatar", props),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: any) => React.createElement("MockButton", props),
}));
jest.mock("../../ui/EmptyState", () => ({
  EmptyState: (props: any) => React.createElement("MockEmpty", props),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: any) => React.createElement("MockCard", null, children),
}));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: any) => React.createElement("MockIcon", props),
}));
jest.mock("../../ui/Skeleton", () => ({
  Skeleton: (props: any) => React.createElement("MockSkeleton", props),
}));

import { PersonDetailView } from "../PersonDetailView";

const TR = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const textOf = (json: any): string => typeof json === "string"
  ? json
  : Array.isArray(json)
  ? json.map(textOf).join(" ")
  : json && typeof json === "object"
  ? textOf(json.children ?? [])
  : "";

const person = {
  personId: "person-a",
  displayName: "Maya Thompson",
  avatarUrl: null,
  updatedAt: "2026-08-30T12:00:00.000Z",
  alternateNames: ["Maya T."],
  linked: true,
  identityVersion: "version-a",
  capabilities: {
    canMerge: true,
    canPromotePrimary: true,
    canViewMergeHistory: true,
    canSplit: true,
  },
  contacts: [
    { id: "email-a", channel: "email" as const, value: "maya@northstar.co", isPrimary: true },
    { id: "email-b", channel: "email" as const, value: "maya.t@example.test", isPrimary: false },
    { id: "phone-a", channel: "phone" as const, value: "+14045550148", isPrimary: true },
  ],
  suppressions: [{ channel: "email" as const, scope: "marketing" as const }],
};
const history = [{
  mergeEventId: "merge-a",
  status: "active" as const,
  createdAt: "2026-08-28T14:14:00.000Z",
  reversedAt: null,
  survivorPersonId: "person-a",
  survivorLabel: "Maya Thompson",
  counterpartPersonId: "person-erased",
  counterpartLabel: "an erased contact",
  canSplit: true,
  eventVersion: "event-a",
}];

describe("#1772 Person detail approved hierarchy", () => {
  test("renders aliases, merge, grouped primary controls, history, then preferences", () => {
    const onMerge = jest.fn();
    const onPromote = jest.fn();
    const onSplit = jest.fn();
    let tree: any;
    TR.act(() => {
      tree = TR.create(
        <PersonDetailView
          person={person}
          loading={false}
          error={null}
          status={null}
          onRetry={() => undefined}
          historyRows={history}
          onMerge={onMerge}
          onPromote={onPromote}
          onSplit={onSplit}
        />,
      );
    });
    const rendered = textOf(tree.toJSON()).replace(/\s+/g, " ");
    for (const copy of [
      "Also known as",
      "Maya T.",
      "Contact details",
      "Primary controls how this person appears in your book. Messages still go to every eligible address.",
      "Email",
      "Phone",
      "Merge history",
      "Merged with an erased contact",
      "Marketing preferences",
    ]) expect(rendered).toContain(copy);
    expect(rendered.indexOf("Also known as")).toBeLessThan(rendered.indexOf("Contact details"));
    expect(rendered.indexOf("Contact details")).toBeLessThan(rendered.indexOf("Merge history"));
    expect(rendered.indexOf("Merge history")).toBeLessThan(rendered.indexOf("Marketing preferences"));

    const buttons = tree.root.findAllByType("MockButton");
    expect(buttons.map((node: any) => node.props.label)).toEqual(expect.arrayContaining([
      "Merge duplicate",
      "Make primary",
      "Split",
    ]));
    TR.act(() => buttons.find((node: any) => node.props.label === "Make primary").props.onPress());
    expect(onPromote).toHaveBeenCalledWith(person.contacts[1]);
  });

  test("lower-role/legacy detail exposes no privilege teaser", () => {
    const legacy = {
      personId: "person-a",
      displayName: "Maya Thompson",
      avatarUrl: null,
      updatedAt: "2026-08-30T12:00:00.000Z",
      contacts: person.contacts,
      suppressions: [],
    };
    let tree: any;
    TR.act(() => {
      tree = TR.create(
        <PersonDetailView
          person={legacy}
          loading={false}
          error={null}
          status={null}
          onRetry={() => undefined}
          onMerge={() => undefined}
          onPromote={() => undefined}
          onSplit={() => undefined}
        />,
      );
    });
    const labels = tree.root.findAllByType("MockButton").map((node: any) => node.props.label);
    expect(labels).not.toContain("Merge duplicate");
    expect(labels).not.toContain("Make primary");
    expect(labels).not.toContain("Split");
  });
});
