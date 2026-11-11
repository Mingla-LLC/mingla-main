// META-ORCH-1232 (H1 / I-PROPOSED-1232-C) — brand create/save write failures must
// surface as a PERSISTENT inline error + Retry, NOT a lone auto-dismiss toast; the
// wizard must stay on the failed step with typed values intact; AuthNotReadyError
// (C2) must render with distinct, retryable copy.
//
// #4389 rebuilt the flow (F1 Name → F2 Bank country → F3 Get paid → F4 done).
// The old address step is gone (approved design v11), so the "address CTA"
// legs now pin the step that replaced it as the second brand write: F2 bank
// country. The behaviour is unchanged and still enforced in code:
//   - the persistent inline error + "Try again" lives in
//     BrandSetupInterruptions.InlineWriteError (rendered below for real);
//   - AuthNotReadyError gets the design's own words ("Getting things ready…",
//     C.f1.authWarming) instead of the old "Finishing sign-in…";
//   - "Try again" is the design's label (C.common.tryAgain) for "Retry".
// The C2 write gate itself (no write before a real access token) is executed
// in src/services/__tests__/issue_4389_brand_setup_service.implementor.test.ts.
import { describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import React from "react";

interface TestInstance {
  props: Record<string, unknown>;
  findAll(predicate: (node: TestInstance) => boolean, options?: { deep?: boolean }): TestInstance[];
}
interface RendererInstance {
  root: TestInstance;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../src/components/ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Button: (p: { label: string; onPress: () => void; testID?: string }) =>
      R.createElement(RN.Pressable, { testID: p.testID, accessibilityLabel: p.label, onPress: p.onPress }),
  };
});
jest.mock("../../src/components/ui/Sheet", () => ({ Sheet: () => null }));

/* eslint-disable import/first */
import {
  InlineWriteError,
  writeErrorMessage,
} from "../../src/components/brand/BrandSetupInterruptions";
import { BRAND_SETUP_COPY as C } from "../../src/components/brand/brandSetupCopy";
import { AuthNotReadyError } from "../../src/utils/authReadyGate";
/* eslint-enable import/first */

const repoRoot = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(repoRoot, "src/components/brand/BrandCreationFlow.tsx"),
  "utf8",
);
const service = fs.readFileSync(
  path.join(repoRoot, "src/services/brandSetupService.ts"),
  "utf8",
);

/** One component's source, from its `const Name` line to the next step marker. */
function block(name: string): string {
  const start = src.indexOf(`const ${name}: React.FC`);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n// ── ", start);
  return src.slice(start, end === -1 ? undefined : end);
}
const nameStep = block("NameStep");
const countryStep = block("CountryStep");

