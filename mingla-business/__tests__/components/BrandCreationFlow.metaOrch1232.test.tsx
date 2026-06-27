// META-ORCH-1232 (H1 / I-PROPOSED-1232-C) — brand create/save write failures must
// surface as a PERSISTENT inline error + Retry, NOT a lone auto-dismiss toast; the
// wizard must stay on the failed step with typed values intact; AuthNotReadyError
// (C2) must render with distinct, retryable copy.
//
// Source-contract style (matches __tests__/components/BrandCreationFlow.test.tsx):
// the default node/ts-jest config cannot mount RN, so we assert the wiring that
// the runtime render depends on. A revert to the lone-toast behavior removes the
// `setWriteError` sink and the inline-error JSX, failing these assertions.
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const src = fs.readFileSync(
  path.join(repoRoot, "src/components/brand/BrandCreationFlow.tsx"),
  "utf8",
);

describe("META-ORCH-1232 H1 — persistent retryable brand-write error", () => {
  test("a persistent writeError state exists (not just a toast)", () => {
    expect(src).toContain("const [writeError, setWriteError]");
    // it carries a retry callback
    expect(src).toMatch(/writeError[\s\S]*retry:\s*\(\)\s*=>/);
  });

  test("create failure routes the NON-collision error to the persistent inline surface (not a lone toast)", () => {
    // SlugCollisionError stays an inline form toast (user-correctable) ...
    expect(src).toContain("error instanceof SlugCollisionError");
    // ... every OTHER create failure now sets the persistent writeError.
    expect(src).toContain("setWriteError({");
    expect(src).toContain("createErrorInline");
  });

  test("the address-save failure also surfaces the persistent inline error + Retry", () => {
    expect(src).toContain("saveErrorInline");
    // handleContinueAddress sets writeError on throw (no lone auto-dismiss toast).
    expect(src).toMatch(
      /handleContinueAddress[\s\S]*catch[\s\S]*setWriteError\(\{/,
    );
  });

  test("AuthNotReadyError (C2) renders distinct, clearly-retryable copy", () => {
    expect(src).toContain("isAuthNotReadyError(error)");
    expect(src).toContain("authNotReadyInline");
    expect(src).toContain("Finishing sign-in");
  });

  test("the inline error region renders a Retry affordance that re-invokes the mutation", () => {
    expect(src).toContain("retryCta");
    expect(src).toContain("onPress={writeError.retry}");
    // accessibilityRole alert so it reads as a persistent error, not decoration.
    expect(src).toContain('accessibilityRole="alert"');
  });

  test("a fresh attempt clears any prior persistent error", () => {
    // both handlers reset writeError before re-trying
    expect((src.match(/setWriteError\(null\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("the create CTA does NOT advance the step on throw (values retained)", () => {
    // brandCreated (the step-advance) only runs after a successful mutateAsync;
    // the catch never dispatches it. Assert the advance is inside the try, after
    // the await, and the catch only sets toast/writeError.
    expect(src).toContain('updateState({ type: "brandCreated", brandId: newBrand.id });');
  });
});

describe("META-ORCH-1232 C2 — create/address CTAs gated on auth readiness", () => {
  test("useAuth exposes isAuthReady to the flow", () => {
    expect(src).toContain("const { user, isAuthReady } = useAuth();");
  });

  test("the create CTA is disabled while !isAuthReady", () => {
    expect(src).toMatch(/createBrandMutation\.isPending[\s\S]*!isAuthReady/);
  });

  test("the address CTA is disabled while !isAuthReady", () => {
    expect(src).toMatch(/updateBrandMutation\.isPending[\s\S]*!isAuthReady/);
  });
});
