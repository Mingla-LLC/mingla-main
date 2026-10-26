/**
 * Issue #4114 Wave 3: Android back inside a chat thread. Closes the top-most
 * open layer first (threadModel.resolveChatBack), then the thread itself.
 *
 * Registered once; it reads the latest open layers, closers and onBack from
 * refs. Sheets that register their own back handler after this one (and RN
 * Modals, which take the press natively) still get the press first.
 */
import { useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";
import { resolveChatBack, type ChatBackLayer } from "../utils/threadModel";

export function useChatBackHandler(
  openLayers: Partial<Record<ChatBackLayer, boolean>>,
  closers: Record<ChatBackLayer, () => void>,
  onBack: () => void,
): void {
  const backLayersRef = useRef(openLayers);
  backLayersRef.current = openLayers;
  const closersRef = useRef(closers);
  closersRef.current = closers;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const target = resolveChatBack(backLayersRef.current);
      if (target === "leaveThread") {
        onBackRef.current();
      } else {
        closersRef.current[target]();
      }
      return true;
    });
    return () => sub.remove();
  }, []);
}