describe("META-ORCH-1232 H1 — persistent retryable brand-write error", () => {
  test("a persistent writeError state exists (not just a toast)", () => {
    for (const step of [nameStep, countryStep]) {
      expect(step).toContain("const [writeError, setWriteError] = useState<WriteError | null>(null);");
      expect(step).toMatch(/setWriteError\(\{[^}]*retry:\s*\(\)\s*=>\s*submitRef\.current\(\)/);
    }
    expect(src).not.toMatch(/Toast\.show|showToast/);
  });

  test("create failure routes the NON-draft, NON-session error to the persistent inline surface (not a lone toast)", () => {
    // draft_exists (N1) and an expired session (sign-in sheet) are their own
    // screens; every OTHER create failure sets the persistent writeError.
    expect(nameStep).toMatch(
      /onError: \(e\) => \{[\s\S]*draft_exists[\s\S]*isSessionExpiredError\(e\)[\s\S]*setWriteError\(\{ message: writeErrorMessage\(e, C\.common\.serverError\)/,
    );
    expect(nameStep).toContain('<InlineWriteError writeError={writeError} testID="brand-setup-name-error" />');
  });

  test("the address-save failure also surfaces the persistent inline error + Retry (address step → F2 bank country in #4389)", () => {
    // Locked / forbidden are answers (no Try again); any other failure is persistent + retryable.
    expect(countryStep).toMatch(
      /onError: \(e\) => \{[\s\S]*payout_country_locked[\s\S]*forbidden[\s\S]*else setWriteError\(\{ message: writeErrorMessage\(e, C\.common\.serverError\)/,
    );
    expect(countryStep).toContain('<InlineWriteError writeError={writeError} testID="brand-setup-country-error" />');
  });

  test("AuthNotReadyError (C2) renders distinct, clearly-retryable copy", () => {
    expect(writeErrorMessage(new AuthNotReadyError(), C.common.serverError)).toBe(C.f1.authWarming);
    expect(C.f1.authWarming).toBe("Getting things ready…");
    // A plain failure keeps the generic words, so the two are distinguishable.
    expect(writeErrorMessage(new Error("boom"), C.common.serverError)).toBe(C.common.serverError);
    expect(C.f1.authWarming).not.toBe(C.common.serverError);
  });

  test("the inline error region renders a Retry affordance that re-invokes the mutation", () => {
    const retry = jest.fn();
    let r!: RendererInstance;
    TestRenderer.act(() => {
      r = TestRenderer.create(
        <InlineWriteError writeError={{ message: C.common.serverError, retry }} testID="w" />,
      );
    });
    const region = r.root.findAll(
      (n) => n.props.testID === "w" && n.props.accessibilityRole === "alert",
      { deep: true },
    );
    expect(region.length).toBeGreaterThan(0);
    expect(region[0]?.props.accessibilityLabel).toBe(C.common.serverError);
    // The pressable the Button mock renders carries the label as its a11y label.
    const button = r.root.findAll(
      (n) => n.props.testID === "w-retry" && n.props.accessibilityLabel !== undefined,
      { deep: true },
    )[0];
    expect(button?.props.accessibilityLabel).toBe(C.common.tryAgain);
    TestRenderer.act(() => {
      (button?.props.onPress as () => void)();
    });
    expect(retry).toHaveBeenCalledTimes(1);

    // No error, no region.
    let empty!: RendererInstance;
    TestRenderer.act(() => {
      empty = TestRenderer.create(<InlineWriteError writeError={null} testID="w" />);
    });
    expect(
      empty.root.findAll((n) => n.props.accessibilityRole === "alert", { deep: true }),
    ).toHaveLength(0);
  });

  test("a fresh attempt clears any prior persistent error", () => {
    for (const step of [nameStep, countryStep]) {
      expect(step).toMatch(/const submit = \(\): void => \{[\s\S]*setWriteError\(null\);[\s\S]*\.mutate\(/);
    }
  });

  test("the create CTA does NOT advance the step on throw (values retained)", () => {
    // The step advances only in onSuccess; onError never calls onCreated and
    // never clears the typed name.
    expect(nameStep).toContain("onSuccess: (r) => onCreated(r.brandId),");
    const onError = nameStep.slice(nameStep.indexOf("onError: (e) =>"), nameStep.indexOf("// \"Try again\""));
    expect(onError).not.toContain("onCreated");
    expect(onError).not.toContain("setName(");
  });
});

describe("META-ORCH-1232 C2 — create/address CTAs gated on auth readiness", () => {
  test("useAuth exposes isAuthReady to the flow", () => {
    expect(src).toContain("const { user, isAuthReady } = useAuth();");
  });

  test("the create CTA is disabled while !isAuthReady", () => {
    expect(src).toContain("authReady={isAuthReady && user !== null}");
    expect(nameStep).toMatch(/const disabled = [^;]*!authReady[^;]*create\.isPending/);
    expect(nameStep).toContain("disabled={disabled}");
  });

  test("the address CTA is disabled while !isAuthReady (address step → F2 bank country in #4389)", () => {
    expect(countryStep).toMatch(/if \(selected === null \|\| save\.isPending[^)]*!authReady\) return;/);
    expect(countryStep).toMatch(/testID="brand-setup-country-continue"[^\n]*!authReady[^\n]*save\.isPending/);
  });

  test("the setup writes await a real attached session before going out", () => {
    for (const fn of ["export async function createSetupBrand", "export async function setBrandPayoutCountry"]) {
      const start = service.indexOf(fn);
      const body = service.slice(start, service.indexOf("\n}\n", start));
      const gate = body.indexOf("await awaitSessionAttached(() => supabase.auth.getSession());");
      expect(gate).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(body.indexOf("supabase.rpc("));
    }
  });
});
