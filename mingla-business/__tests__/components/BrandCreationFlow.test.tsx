import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");
const readBusinessFile = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// fails-on-revert verified at 6633be066

describe("META-ORCH-0972 Sub-B BrandCreationFlow contract", () => {
  test("SC-B-1 keeps locked brand creation copy verbatim", () => {
    const source = readBusinessFile(
      "src/components/brand/BrandCreationFlow.tsx",
    );

    [
      "Create brand",
      "Brand name",
      "e.g. Wandering Soul Retreats",
      "Short bio (optional)",
      "Tell people what you're about — 200 characters.",
      "Add an address?",
      "We'll use this to pre-fill venues for any experiences you publish. You can add this later.",
      "e.g. 12 Soho Square, London",
      "Skip for now",
      "Add a cover (optional)",
      "Skip",
      "Done",
      "What do you want to make first?",
      "Mix and match anytime.",
    ].forEach((copy) => {
      expect(source).toContain(copy);
    });
  });

  test("SC-B-2 skip address preserves a null brand address", () => {
    const source = readBusinessFile(
      "src/components/brand/BrandCreationFlow.tsx",
    );

    expect(source).toContain(
      'return { ...state, address: action.address, step: 3 };',
    );
    // META-ORCH-1009 Sub-F WS1: skip now routes through handleSkipAddress, which
    // still dispatches a null-address setAddress (and clears validated geo meta).
    expect(source).toContain("onPress={handleSkipAddress}");
    expect(source).toContain('updateState({ type: "setAddress", address: null });');
  });

  test("SC-B-5 welcome offering chooser routes to every creator", () => {
    const creationSource = readBusinessFile(
      "src/components/brand/BrandCreationFlow.tsx",
    );
    const chooserSource = readBusinessFile(
      "src/components/brand/OfferingChooser.tsx",
    );

    expect(creationSource).toContain("router.push(routeForOffering(offering) as never)");
    expect(chooserSource).toContain('if (offering === "trip") return "/trip/create";');
    expect(chooserSource).toContain(
      'if (offering === "experience") return "/experience/create";',
    );
    expect(chooserSource).toContain('return "/event/create";');
  });
});
