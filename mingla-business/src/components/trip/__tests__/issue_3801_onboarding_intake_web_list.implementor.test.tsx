/**
 * Issue #3801 — saving the FIRST Traveler info question on web no longer
 * crashes the trip editor.
 *
 * THE BUG. `IntakeSchemaBuilder` mounted a drag-and-drop list
 * (`react-native-draggable-flatlist`) the moment the question list went from
 * zero to one. On web, Metro swaps Reanimated for
 * `src/shims/reactNativeReanimatedWebStub.js`, which has no
 * `useAnimatedReaction`; the library calls it during render, the TypeError
 * reached the error boundary, and the question was never saved. The same list
 * sat in the choice-option editor and, through the builder, in the
 * published-trip intake accordion.
 *
 * THE FIX. Web resolves `IntakeSchemaBuilder.web.tsx` and
 * `IntakeQuestionEditor.web.tsx`: a plain list with accessible move up / move
 * down buttons. Native keeps drag and drop. The Reanimated stand-in is NOT
 * padded.
 *
 * HOW THIS PROVES IT. The REAL web builder source is compiled with the
 * TypeScript compiler and mounted against an explicit module boundary (the
 * #3439 / #1780 compiled-creator pattern). Reanimated is supplied as the SAME
 * stand-in Metro supplies on web, and the drag-and-drop library is supplied as
 * a module that throws on load, so a web path that reaches for it goes red.
 * Every other import is classified; an unknown one throws.
 *
 * Fails on revert: delete the two `.web.tsx` files (web then resolves the
 * native files, which import the library) -> red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { afterEach, describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";

jest.mock("../../../services/supabase", () => ({ supabase: {} }));

import * as intakeSchemaService from "../../../services/intakeSchemaService";
import type {
  IntakeQuestion,
  IntakeSchema,
} from "../../../services/intakeSchemaService";

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
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}
// CI installs the renderer but not a separate @types package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const TRIP_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.resolve(TRIP_DIR, "..", "..");
const APP_DIR = path.resolve(SRC_DIR, "..", "app");
const DRAG_LIBRARY = "react-native-draggable-flatlist";

/** What Metro does on web: `X.web.tsx` wins over `X.tsx`. */
function webResolved(file: string): string {
  const web = file.replace(/\.tsx$/, ".web.tsx");
  return fs.existsSync(web) ? web : file;
}

const importsDragLibrary = (source: string): boolean =>
  new RegExp(`from\\s+["']${DRAG_LIBRARY}["']|require\\(\\s*["']${DRAG_LIBRARY}["']`).test(
    source,
  );

// ---------------------------------------------------------------------------
// module boundary
// ---------------------------------------------------------------------------

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};
const nothing = (): null => null;

// The stand-in Metro maps `react-native-reanimated` to on web
// (metro.config.js -> REACT_NATIVE_REANIMATED_WEB_STUB).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reanimatedWebStub = require("../../../shims/reactNativeReanimatedWebStub.js") as Record<
  string,
  unknown
>;

const BOUNDARY: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  "react-native-reanimated": () => reanimatedWebStub,
  [DRAG_LIBRARY]: () => {
    throw new Error(
      `${DRAG_LIBRARY} was loaded on the web path. It needs Reanimated's useAnimatedReaction, which the web stand-in does not have.`,
    );
  },
  designSystem: () => designSystem,
  GlassCard: () => ({ GlassCard: leaf("GlassCardProbe") }),
  Icon: () => ({ Icon: nothing }),
  intakeSchemaService: () => intakeSchemaService,
  IntakeQuestionEditor: () => ({ IntakeQuestionEditor: leaf("IntakeQuestionEditorProbe") }),
  IntakeTypePickerSheet: () => ({ IntakeTypePickerSheet: leaf("IntakeTypePickerSheetProbe") }),
};

