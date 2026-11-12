/**
 * #4389 HT — web build of useTapToPayTodoRow. Tap to Pay never runs on the
 * web (useTapToPaySettingsEntry.web.ts is always null), so there is never a
 * Tap to Pay To do row there.
 */
import type { TapToPayTodoRow } from "../utils/businessTodos";

export function useTapToPayTodoRow(_input: {
  userId: string | null;
  brandId: string | null;
  setupComplete: boolean;
  brand: unknown;
}): TapToPayTodoRow | null {
  return null;
}
