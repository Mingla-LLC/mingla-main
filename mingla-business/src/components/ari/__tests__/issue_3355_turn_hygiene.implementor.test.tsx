/**
 * #3355 P1 — Ari turn and confirm hygiene on the Host (implementor happy paths).
 *
 * 1. The confirmation card for a write with no dedicated layout shows owner
 *    words — the server presentation when present, else the Host table and
 *    plumbing filter — never the tool name, a revision, a hash or an id (D-5).
 * 2. The cards that used to print plumbing (Website site tools' "Expected
 *    revision", currency "State version", team ids) no longer do (D-5).
 * 3. A deterministic refusal never offers a Retry that replays it; today's
 *    cap names its real reset time and offers Retry once it passes; a turn the
 *    server refused before accepting it is retried under a fresh id (D-1).
 *
 * Mounts the real ToolProposalCard; only native-only leaves are stubbed.
 */
import React from "react";

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../services/lazyHostAdPlanService", () => ({
  loadHostAdPlanService: async () => ({ loadHostAdSetup: async () => null }),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({
  CoverPickerSheet: "CoverPickerSheet",
}));
jest.mock("../../ui/GlassChrome", () => ({
  GlassChrome: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../AriOrb", () => ({ AriOrb: "AriOrb" }));
jest.mock("../ToolEditForm", () => ({
  ToolEditForm: "ToolEditForm",
  isToolProposalEditable: () => false,
}));
jest.mock("../../../hooks/useBrands", () => ({
  useBrandCascadePreview: () => ({ data: null, isLoading: false }),
}));
jest.mock("../../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: jest.fn(),
}));
jest.mock("lucide-react-native", () => ({
  AlertTriangle: "AlertTriangle",
  Pencil: "Pencil",
  Play: "Play",
  Plus: "Plus",
  X: "X",
}));

// eslint-disable-next-line import/first
import { ToolProposalCard } from "../ToolProposalCard";
// eslint-disable-next-line import/first
import {
  isOwnerSafeLabel,
  ownerSafeProposalFields,
  readServerPresentation,
  toolProposalOwnerCopy,
} from "../toolProposalCopy";
// eslint-disable-next-line import/first
import {
  ariRateLimitCopy,
  ariRetryNeedsFreshTurn,
  ariTurnRetryAllowed,
} from "../../../hooks/ariTurnRetryPolicy";

const BRAND = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

const PLUMBING = {
  brand_id: BRAND,
  trip_id: "22222222-2222-4222-8222-222222222222",
  expected_plan_revision: 7,
  expected_context_revision: HASH,
  client_revision: 3,
  expected_state_version: 4,
  confirm_phrase: "CHARGE",
};

const visibleText = (
  renderer: ReturnType<typeof TestRenderer.create>,
): string =>
  renderer.root
    .findAll((node) => node.type === "Text")
    .map((node) => node.props.children)
    .flat(Infinity)
    .filter((value): value is string => typeof value === "string")
    .join(" | ");

const mount = async (toolName: string, args: Record<string, unknown>) => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <ToolProposalCard
        toolName={toolName}
        args={args}
        isExecuting={false}
        onConfirm={async () => ({ ok: true })}
        onCancel={() => undefined}
        proposalId="33333333-3333-4333-8333-333333333333"
      />,
    );
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  return renderer;
};

const LEAKS = [
  /manage[ _]trip[ _]tiers/i,
  /revision/i,
  /state version/i,
  /aaaaaaaaaaaaaaaa/,
  /11111111/,
  /22222222/,
  /CHARGE/,
];

