// issue #3284 [bundle budget] — implementor regression for the lazy refund
// boundaries that keep the refund work out of the business-web boot payload
// (`__common`, ORCH-1083).
//
// WHAT THIS FILE PINS
//   LE-*  LazyRefundPolicyEditor: the loading card (the editor's eyebrow over a
//         chip-row skeleton, no preset and no "no policy" copy) until the chunk is
//         in memory, then the real editor with the same props; a failed chunk load
//         is reported and shows the app's standard fallback, and Try again loads it;
//         once loaded, every later mount renders the editor on its first frame.
//   LW-*  refundPolicyWrites: a writer chunk that cannot load is the SAME outcome
//         as a request that never reached the server — `network_error` and the
//         unavailable copy for events and experiences, the writer's own
//         "Couldn't save policy. Try again." for trips — reported, with nothing
//         sent; a loaded chunk delegates to the real writer unchanged.
//   LL-*  LazyOfferingRefundLadder: nothing loads the ladder until a body mounts it
//         (no load at module evaluation), then it renders exactly the ladder's
//         output, and every later mount gets it on the first frame.
//   LB-*  The boundary itself: no app or package module imports the editor, the
//         writers or the ladder statically; only their one lazy owner loads each.
//         Its scanner is proven non-vacuous on a planted static import.
//
// FAILS-ON-REVERT: put back a static import of RefundPolicyEditor in any of the
// four editor sites, of refundPolicyService in any writer consumer, or of
// OfferingRefundLadder in a body or the barrel, and LB-1 goes red; drop the load
// failure mapping in refundPolicyWrites.ts and LW-1/LW-2 go red; drop the retry or
// the fallback in LazyRefundPolicyEditor.tsx and LE-1 goes red.

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<TestInstance | string>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------
// module boundaries: the network, native leaves, telemetry, and the two chunks
// under test (each can be told to fail its next N loads, like a dropped chunk)
// ---------------------------------------------------------------------------

let mockEditorLoadFailures = 0;
let mockWriterLoadFailures = 0;

jest.mock("../RefundPolicyEditor", () => {
  if (mockEditorLoadFailures > 0) {
    mockEditorLoadFailures -= 1;
    throw new Error("Loading chunk RefundPolicyEditor failed");
  }
  return jest.requireActual("../RefundPolicyEditor");
});
jest.mock("../../../services/refundPolicyService", () => {
  if (mockWriterLoadFailures > 0) {
    mockWriterLoadFailures -= 1;
    throw new Error("Loading chunk refundPolicyService failed");
  }
  return jest.requireActual("../../../services/refundPolicyService");
});

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();
const mockFrom = jest.fn<(table: string) => unknown>();
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    from: (table: string) => mockFrom(table),
  },
}));
const mockReportNonFatal = jest.fn();
jest.mock("../../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: (...args: unknown[]) => mockReportNonFatal(...args),
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", { ...props, testID: `button-${String(props.label)}` }),
}));
jest.mock("../../../../../packages/offering-rendering/LucideIcons", () => {
  const icon = (): null => null;
  return new Proxy({}, { get: () => icon });
});

// eslint-disable-next-line import/first
import {
  LazyRefundPolicyEditor,
  loadRefundPolicyEditor,
} from "../LazyRefundPolicyEditor";
// eslint-disable-next-line import/first
import { EVENT_STANDARD_POLICY } from "../../../services/refundPolicyModel";
// eslint-disable-next-line import/first
import {
  setOfferingRefundPolicy,
  updateBookingDeadline,
  updateRefundPolicy,
} from "../../../services/refundPolicyWrites";
// eslint-disable-next-line import/first
import {
  REFUND_TERMS_UNAVAILABLE_COPY,
  refundTermsSaveFailureCopy,
} from "../../../utils/refundPolicyTerms";
// eslint-disable-next-line import/first
import { OfferingRefundLadder } from "../../../../../packages/offering-rendering/OfferingRefundLadder";
// eslint-disable-next-line import/first
import { LazyOfferingRefundLadder } from "../../../../../packages/offering-rendering/LazyOfferingRefundLadder";

const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..", "..");

const collectText = (node: unknown): string[] => {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(collectText);
  if (node !== null && typeof node === "object") {
    const n = node as { children?: unknown };
    return collectText(n.children ?? []);
  }
  return [];
};
const textOf = (tree: Renderer): string => collectText(tree.toJSON()).join(" ");
const byTestId = (tree: Renderer, testID: string): TestInstance[] =>
  tree.root.findAll((n) => n.props.testID === testID && typeof n.type === "string");

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockReportNonFatal.mockReset();
});

