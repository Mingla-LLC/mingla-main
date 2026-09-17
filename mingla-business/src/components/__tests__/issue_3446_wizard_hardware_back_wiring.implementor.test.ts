/**
 * #3446 — every Business creation wizard wires Android hardware back through
 * the ONE shared hook, bound to its own in-app owners (SPEC §4.4, §7 T-B).
 *
 * The wizards are parsed with the TypeScript compiler (not regex) and the
 * `useWizardHardwareBack({...})` argument each one passes is carved out and
 * EXECUTED:
 *   - `isFirstStep` is evaluated for every step index (only the first is true);
 *   - `busy` / `exitSurfaced` are evaluated over their flags (each flag alone
 *     turns them on, none leaves them off);
 *   - the carved config is fed to the REAL dispatcher with a spy per owner name,
 *     proving which in-app owner a press on step 1 / step N / while busy runs.
 * The web variant module is imported and run, and must do nothing.
 *
 * Fails on revert:
 *   - delete the `useWizardHardwareBack(` call from any wizard -> T-11 red;
 *   - bind the wrong owner / drop a busy flag / `&&` for `||`  -> T-12 red;
 *   - a wizard imports BackHandler or adds beforeRemove        -> T-13 red;
 *   - the web variant imports react-native or does anything    -> T-14 red;
 *   - an overlay primitive stops routing back natively          -> T-15 red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

import { describe, expect, jest, test } from "@jest/globals";

import {
  dispatchWizardHardwareBackPress,
  type WizardHardwareBackConfig,
} from "../../hooks/wizardHardwareBackRouting";

const SRC = path.resolve(__dirname, "..", "..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(SRC, relative), "utf8");
const parse = (relative: string): ts.SourceFile =>
  ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

type WizardSpec = {
  name: string;
  file: string;
  component: string;
  /** Scope variable driving the step index, and the step indices it can take. */
  stepVar: string;
  steps: number[];
  firstStep: number;
  /** `isFirstStep` is the shorthand of a local `const isFirstStep = …`. */
  isFirstStepLocal: boolean;
  onStepBack: string;
  onExit: string;
  busyFlags: string[];
  /** Flags that must turn exitSurfaced on; `null` = must be the literal false. */
  exitFlags: string[] | null;
};

const WIZARDS: WizardSpec[] = [
  {
    name: "Event",
    file: "components/event/EventCreatorWizard.tsx",
    component: "EventCreatorWizard",
    stepVar: "currentStep",
    steps: [0, 1, 2, 3, 4, 5, 6, 7],
    firstStep: 0,
    isFirstStepLocal: true,
    onStepBack: "handleStepBack",
    onExit: "handleClose",
    busyFlags: ["isPublishing", "checkingInvitePublish", "isDiscarding"],
    exitFlags: ["discardDialogVisible", "toast.visible"],
  },
  {
    name: "RSVP",
    file: "components/rsvp/RsvpCreatorWizard.tsx",
    component: "RsvpCreatorWizard",
    stepVar: "currentStep",
    steps: [0, 1, 2, 3, 4, 5, 6],
    firstStep: 0,
    isFirstStepLocal: true,
    onStepBack: "handleStepBack",
    onExit: "handleClose",
    busyFlags: ["isPublishing", "checkingInvitePublish", "isDiscarding"],
    exitFlags: ["discardDialogVisible", "toast.visible"],
  },
  {
    name: "Experience",
    file: "components/experience/ExperienceCreatorWizard.tsx",
    component: "ExperienceCreatorWizard",
    stepVar: "step",
    steps: [1, 2, 3, 4, 5, 6, 7],
    firstStep: 1,
    isFirstStepLocal: false,
    onStepBack: "goBack",
    onExit: "goBack",
    busyFlags: ["submitting", "checkingInvitePublish"],
    exitFlags: null,
  },
  {
    name: "Trip",
    file: "components/trip/TripCreatorWizard.tsx",
    component: "TripCreatorWizard",
    stepVar: "step",
    steps: [1, 2, 3, 4, 5, 6, 7, 8],
    firstStep: 1,
    isFirstStepLocal: false,
    onStepBack: "handleStepBack",
    onExit: "handleClose",
    busyFlags: ["submitting", "checkingInvitePublish", "isDiscarding"],
    exitFlags: ["discardDialogVisible"],
  },
];

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

