/**
 * Input variant behaviour table — extracted to a pure-data sibling so the
 * ORCH-0823 regression test at __tests__/Input.variantBehaviour.test.tsx
 * can import it from the node test environment without pulling in the
 * JSX-containing Input.tsx component module.
 *
 * Why: ORCH-0823 — no variant may inherit RN platform defaults on free-text
 * Mingla fields. Two distinct iOS UIKit defects had to be neutralised:
 *
 *   Path B (autocorrect smart-replacement) — fixed by autoCorrect: false on
 *     every variant. Without it, iOS substitutes near-misses (e.g. "Big P"
 *     → "Bigot") and visually erases user input.
 *
 *   Path A (autoCapitalize="sentences" + hardware capslock collision) —
 *     fixed by autoCapitalize: "none" on the text variant. With "sentences"
 *     active and a pending trailing space, pressing the hardware caps-lock
 *     key causes iOS to silently delete the trailing space from the buffer
 *     BEFORE the next character is processed. The patched-build QA on
 *     2026-05-13 proved this in isolation (evidence:
 *     Mingla_Artifacts/evidence/ORCH-0823-test/T01-CLEAN-3.png).
 *
 * Every variant MUST declare autoCorrect AND autoCapitalize explicitly.
 * No variant may use autoCapitalize: "sentences" — that mode is incompatible
 * with hardware-keyboard capslock interaction.
 */

import type { TextInputProps } from "react-native";

export type InputVariant =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "password"
  | "search";

export type VariantBehaviour = Pick<
  TextInputProps,
  "keyboardType" | "autoCapitalize" | "autoComplete" | "autoCorrect"
>;

export const VARIANT_BEHAVIOUR: Record<InputVariant, VariantBehaviour> = {
  text: {
    autoCorrect: false,
    // ORCH-0823 v2 rework: must NOT be "sentences" — see Path A above.
    // "none" matches every other free-text Input variant in mingla-business
    // (ticket name, address, search, etc.) and fully eliminates Path A.
    // User-typed capitals (proper nouns, brand names) require shift; matches
    // sibling mobile-input conventions.
    autoCapitalize: "none",
  },
  email: {
    keyboardType: "email-address",
    autoCorrect: false,
    autoCapitalize: "none",
    autoComplete: "email",
  },
  phone: {
    keyboardType: "phone-pad",
    autoCorrect: false,
    autoCapitalize: "none",
    autoComplete: "tel",
  },
  number: {
    keyboardType: "numeric",
    autoCorrect: false,
    autoCapitalize: "none",
  },
  password: {
    autoCorrect: false,
    autoCapitalize: "none",
    autoComplete: "password",
  },
  search: {
    autoCorrect: false,
    autoCapitalize: "none",
  },
};
