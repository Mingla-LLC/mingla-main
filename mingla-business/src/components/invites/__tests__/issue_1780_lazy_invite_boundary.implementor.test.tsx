/**
 * issue #1780 [bundle budget] — the invite surfaces load in their own chunk.
 *
 * WHY. Every creation wizard (Event, RSVP, Experience, Trip) is its own lazy
 * route chunk, and Metro hoists any module two lazy chunks import statically
 * into `__common`, the boot payload every business-web visitor downloads before
 * anything renders (ORCH-1083, rebuilt by issue #1509). Importing
 * `InvitePeopleStep` from all four therefore charged every visitor — a guest
 * opening a checkout link included — 22,031 B of generated JavaScript for a
 * surface only a signed-in host creating an offering ever sees. Measured with
 * the repo's own attribution (`scripts/ci/bundle-attribute.mjs`) on a
 * source-mapped web export.
 *
 * WHAT THIS FILE PINS
 *   LI-*  LazyInvitePeopleStep: the placeholder each surface shows until the
 *         chunk is in memory (the step's own "Loading your saved selection…"
 *         treatment; the Review card with its heading; nothing at all for the
 *         publish confirmation), then the real surface with the same props; a
 *         failed load is reported and shows the app's standard fallback, whose
 *         Try again loads it; once loaded, every later mount renders the real
 *         surface on its FIRST frame, with no placeholder flash.
 *   LW-*  Warming: the publish confirmation — mounted by every wizard for the
 *         whole of its life — starts the load, so the chunk is in memory long
 *         before a host can reach the invite step.
 *   LB-*  The boundary itself: no app or src module imports InvitePeopleStep
 *         statically, and only its one lazy owner loads it at runtime. The
 *         scanner is proven non-vacuous on a planted static import.
 *
 * FAILS-ON-REVERT: put a static `import { InvitePeopleStep } from
 * "../invites/InvitePeopleStep"` back into any of the four wizards and LB-1
 * goes red; drop the retry or the fallback from LazyInvitePeopleStep and LI-3
 * goes red; drop the loader's `loadedInvites` memo and LI-4 goes red; stop the
 * publish confirmation from starting the load and LW-1 goes red.
 *
 * Mirrors the #3284 lazy-refund-boundary suite, which established this pattern.
 */

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
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
  unmount: () => void;
}
// ---------------------------------------------------------------------------
// boundaries — the chunk under test (it can be told to fail its next N loads,
// like a dropped chunk) plus the leaves the real step would otherwise pull.
// ---------------------------------------------------------------------------

let mockInviteLoadFailures = 0;
let mockInviteLoads = 0;

jest.mock("../InvitePeopleStep", () => {
  mockInviteLoads += 1;
  if (mockInviteLoadFailures > 0) {
    mockInviteLoadFailures -= 1;
    throw new Error("Loading chunk InvitePeopleStep failed");
  }
  return {
    InvitePeopleStep: (props: Record<string, unknown>): React.ReactElement =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react").createElement("invite-step-real", props),
    InvitePlanReviewSummary: (props: Record<string, unknown>): React.ReactElement =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react").createElement("invite-review-real", props),
    InvitePeoplePublishConfirmation: (props: Record<string, unknown>): React.ReactElement =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("react").createElement("invite-confirm-real", props),
  };
});

const mockReportNonFatal = jest.fn<(scope: string, error: unknown) => void>();
jest.mock("../../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: (scope: string, error: unknown): void => mockReportNonFatal(scope, error),
}));

// The standard fallback's leaves. Button pulls react-native-reanimated, which
// this project's node/ts-jest config cannot parse; the #3284 lazy-boundary
// suite substitutes the same two for the same reason. The fallback's COPY and
// its Try again wiring are what this suite asserts, and both survive.
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", { ...props, testID: `button-${String(props.label)}` }),
}));

