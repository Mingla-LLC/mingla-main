/* eslint-disable import/first */
/**
 * Issue #3801 — TESTER adversarial: the web Traveler info editor can never
 * reach the drag-and-drop library, not even through a file it imports, and the
 * web copies have not drifted from their native siblings.
 *
 * A DIFFERENT ANGLE from the implementor suite
 * (`issue_3801_onboarding_intake_web_list.implementor.test.tsx`), which mounts
 * the web builder and checks each surface's OWN import lines. This file:
 *
 *   1. Walks the whole import graph the way Metro resolves it on web
 *      (`X.web.tsx` wins over `X.tsx`), starting from every `.web.tsx` in the
 *      trip folder and from the two screens that mount the intake builder, and
 *      fails if ANY file in that closure imports the library. A direct-import
 *      check passes when a helper two hops away pulls it in; this does not.
 *   2. Proves the walk is not blind: the same walk with native resolution DOES
 *      find the library.
 *   3. Checks every Reanimated name the closure imports exists on the stand-in
 *      Metro supplies on web, so no other "undefined is not a function" waits
 *      behind the one that was fixed.
 *   4. Pins the two web copies to their native siblings: every hook callback
 *      except the reorder one is text-identical, and no user-facing string was
 *      changed or dropped. The copies are full duplicates, so drift in
 *      validation, the save payload or wording is a defect.
 *   5. Attacks the boundaries of the move buttons: up on the first row and
 *      down on the last do nothing, a disabled builder moves nothing, ids
 *      survive a reorder, and positions stay 0..n-1 after several moves.
 *
 * Fails on revert (verified, see the tester report on the issue): add
 * `import "react-native-draggable-flatlist"` to a web copy, or delete the web
 * copies, and the closure tests go red.
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

const TRIP_DIR = path.resolve(__dirname, "..");
const SRC_DIR = path.resolve(TRIP_DIR, "..", "..");
const DRAG_LIBRARY = "react-native-draggable-flatlist";
const REANIMATED = "react-native-reanimated";

// ---------------------------------------------------------------------------
// 1-3. the import graph, resolved the way Metro resolves it
// ---------------------------------------------------------------------------

type Platform = "web" | "native";

const EXTENSIONS: Record<Platform, string[]> = {
  web: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js", ".jsx"],
  native: [".native.tsx", ".native.ts", ".tsx", ".ts", ".js", ".jsx"],
};

function resolveRelative(from: string, specifier: string, platform: Platform): string | null {
  const base = path.resolve(path.dirname(from), specifier);
  for (const ext of EXTENSIONS[platform]) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS[platform]) {
    const index = path.join(base, `index${ext}`);
    if (fs.existsSync(index)) return index;
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  return null;
}

interface ImportEdge {
  specifier: string;
  /** Names a value import pulls in (empty for a side-effect import). */
  names: string[];
}

/** Value imports only: `import type` and type-only names are erased by Metro. */
function valueImports(file: string): ImportEdge[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2020,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edges: ImportEdge[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause === undefined) {
        edges.push({ specifier: node.moduleSpecifier.text, names: [] });
      } else if (!clause.isTypeOnly) {
        const names: string[] = [];
        if (clause.name !== undefined) names.push("default");
        const bindings = clause.namedBindings;
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
          }
        } else if (bindings !== undefined) {
          names.push("*");
        }
        // `import { type A, type B } from "x"` leaves nothing at runtime.
        if (names.length > 0) edges.push({ specifier: node.moduleSpecifier.text, names });
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      edges.push({ specifier: node.moduleSpecifier.text, names: ["*"] });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      edges.push({ specifier: (node.arguments[0] as ts.StringLiteral).text, names: ["*"] });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

interface Closure {
  files: Set<string>;
  /** package specifier -> the files importing it, with the names they take. */
  packages: Map<string, { file: string; names: string[] }[]>;
}

