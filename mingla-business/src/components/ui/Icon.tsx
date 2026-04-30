/**
 * Icon — 69 SVG glyphs ported verbatim from
 * `Mingla_Artifacts/design-package/.../primitives.jsx:9–79`.
 *
 * Web source uses `fill="currentColor"` on filled paths; RN SVG does not
 * support `currentColor`, so we thread the `color` prop through on every
 * path that needs a fill. Stroked paths inherit `stroke` from the parent
 * `<Svg>` element.
 */

import React from "react";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import type { StyleProp, ViewStyle } from "react-native";

import { text as textTokens } from "../../constants/designSystem";

export type IconName =
  | "home"
  | "calendar"
  | "chat"
  | "user"
  | "plus"
  | "chevR"
  | "chevL"
  | "chevD"
  | "chevU"
  | "close"
  | "check"
  | "search"
  | "bell"
  | "qr"
  | "scan"
  | "share"
  | "edit"
  | "pound"
  | "trash"
  | "settings"
  | "google"
  | "apple"
  | "arrowL"
  | "moreH"
  | "flash"
  | "location"
  | "clock"
  | "ticket"
  | "eye"
  | "cash"
  | "tap"
  | "list"
  | "grid"
  | "refund"
  | "sparkle"
  | "flag"
  | "flashOn"
  | "keypad"
  | "backspace"
  | "star"
  | "mail"
  | "sms"
  | "chart"
  | "pieChart"
  | "funnel"
  | "link"
  | "users"
  | "tag"
  | "send"
  | "play"
  | "pause"
  | "template"
  | "upload"
  | "download"
  | "filter"
  | "branch"
  | "shield"
  | "receipt"
  | "bank"
  | "nfc"
  | "swap"
  | "target"
  | "calendarPlus"
  | "globe"
  | "rocket"
  | "notebook"
  | "award"
  | "trending"
  | "inbox"
  | "phone"
  | "instagram"
  | "tiktok"
  | "x"
  | "facebook"
  | "youtube"
  | "linkedin"
  | "threads";

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

type Renderer = (color: string) => React.ReactNode;