// ===========================================================================
// LE — the lazy editor. Order matters: the chunk is module state, so LE-1 runs
// while it is still unloaded and LE-2 runs after.
// ===========================================================================

describe("#3284 LE — LazyRefundPolicyEditor", () => {
  test("LE-1 a failed chunk load is reported, shows the standard fallback, and Try again loads the editor", async () => {
    mockEditorLoadFailures = 1;
    const onChange = jest.fn();
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(
        <LazyRefundPolicyEditor offeringType="event" value={EVENT_STANDARD_POLICY} onChange={onChange} />,
      );
    });
    // Loading: the editor's own eyebrow over four skeleton chips, and nothing that
    // could be mistaken for the organiser's terms.
    expect(byTestId(tree, "refund-policy-editor-loading")).toHaveLength(1);
    expect(textOf(tree)).toBe("REFUND POLICY");
    expect(tree.root.findAll((n) => String(n.props.testID ?? "").startsWith("refund-policy-chip-"))).toHaveLength(0);

    await flush();
    expect(mockReportNonFatal).toHaveBeenCalledTimes(1);
    expect(mockReportNonFatal.mock.calls[0][0]).toBe("LazyRefundPolicyEditor");
    expect(textOf(tree)).toContain("Something broke.");
    expect(byTestId(tree, "refund-policy-editor-loading")).toHaveLength(0);

    const retry = tree.root.findAll((n) => n.props.testID === "button-Try again")[0];
    await act(async () => {
      (retry.props.onPress as () => void)();
    });
    await flush();
    const { RefundPolicyEditor } = await loadRefundPolicyEditor();
    const editors = tree.root.findAll((n) => n.type === RefundPolicyEditor);
    expect(editors).toHaveLength(1);
    expect(editors[0].props).toEqual({ offeringType: "event", value: EVENT_STANDARD_POLICY, onChange });
    expect(textOf(tree)).not.toContain("Something broke.");
    tree.unmount();
  });

  test("LE-2 once the chunk is in memory, a new mount renders the real editor on its FIRST frame", async () => {
    const { RefundPolicyEditor } = await loadRefundPolicyEditor();
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(
        <LazyRefundPolicyEditor value={null} onChange={jest.fn()} />,
      );
    });
    // No flush: the first committed frame already holds the editor.
    expect(tree.root.findAll((n) => n.type === RefundPolicyEditor)).toHaveLength(1);
    expect(byTestId(tree, "refund-policy-editor-loading")).toHaveLength(0);
    expect(byTestId(tree, "refund-policy-chip-standard").length).toBeGreaterThan(0);
    tree.unmount();
  });
});

// ===========================================================================
// LW — the lazy writers
// ===========================================================================

describe("#3284 LW — refundPolicyWrites", () => {
  // Order matters: a chunk that loads stays loaded, so the two failure cases run
  // before the first successful load (the offline half of LW-2).
  test("LW-1 a trip writer chunk that cannot load throws the writer's own typed failure, for both trip writers", async () => {
    mockWriterLoadFailures = 2;
    await expect(updateRefundPolicy("trip-1", EVENT_STANDARD_POLICY)).rejects.toMatchObject({
      code: "internal_error",
      message: "Couldn't save policy. Try again.",
    });
    await expect(updateBookingDeadline("trip-1", null)).rejects.toMatchObject({
      code: "internal_error",
      message: "Couldn't save policy. Try again.",
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockReportNonFatal).toHaveBeenCalledTimes(2);
  });

  test("LW-2 an event/experience writer chunk that cannot load is a network_error with the unavailable copy, and nothing is sent", async () => {
    mockWriterLoadFailures = 1;
    const result = await setOfferingRefundPolicy("evt-1", EVENT_STANDARD_POLICY, "Organiser changed terms");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("network_error");
    expect(refundTermsSaveFailureCopy(result.reason)).toBe(REFUND_TERMS_UNAVAILABLE_COPY);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockReportNonFatal).toHaveBeenCalledTimes(1);
    expect(mockReportNonFatal.mock.calls[0][0]).toBe("refundPolicyWrites");

    // The same outcome the loaded writer gives a request that never reached the server.
    mockRpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const offline = await setOfferingRefundPolicy("evt-1", EVENT_STANDARD_POLICY, "Organiser changed terms");
    expect(offline.ok).toBe(false);
    if (offline.ok) throw new Error("unreachable");
    expect(offline.reason).toBe(result.reason);
    expect(refundTermsSaveFailureCopy(offline.reason)).toBe(refundTermsSaveFailureCopy(result.reason));
  });

  test("LW-3 a loaded writer chunk delegates to the real gated writer unchanged", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, refundPolicy: EVENT_STANDARD_POLICY }, error: null });
    await expect(setOfferingRefundPolicy("evt-2", EVENT_STANDARD_POLICY, null)).resolves.toEqual({
      ok: true,
      refundPolicy: EVENT_STANDARD_POLICY,
    });
    expect(mockRpc).toHaveBeenCalledWith("business_patch_offering_refund_policy", {
      p_event_id: "evt-2",
      p_policy: EVENT_STANDARD_POLICY,
      p_reason: null,
    });
    expect(mockReportNonFatal).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// LL — the lazy ladder
