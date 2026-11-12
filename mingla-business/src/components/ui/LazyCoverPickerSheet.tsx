/**
 * #4389 — the one way screens mount the cover picker sheet. Native: the sheet
 * itself, unchanged. Web (LazyCoverPickerSheet.web.tsx): the sheet's code
 * loads on intent (first open), because thirteen web chunks render it and
 * Metro would otherwise hoist it into the eager web __common chunk. Do not
 * import ./CoverPickerSheet from a screen.
 */
export { CoverPickerSheet } from "./CoverPickerSheet";
export type { CoverPickerSheetProps } from "./CoverPickerSheet";
