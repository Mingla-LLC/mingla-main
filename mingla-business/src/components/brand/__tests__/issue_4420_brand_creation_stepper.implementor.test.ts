/**
 * #4420 B7 — PartnerClientBrandCreationFlow is wired to the clickable Stepper.
 * Reachable = a step the wizard already passed; forward moves stay on Continue
 * (they are server writes), and "For" (step 0) is a partner-only target, the
 * same floor Back uses.
 */
import { describe, expect, jest, test } from "@jest/globals";

// The reducer and the target map are pure; stub the screen's UI imports so the
// suite never loads native animation code.
const stubModule = (): Record<string, unknown> =>
  new Proxy({ __esModule: true } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : () => null),
  });
jest.mock("../../ui/Button", () => stubModule());
jest.mock("../../ui/GlassCard", () => stubModule());
jest.mock("../../ui/Icon", () => stubModule());
jest.mock("../../ui/Input", () => stubModule());
jest.mock("../../ui/Stepper", () => stubModule());
jest.mock("../../ui/Toast", () => stubModule());
jest.mock("../../ui/CoverPickerSheet", () => stubModule());
jest.mock("../../location/AddressInput", () => stubModule());
jest.mock("../../ui/EventCoverMedia", () => stubModule());
jest.mock("../../../wrappers/useKeyboardIsVisible", () => stubModule());
jest.mock("expo-haptics", () => stubModule());
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({}),
}));

import {
  BRAND_CREATION_INITIAL_STATE,
  brandCreationReducer,
  brandCreationStepperTarget,
  type BrandCreationState,
} from "../PartnerClientBrandCreationFlow";

const at = (patch: Partial<BrandCreationState>): BrandCreationState => ({
  ...BRAND_CREATION_INITIAL_STATE,
  ...patch,
});

describe("#4420 brand creation stepper", () => {
  test("self mode: a passed step maps to its reducer step", () => {
    // currentIndex 4 = Create (step 6)
    expect(brandCreationStepperTarget("self", 4, 0, false)).toBe(1);
    expect(brandCreationStepperTarget("self", 4, 1, false)).toBe(2);
    expect(brandCreationStepperTarget("self", 4, 2, false)).toBe(3);
    expect(brandCreationStepperTarget("self", 4, 3, false)).toBe(4);
  });

  test("the current and later steps are not reachable", () => {
    expect(brandCreationStepperTarget("self", 2, 2, false)).toBeNull();
    expect(brandCreationStepperTarget("self", 2, 3, false)).toBeNull();
    expect(brandCreationStepperTarget("self", 2, 4, true)).toBeNull();
  });

  test("client mode: For is reachable for partners only, Invite maps to step 5's predecessors", () => {
    expect(brandCreationStepperTarget("client", 4, 0, true)).toBe(0);
    expect(brandCreationStepperTarget("client", 4, 0, false)).toBeNull();
    expect(brandCreationStepperTarget("client", 4, 3, true)).toBe(3);
  });

  test("goTo jumps back and never forward", () => {
    expect(brandCreationReducer(at({ step: 6 }), { type: "goTo", step: 2 }).step).toBe(2);
    const stay = at({ step: 2 });
    expect(brandCreationReducer(stay, { type: "goTo", step: 4 })).toBe(stay);
    expect(brandCreationReducer(stay, { type: "goTo", step: 2 })).toBe(stay);
  });

  test("goTo keeps everything the host already entered", () => {
    const filled = at({ step: 5, mode: "client", name: "Nora's", bio: "Bar", brandId: "b1" });
    const back = brandCreationReducer(filled, { type: "goTo", step: 1 });
    expect(back).toEqual({ ...filled, step: 1 });
  });
});