// ===========================================================================

describe("#3284 LL — LazyOfferingRefundLadder", () => {
  const palette = {
    page: "#fffaf5",
    accent: "#ae591b",
    accentText: "#ffffff",
    primaryText: "#101418",
    secondaryText: "#3a3f47",
    tertiaryText: "#8a8f99",
    panel: "#ffffff",
    panelStrong: "#ffffff",
    panelBorder: "#e6e0da",
    card: "#fcfbfb",
    cutoutBorder: "#eeeeee",
    glass: "#ffffff",
    glassTint: "light",
    accentWash: "#fbeee3",
  } as never;
  const surface = {
    card: { backgroundColor: "#fcfbfb" },
    primaryText: { color: "#101418" },
    secondaryText: { color: "#3a3f47" },
    tertiaryText: { color: "#8a8f99" },
  } as never;

  test("LL-1 nothing loads the ladder before a body mounts it; then it renders exactly the ladder's output, and later mounts get it on the first frame", async () => {
    const props = {
      policy: EVENT_STANDARD_POLICY,
      offeringType: "event" as const,
      hostName: "Sunset Collective",
      palette,
      surface,
    };
    let direct!: Renderer;
    let lazy!: Renderer;
    act(() => {
      direct = TestRenderer.create(<OfferingRefundLadder {...props} />);
      lazy = TestRenderer.create(<LazyOfferingRefundLadder {...props} />);
    });
    // First mount in this file: had anything loaded the chunk when the module was
    // evaluated (the business-web bodies are evaluated at boot on every route), the
    // ladder would already be here.
    expect(lazy.toJSON()).toBeNull();
    await flush();
    expect(textOf(lazy)).toContain("Cancellation policy");
    expect(lazy.toJSON()).toEqual(direct.toJSON());

    let again!: Renderer;
    act(() => {
      again = TestRenderer.create(<LazyOfferingRefundLadder {...props} />);
    });
    expect(again.toJSON()).toEqual(direct.toJSON());
  });
});

// ===========================================================================
// LB — the boundary
// ===========================================================================

const LAZY_TARGETS = [
  { name: "RefundPolicyEditor", owner: "mingla-business/src/components/trip/LazyRefundPolicyEditor.tsx" },
  { name: "refundPolicyService", owner: "mingla-business/src/services/refundPolicyWrites.ts" },
  { name: "OfferingRefundLadder", owner: "packages/offering-rendering/LazyOfferingRefundLadder.tsx" },
] as const;

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

interface BoundaryViolation {
  file: string;
  target: string;
  kind: "static import" | "value re-export" | "dynamic import outside its owner";
}

