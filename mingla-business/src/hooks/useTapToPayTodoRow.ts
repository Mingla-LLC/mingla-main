/**
 * #4389 HT — "Not now" on Home's Tap to Pay card becomes a To do row (Hub and
 * Home), until Tap to Pay is set up on this phone. Native only: the web build
 * (useTapToPayTodoRow.web.ts) answers null, as this hook always did there
 * (useTapToPaySettingsEntry is null on the web), so the web boot skips the
 * Home setup words, the prompt store read and the warm hint.
 */
import { Platform } from "react-native";

import { useTapToPaySettingsEntry } from "./useTapToPaySettingsEntry";
import { tapToPayBrandEligible } from "../utils/tapToPayBrandEligible";
import { useTapToPayWarmHint } from "./useTapToPayWarmHint";
import {
  homeSetupPromptKey,
  useHomeSetupPromptStore,
} from "../store/homeSetupPromptStore";
import { HOME_SETUP_TAP_COPY } from "../components/home/homeSetupTapCopy";
import type { TapToPayTodoRow } from "../utils/businessTodos";

export function useTapToPayTodoRow(input: {
  userId: string | null;
  brandId: string | null;
  setupComplete: boolean;
  brand: Parameters<typeof tapToPayBrandEligible>[0];
}): TapToPayTodoRow | null {
  const { userId, brandId, setupComplete, brand } = input;
  const tapEntry = useTapToPaySettingsEntry(brandId);
  const tapHint = useTapToPayWarmHint(tapEntry !== null ? brandId : null);
  const promptHydrated = useHomeSetupPromptStore((st) => st.hasHydrated);
  const tapNotNow = useHomeSetupPromptStore((st) =>
    userId !== null && brandId !== null
      ? st.tapNotNow[homeSetupPromptKey(userId, brandId)] === true
      : false,
  );
  return promptHydrated &&
    tapNotNow &&
    tapEntry !== null &&
    tapHint === false &&
    setupComplete &&
    tapToPayBrandEligible(brand) &&
    brandId !== null
    ? {
        label:
          Platform.OS === "ios"
            ? HOME_SETUP_TAP_COPY.ht.todoIos
            : HOME_SETUP_TAP_COPY.ht.todoAndroid,
        sublabel: HOME_SETUP_TAP_COPY.ht.todoSub,
        route: `/account/tap-to-pay?brandId=${encodeURIComponent(brandId)}`,
      }
    : null;
}