const RENDERERS: Record<IconName, Renderer> = {
  home: () => <Path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z" />,
  calendar: () => (
    <>
      <Rect x="3" y="5" width="18" height="16" rx="2" />
      <Path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  chat: () => <Path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z" />,
  user: () => (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </>
  ),
  plus: () => <Path d="M12 5v14M5 12h14" />,
  chevR: () => <Path d="M9 6l6 6-6 6" />,
  chevL: () => <Path d="M15 6l-6 6 6 6" />,
  chevD: () => <Path d="M6 9l6 6 6-6" />,
  chevU: () => <Path d="M6 15l6-6 6 6" />,
  close: () => <Path d="M18 6L6 18M6 6l12 12" />,
  check: () => <Path d="M5 13l4 4L19 7" />,
  search: () => (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M21 21l-4.3-4.3" />
    </>
  ),
  bell: () => <Path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 3h16l-2-3zM10 21a2 2 0 0 0 4 0" />,
  qr: () => (
    <>
      <Rect x="3" y="3" width="7" height="7" rx="1" />
      <Rect x="14" y="3" width="7" height="7" rx="1" />
      <Rect x="3" y="14" width="7" height="7" rx="1" />
      <Path d="M14 14h3v3h-3zM20 14v3M14 20h3M17 17h4v4" />
    </>
  ),
  scan: () => <Path d="M3 7V5a2 2 0 0 1 2-2h2M21 7V5a2 2 0 0 0-2-2h-2M3 17v2a2 2 0 0 0 2 2h2M21 17v2a2 2 0 0 1-2 2h-2M7 12h10" />,
  share: () => (
    <>
      <Circle cx="6" cy="12" r="2.5" />
      <Circle cx="18" cy="6" r="2.5" />
      <Circle cx="18" cy="18" r="2.5" />
      <Path d="M8.2 10.8L15.8 7.2M8.2 13.2L15.8 16.8" />
    </>
  ),
  edit: () => <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />,
  pound: () => <Path d="M16 5a4 4 0 0 0-7 3l-1 6H6m11 4a4 4 0 0 1-3-1.5 4 4 0 0 0-3-1.5H6m12 0H6" />,
  trash: () => <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />,
  settings: () => (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  // Google brand colours below are the externally-specified, official
  // Google logo palette and cannot be tokenised. Same for the apple icon
  // we leave the stroke colour caller-controlled.
  google: () => (
    <>
      <Path d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5c-.2 1.3-1 2.4-2 3.1v2.6h3.3c2-1.8 3-4.5 3-7.5z" fill="#4285F4" stroke="none" />
      <Path d="M12 22c2.7 0 5-1 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3v2.6A10 10 0 0 0 12 22z" fill="#34A853" stroke="none" />
      <Path d="M6.4 14a6 6 0 0 1 0-3.8V7.6H3a10 10 0 0 0 0 8.8L6.4 14z" fill="#FBBC04" stroke="none" />
      <Path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C17 2.9 14.7 2 12 2A10 10 0 0 0 3 7.6L6.4 10c.8-2.4 3-4.1 5.6-4.1z" fill="#EA4335" stroke="none" />
    </>
  ),
  apple: (color) => (
    <Path d="M16.5 2c.1 1.4-.4 2.7-1.3 3.6-.9 1-2.3 1.7-3.6 1.6-.1-1.3.5-2.7 1.4-3.6.9-1 2.3-1.5 3.5-1.6zM20.7 17c-.6 1.3-.9 1.9-1.6 3-1 1.6-2.4 3.5-4.2 3.5-1.6 0-2-1-4.2-1-2.2 0-2.7 1-4.2 1-1.8 0-3.1-1.7-4.1-3.3-2.7-4.4-3-9.5-1.3-12.3 1.2-2 3.1-3.1 4.9-3.1 1.8 0 3 1 4.5 1 1.5 0 2.4-1 4.5-1 1.6 0 3.3.9 4.5 2.4-4 2.2-3.3 7.9.2 9.8z" fill={color} stroke="none" />
  ),
  arrowL: () => <Path d="M19 12H5M12 19l-7-7 7-7" />,
  moreH: (color) => (
    <>
      <Circle cx="5" cy="12" r="1.5" fill={color} stroke="none" />
      <Circle cx="12" cy="12" r="1.5" fill={color} stroke="none" />
      <Circle cx="19" cy="12" r="1.5" fill={color} stroke="none" />
    </>
  ),
  flash: () => <Path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />,
  location: () => (
    <>
      <Path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
      <Circle cx="12" cy="10" r="3" />
    </>
  ),
  clock: () => (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  ticket: () => (
    <>
      <Path d="M3 9V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" />
      <Path d="M13 5v3M13 12v0M13 16v3" />
    </>
  ),
  eye: () => (
    <>
      <Path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  cash: () => (
    <>
      <Rect x="2" y="6" width="20" height="12" rx="2" />
      <Circle cx="12" cy="12" r="3" />
      <Path d="M6 10v0M18 14v0" />
    </>
  ),
  tap: () => (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
    </>
  ),
  list: () => <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  grid: () => (
    <>
      <Rect x="3" y="3" width="7" height="7" />
      <Rect x="14" y="3" width="7" height="7" />
      <Rect x="3" y="14" width="7" height="7" />
      <Rect x="14" y="14" width="7" height="7" />
    </>
  ),
  refund: () => <Path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  sparkle: () => <Path d="M12 3l1.5 5L18 9.5l-4.5 1.5L12 16l-1.5-5L6 9.5 10.5 8 12 3zM18 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />,
  flag: () => <Path d="M4 22V4M4 4h13l-2 4 2 4H4" />,
  flashOn: (color) => <Path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" fill={color} />,
  keypad: (color) => (
    <>
      <Circle cx="6" cy="6" r="1.5" fill={color} stroke="none" />
      <Circle cx="12" cy="6" r="1.5" fill={color} stroke="none" />
      <Circle cx="18" cy="6" r="1.5" fill={color} stroke="none" />
      <Circle cx="6" cy="12" r="1.5" fill={color} stroke="none" />
      <Circle cx="12" cy="12" r="1.5" fill={color} stroke="none" />
      <Circle cx="18" cy="12" r="1.5" fill={color} stroke="none" />
      <Circle cx="6" cy="18" r="1.5" fill={color} stroke="none" />
      <Circle cx="12" cy="18" r="1.5" fill={color} stroke="none" />
      <Circle cx="18" cy="18" r="1.5" fill={color} stroke="none" />
    </>
  ),
  backspace: () => <Path d="M22 5H9l-7 7 7 7h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM18 9l-6 6M12 9l6 6" />,
  star: (color) => <Path d="M12 3l2.5 6 6.5.5-5 4.5 1.5 6.5L12 17l-5.5 3.5L8 14l-5-4.5 6.5-.5L12 3z" fill={color} />,
  mail: () => (
    <>
      <Rect x="3" y="5" width="18" height="14" rx="2" />
      <Path d="M3 7l9 6 9-6" />
    </>
  ),
  sms: () => <Path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />,
  chart: () => <Path d="M3 3v18h18M7 16l4-4 4 4 5-5" />,
  pieChart: () => <Path d="M21 15.5A9 9 0 1 1 8.5 3 M21 12A9 9 0 0 0 12 3v9h9z" />,
  funnel: () => <Path d="M3 4h18l-7 9v7l-4-2v-5L3 4z" />,
  link: () => <Path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
  users: () => (
    <>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Circle cx="9" cy="7" r="4" />
      <Path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  tag: (color) => (
    <>
      <Path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <Circle cx="7.5" cy="7.5" r="1.5" fill={color} stroke="none" />
    </>
  ),
  send: () => <Path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  play: (color) => <Path d="M5 3v18l15-9-15-9z" fill={color} />,
  pause: (color) => (
    <>
      <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} stroke="none" />
      <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} stroke="none" />
    </>
  ),
  template: () => (
    <>
      <Rect x="3" y="3" width="18" height="6" rx="2" />
      <Rect x="3" y="13" width="8" height="8" rx="2" />
      <Rect x="13" y="13" width="8" height="8" rx="2" />
    </>
  ),
  upload: () => <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  download: () => <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  filter: () => <Path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z" />,
  branch: () => (
    <>
      <Circle cx="6" cy="3" r="2" />
      <Circle cx="6" cy="21" r="2" />
      <Circle cx="18" cy="6" r="2" />
      <Path d="M6 5v14M18 8a4 4 0 0 1-4 4H8" />
    </>
  ),
  shield: () => <Path d="M12 3l8 3v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z" />,
  receipt: () => <Path d="M4 4v18l3-2 2 2 2-2 2 2 2-2 3 2V4l-3 2-2-2-2 2-2-2-2 2-3-2zM8 9h8M8 13h8M8 17h5" />,
  bank: () => <Path d="M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M2 10h20L12 3 2 10z" />,
  nfc: () => <Path d="M5 12C5 8 8 5 12 5s7 3 7 7-3 7-7 7M9 12a3 3 0 0 1 3-3 3 3 0 0 1 3 3" />,
  swap: () => <Path d="M3 7h13l-3-3M21 17H8l3 3" />,
  target: (color) => (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Circle cx="12" cy="12" r="5" />
      <Circle cx="12" cy="12" r="1.5" fill={color} stroke="none" />
    </>
  ),
  calendarPlus: () => (
    <>
      <Rect x="3" y="5" width="18" height="16" rx="2" />
      <Path d="M3 10h18M8 3v4M16 3v4M12 13v6M9 16h6" />
    </>
  ),
  globe: () => (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </>
  ),
  rocket: () => (
    <>
      <Path d="M12 2c4 3 6 7 6 12l-3 3-3-2-3 2-3-3c0-5 2-9 6-12z" />
      <Circle cx="12" cy="10" r="2" />
    </>
  ),
  notebook: () => (
    <>
      <Rect x="4" y="4" width="16" height="18" rx="2" />
      <Path d="M8 4v18M11 8h6M11 12h6M11 16h4" />
    </>
  ),
  award: () => (
    <>
      <Circle cx="12" cy="9" r="6" />
      <Path d="M9 14l-2 7 5-3 5 3-2-7" />
    </>
  ),
  trending: () => <Path d="M3 17l6-6 4 4 8-8M14 7h7v7" />,
  inbox: () => (
    <>
      <Rect x="3" y="3" width="18" height="18" rx="2" />
      <Path d="M3 13h5l2 3h4l2-3h5" />
    </>
  ),
  // J-A8 polish (DEC-082) — additive icon expansion for contact + social platforms.
  // Lucide-derived line glyphs at 24×24, strokeWidth 1.75 (inherits from Svg parent).
  // Threads is an "@"-derived approximation per D-FORENSICS-A8P-1; designer-review-pending.
  phone: () => (
    <Path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  ),
  instagram: (color) => (
    <>
      <Rect x="2" y="2" width="20" height="20" rx="5" />
      <Path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <Circle cx="17.5" cy="6.5" r="1" fill={color} stroke="none" />
    </>
  ),
  tiktok: () => (
    <Path d="M16 8v8a4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4-4M16 8a5 5 0 0 0 5 5V9a5 5 0 0 1-5-5z" />
  ),
  x: () => (
    <Path d="M4 4l7 9-7 9h2.5l5.5-7 5.5 7H22l-7-9 7-9h-2.5L14 11 8.5 4H4z" />
  ),
  facebook: () => (
    <Path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  ),
  youtube: () => (
    <>
      <Path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <Path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" />
    </>
  ),
  linkedin: () => (
    <>
      <Path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V8h4v2c1-1 2-2 4-2z" />
      <Rect x="2" y="9" width="4" height="12" />
      <Circle cx="4" cy="4" r="2" />
    </>
  ),
  threads: () => (
    <Path d="M12 21a9 9 0 1 1 9-9c0 2-1 4-3 5M9 11c1-2 3-3 5-2 1 1 1 3-1 4M11 14c-1-1-1-3 0-4 2-1 4 1 4 3-1 2-3 2-4 1" />
  ),
};

const FALLBACK_RENDERER: Renderer = () => (
  <Rect x="3" y="3" width="18" height="18" rx="2" />
);

export const Icon: React.FC<IconProps> = ({
  name,
  size = 22,
  color,
  strokeWidth = 1.75,
  testID,
  style,
}) => {
  const resolvedColor = color ?? textTokens.primary;
  const renderer = RENDERERS[name];

  if (!renderer && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[Icon] Unknown icon name "${name}". Rendering fallback square.`);
  }

  const renderFn = renderer ?? FALLBACK_RENDERER;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={resolvedColor}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      testID={testID}
      style={style}
    >
      <G>{renderFn(resolvedColor)}</G>
    </Svg>
  );
};

export default Icon;
