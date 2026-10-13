/**
 * issue #3237 [after Publish, land on the manage screen] — TESTER adversarial.
 * Append-only: NEW file.
 *
 * The implementor pins the publish destinations by reading the route SOURCE.
 * This file RENDERS the real experience create route and drives the wizard's
 * callbacks the way the wizard does, so it proves where the host actually goes:
 *
 *  - a publish opens that experience's manage screen, and the manage screen
 *    (the real arrival hook) then shows the banner exactly once;
 *  - "Save as draft" still returns to the Hub list and leaves no signal;
 *  - a publish of experience A followed by a draft save of experience B does
 *    not send B to a manage screen, and does not spend A's banner;
 *  - a stale signal (older than its window) does not redirect a draft save;
 *  - a second draft save of the SAME id after its banner was shown goes to the
 *    Hub list, not back to the manage screen;
 *  - both paths refresh the brand's list and the experience's detail.
 *
 * It also pins, across the repo, WHO may raise the signal: only the four
 * publish routes, never an edit-published screen or the retired RSVP helper.
 *
 * FAILS-ON-REVERT: restore app/experience/create.tsx from origin/main
 *   -> "a publish opens the experience's manage screen" (and the three cases
 *      built on it) go RED: the route sends every completion to the Hub list.
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockInvalidate = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    push: jest.fn(),
    canGoBack: () => true,
  }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
jest.mock("../../src/hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ id: "brand-1" }),
}));
jest.mock("../../src/hooks/useExperienceDetail", () => ({
  experienceDetailKeys: {
    detail: (id: string) => ["experience-detail", id],
  },
}));
jest.mock("../../src/hooks/useExperiencesByBrand", () => ({
  experienceKeys: {
    listByBrand: (brandId: string) => ["experiences", "list", brandId],
  },
}));
jest.mock("../../src/components/ui/SafeScreen", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react") as typeof React;
  return {
    SafeScreen: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement("MockSafeScreen", null, children),
  };
});
jest.mock("../../src/components/experience/LazyExperienceCreatorWizard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react") as typeof React;
  return {
    LazyExperienceCreatorWizard: (props: Record<string, unknown>) =>
      ReactActual.createElement("MockWizard", props),
  };
});

// eslint-disable-next-line import/first
import ExperienceCreateRoute from "../experience/create";
// eslint-disable-next-line import/first
import { useJustPublishedArrival } from "../../src/hooks/useJustPublishedArrival";
// eslint-disable-next-line import/first
import {
  JUST_PUBLISHED_TTL_MS,
  isJustPublishedPending,
  markJustPublished,
  resetJustPublishedForTests,
} from "../../src/utils/justPublishedSignal";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAllByType: (type: string) => HostNode[] };
  unmount: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const mount = async (element: React.ReactElement): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return tree as Tree;
};

interface WizardProps {
  brandId: string;
  onComplete: (id: string) => void;
  onPublished?: (id: string) => void;
}
const wizardProps = (tree: Tree): WizardProps => {
  const nodes = tree.root.findAllByType("MockWizard");
  expect(nodes).toHaveLength(1);
  return nodes[0].props as unknown as WizardProps;
};

/** What the wizard does on a successful PUBLISH: report it, then complete. */
const wizardPublishes = async (tree: Tree, id: string): Promise<void> => {
  await TestRenderer.act(() => {
    const props = wizardProps(tree);
    props.onPublished?.(id);
    props.onComplete(id);
  });
};
/** What the wizard does on "Save as draft": complete, nothing else. */
const wizardSavesDraft = async (tree: Tree, id: string): Promise<void> => {
  await TestRenderer.act(() => {
    wizardProps(tree).onComplete(id);
  });
};

/** The manage screen in miniature: the real arrival hook. */
const ManageScreen: React.FC<{ id: string }> = ({ id }) => {
  const arrival = useJustPublishedArrival(id);
  return arrival.justPublished ? React.createElement("Banner", { id }) : null;
};
const bannerCount = (tree: Tree): number =>
  tree.root.findAllByType("Banner").length;

const HUB = "/(tabs)/hub/experiences";

beforeEach(() => {
  mockReplace.mockClear();
  mockBack.mockClear();
  mockInvalidate.mockClear();
});
afterEach(() => resetJustPublishedForTests());