function closureOf(roots: string[], platform: Platform): Closure {
  const files = new Set<string>();
  const packages: Closure["packages"] = new Map();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const edge of valueImports(file)) {
      if (!edge.specifier.startsWith(".")) {
        const users = packages.get(edge.specifier) ?? [];
        users.push({ file, names: edge.names });
        packages.set(edge.specifier, users);
        continue;
      }
      const resolved = resolveRelative(file, edge.specifier, platform);
      if (resolved !== null && resolved.startsWith(SRC_DIR) && /\.(tsx?|jsx?)$/.test(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return { files, packages };
}

const rel = (file: string): string => path.relative(SRC_DIR, file);

const WEB_COPIES = fs
  .readdirSync(TRIP_DIR)
  .filter((name) => name.endsWith(".web.tsx"))
  .map((name) => path.join(TRIP_DIR, name));

/** Screens that mount the intake builder (wizard step 6 and the published-trip accordion). */
const INTAKE_SCREENS = ["TripCreatorStep6Intake.tsx", "EditPublishedTripIntakeAccordion.tsx"].map(
  (name) => path.join(TRIP_DIR, name),
);

describe("#3801 tester — nothing the web intake editor can reach imports the drag-and-drop library", () => {
  test("the trip folder has web copies of both intake files that used the library", () => {
    expect(WEB_COPIES.map(rel).sort()).toEqual(
      expect.arrayContaining([
        "components/trip/IntakeQuestionEditor.web.tsx",
        "components/trip/IntakeSchemaBuilder.web.tsx",
      ]),
    );
  });

  test("the walk is not blind: with NATIVE resolution the same screens do reach the library", () => {
    const native = closureOf(INTAKE_SCREENS, "native");
    const users = (native.packages.get(DRAG_LIBRARY) ?? []).map((u) => rel(u.file)).sort();
    expect(users).toEqual([
      "components/trip/IntakeQuestionEditor.tsx",
      "components/trip/IntakeSchemaBuilder.tsx",
    ]);
  });

  test("with WEB resolution, no file reachable from a web copy or an intake screen imports it", () => {
    const web = closureOf([...WEB_COPIES, ...INTAKE_SCREENS], "web");
    // The closure really went somewhere, and really took the web copies.
    expect(web.files.size).toBeGreaterThan(20);
    expect(web.files.has(path.join(TRIP_DIR, "IntakeSchemaBuilder.web.tsx"))).toBe(true);
    expect(web.files.has(path.join(TRIP_DIR, "IntakeQuestionEditor.web.tsx"))).toBe(true);
    expect(web.files.has(path.join(TRIP_DIR, "IntakeSchemaBuilder.tsx"))).toBe(false);
    expect(web.files.has(path.join(TRIP_DIR, "IntakeQuestionEditor.tsx"))).toBe(false);

    expect((web.packages.get(DRAG_LIBRARY) ?? []).map((u) => rel(u.file))).toEqual([]);
    // Belt and braces: not as a string anywhere in the closure's import lines.
    for (const file of web.files) {
      const specifiers = valueImports(file).map((e) => e.specifier);
      expect({ file: rel(file), drag: specifiers.includes(DRAG_LIBRARY) }).toEqual({
        file: rel(file),
        drag: false,
      });
    }
  });

  test("every Reanimated name the web closure imports exists on the web stand-in", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stub = require("../../../shims/reactNativeReanimatedWebStub.js") as Record<
      string,
      unknown
    >;
    const web = closureOf([...WEB_COPIES, ...INTAKE_SCREENS], "web");
    const users = web.packages.get(REANIMATED) ?? [];
    // The intake editor sits in a Sheet and uses Button: it does use Reanimated.
    expect(users.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const user of users) {
      for (const name of user.names) {
        if (name === "*") continue;
        if (stub[name] === undefined) missing.push(`${rel(user.file)} -> ${name}`);
      }
    }
    expect(missing).toEqual([]);
    // The hook the library needed is still absent: the stand-in was not padded.
    expect(stub.useAnimatedReaction).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. the web copies have not drifted from their native siblings
// ---------------------------------------------------------------------------

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TSX,
  );
}

/** Every `const name = useCallback(...)` / `useMemo(...)` in the file, by name. */
function hookBodies(file: string): Map<string, string> {
  const source = parse(file);
  const out = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      ["useCallback", "useMemo"].includes(node.initializer.expression.text)
    ) {
      // Comments are not behaviour; compare the code only.
      const printer = ts.createPrinter({ removeComments: true });
      out.set(
        node.name.text,
        squash(printer.printNode(ts.EmitHint.Unspecified, node.initializer, source)),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Module-level helper functions (validation lives here), by name. */
function topLevelFunctions(file: string): Map<string, string> {
  const source = parse(file);
  const out = new Map<string, string>();
  const printer = ts.createPrinter({ removeComments: true });
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      out.set(
        statement.name.text,
        squash(printer.printNode(ts.EmitHint.Unspecified, statement, source)),
      );
    }
  }
  return out;
}

/** String literals, template text and JSX text: everything a host could read. */
function userFacingStrings(file: string): Set<string> {
  const source = parse(file);
  const out = new Set<string>();
  const add = (text: string): void => {
    const value = squash(text);
    // Words a person reads, not identifiers, colours or style keys.
    if (/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(value)) out.add(value);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isTemplateExpression(node)) {
      add(node.head.text);
      node.templateSpans.forEach((span) => add(span.literal.text));
    } else if (ts.isJsxText(node)) add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

interface Pair {
  name: string;
  /** The native hook the web copy replaces, and what it is called there. */
  nativeReorder: string;
  webReorder: string;
  /** Native-only wording that belongs to drag and drop. */
  nativeOnlyStrings: string[];
}

const PAIRS: Pair[] = [
  {
    name: "IntakeSchemaBuilder",
    nativeReorder: "handleDragEnd",
    webReorder: "handleMove",
    nativeOnlyStrings: ["Drag to reorder question"],
  },
  {
    name: "IntakeQuestionEditor",
    nativeReorder: "handleDragEnd",
    webReorder: "moveOption",
    nativeOnlyStrings: ["Drag to reorder option"],
  },
];

describe.each(PAIRS)("#3801 tester — $name.web.tsx has not drifted from $name.tsx", (pair) => {
  const nativeFile = path.join(TRIP_DIR, `${pair.name}.tsx`);
  const webFile = path.join(TRIP_DIR, `${pair.name}.web.tsx`);

  test("every hook callback except the reorder one is identical", () => {
    const native = hookBodies(nativeFile);
    const web = hookBodies(webFile);
    expect(native.size).toBeGreaterThan(3);

    const nativeNames = [...native.keys()].filter((n) => n !== pair.nativeReorder).sort();
    const webNames = [...web.keys()].filter((n) => n !== pair.webReorder).sort();
    expect(webNames).toEqual(nativeNames);
    expect(native.has(pair.nativeReorder)).toBe(true);
    expect(web.has(pair.webReorder)).toBe(true);
    expect(web.has(pair.nativeReorder)).toBe(false);

    const drifted = nativeNames.filter((name) => native.get(name) !== web.get(name));
    expect(drifted).toEqual([]);
  });

  test("every module-level helper (validation, defaults) is identical", () => {
    const native = topLevelFunctions(nativeFile);
    const web = topLevelFunctions(webFile);
    expect([...web.keys()].sort()).toEqual([...native.keys()].sort());
    const drifted = [...native.keys()].filter((name) => native.get(name) !== web.get(name));
    expect(drifted).toEqual([]);
  });

  test("no user-facing wording was changed or dropped", () => {
    const native = userFacingStrings(nativeFile);
    const webSource = squash(fs.readFileSync(webFile, "utf8"));
    const missing = [...native].filter(
      (text) => !pair.nativeOnlyStrings.includes(text) && !webSource.includes(text),
    );
    expect(missing).toEqual([]);
    // And the drag wording is gone from the web copy.
    for (const text of pair.nativeOnlyStrings) expect(webSource.includes(text)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. the move buttons at their boundaries (real web builder source, compiled)
// ---------------------------------------------------------------------------

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

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};

function loadWebBuilder(): React.ComponentType<Record<string, unknown>> {
  const boundary: Record<string, () => unknown> = {
    react: () => React,
    "react-native": () => jest.requireActual("react-native"),
    [DRAG_LIBRARY]: () => {
      throw new Error(`${DRAG_LIBRARY} was loaded on the web path.`);
    },
    designSystem: () => designSystem,
    GlassCard: () => ({ GlassCard: leaf("GlassCardProbe") }),
    Icon: () => ({ Icon: (): null => null }),
    intakeSchemaService: () => intakeSchemaService,
    IntakeQuestionEditor: () => ({ IntakeQuestionEditor: leaf("IntakeQuestionEditorProbe") }),
    IntakeTypePickerSheet: () => ({ IntakeTypePickerSheet: leaf("IntakeTypePickerSheetProbe") }),
  };
  const output = ts.transpileModule(
    fs.readFileSync(path.join(TRIP_DIR, "IntakeSchemaBuilder.web.tsx"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const boundaryRequire = (specifier: string): unknown => {
    const supply = boundary[specifier] ?? boundary[specifier.split("/").pop() as string];
    if (supply !== undefined) return supply();
    throw new Error(`Unclassified IntakeSchemaBuilder.web boundary: ${specifier}`);
  };
  const module = {
    exports: {} as Record<string, React.ComponentType<Record<string, unknown>>>,
  };
  new Function("require", "module", "exports", output)(boundaryRequire, module, module.exports);
  return module.exports.IntakeSchemaBuilder;
}

const question = (label: string, position: number): IntakeQuestion => ({
  ...intakeSchemaService.createBlankQuestion("short_text", position),
  label,
});

const schemaOf = (labels: string[]): IntakeSchema => ({
  ...intakeSchemaService.createEmptyIntakeSchema(),
  questions: labels.map((label, index) => question(label, index)),
});

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

interface Harness {
  tree: Renderer;
  schema: () => IntakeSchema;
  changes: () => number;
}

async function mountBuilder(initial: IntakeSchema, disabled = false): Promise<Harness> {
  const Builder = loadWebBuilder();
  let current = initial;
  let changes = 0;
  let tree!: Renderer;
  const element = (): React.ReactElement => (
    <Builder
      schema={current}
      activeTicketTypeId="tt-3801"
      activeTierName="Shared"
      disabled={disabled}
      onSchemaChange={(next: IntakeSchema) => {
        current = next;
        changes += 1;
        tree.update(element());
      }}
      onClearAll={() => undefined}
    />
  );
  await act(async () => {
    tree = TestRenderer.create(element());
  });
  mounted.push(tree);
  return { tree, schema: () => current, changes: () => changes };
}

const button = (tree: Renderer, testID: string): TestInstance => {
  const found = tree.root.findAll(
    (node) => node.props.testID === testID && typeof node.type !== "string",
  );
  expect(found).toHaveLength(1);
  return found[0];
};

/** Fire the handler whatever the `disabled` prop says, as a stray event would. */
const forcePress = async (tree: Renderer, testID: string): Promise<void> => {
  await act(async () => {
    (button(tree, testID).props.onPress as () => void)();
  });
};

const labels = (schema: IntakeSchema): string[] => schema.questions.map((q) => q.label);

describe("#3801 tester — the move buttons at the edges of the list", () => {
  test("up on the first row and down on the last row are disabled AND do nothing if fired", async () => {
    const initial = schemaOf(["Passport", "Diet", "Emergency contact"]);
    const harness = await mountBuilder(initial);
    const [first, , last] = initial.questions;

    const up = button(harness.tree, `intake-builder-move-up-${first.id}`);
    const down = button(harness.tree, `intake-builder-move-down-${last.id}`);
    expect(up.props.disabled).toBe(true);
    expect(up.props.accessibilityState).toEqual({ disabled: true });
    expect(down.props.disabled).toBe(true);
    expect(down.props.accessibilityState).toEqual({ disabled: true });

    await forcePress(harness.tree, `intake-builder-move-up-${first.id}`);
    await forcePress(harness.tree, `intake-builder-move-down-${last.id}`);

    expect(harness.changes()).toBe(0);
    expect(labels(harness.schema())).toEqual(["Passport", "Diet", "Emergency contact"]);
  });

  test("the inner buttons of the first and last rows are enabled and labelled with the question", async () => {
    const initial = schemaOf(["Passport", "Diet", "Emergency contact"]);
    const harness = await mountBuilder(initial);
    const [first, middle, last] = initial.questions;

    const firstDown = button(harness.tree, `intake-builder-move-down-${first.id}`);
    const lastUp = button(harness.tree, `intake-builder-move-up-${last.id}`);
    expect(firstDown.props.disabled).toBe(false);
    expect(lastUp.props.disabled).toBe(false);
    expect(firstDown.props.accessibilityRole).toBe("button");
    expect(firstDown.props.accessibilityLabel).toBe("Move question down: Passport");
    expect(lastUp.props.accessibilityLabel).toBe("Move question up: Emergency contact");
    expect(
      button(harness.tree, `intake-builder-move-up-${middle.id}`).props.accessibilityLabel,
    ).toBe("Move question up: Diet");
  });

  test("a question with no label still gets a button a screen reader can name", async () => {
    const initial = schemaOf(["", "Diet"]);
    const harness = await mountBuilder(initial);
    expect(
      button(harness.tree, `intake-builder-move-down-${initial.questions[0].id}`).props
        .accessibilityLabel,
    ).toBe("Move question down: Untitled question");
  });

  test("several moves keep every id, lose no question, and leave positions 0..n-1 in list order", async () => {
    const initial = schemaOf(["A", "B", "C", "D"]);
    const harness = await mountBuilder(initial);
    const id = (label: string): string =>
      initial.questions.find((q) => q.label === label)?.id as string;

    // D to the top (three moves up). A is then second, so two moves down put it
    // last and the third press lands on the bottom edge and must do nothing.
    for (let i = 0; i < 3; i += 1) await forcePress(harness.tree, `intake-builder-move-up-${id("D")}`);
    expect(labels(harness.schema())).toEqual(["D", "A", "B", "C"]);
    for (let i = 0; i < 3; i += 1) await forcePress(harness.tree, `intake-builder-move-down-${id("A")}`);
    expect(labels(harness.schema())).toEqual(["D", "B", "C", "A"]);

    const saved = harness.schema();
    // This is the payload the step change persists: order and `position` agree.
    expect(saved.questions.map((q) => q.position)).toEqual([0, 1, 2, 3]);
    expect(saved.questions.map((q) => q.id).sort()).toEqual(
      initial.questions.map((q) => q.id).sort(),
    );
    // Nothing else about a question changed while it moved.
    for (const original of initial.questions) {
      const now = saved.questions.find((q) => q.id === original.id) as IntakeQuestion;
      expect({ ...now, position: original.position }).toEqual(original);
    }
    // Each move is a schema edit: it gets a new version id like any other.
    expect(harness.changes()).toBe(5);
    expect(saved.schema_version_id).not.toBe(initial.schema_version_id);
    // Once at the top, D's up button is the disabled one now.
    expect(button(harness.tree, `intake-builder-move-up-${id("D")}`).props.disabled).toBe(true);
    expect(button(harness.tree, `intake-builder-move-down-${id("A")}`).props.disabled).toBe(true);
  });

  test("a disabled builder disables every move button", async () => {
    const initial = schemaOf(["Passport", "Diet", "Emergency contact"]);
    const harness = await mountBuilder(initial, true);
    for (const q of initial.questions) {
      expect(button(harness.tree, `intake-builder-move-up-${q.id}`).props.disabled).toBe(true);
      expect(button(harness.tree, `intake-builder-move-down-${q.id}`).props.disabled).toBe(true);
    }
  });
});
