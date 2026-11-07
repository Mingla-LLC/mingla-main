/**
 * #2830 setup polish, bugs 4 and 5 — the setup form agrees with Ari:
 *  - the Address helper reads the City and country Ari just saved;
 *  - "Next" goes to the next OPEN part;
 *  - when Ari moves on to another part, the form goes with it (a part opened
 *    by hand afterwards stays until Ari moves again);
 *  - the trip creator's way back reopens Ari if it was open;
 *  - "Add it myself" in the panel opens the field on this screen.
 */
import fs from "fs";
import path from "path";
import React from "react";

const mockAddressProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock("../../../brand/BrandEditAddressField", () => ({
  BrandEditAddressField: (props: Record<string, unknown>) => {
    mockAddressProps.current = props;
    return null;
  },
}));
jest.mock("../../website/WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() } }));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true, user: { id: "u" } }) }));
jest.mock("../../../../hooks/useBrands", () => ({
  // The brand row as the screen last read it: no city yet.
  useBrand: () => ({ isLoading: false, data: { id: "b", displayName: "Lantern Room", contact: {}, links: {} }, refetch: jest.fn() }),
  useUpdateBrand: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../../theme/ThemeControlRow", () => ({ ThemeControlRow: () => null }));
jest.mock("../../../theme/ThemeSheet", () => ({ ThemeSheet: () => null }));
jest.mock("../../../ui/Input", () => ({ Input: () => null, PHONE_COUNTRIES: [] }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SetupBrandStep } from "../SetupBrandStep";
import { ariStepToFollow, nextOpenStep, setupSteps } from "../../../../sites/setupStatus";
import type { SitePlanState } from "../../../../sites/sitePlanState";
import { isSetupReturn } from "../../../../utils/brandEditReturn";
import { setupHandoff } from "../../../../screens/ari/setupFlowRoute";

type TestNode = { props: Record<string, any>; children: (TestNode | string)[]; findAll: (test: (node: TestNode) => boolean) => TestNode[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => unknown) => Promise<void> & void;
  create: (node: React.ReactElement) => { root: TestNode; update: (node: React.ReactElement) => void };
};
const noop = () => undefined;

const fieldRow = (key: string, label: string, state: string, value: unknown = null, requirement = "recommended") => ({
  key, label, group: "Brand", requirement, state, value,
  sourceType: null, sourceRef: null, sourceUrl: null, observedAt: null, ownerConfirmedAt: null, exceptionReason: null, humanActionRequired: false,
});
const planWith = (fields: ReturnType<typeof fieldRow>[]) => ({
  completeness: { contextRevision: "c".repeat(64), fields },
}) as unknown as SitePlanState;

const read = (relative: string) => fs.readFileSync(path.join(__dirname, relative), "utf8");

describe("#2830 bug 4 — the setup form agrees with Ari", () => {
  it("the Address helper reads the City and country Ari saved", async () => {
    mockAddressProps.current = null;
    const plan = planWith([
      fieldRow("name", "Brand name", "verified", "Lantern Room", "required"),
      fieldRow("city_country", "City and country", "verified", { city: "Accra", country_code: "GH" }),
      fieldRow("address", "Address", "missing"),
    ]);
    await act(async () => {
      create(<QueryClientProvider client={new QueryClient()}><SetupBrandStep brandId="b" plan={plan} readOnly={false} hotField={null} onNext={noop} nextStepLabel={null} /></QueryClientProvider>);
    });
    // React.lazy resolves on the next turn.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const props = mockAddressProps.current as Record<string, unknown> | null;
    expect(props?.city).toBe("Accra");
    expect(props?.countryCode).toBe("GH");
  });

  it("Next goes to the next open part, never one already done", () => {
    const parts = ["offer", "brand", "look", "story", "approve", "build", "first_offering", "publish"] as const;
    const { steps } = setupSteps({
      setupStatus: {
        doneCount: 2, nextPart: "brand", total: 8,
        parts: parts.map((key) => ({ key, done: key === "offer" || key === "look", skipped: false, fieldCount: 1, openFields: [] })),
      },
      fields: [],
      draftFailed: false,
      publishFailed: false,
    });
    expect(nextOpenStep(steps, "brand")).toBe("story");
    expect(read("../WebsiteSetupScreen.tsx")).toContain('const next = nextOpenStep(status.steps, "brand");');
  });

  it("the form follows Ari's part; a part opened by hand stays until Ari moves again", () => {
    let seen: string | null = null;
    const opened: string[] = [];
    const ari = (stepKey: string | null) => {
      const follow = ariStepToFollow(seen, stepKey);
      if (stepKey) seen = stepKey;
      if (follow) opened.push(follow);
    };
    ari(null);
    ari("brand");
    ari("brand"); // re-rendered, not moved
    // The person opens Your story by hand here: nothing from Ari repeats.
    ari("brand");
    ari("look");
    ari("not_a_part");
    expect(opened).toEqual(["brand", "look"]);
    expect(read("../../../../screens/ari/AriChatScreen.tsx")).toMatch(/onFlowStep\?\.\(flowStepKey\)/);
  });

  it("the way back from the trip creator reopens Ari when it was open", () => {
    expect(isSetupReturn("/brand/b1/website/setup?step=first_offering&ari=1")).toBe(true);
    expect(read("../WebsiteSetupScreen.tsx")).toContain('setup?step=first_offering${ariOpen ? "&ari=1" : ""}');
    expect(read("../../../../screens/ari/AriChatScreen.tsx")).toContain("/website/setup?step=first_offering&ari=1");
  });
});

describe("#2830 bug 5 — Add it myself stays on the setup screen", () => {
  it("Brand edit's route is the Brand details part at the field Ari asked about", () => {
    expect(setupHandoff("/brand/b1/edit", "b1", "contact_email")).toEqual({ step: "brand", field: "contact_email" });
    expect(setupHandoff("/brand/b1/edit?section=contact", "b1", null)).toEqual({ step: "brand", field: null });
    expect(setupHandoff("/support/inbox", "b1", "contact_email")).toBeNull();
  });

  it("a card's route beside the form goes through the setup screen, not Brand edit", () => {
    const screen = read("../../../../screens/ari/AriChatScreen.tsx");
    const route = screen.slice(screen.indexOf('if (behavior.type === "route") {'));
    expect(route.slice(0, 400)).toMatch(/if \(setup\) \{\s*openSetupRoute\(behavior\.route\);/);
  });

  it("the requested field is the one in view", async () => {
    const plan = planWith([
      fieldRow("name", "Brand name", "missing", null, "required"),
      fieldRow("contact_email", "Contact email", "missing"),
    ]);
    let tree!: { root: TestNode; update: (node: React.ReactElement) => void };
    const at = (focusRequest: { key: string; at: number } | null) => (
      <QueryClientProvider client={new QueryClient()}>
        <SetupBrandStep brandId="b" plan={plan} readOnly={false} hotField={null} focusRequest={focusRequest} onNext={noop} nextStepLabel={null} />
      </QueryClientProvider>
    );
    await act(async () => { tree = create(at(null)); });
    const hot = (key: string) => tree.root.findAll((n) =>
      Array.isArray(n.props.style) && n.props.style.some((style: { borderLeftWidth?: number } | null) => style?.borderLeftWidth === 2) &&
      n.findAll((child) => child.props.testID === `setup-field-${key}`).length > 0,
    ).length > 0;
    expect(hot("name")).toBe(true);
    expect(hot("contact_email")).toBe(false);
    await act(async () => { tree.update(at({ key: "contact_email", at: 1 })); });
    expect(hot("contact_email")).toBe(true);
    expect(hot("name")).toBe(false);
  });
});