describe("#3237 tester — experience create: where the host really lands", () => {
  test("a publish opens the experience's manage screen, which shows the banner once", async () => {
    const route = await mount(<ExperienceCreateRoute />);
    await wizardPublishes(route, "exp-new-1");

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/experience/exp-new-1");

    // The route only PEEKS: the signal is still there for the manage screen.
    const manage = await mount(<ManageScreen id="exp-new-1" />);
    expect(bannerCount(manage)).toBe(1);
    await TestRenderer.act(() => manage.unmount());
    // A later visit to the same manage screen does not replay it.
    const later = await mount(<ManageScreen id="exp-new-1" />);
    expect(bannerCount(later)).toBe(0);
  });

  test("Save as draft still returns to the Hub list and raises no signal", async () => {
    const route = await mount(<ExperienceCreateRoute />);
    await wizardSavesDraft(route, "exp-draft-1");

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(HUB);
    expect(isJustPublishedPending("exp-draft-1")).toBe(false);
    const manage = await mount(<ManageScreen id="exp-draft-1" />);
    expect(bannerCount(manage)).toBe(0);
  });

  test("publishing A does not send a draft save of B to a manage screen, and A keeps its banner", async () => {
    // A was published elsewhere a moment ago and its screen has not mounted yet.
    markJustPublished("exp-A");
    const route = await mount(<ExperienceCreateRoute />);
    await wizardSavesDraft(route, "exp-B");

    expect(mockReplace).toHaveBeenCalledWith(HUB);
    expect(mockReplace).not.toHaveBeenCalledWith("/experience/exp-B");
    expect(isJustPublishedPending("exp-B")).toBe(false);
    const manageA = await mount(<ManageScreen id="exp-A" />);
    expect(bannerCount(manageA)).toBe(1);
  });

  test("a signal older than its window does not redirect a draft save of the same id", async () => {
    markJustPublished("exp-stale", Date.now() - JUST_PUBLISHED_TTL_MS - 1_000);
    const route = await mount(<ExperienceCreateRoute />);
    await wizardSavesDraft(route, "exp-stale");

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(HUB);
  });

  test("once the banner was shown, a later draft save of the same id goes to the Hub list", async () => {
    const route = await mount(<ExperienceCreateRoute />);
    await wizardPublishes(route, "exp-cycle");
    const manage = await mount(<ManageScreen id="exp-cycle" />);
    expect(bannerCount(manage)).toBe(1);
    mockReplace.mockClear();

    await wizardSavesDraft(route, "exp-cycle");
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(HUB);
  });

  test("the publish destination is the id the wizard reported, never a literal or the brand", async () => {
    const route = await mount(<ExperienceCreateRoute />);
    await wizardPublishes(route, "0b7c2f1a-1111-4222-8333-444455556666");
    expect(mockReplace).toHaveBeenCalledWith(
      "/experience/0b7c2f1a-1111-4222-8333-444455556666",
    );
    expect(mockReplace).not.toHaveBeenCalledWith(HUB);
  });

  test("both paths refresh the brand's list and that experience's detail", async () => {
    const route = await mount(<ExperienceCreateRoute />);
    await wizardPublishes(route, "exp-pub");
    expect(mockInvalidate).toHaveBeenCalledWith({
      queryKey: ["experiences", "list", "brand-1"],
    });
    expect(mockInvalidate).toHaveBeenCalledWith({
      queryKey: ["experience-detail", "exp-pub"],
    });

    mockInvalidate.mockClear();
    await wizardSavesDraft(route, "exp-dr");
    expect(mockInvalidate).toHaveBeenCalledWith({
      queryKey: ["experiences", "list", "brand-1"],
    });
    expect(mockInvalidate).toHaveBeenCalledWith({
      queryKey: ["experience-detail", "exp-dr"],
    });
  });
});

// ---------------------------------------------------------------------------
// Who may raise the signal. A mark raised anywhere but a real publish would put
// "Published. It's live." on a screen for something that was only saved.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", "__tests__", "dist", ".expo", "android", "ios"]);

const sourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(path.join(dir, entry.name));
  }
  return out;
};

/** Strips comments so a mention in prose never counts as a call site. */
const code = (file: string): string =>
  fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const rel = (file: string): string =>
  path.relative(ROOT, file).split(path.sep).join("/");

const ALL = [
  ...sourceFiles(path.join(ROOT, "app")),
  ...sourceFiles(path.join(ROOT, "src")),
];