function loadWebBuilder(): React.ComponentType<Record<string, unknown>> {
  const file = webResolved(path.join(TRIP_DIR, "IntakeSchemaBuilder.tsx"));
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const boundaryRequire = (specifier: string): unknown => {
    const key = specifier.split("/").pop() as string;
    const supply = BOUNDARY[specifier] ?? BOUNDARY[key];
    if (supply !== undefined) return supply();
    throw new Error(`Unclassified IntakeSchemaBuilder (web) boundary: ${specifier}`);
  };
  const module = {
    exports: {} as Record<string, React.ComponentType<Record<string, unknown>>>,
  };
  new Function("require", "module", "exports", output)(
    boundaryRequire,
    module,
    module.exports,
  );
  return module.exports.IntakeSchemaBuilder;
}

// ---------------------------------------------------------------------------
// harness: the builder is controlled, so the test owns the schema like a host
// ---------------------------------------------------------------------------

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

interface Harness {
  tree: Renderer;
  schema: () => IntakeSchema | null;
}

async function mountBuilder(): Promise<Harness> {
  const Builder = loadWebBuilder();
  let current: IntakeSchema | null = null;
  let tree!: Renderer;
  const element = (): React.ReactElement => (
    <Builder
      schema={current}
      activeTicketTypeId="tt-3801"
      activeTierName="Shared"
      onSchemaChange={(next: IntakeSchema) => {
        current = next;
        tree.update(element());
      }}
      onClearAll={() => {
        current = null;
        tree.update(element());
      }}
    />
  );
  await act(async () => {
    tree = TestRenderer.create(element());
  });
  mounted.push(tree);
  return { tree, schema: () => current };
}

const byTestId = (tree: Renderer, testID: string): TestInstance[] =>
  tree.root.findAll(
    (node) => node.props.testID === testID && typeof node.type !== "string",
  );

const questionRows = (tree: Renderer): string[] =>
  tree.root
    .findAll(
      (node) =>
        typeof node.type !== "string" &&
        typeof node.props.testID === "string" &&
        /^intake-builder-question-(?!list$)/.test(node.props.testID),
    )
    .map((node) => String(node.props.testID).replace("intake-builder-question-", ""));

const press = async (tree: Renderer, testID: string): Promise<void> => {
  const found = byTestId(tree, testID);
  expect(found).toHaveLength(1);
  expect(found[0].props.disabled === true).toBe(false);
  await act(async () => {
    (found[0].props.onPress as () => void)();
  });
};

/** Add a question the way a host does: Add question -> pick a type -> Save. */
async function addQuestion(harness: Harness, label: string): Promise<IntakeQuestion> {
  const { tree } = harness;
  await press(tree, "intake-builder-add-question");
  const picker = tree.root.findAll((node) => node.type === "IntakeTypePickerSheetProbe");
  expect(picker).toHaveLength(1);
  await act(async () => {
    (picker[0].props.onSelect as (type: string) => void)("short_text");
    // The builder waits for the picker to close before opening the editor.
    await new Promise((resolve) => setTimeout(resolve, 560));
  });
  const editor = tree.root.findAll((node) => node.type === "IntakeQuestionEditorProbe");
  expect(editor).toHaveLength(1);
  const question: IntakeQuestion = {
    ...intakeSchemaService.createBlankQuestion("short_text", 0),
    label,
  };
  await act(async () => {
    (editor[0].props.onSave as (q: IntakeQuestion) => void)(question);
  });
  return question;
}

// ---------------------------------------------------------------------------

describe("#3801 — why the list crashed on web", () => {
  test("the web Reanimated stand-in has no useAnimatedReaction, and is not padded to fake one", () => {
    expect(typeof reanimatedWebStub.useAnimatedStyle).toBe("function");
    expect(reanimatedWebStub.useAnimatedReaction).toBeUndefined();
  });
});

