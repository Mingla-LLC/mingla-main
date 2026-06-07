import { Platform } from "react-native";

export function isMobileBusinessWeb(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;

  const nav = window.navigator;
  const userAgent = nav?.userAgent ?? "";
  const coarseOrNarrow =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;

  return coarseOrNarrow || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function redirectMobileBusinessWebToStaticHome(): boolean {
  if (!isMobileBusinessWeb()) return false;
  window.location.replace("/home");
  return true;
}
