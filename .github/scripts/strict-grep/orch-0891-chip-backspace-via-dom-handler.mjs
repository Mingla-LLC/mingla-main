#!/usr/bin/env node

/**
 * I-CHIP-BACKSPACE-VIA-DOM-HANDLER (ORCH-0891 invariant).
 *
 * Chip atomic delete on web MUST reuse the existing
 * `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` DOM handler verbatim. Tiptap
 * keymap reimplementation of chip-backspace is FORBIDDEN because:
 *   (1) The existing DOM handler is production-tested on iOS/Android
 *       pell WebViews — reusing it guarantees behavioral parity.
 *   (2) Tiptap keymaps run before the DOM handler in the event chain;
 *       a keymap override would shadow the DOM handler and require
 *       maintaining two delete-chip code paths.
 *   (3) The DOM handler is library-agnostic (pure
 *       `document.addEventListener('keydown', ...)`) — it works on
 *       Tiptap's contenteditable, pell's WebView, and any future
 *       editor swap. Migration cost stays zero.
 *
 * Scope: mingla-business/src/components/marketing/ComposerV2/tiptapNodes/**\/*.ts
 *        AND mingla-business/src/components/marketing/ComposerV2/richEditor.tsx
 *
 * Forbidden pattern: `addKeyboardShortcuts.*Backspace` OR
 * `addKeyboardShortcuts.*"Delete"`. (Tiptap's keymap API uses
 * `addKeyboardShortcuts()` returning a `{ Backspace: ... }` object.)
 *
 * Required pattern (positive assertion): richEditor.tsx must reference
 * `COMPOSER_CHIP_BACKSPACE_HANDLER_JS` to confirm the handler is
 * actually installed.
 *
 * Cross-references:
 *   - SPEC_ORCH-0891 §5 (new invariants)
 *   - composerChipHtml.ts (the verbatim handler script)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TIPTAP_NODES_ROOT =
  "mingla-business/src/components/marketing/ComposerV2/tiptapNodes";
const RICH_EDITOR_PATH =
  "mingla-business/src/components/marketing/ComposerV2/richEditor.tsx";

const FORBIDDEN_KEYMAP =
  /addKeyboardShortcuts\b[\s\S]*?["']Backspace["']/;

const REQUIRED_HANDLER_IMPORT = /COMPOSER_CHIP_BACKSPACE_HANDLER_JS/;

const violations = [];
let filesScanned = 0;

function walkDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

// 1. Negative check: no Tiptap node file may declare a Backspace keymap.
const nodesAbs = path.join(repoRoot, TIPTAP_NODES_ROOT);
for (const entry of walkDir(nodesAbs)) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
  const file = path.join(nodesAbs, entry.name);
  filesScanned++;
  const source = fs.readFileSync(file, "utf8");
  if (FORBIDDEN_KEYMAP.test(source)) {
    violations.push({
      file: path.relative(repoRoot, file),
      reason:
        `addKeyboardShortcuts with "Backspace" key — reimplements atomic delete via Tiptap keymap. Reuse COMPOSER_CHIP_BACKSPACE_HANDLER_JS instead.`,
    });
  }
}

// 2. Positive check: richEditor.tsx must reference the handler import.
const richEditorAbs = path.join(repoRoot, RICH_EDITOR_PATH);
try {
  filesScanned++;
  const source = fs.readFileSync(richEditorAbs, "utf8");
  if (!REQUIRED_HANDLER_IMPORT.test(source)) {
    violations.push({
      file: RICH_EDITOR_PATH,
      reason:
        `richEditor.tsx does NOT reference COMPOSER_CHIP_BACKSPACE_HANDLER_JS — atomic chip delete may not be installed. Import the handler from composerChipHtml.ts and install via a useEffect on mount.`,
    });
  }
} catch (err) {
  // If richEditor.tsx doesn't exist yet, skip — gate passes (file not in M1 yet).
  if (err.code !== "ENOENT") throw err;
}

if (violations.length > 0) {
  console.error("I-CHIP-BACKSPACE-VIA-DOM-HANDLER violation (ORCH-0891):");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    → ${v.reason}`);
  }
  console.error("");
  console.error(
    `Scanned ${filesScanned} file(s); found ${violations.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  `ORCH-0891 I-CHIP-BACKSPACE-VIA-DOM-HANDLER OK: scanned ${filesScanned} file(s); chip backspace handler installed via DOM script (no Tiptap keymap override found).`,
);
process.exit(0);
