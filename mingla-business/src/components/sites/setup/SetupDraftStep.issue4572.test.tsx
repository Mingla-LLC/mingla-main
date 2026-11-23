/*
 * #4572 item 4 (D1) — Build no longer dead-ends on a recommended detail the
 * brand doesn't have (Kolanut: a phone number). Each missing item is a row; a
 * recommended one the server accepts as "doesn't apply" gets that button,
 * a required one never does, and a refused mark says "That didn't save".
 * FAILS-ON-REVERT: the old card was one sentence with no button.
 */
import React from "react";

jest.mock("../website/WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../plan/BuildPart", () => ({ BuildPart: () => null }));

import { SetupDraftStep } from "./SetupDraftStep";

type TestNode = { props: Record<string, any>; children: (TestNode | string)[]; findAll: (test: (node: TestNode) => boolean) => TestNode[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as { act: (fn: () => unknown) => Promise<void> | void; create: (node: React.ReactElement) => { root: TestNode } };
const byId = (root: TestNode, id: string) => root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0];
const has = (root: TestNode, id: string) => root.findAll((n) => n.props.testID === id).length > 0;
const textOf = (node: TestNode | string): string => (typeof node === "string" ? node : node.children.map(textOf).join(" "));
const noop = () => undefined;
const blockers = [
  { key: "contact_phone", label: "Phone number", requirement: "recommended" as const },
  { key: "social_links", label: "Social links", requirement: "recommended" as const },
  { key: "description", label: "What your brand is about", requirement: "required" as const },
];

function mount(onNotApplicable?: (key: string) => Promise<void>) {
  let tree!: { root: TestNode };
  act(() => {
    tree = create(<SetupDraftStep brandId="b" brandName="Kolanut Gallery" state={{ kind: "can_start" }} canManage blockers={blockers} nextStep="brand" onStart={noop} onRetry={noop} onTellMingla={noop} onDone={noop} onNotApplicable={onNotApplicable} />);
  });
  return tree;
}

describe("#4572 item 4 — Doesn't apply to my brand on Build", () => {
  it("each recommended row offers the button; the required row does not; Go to what's missing stays", () => {
    const tree = mount(async () => undefined);
    expect(has(tree.root, "setup-draft-na-contact_phone")).toBe(true);
    expect(has(tree.root, "setup-draft-na-social_links")).toBe(true);
    expect(has(tree.root, "setup-draft-na-description")).toBe(false);
    expect(has(tree.root, "setup-draft-missing")).toBe(true);
    expect(textOf(tree.root)).toContain("Recommended");
    expect(textOf(tree.root)).toContain("Required");
  });

  it("tapping it marks that field (the server decides); read-only shows no button", async () => {
    const mark = jest.fn(async () => undefined);
    const tree = mount(mark);
    await act(async () => { byId(tree.root, "setup-draft-na-contact_phone")!.props.onPress(); });
    expect(mark).toHaveBeenCalledWith("contact_phone");
    expect(has(mount(undefined).root, "setup-draft-na-contact_phone")).toBe(false);
  });

  it("a refused mark (a stale revision) says That didn't save and offers Try again", async () => {
    const tree = mount(async () => { throw new Error("stale"); });
    await act(async () => { byId(tree.root, "setup-draft-na-contact_phone")!.props.onPress(); });
    expect(has(tree.root, "setup-draft-row-contact_phone-error")).toBe(true);
    expect(textOf(tree.root)).toContain("That didn't save");
    expect(textOf(tree.root)).toContain("Try again");
  });
});