describe("#3801 — the first Traveler info question saves on web", () => {
  test("zero questions -> add one -> the row renders, with no drag-and-drop library loaded", async () => {
    const harness = await mountBuilder();
    const { tree } = harness;

    // Zero questions: the empty hint, and no list at all.
    expect(questionRows(tree)).toEqual([]);
    expect(byTestId(tree, "intake-builder-question-list")).toHaveLength(0);

    // The step that used to crash: the list mounts for the first time.
    const first = await addQuestion(harness, "Passport number");

    expect(harness.schema()?.questions.map((q) => q.label)).toEqual(["Passport number"]);
    expect(byTestId(tree, "intake-builder-question-list")).toHaveLength(1);
    expect(questionRows(tree)).toEqual([first.id]);

    // One row: both move buttons exist, are labelled, and are disabled.
    const up = byTestId(tree, `intake-builder-move-up-${first.id}`);
    const down = byTestId(tree, `intake-builder-move-down-${first.id}`);
    expect(up).toHaveLength(1);
    expect(down).toHaveLength(1);
    expect(up[0].props.accessibilityLabel).toBe("Move question up: Passport number");
    expect(down[0].props.accessibilityLabel).toBe("Move question down: Passport number");
    expect(up[0].props.disabled).toBe(true);
    expect(down[0].props.disabled).toBe(true);
  }, 20000);

  test("move down reorders the questions and renumbers their positions", async () => {
    const harness = await mountBuilder();
    const { tree } = harness;
    const first = await addQuestion(harness, "Passport number");
    const second = await addQuestion(harness, "Dietary needs");
    expect(questionRows(tree)).toEqual([first.id, second.id]);

    await press(tree, `intake-builder-move-down-${first.id}`);

    expect(questionRows(tree)).toEqual([second.id, first.id]);
    expect(
      harness.schema()?.questions.map((q) => [q.label, q.position]),
    ).toEqual([
      ["Dietary needs", 0],
      ["Passport number", 1],
    ]);
  }, 20000);
});

describe("#3801 — no web-reachable module imports the drag-and-drop library", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  test("each intake surface resolves on web to a file that does not import it", () => {
    for (const name of [
      "IntakeSchemaBuilder.tsx",
      "IntakeQuestionEditor.tsx",
      "EditPublishedTripIntakeAccordion.tsx",
      "TripCreatorStep6Intake.tsx",
    ]) {
      const resolved = webResolved(path.join(TRIP_DIR, name));
      expect([name, importsDragLibrary(fs.readFileSync(resolved, "utf8"))]).toEqual([
        name,
        false,
      ]);
    }
  });

  test("every file that imports it is native-only: it has a .web sibling that does not", () => {
    const importers = [...walk(SRC_DIR), ...walk(APP_DIR)].filter(
      (file) =>
        !/\.web\.(ts|tsx)$/.test(file) && importsDragLibrary(fs.readFileSync(file, "utf8")),
    );
    // Native still drags: the two native files keep the library.
    expect(importers.map((file) => path.basename(file)).sort()).toEqual([
      "IntakeQuestionEditor.tsx",
      "IntakeSchemaBuilder.tsx",
    ]);
    for (const file of importers) {
      const web = file.replace(/\.(ts|tsx)$/, ".web.$1");
      expect([path.basename(web), fs.existsSync(web)]).toEqual([path.basename(web), true]);
      expect(importsDragLibrary(fs.readFileSync(web, "utf8"))).toBe(false);
    }
    const webFiles = [...walk(SRC_DIR), ...walk(APP_DIR)].filter((file) =>
      /\.web\.(ts|tsx)$/.test(file),
    );
    for (const file of webFiles) {
      expect([path.basename(file), importsDragLibrary(fs.readFileSync(file, "utf8"))]).toEqual([
        path.basename(file),
        false,
      ]);
    }
  });

  test("the web choice-option list has move up / move down buttons and no drag handle", () => {
    const source = fs.readFileSync(
      webResolved(path.join(TRIP_DIR, "IntakeQuestionEditor.tsx")),
      "utf8",
    );
    expect(source).toContain("Move option ${item.index + 1} up");
    expect(source).toContain("Move option ${item.index + 1} down");
    expect(source).not.toContain("onLongPress");
  });
});