const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..", "..");
const OWNER = "mingla-business/src/components/invites/LazyInvitePeopleStep.tsx";
const TARGET = "InvitePeopleStep";

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
const hostsOf = (tree: Renderer, type: string): TestInstance[] =>
  tree.root.findAll((n) => n.type === type);
beforeEach(() => {
  mockReportNonFatal.mockReset();
});

// ===========================================================================
// LI / LW — the lazy surfaces.
//
// Each case needs its OWN cold loader (the loaded module is module state), so
// each takes a fresh registry. React, the renderer and the module under test
// are all required FROM THAT registry: a `jest.resetModules()` that leaves the
// file's top-level React behind gives the renderer one React and the component
// another, and the second one's hook dispatcher is null.
// ===========================================================================

interface Registry {
  create: (type: unknown, props: Record<string, unknown>) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
  lazy: typeof import("../LazyInvitePeopleStep");
}

const freshRegistry = (): Registry => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactFresh = require("react") as typeof React;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RendererFresh = require("react-test-renderer") as {
    create: (node: React.ReactElement) => Renderer;
    act: (fn: () => Promise<void> | void) => Promise<void>;
  };
  return {
    create: (type, props) =>
      RendererFresh.create(
        ReactFresh.createElement(type as React.ElementType, props),
      ),
    act: RendererFresh.act,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lazy: require("../LazyInvitePeopleStep") as typeof import("../LazyInvitePeopleStep"),
  };
};