describe("#3237 tester — only a real publish raises the signal", () => {
  test("the source walk actually found the routes (guards against an empty sweep)", () => {
    const names = ALL.map(rel);
    expect(names.length).toBeGreaterThan(200);
    expect(names).toContain("app/event/[id]/edit.tsx");
    expect(names).toContain("app/rsvp/[id]/edit.tsx");
    expect(names).toContain("app/trip/[id]/edit.tsx");
    expect(names).toContain("app/experience/[id]/edit.tsx");
    expect(names).toContain("app/experience/create.tsx");
  });

  test("markJustPublished is referenced by the publish routes and nowhere else", () => {
    const callers = ALL.filter((file) => /\bmarkJustPublished\b/.test(code(file)))
      .map(rel)
      .sort();
    expect(callers).toEqual(
      [
        "app/event/[id]/edit.tsx",
        "app/experience/[id]/edit.tsx",
        "app/experience/create.tsx",
        "app/rsvp/[id]/edit.tsx",
        "app/trip/[id]/edit.tsx",
        "src/utils/justPublishedSignal.ts",
      ].sort(),
    );
  });

  test("the signal is claimed only through the arrival hook", () => {
    const claimers = ALL.filter((file) => /\bconsumeJustPublished\b/.test(code(file)))
      .map(rel)
      .sort();
    expect(claimers).toEqual(
      ["src/hooks/useJustPublishedArrival.ts", "src/utils/justPublishedSignal.ts"].sort(),
    );
  });

  test("event and RSVP: the mark sits inside the published branch, never the discard or abandon branch", () => {
    for (const route of ["app/event/[id]/edit.tsx", "app/rsvp/[id]/edit.tsx"]) {
      const src = code(path.join(ROOT, route));
      const start = src.indexOf("const handleExit = React.useCallback(");
      expect(start).toBeGreaterThan(-1);
      const handler = src.slice(start, src.indexOf("[router],", start));
      const publishedAt = handler.indexOf('if (mode === "published")');
      const otherwiseAt = handler.indexOf('if (mode === "discarded")');
      expect(publishedAt).toBeGreaterThan(-1);
      expect(otherwiseAt).toBeGreaterThan(publishedAt);
      const marks = [...handler.matchAll(/markJustPublished\(/g)].map((m) => m.index ?? -1);
      // Exactly one call in the handler, and it is in the published branch.
      expect(marks).toHaveLength(1);
      expect(marks[0]).toBeGreaterThan(publishedAt);
      expect(marks[0]).toBeLessThan(otherwiseAt);
      // ...and nowhere else in the route (one call + the import).
      expect([...src.matchAll(/\bmarkJustPublished\b/g)]).toHaveLength(2);
    }
  });

  test("event and RSVP: the published id is cleared as it is read, so a later exit cannot reuse it", () => {
    const eventSrc = code(path.join(ROOT, "app/event/[id]/edit.tsx"));
    expect(eventSrc).toMatch(
      /const publishedEventId = publishedEventIdRef\.current;\s*publishedEventIdRef\.current = null;/,
    );
    const rsvpSrc = code(path.join(ROOT, "app/rsvp/[id]/edit.tsx"));
    expect(rsvpSrc).toMatch(
      /const landing = publishedLandingRef\.current;\s*publishedLandingRef\.current = null;/,
    );
  });

  test("the edit-published screens never raise the signal", () => {
    const editPublished = ALL.filter((file) => /EditPublished/.test(path.basename(file)));
    expect(editPublished.length).toBeGreaterThan(0);
    for (const file of editPublished) {
      expect(code(file)).not.toMatch(/justPublishedSignal|markJustPublished/);
    }
  });

  test("a live experience edit completes without reporting a publish", () => {
    const wizard = code(
      path.join(ROOT, "src/components/experience/ExperienceCreatorWizard.tsx"),
    );
    // One report in the whole wizard, and it is guarded by the publish flag.
    expect([...wizard.matchAll(/onPublished\?\.\(/g)]).toHaveLength(1);
    const reportAt = wizard.indexOf("onPublished?.(savedId)");
    const guardAt = wizard.lastIndexOf("if (publish) {", reportAt);
    expect(guardAt).toBeGreaterThan(-1);
    const between = wizard.slice(guardAt, reportAt);
    expect(between.split("{").length - between.split("}").length).toBe(1);
    // The live-edit save handler is a different function with its own complete.
    const liveSave = wizard.slice(wizard.indexOf("p_event_id: liveExperience.id"));
    expect(liveSave).toContain("onComplete(savedId)");
    expect(liveSave).not.toContain("onPublished");
  });

  test("the retired RSVP landing helper is not imported by any route or component", () => {
    const importers = ALL.filter(
      (file) =>
        rel(file) !== "src/utils/rsvpPostPublishRoute.ts" &&
        /rsvpPostPublishRoute/.test(code(file)),
    ).map(rel);
    expect(importers).toEqual([]);
  });

  test("no publish route still sends the host to the buyer's page", () => {
    for (const route of [
      "app/event/[id]/edit.tsx",
      "app/rsvp/[id]/edit.tsx",
      "app/trip/[id]/edit.tsx",
      "app/experience/[id]/edit.tsx",
      "app/experience/create.tsx",
    ]) {
      const src = code(path.join(ROOT, route));
      expect(src).not.toMatch(/router\.replace\(\s*`\/(e|t|exp)\/\$\{/);
    }
  });
});
