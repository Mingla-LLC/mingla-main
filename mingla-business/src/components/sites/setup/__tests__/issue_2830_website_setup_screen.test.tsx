/**
 * #2830 — the setup screen's states, in the design's words (T-UI-1), a save that
 * fails keeps the text (T-UI-2), and the draft hook (T-DRAFT-2).
 */
import React from "react";

const mockProvision = jest.fn();
const mockCompose = jest.fn();
const mockUpdate = jest.fn();

jest.mock("../../website/WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../../plan/BuildPart", () => ({ BuildPart: () => null }));
jest.mock("../../../../services/brandSitesService", () => ({
  BrandSitesError: class BrandSitesError extends Error {
    constructor(readonly code: string, message: string, readonly retryable: boolean) { super(message); }
  },
  createBrandSiteOperationId: () => "new-op",
  persistProvisionOperation: () => Promise.resolve(),
  provisionBrandSite: (brandId: string, op: string) => mockProvision(brandId, op),
}));
jest.mock("../../../../sites/planApi", () => ({ composeBrandSiteFromPlan: (brandId: string) => mockCompose(brandId) }));
jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() } }));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true, user: { id: "u" } }) }));
jest.mock("../../../../hooks/useBrands", () => ({
  useBrand: () => ({ isLoading: false, data: { id: "b", displayName: "Lantern Room", contact: {}, links: {} } }),
  useUpdateBrand: () => ({ mutateAsync: mockUpdate }),
}));
jest.mock("../../../theme/ThemeControlRow", () => ({ ThemeControlRow: () => null }));
jest.mock("../../../theme/ThemeSheet", () => ({ ThemeSheet: () => null }));
jest.mock("../../../ui/Input", () => ({ Input: () => null, PHONE_COUNTRIES: [] }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetupBrandStep } from "../SetupBrandStep";
import { SetupDraftStep } from "../SetupDraftStep";
import { SetupPresenceCard } from "../SetupPresenceCard";
import { SetupStart } from "../SetupStart";
import { SetupStepList } from "../SetupStepList";
import { setupSteps } from "../../../../sites/setupStatus";
import { useSetupDraft } from "../../../../sites/setupApi";
import type { SitePlanState } from "../../../../sites/sitePlanState";

type TestNode = { props: Record<string, any>; children: (TestNode | string)[]; findAll: (test: (node: TestNode) => boolean) => TestNode[] };
type TestTree = { root: TestNode; unmount: () => void; update: (node: React.ReactElement) => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => unknown) => Promise<void> & void;
  create: (node: React.ReactElement) => TestTree;
};
const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join(" ");
const has = (root: TestNode, testID: string) =>
  root.findAll((n) => n.props.testID === testID).length > 0;
const pressable = (root: TestNode, testID: string) =>
  root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