const walk = (node: ts.Node, visit: (n: ts.Node) => void): void => {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
};

const hookCalls = (sf: ts.SourceFile): ts.CallExpression[] => {
  const calls: ts.CallExpression[] = [];
  walk(sf, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "useWizardHardwareBack"
    ) {
      calls.push(n);
    }
  });
  return calls;
};

const componentBody = (sf: ts.SourceFile, component: string): ts.Block => {
  let body: ts.Block | null = null;
  walk(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === component &&
      n.initializer !== undefined &&
      ts.isArrowFunction(n.initializer) &&
      ts.isBlock(n.initializer.body)
    ) {
      body = n.initializer.body;
    }
  });
  if (body === null) throw new Error(`component ${component} not found`);
  return body;
};

/** Root identifiers an expression reads (`toast.visible` -> `toast`). */
const readsOf = (expr: ts.Expression): Set<string> => {
  const names = new Set<string>();
  walk(expr, (n) => {
    if (!ts.isIdentifier(n)) return;
    const parent = n.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === n) return;
    names.add(n.text);
  });
  return names;
};

/** Execute a carved expression against a scope of named values. */
const evaluate = (expr: ts.Expression, scope: Record<string, unknown>): unknown => {
  const js = ts.transpile(`const carvedValue = (${expr.getText()});`, {
    target: ts.ScriptTarget.ES2020,
  });
  const names = Object.keys(scope);
  return new Function(...names, `${js}\nreturn carvedValue;`)(
    ...names.map((name) => scope[name]),
  );
};

/**
 * A scope for `reads` where exactly the flags in `on` are true. `known` lists
 * every flag the expression may use; a dotted flag (`toast.visible`) makes its
 * root an object, so an "off" property read is falsy rather than a TypeError.
 */
const scopeWith = (
  reads: Set<string>,
  known: string[],
  on: string[],
): Record<string, unknown> => {
  const scope: Record<string, unknown> = {};
  for (const name of reads) {
    const dotted = known.filter((flag) => flag.startsWith(`${name}.`));
    if (dotted.length === 0) {
      scope[name] = on.includes(name);
      continue;
    }
    const value: Record<string, boolean> = {};
    for (const flag of dotted) value[flag.slice(name.length + 1)] = on.includes(flag);
    scope[name] = value;
  }
  return scope;
};

const makeSpy = () => jest.fn<() => void>();
type Spy = ReturnType<typeof makeSpy>;

type Carved = {
  call: ts.CallExpression;
  props: Map<string, ts.Expression | "shorthand">;
};

const carve = (spec: WizardSpec, sf: ts.SourceFile): Carved => {
  const calls = hookCalls(sf);
  expect(calls).toHaveLength(1);
  const call = calls[0];
  expect(call.arguments).toHaveLength(1);
  const arg = call.arguments[0];
  if (!ts.isObjectLiteralExpression(arg)) throw new Error(`${spec.name}: argument is not an object literal`);
  const props = new Map<string, ts.Expression | "shorthand">();
  for (const p of arg.properties) {
    if (ts.isShorthandPropertyAssignment(p)) props.set(p.name.text, "shorthand");
    else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) props.set(p.name.text, p.initializer);
    else throw new Error(`${spec.name}: unsupported property ${p.getText()}`);
  }
  return { call, props };
};

const expressionOf = (carved: Carved, key: string): ts.Expression => {
  const value = carved.props.get(key);
  if (value === undefined) throw new Error(`missing ${key}`);
  if (value === "shorthand") throw new Error(`${key} is shorthand`);
  return value;
};

// ---------------------------------------------------------------------------

