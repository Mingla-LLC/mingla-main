#!/usr/bin/env node
/**
 * ORCH-1097 — Business web media picker controls guard.
 *
 * Verifies in-scope browser media controls use browser-safe file selection while
 * native picker modules remain quarantined to native split files.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const IN_SCOPE_WEB_FILES = [
  "src/components/ui/CoverPicker.tsx",
  "src/components/ui/coverPickerDeviceMedia.ts",
  "src/components/brand/BrandAvatarPickerSheet.tsx",
  "app/account/edit-profile.tsx",
  "src/components/experience/ExperienceStopPhotoSheet.tsx",
  "src/components/experience/ActivitiesSnapInput.tsx",
  "src/components/experience/MenuSnapInput.tsx",
];

const REQUIRED_NATIVE_SPLITS = [
  "src/components/ui/coverPickerDeviceMedia.native.ts",
  "src/components/experience/ActivitiesSnapInput.native.tsx",
  "src/components/experience/MenuSnapInput.native.tsx",
];

const FORBIDDEN_WEB_TOKENS = [
  "expo-image-picker",
  "expo-document-picker",
  "expo-file-system",
  "expo-file-system/legacy",
  "expo-camera",
  "react-native-keyboard-controller",
];

function fail(message) {
  console.error(`ORCH-1097 business web media picker controls FAIL: ${message}`);
  process.exit(1);
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function walkJsFiles(root, acc = []) {
  if (!existsSync(root)) return acc;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkJsFiles(path, acc);
    else if (path.endsWith(".js")) acc.push(path);
  }
  return acc;
}

function assertIncludes(source, token, label) {
  if (!source.includes(token)) fail(`${label} missing required token: ${token}`);
}

function assertNotIncludes(source, token, label) {
  if (source.includes(token)) fail(`${label} must not include forbidden token: ${token}`);
}

for (const file of REQUIRED_NATIVE_SPLITS) {
  if (!existsSync(file)) fail(`${file} is missing`);
}

for (const file of IN_SCOPE_WEB_FILES) {
  const source = stripComments(read(file));
  for (const token of FORBIDDEN_WEB_TOKENS) {
    assertNotIncludes(source, token, file);
  }
}

const adapter = read("src/utils/browserFilePicker.ts");
for (const token of [
  "doc.createElement(\"input\")",
  "input.type = \"file\"",
  "input.accept",
  "input.multiple",
  "URL.createObjectURL",
  "URL.revokeObjectURL",
  "FileReader",
]) {
  assertIncludes(adapter, token, "src/utils/browserFilePicker.ts");
}
assertNotIncludes(adapter.slice(0, adapter.indexOf("pickBrowserFiles")), "document.createElement", "browser adapter import path");

const coverDevice = stripComments(read("src/components/ui/coverPickerDeviceMedia.ts"));
assertIncludes(coverDevice, "pickBrowserFiles", "src/components/ui/coverPickerDeviceMedia.ts");
assertIncludes(coverDevice, "revokeCoverPickedAssets", "src/components/ui/coverPickerDeviceMedia.ts");
assertNotIncludes(coverDevice, "granted: false", "src/components/ui/coverPickerDeviceMedia.ts");
assertNotIncludes(coverDevice, "canceled: true", "src/components/ui/coverPickerDeviceMedia.ts");

const coverPicker = stripComments(read("src/components/ui/CoverPicker.tsx"));
assertIncludes(coverPicker, "revokeCoverPickedAssets", "src/components/ui/CoverPicker.tsx");
assertIncludes(coverPicker, "Device image uploads are available in this browser.", "src/components/ui/CoverPicker.tsx");
assertIncludes(coverPicker, "Video cover uploads are available on desktop or in the app for now.", "src/components/ui/CoverPicker.tsx");

for (const file of [
  "src/components/brand/BrandAvatarPickerSheet.tsx",
  "app/account/edit-profile.tsx",
  "src/components/experience/ExperienceStopPhotoSheet.tsx",
  "src/components/experience/ActivitiesSnapInput.tsx",
  "src/components/experience/MenuSnapInput.tsx",
]) {
  assertIncludes(stripComments(read(file)), "pickBrowserFiles", file);
}

for (const file of [
  "src/components/experience/ActivitiesSnapInput.tsx",
  "src/components/experience/MenuSnapInput.tsx",
]) {
  const source = stripComments(read(file));
  assertIncludes(source, "readBrowserFileAsBase64", file);
  assertNotIncludes(source, "platformFileSystem", file);
}

for (const file of [
  "src/components/experience/ActivitiesSnapInput.native.tsx",
  "src/components/experience/MenuSnapInput.native.tsx",
]) {
  const source = stripComments(read(file));
  assertIncludes(source, "expo-document-picker", file);
  assertIncludes(source, "platformFileSystem", file);
}

const exportJsFiles = walkJsFiles(join("web-build", "_expo/static/js/web"));
if (exportJsFiles.length > 0) {
  const exportBundle = exportJsFiles.map((file) => read(file)).join("\n");
  for (const token of FORBIDDEN_WEB_TOKENS) {
    assertNotIncludes(exportBundle, token, "web-build export bundle");
  }
}

console.log("ORCH-1097 business web media picker controls guard PASS");