const settle = async (reg: Registry): Promise<void> => {
  await reg.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

/**
 * Render, and return the FIRST committed frame — what a host actually sees at
 * the instant the surface mounts.
 *
 * It cannot be observed through `await act(async …)`: the chunk resolves in one
 * microtask (jest turns `import()` into `Promise.resolve().then(require)`) and
 * awaiting act drains every microtask before returning, so the placeholder has
 * already been replaced by the time the assertion runs. The SYNCHRONOUS act
 * form commits the frame and flushes effects without yielding to the
 * microtask queue, so the assertions below see the frame, and `await flushed`
 * then lets the load complete. Nothing is skipped — only observed earlier.
 */
const firstFrame = (
  reg: Registry,
  type: unknown,
  props: Record<string, unknown>,
): { tree: Renderer; flushed: Promise<void> } => {
  let tree!: Renderer;
  const flushed = reg.act(() => {
    tree = reg.create(type, props);
  }) as unknown as Promise<void>;
  return { tree, flushed };
};

const STEP_PROPS = { eventId: "e1", brandId: "b1", eventType: "event" as const };

describe("#1780 LI — the invite surfaces load in their own chunk", () => {
  test("LI-1 a cold step shows the step's own loading treatment, then the real step", async () => {
    const reg = freshRegistry();
    const { tree, flushed } = firstFrame(reg, reg.lazy.InvitePeopleStep, STEP_PROPS);

    // The placeholder is the step's own copy, so the chunk wait and the plan
    // wait read as one state. Nothing of the real step is on screen yet.
    expect(textOf(tree)).toContain("Loading your saved selection…");
    expect(hostsOf(tree, "invite-step-real")).toHaveLength(0);

    await flushed;
    await settle(reg);

    expect(hostsOf(tree, "invite-step-real")).toHaveLength(1);
    expect(hostsOf(tree, "invite-step-real")[0].props).toMatchObject(STEP_PROPS);
    expect(textOf(tree)).not.toContain("Loading your saved selection…");
    tree.unmount();
  });

  test("LI-2 the Review summary reserves its card, with its heading, then becomes the real summary", async () => {
    const reg = freshRegistry();
    const { tree, flushed } = firstFrame(reg, reg.lazy.InvitePlanReviewSummary, {
      plan: null,
      quote: null,
    });

    // Same bordered card, same heading, one muted line — so Review does not
    // move when the real summary arrives.
    expect(textOf(tree)).toContain("Invites");
    expect(
      tree.root.findAll((n) => n.props.testID === "invite-plan-review-summary-loading"),
    ).toHaveLength(1);

    await flushed;
    await settle(reg);
    expect(hostsOf(tree, "invite-review-real")).toHaveLength(1);
    tree.unmount();
  });

  test("LI-3 a failed load is reported and offers Try again, which loads it", async () => {
    mockInviteLoadFailures = 1;
    const reg = freshRegistry();
    let tree!: Renderer;
    await reg.act(async () => {
      tree = reg.create(reg.lazy.InvitePeopleStep, { ...STEP_PROPS, eventType: "rsvp" });
    });
    await settle(reg);

    // The app's standard fallback — no new copy — and one non-fatal report.
    expect(textOf(tree)).toContain("Something broke.");
    expect(mockReportNonFatal).toHaveBeenCalledTimes(1);
    expect(mockReportNonFatal.mock.calls[0][0]).toBe("LazyInvitePeopleStep");
    expect(hostsOf(tree, "invite-step-real")).toHaveLength(0);

    // Try again. A React.lazy boundary could never recover here: it caches the
    // rejection. The hand loader forgets a failed load, so the retry succeeds.
    const retry = tree.root.findAll((n) => n.props.testID === "button-Try again");
    expect(retry).toHaveLength(1);
    await reg.act(async () => {
      (retry[0].props.onPress as () => void)();
    });
    await settle(reg);
    expect(hostsOf(tree, "invite-step-real")).toHaveLength(1);
    tree.unmount();
  });

  test("LI-4 once loaded, a later mount renders the real surface on its FIRST frame", async () => {
    const reg = freshRegistry();
    let warm!: Renderer;
    await reg.act(async () => {
      warm = reg.create(reg.lazy.InvitePeopleStep, STEP_PROPS);
    });
    await settle(reg);
    warm.unmount();

    const before = mockInviteLoads;
    const { tree: again, flushed } = firstFrame(reg, reg.lazy.InvitePeopleStep, {
      ...STEP_PROPS,
      eventId: "e2",
    });
    // No placeholder frame on the way back to the step, and no second load.
    expect(hostsOf(again, "invite-step-real")).toHaveLength(1);
    expect(textOf(again)).not.toContain("Loading your saved selection…");
    expect(mockInviteLoads).toBe(before);
    await flushed;
    again.unmount();
  });
});

describe("#1780 LW — the publish confirmation warms the chunk", () => {
  test("LW-1 a closed confirmation renders nothing and still starts the load", async () => {
    const reg = freshRegistry();
    const { tree, flushed } = firstFrame(reg, reg.lazy.InvitePeoplePublishConfirmation, {
      visible: false,
      eventType: "event",
      plan: null,
      quote: null,
      publishing: false,
      onClose: (): void => undefined,
      onConfirm: (): void => undefined,
    });
    // A closed ConfirmDialog shows nothing, and so does its placeholder.
    expect(tree.toJSON()).toBeNull();

    await flushed;
    await settle(reg);
    // The chunk is now in memory: the step mounted next gets it immediately.
    expect(hostsOf(tree, "invite-confirm-real")).toHaveLength(1);

    const { tree: step, flushed: stepFlushed } = firstFrame(
      reg,
      reg.lazy.InvitePeopleStep,
      STEP_PROPS,
    );
    expect(hostsOf(step, "invite-step-real")).toHaveLength(1);
    await stepFlushed;
    step.unmount();
    tree.unmount();
  });
});

// ===========================================================================
// LB — the boundary. A source scan, so it also covers files no test mounts.
// ===========================================================================

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

interface BoundaryViolation {
  file: string;
  kind: "static import" | "value re-export" | "dynamic import outside its owner";
}

/** Static value imports, value re-exports and runtime import() of the lazy target. */
const scanForBoundaryViolations = (file: string, raw: string): BoundaryViolation[] => {
  const src = stripComments(raw);
  const out: BoundaryViolation[] = [];
  const spec = `["'][^"']*/${TARGET}["']`;
  for (const match of src.matchAll(
    new RegExp(`\\b(import|export)\\s+(type\\s+)?([^;]*?)\\s+from\\s+${spec}`, "g"),
  )) {
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
    out.push({ file, kind: match[1] === "import" ? "static import" : "value re-export" });
  }
  // A runtime import() — `typeof import("…")` and `import("…").Type` are types.
  for (const match of src.matchAll(
    new RegExp(`(typeof\\s+)?\\bimport\\(\\s*${spec}\\s*\\)(\\.[A-Za-z])?`, "g"),
  )) {
    if (match[1] !== undefined || match[2] !== undefined) continue;
    if (file !== OWNER) out.push({ file, kind: "dynamic import outside its owner" });
  }
  return out;
};

const listSourceFiles = (dir: string): string[] => {
  const abs = path.join(REPO_ROOT, dir);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith("."))
        continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.(ts|tsx)$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        found.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  walk(abs);
  return found;
};

