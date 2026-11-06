/**
 * #2830 tester — the angles the implementor's screen tests do not take: a tap on
 * Next that never blurs (native), every surface that still counts by the old
 * rule, hostile return paths, and a paused or foreign site reaching compose.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";

const mockUpdate = jest.fn();

jest.mock("../../website/WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() } }));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true, user: { id: "u" } }) }));
jest.mock("../../../../hooks/useBrands", () => ({
  useBrand: () => ({ isLoading: false, data: { id: "b", displayName: "", contact: {}, links: {} } }),
  useUpdateBrand: () => ({ mutateAsync: mockUpdate }),
}));
jest.mock("../../../theme/ThemeControlRow", () => ({ ThemeControlRow: () => null }));
jest.mock("../../../theme/ThemeSheet", () => ({ ThemeSheet: () => null }));
jest.mock("../../../ui/Input", () => ({ Input: () => null, PHONE_COUNTRIES: [] }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetupBrandStep } from "../SetupBrandStep";
import { setupDraftState, setupPresence, setupSteps } from "../../../../sites/setupStatus";
import { isSetupReturn } from "../../../../utils/brandEditReturn";
import { websiteTodoFor } from "../../../../sites/websiteTodo";
import type { SitePlanState } from "../../../../sites/sitePlanState";

type TestNode = { props: Record<string, any>; findAll: (test: (node: TestNode) => boolean) => TestNode[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => unknown) => Promise<void>;
  create: (node: React.ReactElement) => { root: TestNode };
};
const ROOT = path.resolve(__dirname, "../../../../..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("a field is saved on Next, even when the tap does not blur it (native)", () => {
  it("Next sends what was typed", async () => {
    mockUpdate.mockReset().mockResolvedValue({});
    const plan = {
      completeness: {
        contextRevision: "r",
        fields: [
          { key: "contact_email", label: "Contact email", state: "missing", requirement: "recommended", humanActionRequired: false },
          { key: "name", label: "Name", state: "missing", requirement: "required", humanActionRequired: false },
        ],
      },
    } as unknown as SitePlanState;
    let tree!: { root: TestNode };
    await act(async () => {
      tree = create(
        <QueryClientProvider client={new QueryClient()}>
          <SetupBrandStep brandId="b" plan={plan} readOnly={false} hotField={null} onNext={() => undefined} nextStepLabel="Your design" />
        </QueryClientProvider>,
      );
    });
    const input = tree.root.findAll((n) => typeof n.props.onChangeText === "function" && /name/i.test(String(n.props.testID ?? n.props.label ?? "")))[0];
    await act(async () => { input.props.onChangeText("Lantern Room"); });
    const next = tree.root.findAll((n) => n.props.testID === "setup-next" && typeof n.props.onPress === "function")[0];
    await act(async () => { next.props.onPress(); });
    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe("one status: no surface counts by the old rule", () => {
  it("the phone Website card reads the same number as the setup screen", () => {
    expect(read("src/components/sites/website/WebsiteApp.tsx")).not.toMatch(/\$\{ctx\.plan\.doneCount\} of/);
  });
  it("Overview's 'Next:' comes from the same status as its count", () => {
    expect(read("src/components/sites/website/sections/OverviewSection.tsx")).not.toMatch(/const next = plan\?\.parts\.find\(\(part\) => !part\.done\)/);
  });
  it("Home's to-do uses setup_status, not the old tick", () => {
    const todo = websiteTodoFor("b", {
      entitled: true, can_manage: true, plan: { revision: 1 },
      status: { done_count: 5, next_part: "story" },
      setup_status: { done_count: 1, next_part: "brand" },
    });
    expect(todo).toMatchObject({ variant: "finish", done: 1, route: "/brand/b/website/setup" });
  });
  it("a tick never comes from the fallback for a part with open fields", () => {
    const { steps, doneCount } = setupSteps({
      setupStatus: { doneCount: 1, nextPart: "brand", total: 8, parts: [
        { key: "brand", done: false, skipped: false, fieldCount: 10, openFields: ["contact_email"] },
      ] },
      fallbackParts: [{ key: "brand", done: true, skipped: false }],
      fields: [],
      draftFailed: false,
      publishFailed: false,
    });
    expect(steps.find((step) => step.key === "brand")?.status.kind).not.toBe("done");
    expect(doneCount).toBe(0);
  });
});

describe("the way back", () => {
  it.each([
    "https://evil.example/brand/b/website/setup",
    "//evil.example/brand/b/website/setup",
    "/\\evil.example/brand/b/website/setup",
    "\\\\evil.example",
    "javascript:alert(1)//brand/b/website/setup",
    "/brand/b/website/setup/../../../../auth",
    "/brand/b/website/setupx",
    "/brand//website/setup",
    "/brand/b/website/setup#https://evil.example",
    " /brand/b/website/setup",
    "/brand/b/website/setup\n",
    "/brand/b/website/plan",
    "/event/create",
    "",
  ])("%j is refused", (value) => {
    expect(isSetupReturn(value)).toBe(false);
  });
  it.each([[null], [undefined], [42], [["/brand/b/website/setup"]], [{}]])("%j is refused", (value) => {
    expect(isSetupReturn(value)).toBe(false);
  });
  it("a path that walks out of the brand is refused", () => {
    expect(isSetupReturn("/brand/../website/setup")).toBe(false);
    expect(isSetupReturn("/brand/%2e%2e/website/setup")).toBe(false);
  });
});

describe("draft states on shapes production really has", () => {
  const base = { buildDone: false, approved: true, composePending: false, composeFailed: false, ensurePending: false, now: Date.parse("2026-11-05T12:00:00Z") };
  it("stuck provisioning for 15 hours is failed and replays its own operation", () => {
    expect(setupDraftState({ ...base, site: {
      status: "provisioning",
      latest_provision_operation: { operation_id: "op", status: "ambiguous", updated_at: "2026-11-04T21:00:00Z" },
    } })).toEqual({ kind: "failed", retry: "same_operation" });
  });
  it("provisioned and never composed is not ready", () => {
    expect(setupDraftState({ ...base, site: { status: "ready" } }).kind).not.toBe("ready");
  });
  it("a paused site never reads as building", () => {
    expect(setupDraftState({ ...base, site: { status: "suspended" } }).kind).not.toBe("building");
  });
  it("a corrupt receipt date is never a tick", () => {
    expect(setupDraftState({ ...base, site: {
      status: "provisioning", latest_provision_operation: { operation_id: "op", status: "executing", updated_at: "not a date" },
    } }).kind).toBe("failed");
  });
});

describe("presence", () => {
  const flow = { runId: "r", status: "awaiting_owner", stepKey: "brand", revision: 3, mine: false, stopped: true, ownerName: "Ada", ownerSince: null, lastActivityAt: null, conversationId: null, canTakeOver: true, lastTakeover: null };
  it("a live form beats a stale run: nobody continues over someone typing", () => {
    expect(setupPresence({ paused: false, flow, lock: { active: true, heldByMe: false, holderName: "Tayo" }, canManage: true, wasMine: false }).kind).toBe("active");
  });
  it("rank 40 never gets a take over", () => {
    const seen = setupPresence({ paused: false, flow: { ...flow, stopped: false }, lock: null, canManage: false, wasMine: false });
    expect(seen).toMatchObject({ kind: "active", canTakeOver: false });
  });
  it("a teammate starting after my lock lapsed is not a takeover of me", () => {
    // wasMine came from my own by-hand lock, which expired while I was idle.
    const seen = setupPresence({ paused: false, flow: { ...flow, stopped: false }, lock: { active: false, heldByMe: false, holderName: null }, canManage: true, wasMine: true });
    expect(seen.kind).toBe("active");
  });
});
