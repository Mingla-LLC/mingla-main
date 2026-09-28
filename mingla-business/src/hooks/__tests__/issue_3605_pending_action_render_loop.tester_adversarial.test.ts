/**
 * issue #3605 — adversarial guard for the OTHER half of the bug.
 *
 * Different angle from the implementor test on purpose: that one proves the
 * transcript Ari sends to Gemini is a shape the provider accepts. This one
 * proves the Ari chat cannot re-enter React error #185 ("maximum update depth
 * exceeded") while a website write proposal is on screen — which is precisely
 * the state the backend fix unblocks, and therefore the state that had never
 * been reachable long enough to expose the loop.
 *
 * The loop: `useAgentChat`'s pending-action effect depends on `serverMessages`,
 * which is `messagesQuery.data ?? []` and therefore identity-fresh on any
 * render where the query has no data. Handing React a brand-new object literal
 * on every run of that effect is a state change on every run, and a state
 * change on every run is a render on every run. Nothing in either file looks
 * cyclic; the cycle is in the identities.
 *
 * Adversarial coverage — both lazy "fixes" must fail here:
 *   - "always return the current value" is caught by the edited-proposal case;
 *   - "always return the new object" is caught by the render-count case.
 *
 * Fails-on-revert: restoring `setPendingAction(unresolved)` (and deleting
 * `samePendingAction`) makes this file fail to resolve its import; restoring
 * the identity-unstable comparison (e.g. `a === b` only) makes the render-count
 * case report one render per iteration instead of one in total.
 */

jest.mock("react-native", () => ({ AppState: { addEventListener: jest.fn() } }), {
  virtual: true,
});
jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));
jest.mock("../../components/ui/useShareNetworkState", () => ({
  useShareNetworkState: jest.fn(),
}));
jest.mock("../../context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("../../services/agentChatService", () => ({
  fetchMessages: jest.fn(),
  sendAgentMessage: jest.fn(),
}));
jest.mock("../../services/ariAttachmentService", () => ({
  discardAriAttachment: jest.fn(),
}));
jest.mock("../../services/ariTurnService", () => ({
  fetchAriTurnStatus: jest.fn(),
  retryAriTurn: jest.fn(),
  stopAriTurn: jest.fn(),
  subscribeAriTurnActivity: jest.fn(),
}));
jest.mock("../../services/ariPolishAnalytics", () => ({
  captureAriActivityDisplayed: jest.fn(),
  captureAriTurnOutcome: jest.fn(),
}));

import { samePendingAction, type PendingActionView } from "../useAgentChat";

/** A website write proposal exactly as the confirmed-write path stores it. */
function websiteProposal(): PendingActionView {
  // Re-parsed from JSON on every call, the way a jsonb column arrives from a
  // refetch: value-identical, never reference-identical.
  return JSON.parse(
    JSON.stringify({
      pending_action_id: "0f2b2f0a-2f2a-4a1f-9a5d-8f8a7c6b5a40",
      tool_name: "propose_site_content_update",
      tool_args: {
        brand_id: "733bc470-45e1-4684-8896-acd7e26074ff",
        site_id: "90f19f28-42e2-4eb9-b88b-02829bfcb045",
        page_role: "about",
        expected_revision: "r7",
        changes: { seo: { description: "Open 24 hours, Lagos." } },
        change_summary: "Update the About page SEO description",
      },
    }),
  ) as PendingActionView;
}

/**
 * React's own bailout rule, modelled exactly: an updater whose result is
 * Object.is-equal to the current state does not schedule a render.
 */
function reactStateHarness(initial: PendingActionView | null) {
  let current = initial;
  let renders = 0;
  return {
    set(updater: (c: PendingActionView | null) => PendingActionView | null) {
      const next = updater(current);
      if (Object.is(next, current)) return;
      current = next;
      renders += 1;
    },
    get value() {
      return current;
    },
    get renders() {
      return renders;
    },
  };
}

describe("#3605 adversarial — the Ari pending-action slot cannot drive React #185", () => {
  it("re-running the effect 50 times with the same proposal schedules exactly ONE render", () => {
    const state = reactStateHarness(null);

    // Every iteration is a fresh parse of the identical row — the exact input
    // an identity-fresh `serverMessages` produced on every render.
    for (let i = 0; i < 50; i++) {
      const unresolved = websiteProposal();
      state.set((current) =>
        samePendingAction(current, unresolved) ? current : unresolved,
      );
    }

    expect(state.renders).toBe(1);
    expect(state.value?.tool_name).toBe("propose_site_content_update");
  });

  it("a conversation with NO proposal never schedules a render at all", () => {
    const state = reactStateHarness(null);
    for (let i = 0; i < 50; i++) {
      state.set((current) => (samePendingAction(current, null) ? current : null));
    }
    expect(state.renders).toBe(0);
    expect(state.value).toBeNull();
  });

  it("an EDITED proposal still re-renders — the guard must not freeze the card", () => {
    const state = reactStateHarness(websiteProposal());
    const edited = websiteProposal();
    (edited.tool_args as { changes: { seo: { description: string } } }).changes
      .seo.description = "Open until 2am, Lagos.";

    state.set((current) =>
      samePendingAction(current, edited) ? current : edited,
    );

    expect(state.renders).toBe(1);
    expect(
      (state.value?.tool_args as { changes: { seo: { description: string } } })
        .changes.seo.description,
    ).toBe("Open until 2am, Lagos.");
  });

  it("a DIFFERENT proposal id is never mistaken for the same one", () => {
    const first = websiteProposal();
    const second = websiteProposal();
    second.pending_action_id = "11111111-2222-3333-4444-555555555555";
    expect(samePendingAction(first, second)).toBe(false);

    const renamed = websiteProposal();
    renamed.tool_name = "propose_site_settings_update";
    expect(samePendingAction(first, renamed)).toBe(false);
  });

  it("null and a live proposal are never equal in either direction", () => {
    const proposal = websiteProposal();
    expect(samePendingAction(null, proposal)).toBe(false);
    expect(samePendingAction(proposal, null)).toBe(false);
    expect(samePendingAction(null, null)).toBe(true);
  });

  it("two independently parsed copies of one row are equal without being the same object", () => {
    const a = websiteProposal();
    const b = websiteProposal();
    expect(a).not.toBe(b);
    expect(samePendingAction(a, b)).toBe(true);
  });
});
