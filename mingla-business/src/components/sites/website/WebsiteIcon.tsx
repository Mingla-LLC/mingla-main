import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { text as textTokens } from "../../../constants/designSystem";

/*
 * #2829 W9r — the Website section's icons (the approved prototype's set,
 * 24-unit grid, 1.8 stroke). Local to the Website chunk so the shared Icon
 * registry (boot payload) doesn't grow. Decorative: callers label controls.
 */
export type WebsiteIconName =
  | "home" | "pages" | "palette" | "pin" | "book" | "quote" | "clock" | "globe" | "plan" | "upload" | "cog"
  | "right" | "left" | "up" | "down" | "eye" | "eyeoff" | "plus" | "check" | "alert" | "lock" | "copy"
  | "ext" | "spark" | "image" | "video" | "trash" | "search" | "x" | "pause" | "drag" | "download" | "power"
  | "msg" | "edit" | "monitor" | "tablet" | "phone" | "rotate" | "history";

function shapes(name: WebsiteIconName): React.ReactNode {
  switch (name) {
    case "home": return <><Path d="M3 11l9-7 9 7" /><Path d="M5 10v10h14V10" /></>;
    case "pages": return <><Rect x={4} y={3} width={16} height={18} rx={2} /><Path d="M8 8h8M8 12h8M8 16h5" /></>;
    case "palette": return <><Path d="M12 3a9 9 0 100 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A3.6 3.6 0 0021 10.8C21 6.5 17 3 12 3z" /><Circle cx={7.5} cy={11} r={1} /><Circle cx={10} cy={7} r={1} /><Circle cx={15} cy={7} r={1} /></>;
    case "pin": return <><Path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" /><Circle cx={12} cy={10} r={2.5} /></>;
    case "book": return <><Path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" /><Path d="M4 19V5" /></>;
    case "quote": return <Path d="M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6" />;
    case "clock": return <><Circle cx={12} cy={12} r={9} /><Path d="M12 7v5l3 2" /></>;
    case "globe": return <><Circle cx={12} cy={12} r={9} /><Path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></>;
    case "plan": return <><Path d="M9 6h11M9 12h11M9 18h11" /><Path d="M4 6l1 1 2-2M4 12l1 1 2-2" /><Circle cx={5} cy={18} r={1} /></>;
    case "upload": return <><Path d="M12 16V4M7 9l5-5 5 5" /><Path d="M4 16v4h16v-4" /></>;
    case "cog": return <><Circle cx={12} cy={12} r={3} /><Path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 009 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003.6 14H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 9a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 009 3.6V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 110 4h-.1c-.6 0-1.2.4-1.5 1z" /></>;
    case "right": return <Path d="M9 6l6 6-6 6" />;
    case "left": return <Path d="M15 6l-6 6 6 6" />;
    case "up": return <Path d="M6 15l6-6 6 6" />;
    case "down": return <Path d="M6 9l6 6 6-6" />;
    case "eye": return <><Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><Circle cx={12} cy={12} r={3} /></>;
    case "eyeoff": return <Path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.1 3.9M6.6 6.6A17 17 0 002 12s3.6 7 10 7a9.6 9.6 0 004.4-1" />;
    case "plus": return <Path d="M12 5v14M5 12h14" />;
    case "check": return <Path d="M5 12l5 5 9-10" />;
    case "alert": return <><Path d="M12 3l10 18H2z" /><Path d="M12 10v4M12 17.5v.5" /></>;
    case "lock": return <><Rect x={5} y={11} width={14} height={10} rx={2} /><Path d="M8 11V7a4 4 0 018 0v4" /></>;
    case "copy": return <><Rect x={9} y={9} width={11} height={11} rx={2} /><Path d="M5 15V5a2 2 0 012-2h8" /></>;
    case "ext": return <><Path d="M14 4h6v6M20 4l-9 9" /><Path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>;
    case "spark": return <><Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><Path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></>;
    case "image": return <><Rect x={3} y={4} width={18} height={16} rx={2} /><Circle cx={9} cy={10} r={2} /><Path d="M21 16l-5-5-9 9" /></>;
    case "video": return <><Rect x={3} y={5} width={13} height={14} rx={2} /><Path d="M16 10l5-3v10l-5-3" /></>;
    case "trash": return <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />;
    case "search": return <><Circle cx={11} cy={11} r={7} /><Path d="M20 20l-4-4" /></>;
    case "x": return <Path d="M6 6l12 12M18 6L6 18" />;
    case "pause": return <Path d="M9 5v14M15 5v14" />;
    case "drag": return <><Circle cx={9} cy={6} r={1} /><Circle cx={15} cy={6} r={1} /><Circle cx={9} cy={12} r={1} /><Circle cx={15} cy={12} r={1} /><Circle cx={9} cy={18} r={1} /><Circle cx={15} cy={18} r={1} /></>;
    case "download": return <><Path d="M12 4v12M7 11l5 5 5-5" /><Path d="M4 20h16" /></>;
    case "power": return <><Path d="M12 3v9" /><Path d="M6.3 7.3a8 8 0 1011.4 0" /></>;
    case "msg": return <Path d="M4 5h16v11H8l-4 4z" />;
    case "edit": return <Path d="M4 20h4L19 9l-4-4L4 16z" />;
    case "monitor": return <><Rect x={2} y={4} width={20} height={13} rx={2} /><Path d="M8 21h8M12 17v4" /></>;
    case "tablet": return <><Rect x={5} y={2} width={14} height={20} rx={2} /><Path d="M11 18h2" /></>;
    case "phone": return <><Rect x={7} y={2} width={10} height={20} rx={2} /><Path d="M11 18h2" /></>;
    case "rotate": return <><Path d="M21 12a9 9 0 11-3-6.7L21 8" /><Path d="M21 3v5h-5" /></>;
    case "history": return <><Path d="M3 12a9 9 0 103-6.7L3 8" /><Path d="M3 3v5h5M12 7v5l3 2" /></>;
  }
}

export function WebsiteIcon({ name, size = 18, color = textTokens.primary }: {
  name: WebsiteIconName;
  size?: number;
  color?: string;
}): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shapes(name)}
    </Svg>
  );
}
