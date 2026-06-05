import React from "react";

import type { ResolvedTheme } from "./designTokens";

interface ThemeEntranceAnimationProps {
  theme: ResolvedTheme;
  sessionKey: string;
  replayOnMount?: boolean;
}

export const ThemeEntranceAnimation: React.FC<ThemeEntranceAnimationProps> = () =>
  null;