describe("#1780 LB — nothing imports the invite chunk statically", () => {
  test("LB-1 InvitePeopleStep is reached only through its lazy owner", () => {
    const files = [
      ...listSourceFiles("mingla-business/src"),
      ...listSourceFiles("mingla-business/app"),
    ];
    // Denominator: the scan really read the trees it guards.
    expect(files.length).toBeGreaterThan(900);
    const sources = new Map(
      files.map((f) => [f, fs.readFileSync(path.join(REPO_ROOT, f), "utf8")]),
    );

    expect(files.flatMap((f) => scanForBoundaryViolations(f, sources.get(f) ?? ""))).toEqual([]);

    // The owner really is the one runtime loader of the target. This asserts
    // the LOADER form (`import("./X").then`), not just the characters
    // `import("./X")` — a `typeof import("./X")` type alias must not satisfy it.
    expect(stripComments(sources.get(OWNER) ?? "")).toMatch(
      new RegExp(`(^|[^f])\\s*\\bimport\\(\\s*["']\\./${TARGET}["']\\s*\\)\\s*\\.then`, "m"),
    );

    // And all four wizards go through it.
    for (const wizard of [
      "mingla-business/src/components/event/EventCreatorWizard.tsx",
      "mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx",
      "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx",
      "mingla-business/src/components/trip/TripCreatorWizard.tsx",
    ]) {
      expect({
        wizard,
        lazy: /from\s+["'][^"']*\/LazyInvitePeopleStep["']/.test(
          stripComments(sources.get(wizard) ?? ""),
        ),
      }).toEqual({ wizard, lazy: true });
    }
  });

  test("LB-2 the scanner is not vacuous", () => {
    expect(
      scanForBoundaryViolations(
        "planted.tsx",
        'import { InvitePeopleStep } from "../invites/InvitePeopleStep";',
      ),
    ).toEqual([{ file: "planted.tsx", kind: "static import" }]);
    expect(
      scanForBoundaryViolations(
        "planted.tsx",
        'export { InvitePeopleStep } from "../invites/InvitePeopleStep";',
      ),
    ).toEqual([{ file: "planted.tsx", kind: "value re-export" }]);
    expect(
      scanForBoundaryViolations("planted.tsx", 'void import("../invites/InvitePeopleStep");'),
    ).toEqual([{ file: "planted.tsx", kind: "dynamic import outside its owner" }]);
    // Type-only forms and the owner's own loader are NOT violations.
    expect(
      scanForBoundaryViolations(
        "planted.tsx",
        'import type { InvitePeopleStepProps } from "./InvitePeopleStep";\n' +
          'type M = typeof import("./InvitePeopleStep");',
      ),
    ).toEqual([]);
    expect(scanForBoundaryViolations(OWNER, 'import("./InvitePeopleStep")')).toEqual([]);
  });
});
