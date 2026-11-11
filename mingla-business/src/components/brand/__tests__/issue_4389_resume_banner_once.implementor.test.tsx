/**
 * #4389 P2 R1 — "Welcome back. You stopped at…" showed on every normal step
 * advance and NOT on a real resume after relaunch. The route set
 * `resumed = step !== null`: F1's own hop to `?step=country` counted as a
 * resume, while Home / Ari / switcher open `/brand/{id}/setup` with no step.
 *
 * Fix: a hop inside the setup carries `from=flow` (setupFlowHop); every other
 * cold open of the route is a resume. The banner shows once, on the first step
 * the checklist puts the host on, and goes when the host moves on.
 *
 * FAILS ON REVERT: `resumed={params.resumed === "1" || step !== null}` → T1;
 * F1 hop without setupFlowHop → T2; banner not latched to its first step → T4.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

const mockFlowProps: Array<Record<string, unknown>> = [];

/* eslint-disable import/first */
import {
  BrandCreationFlow,
  byLabel,
  checklistAt,
  harness,
  mount,
  press,
  rerender,
  resetHarness,
  unmountAll,
} from "./issue4389FlowHarness";
import { BRAND_SETUP_COPY as C } from "../brandSetupCopy";
import { setupFlowHop } from "../../../services/brandSetupService";
/* eslint-enable import/first */

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../LazyBrandCreationFlow", () => ({
  LazyBrandCreationFlow: (p: Record<string, unknown>) => {
    mockFlowProps.push(p);
    return null;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BrandSetupRoute = (require("../../../../app/brand/[id]/setup") as { default: React.FC }).default;

const ID = "43890000-0000-4000-8000-0000000000c1";
const banner = (step: "country" | "pay"): string => C.common.resume(C.stepNames[step]);

describe("#4389 R1 — the resume banner shows once, only on a resume", () => {
  beforeEach(() => {
    resetHarness();
    mockFlowProps.length = 0;
  });
  afterEach(() => unmountAll());

  test("T1: the route calls a cold open a resume, and a setup hop not", async () => {
    harness.params = { id: ID };
    await mount(<BrandSetupRoute />);
    harness.params = { id: ID, step: "country", from: "flow" };
    await mount(<BrandSetupRoute />);
    harness.params = { id: ID, step: "pay" };
    await mount(<BrandSetupRoute />);
    expect(mockFlowProps.map((p) => p.resumed)).toEqual([true, false, true]);
  });

  test("T2: F1's hop to F2 and the secure-setup returns are setup hops", () => {
    expect(setupFlowHop(`/brand/${ID}/setup?step=country`)).toBe(`/brand/${ID}/setup?step=country&from=flow`);
    expect(setupFlowHop(`/brand/${ID}/setup`)).toBe(`/brand/${ID}/setup?from=flow`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const flow = fs.readFileSync(path.join(__dirname, "../BrandCreationFlow.tsx"), "utf8");
    expect(flow).toContain("router.replace(setupFlowHop(`/brand/${id}/setup?step=country`)");
    const onboard = fs.readFileSync(path.join(__dirname, "../../../../app/brand/[id]/payments/onboard.tsx"), "utf8");
    expect(onboard.match(/setupFlowHop\(/g)?.length).toBe(2);
  });

  test("T3: no banner on a hop inside the setup", async () => {
    harness.checklist = checklistAt("country");
    const t = await mount(<BrandCreationFlow brandId={ID} requestedStep="country" resumed={false} onExit={() => undefined} />);
    expect(byLabel(t, banner("country"))).toHaveLength(0);
  });

  test("T4: on a resume it shows on the first step, then goes once the host moves on", async () => {
    harness.checklist = checklistAt("country");
    harness.saveCountry.mockImplementation((_c, o) => o.onSuccess?.());
    const t = await mount(<BrandCreationFlow brandId={ID} resumed onExit={() => undefined} />);
    expect(byLabel(t, banner("country"))).toHaveLength(1);

    await press(t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "payout-country-list-row-US")[0]);
    await press(t.root.findAll((n) => typeof n.type === "string" && n.props.testID === "brand-setup-country-continue")[0]);
    harness.checklist = checklistAt("pay");
    await rerender(t, <BrandCreationFlow brandId={ID} resumed onExit={() => undefined} />);
    expect(byLabel(t, banner("pay"))).toHaveLength(0);
    expect(byLabel(t, banner("country"))).toHaveLength(0);
  });
});
