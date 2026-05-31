#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1022 [DM-shared card freeze + single-card buttons] structural regression.
 *
 * The native freeze/dead-button bug came from co-presenting the root
 * BaseBottomSheet's RN Modal with child RN Modal surfaces such as the in-app
 * browser and iOS schedule picker. This check locks the shared fix: child
 * overlays are parent-owned or parent-gated, and the root sheet is suppressed
 * while any child overlay is open.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const source = read("app-mobile/src/components/ExpandedCardModal.tsx");
const actionButtonsSource = read("app-mobile/src/components/expandedCard/ActionButtons.tsx");
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const mainStart = source.indexOf("export default function ExpandedCardModal");
const mainBody = mainStart >= 0 ? source.slice(mainStart) : "";
const curatedStart = source.indexOf("function MultiStopPlanView");
const curatedEnd = mainStart;
const curatedBody =
  curatedStart >= 0 && curatedEnd > curatedStart
    ? source.slice(curatedStart, curatedEnd)
    : "";
const rootSheetStart = mainBody.indexOf("visible={visible && !anyChildModalOpen}");
const rootSheetEnd = mainBody.indexOf("</BaseBottomSheet>", rootSheetStart);
const rootSheetBlock =
  rootSheetStart >= 0 && rootSheetEnd > rootSheetStart
    ? mainBody.slice(rootSheetStart, rootSheetEnd)
    : "";
const overlayBlock =
  rootSheetEnd >= 0 ? mainBody.slice(rootSheetEnd) : "";

check(
  "G-01 child overlay aggregate covers all RN Modal child surfaces",
  /const anyChildModalOpen\s*=\s*[\s\S]*?browserUrl !== null[\s\S]*?ticketBrowserUrl !== null[\s\S]*?isNightOutShareOpen[\s\S]*?isSchedulePickerOpen[\s\S]*?curatedLightbox\.visible;/s.test(
    mainBody,
  ),
  "ExpandedCardModal must derive one anyChildModalOpen flag from policy browser, ticket browser, event share modal, iOS schedule picker, and curated lightbox state.",
);

check(
  "G-02 root sheet is gated while child overlays are open",
  rootSheetBlock.includes("visible={visible && !anyChildModalOpen}") &&
    rootSheetBlock.includes("onClose={handleRootSheetClose}") &&
    rootSheetBlock.includes("wrapInRNModal"),
  "The main card BaseBottomSheet must stay RN-Modal-backed but be hidden when any child RN Modal/WebView surface is open.",
);

check(
  "G-03 synthetic root closes are swallowed during child overlays",
  /const handleRootSheetClose = useCallback\(\(\) => \{[\s\S]*?if \(browserUrl !== null \|\| ticketBrowserUrl !== null \|\| isNightOutShareOpen \|\| isSchedulePickerOpen \|\| curatedLightbox\.visible\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?onClose\(\);/s.test(
    mainBody,
  ),
  "BaseBottomSheet can emit a close while the root sheet is suppressed; that synthetic close must not tear down the expanded card.",
);

check(
  "G-04 curated policies no longer mount a nested browser modal",
  curatedBody.includes("onOpenBrowser: (url: string, title: string) => void") &&
    curatedBody.includes("onOpenBrowser(normalized, stop.placeName)") &&
    !/const \[browserUrl,\s*setBrowserUrl\]/.test(curatedBody) &&
    !curatedBody.includes("<InAppBrowserModal"),
  "Curated stop Policies & Reservations must delegate to the parent browser instead of mounting its own RN Modal under the sheet.",
);

check(
  "G-05 curated lightbox is parent-owned like the browser overlays",
  curatedBody.includes("onOpenImageLightbox: (images: string[], initialIndex: number) => void") &&
    curatedBody.includes("onOpenImageLightbox(images, index)") &&
    !curatedBody.includes("<ImageLightbox") &&
    overlayBlock.includes("<ImageLightbox") &&
    overlayBlock.includes("visible={curatedLightbox.visible}"),
  "Curated image lightbox must be a sibling overlay so it cannot co-present with the root RN Modal either.",
);

check(
  "G-06 overlay state is reset when the expanded card closes",
  mainBody.includes("setTicketBrowserUrl(null);") &&
    mainBody.includes("setBrowserUrl(null);") &&
    mainBody.includes("setBrowserTitle('');") &&
    mainBody.includes("setIsNightOutShareOpen(false);") &&
    mainBody.includes("setIsSchedulePickerOpen(false);") &&
    mainBody.includes("setCuratedLightbox({ visible: false, images: [], initialIndex: 0 });"),
  "Closing the expanded card must clear all parent-owned child overlay state before the next card opens.",
);

check(
  "G-07 schedule picker reports visibility to the root overlay gate",
  actionButtonsSource.includes("onSchedulePickerModalVisibilityChange?: (isOpen: boolean) => void") &&
    actionButtonsSource.includes("const setDateTimePickerVisible = useCallback") &&
    actionButtonsSource.includes("onSchedulePickerModalVisibilityChange?.(isOpen)") &&
    actionButtonsSource.includes("onSchedulePickerModalVisibilityChange?.(false)") &&
    [...actionButtonsSource.matchAll(/setShowDateTimePicker\(/g)].length === 1,
  "ActionButtons must route iOS schedule picker open/close through one helper that notifies the expanded-card parent before mounting the RN-Modal-backed picker.",
);

check(
  "G-08 all expanded-card ActionButtons wire schedule picker gating",
  mainBody.includes("const [isSchedulePickerOpen, setIsSchedulePickerOpen] = useState(false);") &&
    curatedBody.includes("onSchedulePickerModalVisibilityChange: (isOpen: boolean) => void") &&
    curatedBody.includes("onSchedulePickerModalVisibilityChange={onSchedulePickerModalVisibilityChange}") &&
    (mainBody.match(/onSchedulePickerModalVisibilityChange=\{setIsSchedulePickerOpen\}/g) ?? []).length >= 2,
  "Both curated and single-card ActionButtons must notify ExpandedCardModal so the root RN Modal is hidden while the iOS schedule picker is open.",
);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.pass) console.log(`  ${item.detail}`);
}

if (failures.length > 0) {
  console.error(`ORCH-1022 expanded-card modal gating regression failed: ${failures.length}/${checks.length}`);
  process.exit(1);
}

console.log("ORCH-1022 expanded-card modal gating regression passed.");
