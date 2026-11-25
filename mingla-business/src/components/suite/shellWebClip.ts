/**
 * #4490 click-test D29 — web-only `overflow: clip` for the suite shell host.
 *
 * `overflow: hidden` still makes an element a scroll container that focus()
 * and scrollIntoView can scroll; `clip` cannot be scrolled at all, so nothing
 * inside the shell can ever shift it. React Native's style types do not list
 * `clip`, so the one web style object is built here.
 */
import { Platform } from "react-native";
import type { ViewStyle } from "react-native";

const WEB_CLIP: Record<string, string> = { overflow: "clip" };

export const SHELL_WEB_CLIP: ViewStyle = Platform.OS === "web" ? (WEB_CLIP as ViewStyle) : {};