const mount = (node: React.ReactElement) => {
  let tree!: TestTree;
  act(() => {
    tree = create(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
  });
  return tree;
};
const noop = () => undefined;

describe("T-UI-1 the design's words", () => {
  const presenceProps = { watching: false, busy: false, problem: null, onContinue: noop, onWatch: noop, onTakeOver: noop, onAskAdmin: noop, asking: false };

  it("state 1 counts what is really open", () => {
    const text = textOf(mount(<SetupStart brandName="Lantern Room" openCount={3} known="name and logo" onAri={noop} onHand={noop} busy={false} ariAvailable />).root);
    expect(text).toContain("Build your website");
    expect(text).toContain("About 15 minutes");
    expect(text).toContain("Lantern Room is already partly filled in.");
    expect(text).toContain("3 details are still needed, plus your design and story. Nothing goes public until you publish.");
    expect(text).toContain("Do it with Ari");
    expect(text).toContain("I'll do it myself");
  });

  it("state 4 names who, when and where; continue only for an admin", () => {
    const presence = { kind: "stopped" as const, name: "Info", since: "2026-11-04T10:00:00Z", stepKey: "brand", canContinue: true };
    const tree = mount(<SetupPresenceCard presence={presence} {...presenceProps} />);
    const text = textOf(tree.root);
    expect(text).toContain("Info started this on 4 Nov and stopped at Your brand details.");
    expect(text).toContain("Everything they answered is saved. Continue from there, and your team can see that you took over.");
    expect(has(tree.root, "setup-continue")).toBe(true);
    const below = mount(<SetupPresenceCard presence={{ ...presence, canContinue: false }} {...presenceProps} />);
    expect(has(below.root, "setup-continue")).toBe(false);
    expect(has(below.root, "setup-ask-admin")).toBe(true);
  });

  it("state 5 warns before taking over", () => {
    const tree = mount(<SetupPresenceCard presence={{ kind: "active", source: "ari", name: "Ama", stepKey: "story", canTakeOver: true }} {...presenceProps} />);
    const text = textOf(tree.root);
    expect(text).toContain("Ama is on Your story right now.");
    expect(text).toContain("You can watch progress here. If you take over, Ama's next answer won't save, and we'll tell Ama why.");
    expect(has(tree.root, "setup-watch")).toBe(true);
    expect(has(tree.root, "setup-take-over")).toBe(true);
  });

  it("the displaced and paused words", () => {
    expect(textOf(mount(<SetupPresenceCard presence={{ kind: "displaced", name: "Ama" }} {...presenceProps} />).root))
      .toContain("Ama took over Website setup, so that didn't save. Everything you answered before is still there.");
    expect(textOf(mount(<SetupPresenceCard presence={{ kind: "paused" }} {...presenceProps} />).root))
      .toContain("Mingla has paused your website, so setup is paused too.");
  });

  it("states 7, 8 and 9", () => {
    const step = (state: React.ComponentProps<typeof SetupDraftStep>["state"], canManage = true) => mount(
      <SetupDraftStep brandId="b" brandName="Lantern Room" state={state} canManage={canManage} onStart={noop} onRetry={noop} onTellMingla={noop} onDone={noop} />,
    );
    expect(textOf(step({ kind: "building" }).root)).toContain("Building Lantern Room's website.");
    expect(textOf(step({ kind: "checking" }).root)).toContain("Checking whether your draft was created.");
    const failed = step({ kind: "failed", retry: "new_operation" });
    expect(textOf(failed.root)).toContain("We couldn't create your draft.");
    expect(textOf(failed.root)).toContain("Try again now, and it won't create a second website.");
    expect(has(failed.root, "setup-draft-retry")).toBe(true);
    expect(has(failed.root, "setup-draft-tell")).toBe(true);
    expect(has(step({ kind: "failed", retry: "new_operation" }, false).root, "setup-draft-retry")).toBe(false);
  });

  it("the list shows each status in words, not only colour; a tick only when nothing is open", () => {
    const { steps } = setupSteps({
      setupStatus: { doneCount: 1, nextPart: "brand", total: 8, parts: [
        { key: "offer", done: true, skipped: false, fieldCount: 1, openFields: [] },
        { key: "brand", done: false, skipped: false, fieldCount: 10, openFields: ["a", "b", "c"] },
        { key: "first_offering", done: false, skipped: true, fieldCount: 0, openFields: [] },
      ] },
      fields: [],
      draftFailed: true,
      publishFailed: false,
    });
    const tree = mount(<SetupStepList steps={steps} active="brand" canManage published={false} onSelect={noop} />);
    expect(textOf(tree.root.findAll((n) => n.props.testID === "setup-step-brand-meta")[0])).toContain("3 left");
    expect(textOf(tree.root.findAll((n) => n.props.testID === "setup-step-first_offering-meta")[0])).toContain("Skipped");
    expect(textOf(tree.root.findAll((n) => n.props.testID === "setup-step-build-meta")[0])).toContain("Didn't work");
    expect(has(tree.root, "setup-step-offer-meta")).toBe(false);
    // Below rank 50, owner steps are labelled.
    const member = mount(<SetupStepList steps={steps} active="brand" canManage={false} published={false} onSelect={noop} />);
    expect(textOf(member.root.findAll((n) => n.props.testID === "setup-step-approve-meta")[0])).toContain("Admin");
  });
});

const fieldRow = (key: string, label: string, state: string, requirement = "recommended") => ({
  key, label, group: "Brand", requirement, state, value: state === "verified" ? "Lantern Room" : null,
  sourceType: null, sourceRef: null, sourceUrl: null, observedAt: null, ownerConfirmedAt: null, exceptionReason: null, humanActionRequired: false,
});
const planWith = (fields: ReturnType<typeof fieldRow>[]) => ({
  completeness: { contextRevision: "c".repeat(64), fields },
}) as unknown as SitePlanState;

describe("T-UI-2 brand details in place", () => {
  beforeEach(() => mockUpdate.mockReset());

  const emailStep = () => mount(
    <SetupBrandStep
      brandId="b"
      plan={planWith([fieldRow("name", "Brand name", "verified", "required"), fieldRow("contact_email", "Contact email", "missing")])}
      readOnly={false}
      hotField={null}
      onNext={noop}
      nextStepLabel="Choose your design"
    />,
  );

  it("saved rows and open fields; doesn't-apply only on the exception keys", () => {
    const tree = emailStep();
    expect(has(tree.root, "setup-saved-name")).toBe(true);
    expect(has(tree.root, "setup-field-contact_email")).toBe(true);
    expect(has(tree.root, "setup-not-applicable")).toBe(true);
    const required = mount(
      <SetupBrandStep brandId="b" plan={planWith([fieldRow("name", "Brand name", "missing", "required")])} readOnly={false} hotField={null} onNext={noop} nextStepLabel={null} />,
    );
    expect(has(required.root, "setup-not-applicable")).toBe(false);
  });

  it("a failed save keeps the text, says so, and Try again sends it again", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("offline"));
    const tree = emailStep();
    const input = tree.root.findAll((n) => n.props.testID === "setup-field-contact_email" && typeof n.props.onChangeText === "function")[0];
    act(() => input.props.onChangeText("hello@lantern.test"));
    const live = () => tree.root.findAll((n) => n.props.testID === "setup-field-contact_email" && typeof n.props.onBlur === "function")[0];
    await act(async () => { live().props.onBlur(); });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].patch).toEqual({ contact: { email: "hello@lantern.test" } });
    expect(textOf(tree.root)).toContain("That didn't save");
    expect(live().props.value).toBe("hello@lantern.test");
    mockUpdate.mockResolvedValueOnce({});
    await act(async () => { pressable(tree.root, "setup-retry-contact_email").props.onPress(); });
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(textOf(tree.root)).not.toContain("That didn't save");
  });

  it("a bad email never reaches the server", async () => {
    const tree = emailStep();
    const input = tree.root.findAll((n) => n.props.testID === "setup-field-contact_email" && typeof n.props.onChangeText === "function")[0];
    act(() => input.props.onChangeText("12 High Street"));
    await act(async () => {
      tree.root.findAll((n) => n.props.testID === "setup-field-contact_email" && typeof n.props.onBlur === "function")[0].props.onBlur();
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("T-DRAFT-2 useSetupDraft", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockProvision.mockReset();
    mockCompose.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  type Args = Parameters<typeof useSetupDraft>[0];
  function harness(args: Partial<Args>) {
    const seen: { current: ReturnType<typeof useSetupDraft> | null } = { current: null };
    const refetchSite = jest.fn();
    const Probe = (props: Partial<Args>) => {
      seen.current = useSetupDraft({ brandId: "b", site: null, refetchSite, approved: true, buildDone: false, canManage: true, ...args, ...props });
      return null;
    };
    const tree = mount(<Probe />);
    return { seen, tree, refetchSite, rerender: (props: Partial<Args>) => act(() => {
      tree.update(<QueryClientProvider client={new QueryClient()}><Probe {...props} /></QueryClientProvider>);
    }) };
  }
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
  const ambiguous = {
    status: "provisioning",
    latest_provision_operation: { operation_id: "stuck-op", status: "ambiguous", updated_at: new Date().toISOString() },
  };

  it("an unclear result replays the SAME operation, at most three times", async () => {
    mockProvision.mockResolvedValue({});
    const { seen } = harness({ site: ambiguous });
    expect(seen.current?.state).toEqual({ kind: "checking" });
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { jest.advanceTimersByTime(20_000); });
      await flush();
    }
    expect(mockProvision).toHaveBeenCalledTimes(3);
    for (const call of mockProvision.mock.calls) expect(call).toEqual(["b", "stuck-op"]);
  });

  it("a 503 or timeout lands in checking, never failed", async () => {
    mockProvision.mockRejectedValue(new Error("timeout"));
    const { seen } = harness({ site: null });
    expect(seen.current?.state).toEqual({ kind: "can_start" });
    await act(async () => { seen.current?.start(); });
    await flush();
    expect(seen.current?.state).toEqual({ kind: "checking" });
    expect(mockProvision).toHaveBeenCalledWith("b", "new-op");
  });

  it("Try again on a stale receipt reuses its id; a failed one mints a new one", async () => {
    mockProvision.mockResolvedValue({});
    const old = new Date(Date.now() - 6 * 60_000).toISOString();
    const stale = harness({ site: { status: "provisioning", latest_provision_operation: { operation_id: "stuck-op", status: "executing", updated_at: old } } });
    expect(stale.seen.current?.state).toEqual({ kind: "failed", retry: "same_operation" });
    await act(async () => { stale.seen.current?.retry(); });
    expect(mockProvision).toHaveBeenLastCalledWith("b", "stuck-op");
    const failed = harness({ site: { status: "error" } });
    await act(async () => { failed.seen.current?.retry(); });
    expect(mockProvision).toHaveBeenLastCalledWith("b", "new-op");
  });

  it("composes once per visit, never while provisioning, and a failure retries compose only", async () => {
    mockCompose.mockRejectedValue(new Error("no"));
    const provisioning = harness({ site: ambiguous });
    await flush();
    expect(mockCompose).not.toHaveBeenCalled();
    provisioning.tree.unmount();

    const { seen, rerender } = harness({ site: { status: "draft" } });
    await flush();
    expect(mockCompose).toHaveBeenCalledTimes(1);
    rerender({ site: { status: "draft" } });
    await flush();
    expect(seen.current?.state).toEqual({ kind: "failed", retry: "compose" });
    mockCompose.mockResolvedValue({});
    await act(async () => { seen.current?.retry(); });
    expect(mockCompose).toHaveBeenCalledTimes(2);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  // Found on production: provision recovered, compose never ran, the site was
  // `draft` with one empty Home page and built_at null under "Draft ready".
  it("provision succeeded and compose not run: not ready, and it composes by itself", async () => {
    mockCompose.mockResolvedValue({});
    const { seen } = harness({ site: { status: "draft" }, buildDone: false });
    expect(seen.current?.state.kind).not.toBe("ready");
    await flush();
    expect(mockCompose).toHaveBeenCalledTimes(1);
  });

  it("state 10 only follows the server's build tick; a stuck site recovered continues into compose", async () => {
    mockCompose.mockResolvedValue({});
    const { seen, rerender } = harness({ site: ambiguous, buildDone: false });
    await flush();
    expect(mockCompose).not.toHaveBeenCalled();
    rerender({ site: { status: "draft" }, buildDone: false });
    await flush();
    expect(mockCompose).toHaveBeenCalledTimes(1);
    expect(seen.current?.state.kind).not.toBe("ready");
    rerender({ site: { status: "draft" }, buildDone: true });
    expect(seen.current?.state).toEqual({ kind: "ready" });
  });

  it("a compose that returned but left the plan unbuilt is the failed state, with retry", async () => {
    mockCompose.mockResolvedValue({});
    const client = new QueryClient();
    client.setQueryData(["brand-sites", "b", "plan"], {
      setupStatus: { parts: [{ key: "build", done: false, skipped: false, fieldCount: 0, openFields: [] }] },
      parts: [],
    });
    const seen: { current: ReturnType<typeof useSetupDraft> | null } = { current: null };
    const Probe = () => {
      seen.current = useSetupDraft({ brandId: "b", site: { status: "draft" }, refetchSite: noop, approved: true, buildDone: false, canManage: true });
      return null;
    };
    act(() => { create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
    await flush();
    await flush();
    expect(mockCompose).toHaveBeenCalledTimes(1);
    expect(seen.current?.state).toEqual({ kind: "failed", retry: "compose" });
  });

  // Tester's P2: PLAN_NOT_READY on Try again read "on our side, not your answers".
  it("a refusal Core named is said as itself, not as our fault, and is not 'checking'", async () => {
    const { BrandSitesError } = jest.requireMock("../../../../services/brandSitesService") as { BrandSitesError: new (code: string, message: string, retryable: boolean) => Error };
    mockProvision.mockRejectedValue(new BrandSitesError("PLAN_NOT_READY", "Approve your plan first.", false));
    const { seen } = harness({ site: { status: "error" } });
    await act(async () => { seen.current?.retry(); });
    await flush();
    expect(seen.current?.refusal).toBe("Approve your plan first.");
    expect(seen.current?.state.kind).not.toBe("checking");
    const step = mount(
      <SetupDraftStep brandId="b" brandName="Lantern Room" state={{ kind: "failed", retry: "new_operation" }} canManage refusal="Approve your plan first." nextStep="approve" onStart={noop} onRetry={noop} onTellMingla={noop} onDone={noop} />,
    );
    const text = textOf(step.root);
    expect(text).toContain("Approve your plan first.");
    expect(text).not.toContain("on our side");
    expect(has(step.root, "setup-draft-missing")).toBe(true);
    // Refused from the idle card too: it never just shows nothing.
    const idle = mount(
      <SetupDraftStep brandId="b" brandName="Lantern Room" state={{ kind: "can_start" }} canManage refusal="Approve your plan first." onStart={noop} onRetry={noop} onTellMingla={noop} onDone={noop} />,
    );
    expect(textOf(idle.root)).toContain("Approve your plan first.");
  });

  it("someone else holding the form is not a failed compose", async () => {
    const { BrandSitesError } = jest.requireMock("../../../../services/brandSitesService") as { BrandSitesError: new (code: string, message: string, retryable: boolean) => Error };
    mockCompose.mockRejectedValue(new BrandSitesError("PLAN_LOCKED", "Locked", false));
    const { seen } = harness({ site: { status: "draft" } });
    await flush();
    expect(seen.current?.state.kind).not.toBe("failed");
  });

  it("no second compose or provision for someone who can't manage", async () => {
    harness({ site: { status: "draft" }, canManage: false });
    await flush();
    expect(mockCompose).not.toHaveBeenCalled();
  });
});
