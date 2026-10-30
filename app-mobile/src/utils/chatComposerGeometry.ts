export const CHAT_COMPOSER_SURFACE_GAP = 8;

type ChatComposerPlatform = "ios" | "android" | "web";

export interface ChatComposerBottomInput {
  platform: ChatComposerPlatform;
  keyboardVisible: boolean;
  keyboardHeight: number;
  keyboardToolbarHeight: number;
  floatingNavBottom: number;
  androidSafeAreaBottom: number;
  androidWindowShrinkAmount: number;
}

/**
 * Resolve the composer's absolute `bottom` value without double-counting the
 * floating nav, Android resize, or the global Done toolbar.
 */
export function resolveChatComposerBottom({
  platform,
  keyboardVisible,
  keyboardHeight,
  keyboardToolbarHeight,
  floatingNavBottom,
  androidSafeAreaBottom,
  androidWindowShrinkAmount,
}: ChatComposerBottomInput): number {
  if (!keyboardVisible) {
    return Math.max(0, floatingNavBottom);
  }

  const keyboardLift =
    platform === "android"
      ? Math.max(
          0,
          keyboardHeight + androidSafeAreaBottom - androidWindowShrinkAmount,
        )
      : Math.max(0, keyboardHeight);

  return keyboardLift + keyboardToolbarHeight + CHAT_COMPOSER_SURFACE_GAP;
}
