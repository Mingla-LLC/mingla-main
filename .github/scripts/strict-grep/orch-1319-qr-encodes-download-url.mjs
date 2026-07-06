#!/usr/bin/env node
/**
 * ORCH-1319 [The download QR] — G-3.
 * Invariant: I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT (QR seam).
 *
 * Over mingla-marketing/components/marketing/download-qr.tsx (comment-stripped):
 *   the <QRCode value=…> binds DOWNLOAD_URL from lib/site — NOT a literal store
 *   URL. Encoding a store URL directly would break the "one QR, both platforms"
 *   property (an Android scanner would land on the App Store).
 *
 * G-3b (adversarial):
 *   - the wrapper must carry role="img" + aria-label (a11y — the alt text).
 *   - bgColor must be #FFFFFF (a translucent / non-white background breaks the
 *     contrast scanners need).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const QR = "mingla-marketing/components/marketing/download-qr.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function checkQr(rawSrc, failures) {
  const src = stripComments(rawSrc);

  // (a) value binds DOWNLOAD_URL from lib/site.
  if (!/from ['"]@\/lib\/site['"]/.test(src) || !/DOWNLOAD_URL/.test(src)) {
    failures.push(`${QR}: must import DOWNLOAD_URL from '@/lib/site'.`);
  }
  if (!/value=\{DOWNLOAD_URL\}/.test(src)) {
    failures.push(
      `${QR}: the <QRCode value=…> must bind DOWNLOAD_URL (not a literal store URL) ` +
        `— one QR must serve both iOS and Android.`,
    );
  }
  // No literal store URL as the encoded value.
  if (/value=\{?["']https?:\/\/(apps\.apple\.com|play\.google\.com)/.test(src)) {
    failures.push(`${QR}: the QR encodes a literal store URL — it must encode DOWNLOAD_URL.`);
  }

  // G-3b — a11y wrapper.
  if (!/role="img"/.test(src)) {
    failures.push(`${QR}: the QR wrapper must carry role="img" (G-3b a11y).`);
  }
  if (!/aria-label=/.test(src)) {
    failures.push(`${QR}: the QR wrapper must carry an aria-label (G-3b a11y).`);
  }

  // G-3b — white background for contrast.
  if (!/bgColor="#FFFFFF"/i.test(src)) {
    failures.push(`${QR}: bgColor must be "#FFFFFF" (G-3b contrast — scanners need a white quiet zone).`);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => { const f = []; checkQr(s, f); return f; };

  const good = `
import QRCode from 'react-qr-code'
import { DOWNLOAD_URL } from '@/lib/site'
export function DownloadQr({ size = 200 }) {
  return (
    <div role="img" aria-label="QR code — scan to download Mingla">
      <QRCode value={DOWNLOAD_URL} size={size} fgColor="#0E0E10" bgColor="#FFFFFF" level="M" />
    </div>
  )
}
`;
  if (run(good).length !== 0) selfFailures.push("compliant QR wrongly flagged");

  // Encodes a literal store URL → fire.
  const literal = good.replace("value={DOWNLOAD_URL}", "value=\"https://apps.apple.com/app/id6760440898\"");
  if (run(literal).length === 0) selfFailures.push("literal store-URL value not flagged");

  // Missing role=img → fire.
  const noRole = good.replace('role="img"', "");
  if (run(noRole).length === 0) selfFailures.push("missing role=img not flagged");

  // Missing aria-label → fire.
  const noAria = good.replace('aria-label="QR code — scan to download Mingla"', "");
  if (run(noAria).length === 0) selfFailures.push("missing aria-label not flagged");

  // Non-white bg → fire.
  const badBg = good.replace('bgColor="#FFFFFF"', 'bgColor="transparent"');
  if (run(badBg).length === 0) selfFailures.push("non-white bgColor not flagged");

  if (selfFailures.length) {
    console.error("ORCH-1319 G-3 qr-encodes-download-url self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1319 G-3 qr-encodes-download-url self-test PASS (5/5 cases).");
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, QR);
if (!fs.existsSync(abs)) {
  console.error(`ORCH-1319 G-3 FAIL — target not found at ${QR} (component missing).`);
  process.exit(1);
}
const failures = [];
checkQr(fs.readFileSync(abs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1319 G-3 FAIL — the download QR must encode DOWNLOAD_URL (lib/site) on a\n" +
      "white background with role=img+aria-label.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1319 G-3 PASS — download-qr encodes DOWNLOAD_URL (one QR, both platforms),\n" +
    "role=img + aria-label, #FFFFFF background.",
);
