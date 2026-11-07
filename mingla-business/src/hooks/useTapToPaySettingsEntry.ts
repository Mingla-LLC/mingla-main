/**
 * #4271 — the Settings way in (Apple 3.6, 4.3), so a host can enable Tap to Pay and
 * re-find the guide outside a sale. Every surface reads the same release value:
 * null means show nothing, never a greyed row.
 */
import { Platform } from "react-native";

import { tapToPayName } from "../constants/tapToPayName";
import { currentTapToPayDevice, isTapToPayDeviceSupported } from "../services/terminal/tapToPayDevice";
import { useTapToPayRelease } from "./useTapToPayRelease";

export const useTapToPaySettingsEntry = (brandId: string | null): { label: string } | null => {
  const { live } = useTapToPayRelease(brandId);
  if (!live || !isTapToPayDeviceSupported(currentTapToPayDevice())) return null;
  return { label: tapToPayName(Platform.OS) };
};

export { tapToPayBrandEligible } from "../utils/tapToPayBrandEligible";