/** Static value imports, value re-exports and runtime import() of the lazy targets. */
const scanForBoundaryViolations = (file: string, raw: string): BoundaryViolation[] => {
  const src = stripComments(raw);
  const out: BoundaryViolation[] = [];
  for (const { name, owner } of LAZY_TARGETS) {
    const spec = `["'][^"']*/${name}["']`;
    const statics = src.matchAll(new RegExp(`\\b(import|export)\\s+(type\\s+)?([^;]*?)\\s+from\\s+${spec}`, "g"));
    for (const match of statics) {
      if (match[2] !== undefined) continue; // `import type` / `export type`
      const clause = match[3].trim();
      const braces = /^\{([\s\S]*)\}$/.exec(clause);
      const allTypes =
        braces !== null &&
        braces[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .every((s) => s.startsWith("type "));
      if (allTypes) continue;
      out.push({ file, target: name, kind: match[1] === "import" ? "static import" : "value re-export" });
    }
    // A runtime import() — `typeof import("…")` and `import("…").Type` are types.
    const dynamics = src.matchAll(new RegExp(`(typeof\\s+)?\\bimport\\(\\s*${spec}\\s*\\)(\\.[A-Za-z])?`, "g"));
    for (const match of dynamics) {
      if (match[1] !== undefined || match[2] !== undefined) continue;
      if (file !== owner) out.push({ file, target: name, kind: "dynamic import outside its owner" });
    }
  }
  return out;
};

const listSourceFiles = (dir: string): string[] => {
  const abs = path.join(REPO_ROOT, dir);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  walk(abs);
  return found;
};

describe("#3284 LB — nothing imports the lazy chunks statically", () => {
  test("LB-1 the editor, the writers and the ladder are reached only through their lazy owners", () => {
    const files = [
      ...listSourceFiles("mingla-business/src"),
      ...listSourceFiles("mingla-business/app"),
      ...listSourceFiles("packages/offering-rendering"),
    ];
    // Denominator: the scan really read the trees it guards.
    expect(files.length).toBeGreaterThan(900);
    const sources = new Map(files.map((f) => [f, fs.readFileSync(path.join(REPO_ROOT, f), "utf8")]));

    const violations = files.flatMap((f) => scanForBoundaryViolations(f, sources.get(f) ?? ""));
    expect(violations).toEqual([]);

    // Each owner really is the one runtime loader of its target.
    for (const { name, owner } of LAZY_TARGETS) {
      expect(stripComments(sources.get(owner) ?? "")).toMatch(new RegExp(`[^f]\\s*\\bimport\\(\\s*["']\\./${name}["']\\s*\\)`));
    }
    // The four editor sites use the lazy editor; the five writer consumers use the
    // lazy writers; the three bodies and the barrel use the lazy ladder.
    const uses = (file: string, owner: string): boolean =>
      new RegExp(`from\\s+["'][^"']*/${owner}["']`).test(stripComments(sources.get(file) ?? ""));
    for (const site of [
      "mingla-business/src/components/event/CreatorStep6Settings.tsx",
      "mingla-business/src/components/experience/ExperiencePricingStep.tsx",
      "mingla-business/src/components/trip/TripCreatorStep5Policy.tsx",
      "mingla-business/src/components/trip/EditPublishedTripSettingsAccordion.tsx",
    ]) {
      expect({ site, lazy: uses(site, "LazyRefundPolicyEditor") }).toEqual({ site, lazy: true });
    }
    for (const site of [
      "mingla-business/src/components/event/EditPublishedScreen.tsx",
      "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx",
      "mingla-business/src/services/businessEvents.ts",
      "mingla-business/src/hooks/useRefundPolicy.ts",
    ]) {
      expect({ site, lazy: uses(site, "refundPolicyWrites") }).toEqual({ site, lazy: true });
    }
    for (const site of [
      "packages/offering-rendering/EventOfferingBody.tsx",
      "packages/offering-rendering/ExperienceOfferingBody.tsx",
      "packages/offering-rendering/TripOfferingBody.tsx",
      "packages/offering-rendering/index.ts",
    ]) {
      expect({ site, lazy: uses(site, "LazyOfferingRefundLadder") }).toEqual({ site, lazy: true });
    }
  });

  test("LB-2 the scanner catches each way the boundary can be broken, and lets types through", () => {
    const planted = [
      'import { RefundPolicyEditor } from "../trip/RefundPolicyEditor";',
      'import {\n  setOfferingRefundPolicy,\n  type RefundPolicy,\n} from "../../services/refundPolicyService";',
      'export { OfferingRefundLadder } from "./OfferingRefundLadder";',
      'const m = await import("../trip/RefundPolicyEditor");',
    ].join("\n");
    expect(scanForBoundaryViolations("mingla-business/src/components/event/CreatorStep6Settings.tsx", planted)).toEqual([
      { file: "mingla-business/src/components/event/CreatorStep6Settings.tsx", target: "RefundPolicyEditor", kind: "static import" },
      { file: "mingla-business/src/components/event/CreatorStep6Settings.tsx", target: "RefundPolicyEditor", kind: "dynamic import outside its owner" },
      { file: "mingla-business/src/components/event/CreatorStep6Settings.tsx", target: "refundPolicyService", kind: "static import" },
      { file: "mingla-business/src/components/event/CreatorStep6Settings.tsx", target: "OfferingRefundLadder", kind: "value re-export" },
    ]);
    const typesOnly = [
      'import type { RefundPolicyEditorProps } from "./RefundPolicyEditor";',
      'import { type RefundPolicy } from "../../services/refundPolicyService";',
      'type Writers = typeof import("./refundPolicyService");',
      'let p: import("./refundPolicyService").RefundPolicy | null = null;',
      '// import { OfferingRefundLadder } from "./OfferingRefundLadder";',
    ].join("\n");
    expect(scanForBoundaryViolations("mingla-business/src/services/tripsService.ts", typesOnly)).toEqual([]);
  });
});