describe("#3355 D-5 the confirmation card shows owner words only", () => {
  it("renders the server presentation for a write with no dedicated layout", async () => {
    const renderer = await mount("manage_trip_tiers", {
      ...PLUMBING,
      tiers: [{ name: "Early bird" }],
      __proposal_context: {
        presentation: {
          version: 1,
          verb: "Update trip prices",
          title: "Lagos to Accra",
          fields: [
            { label: "Price options", value: "1 item" },
            { label: "Expected plan revision", value: "7" },
            { label: "Trip", value: BRAND },
          ],
        },
      },
    });
    const text = visibleText(renderer);
    expect(text.toLowerCase()).toContain("update trip prices");
    expect(text).toContain("Lagos to Accra");
    expect(text).toContain("Price options");
    for (const leak of LEAKS) expect(text).not.toMatch(leak);
    renderer.unmount();
  });

  it("falls back to the Host table and plumbing filter for an older proposal", async () => {
    const renderer = await mount("manage_trip_tiers", {
      ...PLUMBING,
      door_mode: "door_only",
    });
    const text = visibleText(renderer);
    expect(text.toLowerCase()).toContain("update trip prices");
    expect(text).toContain("Door only");
    for (const leak of LEAKS) expect(text).not.toMatch(leak);
    renderer.unmount();
  });

  it("no longer prints revisions, state versions or team ids on dedicated cards", async () => {
    for (const [toolName, args] of [
      ["publish_site", { brand_id: BRAND, expected_revision: HASH }],
      [
        "manage_brand_discovery_currency",
        { currency_code: "ngn", expected_state_version: 4 },
      ],
      [
        "revoke_brand_invitation",
        {
          brand_id: BRAND,
          invitation_id: "44444444-4444-4444-8444-444444444444",
        },
      ],
      [
        "revoke_brand_member",
        { brand_id: BRAND, member_id: "55555555-5555-4555-8555-555555555555" },
      ],
    ] as const) {
      const renderer = await mount(toolName, args as Record<string, unknown>);
      const text = visibleText(renderer);
      expect(text).not.toMatch(
        /revision|state version|44444444|55555555|aaaaaaaa/i,
      );
      renderer.unmount();
    }
  });

  it("gates server presentations and raw fields the same way the server does", () => {
    expect(
      readServerPresentation({
        __proposal_context: {
          presentation: { verb: "manage_trip_tiers", title: "x", fields: [] },
        },
      }),
    ).toBeNull();
    expect(toolProposalOwnerCopy("publish_trip").verb).toBe("Publish trip");
    expect(toolProposalOwnerCopy("not_a_tool").verb).toBe("Review this change");
    expect(isOwnerSafeLabel("Expected plan revision")).toBe(false);
    expect(isOwnerSafeLabel("get_site_plan")).toBe(false);
    expect(isOwnerSafeLabel("Price options")).toBe(true);
    const fields = ownerSafeProposalFields({
      ...PLUMBING,
      title: "Night",
      instagram: "@seth_ogieva",
    });
    expect(fields).toEqual([
      { label: "Title", value: "Night" },
      { label: "Instagram", value: "@seth_ogieva" },
    ]);
  });
});

describe("#3355 D-1 Retry never replays a deterministic refusal", () => {
  const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

  it("hides Retry for deterministic refusals and shows it for transport failures", () => {
    for (const code of [
      "CHOICE_STALE",
      "DOMAIN_ACTION_REFUSED",
      "PROPOSAL_EXPIRED",
      "STALE_PROPOSAL",
    ]) {
      expect(ariTurnRetryAllowed(code, null, NOW)).toBe(false);
    }
    expect(ariTurnRetryAllowed("TRANSPORT_UNAVAILABLE", null, NOW)).toBe(true);
    expect(ariTurnRetryAllowed("INTERNAL", null, NOW)).toBe(true);
  });

  it("offers Retry for today's cap only once the server's reset time has passed", () => {
    const resetAt = NOW + 3 * 3600 * 1000;
    expect(ariTurnRetryAllowed("RATE_LIMITED", resetAt, NOW)).toBe(false);
    expect(ariTurnRetryAllowed("RATE_LIMITED", resetAt, resetAt + 1)).toBe(
      true,
    );
    const copy = ariRateLimitCopy(3 * 3600, NOW);
    expect(copy).toMatch(/You can send again at /);
    expect(copy).not.toMatch(/24 hours/);
  });

  it("retries a deterministic pre-acceptance refusal as a fresh attempt; transient failures keep their id", () => {
    expect(
      ariRetryNeedsFreshTurn({ accepted: false, errorCode: "RATE_LIMITED" }),
    ).toBe(true);
    expect(
      ariRetryNeedsFreshTurn({
        accepted: false,
        errorCode: "TRANSPORT_UNAVAILABLE",
      }),
    ).toBe(false);
    expect(
      ariRetryNeedsFreshTurn({
        accepted: false,
        errorCode: "STOP_BEFORE_ACCEPTANCE",
      }),
    ).toBe(false);
    expect(
      ariRetryNeedsFreshTurn({
        accepted: false,
        errorCode: "TENANT_SCOPE_UNAVAILABLE",
      }),
    ).toBe(false);
    expect(
      ariRetryNeedsFreshTurn({ accepted: true, errorCode: "INTERNAL" }),
    ).toBe(false);
  });
});