describe.each(WIZARDS)("#3446 $name wizard — hardware back wiring", (spec) => {
  test("T-11 imports the platform-resolved hook (no .native suffix) and calls it exactly once, unconditionally", () => {
    const sf = parse(spec.file);
    const imports = sf.statements.filter(ts.isImportDeclaration).filter((d) => {
      const from = (d.moduleSpecifier as ts.StringLiteral).text;
      return from.includes("useWizardHardwareBack");
    });
    expect(imports).toHaveLength(1);
    const decl = imports[0];
    expect((decl.moduleSpecifier as ts.StringLiteral).text).toBe("../../hooks/useWizardHardwareBack");
    expect(decl.importClause?.isTypeOnly ?? false).toBe(false);
    const named = decl.importClause?.namedBindings;
    expect(named !== undefined && ts.isNamedImports(named)).toBe(true);
    expect((named as ts.NamedImports).elements.map((e) => e.name.text)).toEqual(["useWizardHardwareBack"]);

    const calls = hookCalls(sf);
    expect(calls).toHaveLength(1);
    // A top-level statement of the component body (never inside an if, a loop
    // or a callback), placed before the component's return.
    const body = componentBody(sf, spec.component);
    const statement = calls[0].parent;
    expect(ts.isExpressionStatement(statement)).toBe(true);
    expect(statement.parent).toBe(body);
    const index = body.statements.indexOf(statement as ts.Statement);
    const firstReturn = body.statements.findIndex(ts.isReturnStatement);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(firstReturn).toBeGreaterThan(index);
  });

  test("T-12 binds the wizard's own owners, step-1 test, busy flags and exit-surfaced flags", () => {
    const sf = parse(spec.file);
    const carved = carve(spec, sf);
    expect([...carved.props.keys()].sort()).toEqual(
      ["busy", "exitSurfaced", "isFirstStep", "onExit", "onStepBack"],
    );
    const body = componentBody(sf, spec.component);

    // Owners: exactly the in-app Back / close identifiers, declared earlier in
    // the body (so they exist when the hook runs).
    const ownerNames: Record<"onStepBack" | "onExit", string> = {
      onStepBack: spec.onStepBack,
      onExit: spec.onExit,
    };
    for (const key of ["onStepBack", "onExit"] as const) {
      const expr = expressionOf(carved, key);
      expect(ts.isIdentifier(expr) ? expr.text : expr.getText()).toBe(ownerNames[key]);
      const declared = body.statements.findIndex(
        (s) =>
          ts.isVariableStatement(s) &&
          s.declarationList.declarations.some(
            (d) => ts.isIdentifier(d.name) && d.name.text === ownerNames[key],
          ),
      );
      expect(declared).toBeGreaterThanOrEqual(0);
      expect(declared).toBeLessThan(body.statements.indexOf(carved.call.parent as ts.Statement));
    }

    // isFirstStep: true on the first step index only.
    let isFirstStepExpr: ts.Expression;
    if (spec.isFirstStepLocal) {
      expect(carved.props.get("isFirstStep")).toBe("shorthand");
      let init: ts.Expression | undefined;
      walk(body, (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "isFirstStep") {
          init = n.initializer;
        }
      });
      if (init === undefined) throw new Error(`${spec.name}: no local isFirstStep`);
      isFirstStepExpr = init;
    } else {
      isFirstStepExpr = expressionOf(carved, "isFirstStep");
    }
    expect([...readsOf(isFirstStepExpr)]).toEqual([spec.stepVar]);
    for (const value of spec.steps) {
      expect(evaluate(isFirstStepExpr, { [spec.stepVar]: value })).toBe(value === spec.firstStep);
    }

    // busy: each required flag alone turns it on; all off leaves it off.
    const busy = expressionOf(carved, "busy");
    const busyReads = readsOf(busy);
    for (const flag of spec.busyFlags) expect(busyReads.has(flag)).toBe(true);
    expect(Boolean(evaluate(busy, scopeWith(busyReads, spec.busyFlags, [])))).toBe(false);
    for (const flag of spec.busyFlags) {
      expect(Boolean(evaluate(busy, scopeWith(busyReads, spec.busyFlags, [flag])))).toBe(true);
    }

    // exitSurfaced.
    const exit = expressionOf(carved, "exitSurfaced");
    if (spec.exitFlags === null) {
      expect(exit.kind).toBe(ts.SyntaxKind.FalseKeyword);
    } else {
      const exitReads = readsOf(exit);
      for (const flag of spec.exitFlags) {
        expect(exitReads.has(flag.split(".")[0])).toBe(true);
        expect(exit.getText()).toContain(flag);
      }
      expect(Boolean(evaluate(exit, scopeWith(exitReads, spec.exitFlags, [])))).toBe(false);
      for (const flag of spec.exitFlags) {
        expect(Boolean(evaluate(exit, scopeWith(exitReads, spec.exitFlags, [flag])))).toBe(true);
      }
    }

    // Run the carved config through the REAL dispatcher: which owner fires.
    const spies: Record<string, Spy> = {};
    const spy = (name: string): Spy => {
      spies[name] = spies[name] ?? makeSpy();
      return spies[name];
    };
    const configAt = (stepValue: number, busyOn: string[]): WizardHardwareBackConfig => ({
      isFirstStep: evaluate(isFirstStepExpr, { [spec.stepVar]: stepValue }) as boolean,
      busy: Boolean(evaluate(busy, scopeWith(busyReads, spec.busyFlags, busyOn))),
      exitSurfaced: false,
      onStepBack: spy(spec.onStepBack),
      onExit: spy(spec.onExit),
    });
    const later = spec.steps[spec.steps.length - 1];

    expect(dispatchWizardHardwareBackPress("idle", configAt(spec.firstStep, [])).action).toBe("exit");
    expect(spies[spec.onExit]).toHaveBeenCalledTimes(1);

    expect(dispatchWizardHardwareBackPress("idle", configAt(later, [])).action).toBe("step_back");
    expect(spies[spec.onStepBack]).toHaveBeenCalledTimes(spec.onStepBack === spec.onExit ? 2 : 1);

    for (const flag of spec.busyFlags) {
      expect(dispatchWizardHardwareBackPress("idle", configAt(later, [flag])).action).toBe("none");
    }
    const total = Object.values(spies).reduce((sum, s) => sum + s.mock.calls.length, 0);
    expect(total).toBe(2);
  });

  test("T-13 the wizard never touches BackHandler or navigation remove guards directly", () => {
    const source = read(spec.file);
    for (const banned of ["BackHandler", "hardwareBackPress", "beforeRemove", "usePreventRemove"]) {
      expect(source).not.toContain(banned);
    }
  });
});

