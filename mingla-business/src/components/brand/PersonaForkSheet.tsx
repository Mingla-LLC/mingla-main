/**
 * Ve1 — persona fork reuses the same card primitive as BrandSwitcherSheet.
 */

import React from "react";

import {
  PersonaPickerCards,
  type PersonaDef,
  type PersonaPickerCardsProps,
} from "./PersonaPickerCards";

export type { PersonaDef };

export type PersonaForkSheetProps = PersonaPickerCardsProps;

export const PersonaForkSheet: React.FC<PersonaForkSheetProps> = (props) => (
  <PersonaPickerCards {...props} />
);

export default PersonaForkSheet;
