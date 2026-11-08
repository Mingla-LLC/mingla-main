/**
 * #4304 — Ari's pause / resume / end discount cards name the discount from the
 * server's proposal context (`discount_name`, set by preflightDiscountProposal
 * in agent-chat). Mounts the real ToolProposalCard.
 * FAILS ON REVERT: drop the Discount row for any of the three tools.
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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../services/lazyHostAdPlanService", () => ({
  loadHostAdPlanService: () => new Promise(() => undefined),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({ CoverPickerSheet: "CoverPickerSheet" }));
jest.mock("../../ui/GlassChrome", () => ({
  GlassChrome: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../AriOrb", () => ({ AriOrb: "AriOrb" }));
jest.mock("../ToolEditForm", () => ({ ToolEditForm: "ToolEditForm", isToolProposalEditable: () => false }));
jest.mock("../../../hooks/useBrands", () => ({ useBrandCascadePreview: () => ({ data: null, isLoading: false }) }));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("lucide-react-native", () => ({
  AlertTriangle: "AlertTriangle", Pencil: "Pencil", Play: "Play", Plus: "Plus", X: "X",
}));

// eslint-disable-next-line import/first
import { ToolProposalCard } from "../ToolProposalCard";

const ARGS = {
  brand_id: "6f7d1c52-0d4e-4a43-9a0e-1f6b7f2a9b10",
  discount_id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
  version: 3,
  __proposal_context: { discount_name: "TEST10" },
};

const mount = async (toolName: string) => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <ToolProposalCard
        toolName={toolName}
        args={ARGS}
        isExecuting={false}
        onConfirm={async () => ({ ok: true })}
        onCancel={() => undefined}
        proposalId="33333333-3333-4333-8333-333333333333"
      />,
    );
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  return renderer;
};

const fieldValue = (renderer: ReturnType<typeof TestRenderer.create>, label: string): unknown => {
  const texts = renderer.root.findAll((node) => node.type === "Text").map((node) => node.props.children);
  const at = texts.findIndex((value) => value === label);
  return at === -1 ? undefined : texts[at + 1];
};

describe("#4304 Ari's discount status cards name the discount", () => {
  it.each(["pause_discount", "resume_discount", "end_discount"])(
    "%s shows the Discount row from the server context",
    async (toolName) => {
      const renderer = await mount(toolName);
      expect(fieldValue(renderer, "Discount")).toBe("TEST10");
      renderer.unmount();
    },
  );
});