describe("#3446 hook platform split and the overlays it relies on", () => {
  test("T-14 the web/jest variant imports nothing platform-specific and does nothing", async () => {
    const sf = parse("hooks/useWizardHardwareBack.ts");
    const imports = sf.statements.filter(ts.isImportDeclaration);
    expect(imports.map((d) => (d.moduleSpecifier as ts.StringLiteral).text)).toEqual([
      "./wizardHardwareBackRouting",
    ]);
    expect(imports.every((d) => d.importClause?.isTypeOnly === true)).toBe(true);

    const web = await import("../../hooks/useWizardHardwareBack");
    const onStepBack = jest.fn<() => void>();
    const onExit = jest.fn<() => void>();
    expect(
      web.useWizardHardwareBack({ isFirstStep: true, busy: false, exitSurfaced: false, onStepBack, onExit }),
    ).toBeUndefined();
    expect(
      web.useWizardHardwareBack({ isFirstStep: false, busy: false, exitSurfaced: true, onStepBack, onExit }),
    ).toBeUndefined();
    expect(onStepBack).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();

    const native = read("hooks/useWizardHardwareBack.native.ts");
    expect(native).toContain('Platform.OS !== "android"');
    expect(native).toContain("useFocusEffect(");
    expect(native).toContain("return true");
    expect(native).not.toMatch(/addListener\(\s*["']beforeRemove/);
    expect(native).not.toMatch(/\busePreventRemove\(/);
  });

  test("T-15 overlay primitives still consume back natively (onRequestClose)", () => {
    for (const file of ["components/ui/Modal.tsx", "components/ui/SheetMobile.tsx", "components/ui/Toast.tsx"]) {
      expect(read(file)).toContain("onRequestClose=");
    }
  });
});
