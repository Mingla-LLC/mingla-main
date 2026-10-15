#!/usr/bin/env node
/**
 * ORCH-0847 gate #3, retargeted by issue #3859.
 *
 * Marketing consent still defaults off on anonymous buyer web. Explorer is a
 * different surface: account-level marketing is always on outside checkout, so
 * checkout exposes only the required purchase-terms act. That act records only
 * transactional scope and must never become a marketing control.
 *
 * Keep this historical filename stable because the batched strict-grep manifest
 * already owns its class-A registration.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// MINGLA-INVARIANT: I-PROPOSED-3859-CONSENT-SEPARATION | issue #3859 | Explorer checkout has one required transactional purchase act and no marketing control; buyer web keeps purchase and optional marketing independent and default-off.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LOCAL_DECLARATION_PREFIX = "// MINGLA-" + "INVARIANT: ";

const PATHS = Object.freeze({
  explorer: "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
  webCart: "mingla-business/src/components/checkout/CartContext.tsx",
  webEvent: "mingla-business/app/checkout/[eventId]/buyer.tsx",
  webTrip: "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
  webExperience:
    "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
  gate: ".github/scripts/strict-grep/orch-0847-marketing-opt-in-default-unchecked.mjs",
});

const WEB_BUYER_KEYS = Object.freeze(["webEvent", "webTrip", "webExperience"]);

function readSnapshot(root = ROOT) {
  return Object.fromEntries(
    Object.entries(PATHS).map(([key, relative]) => {
      const absolute = path.join(root, relative);
      return [key, fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null];
    }),
  );
}

/** Comments never count as executable consent state or wiring. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
}

function count(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function objectLiteralAfter(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) return null;
  const bodyStart = source.indexOf("{", start);
  const bodyEnd = source.indexOf("};", bodyStart);
  if (bodyStart < 0 || bodyEnd < 0) return null;
  return source.slice(bodyStart, bodyEnd + 2);
}

function requireToken(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbidToken(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

export function checkSnapshot(snapshot) {
  const failures = [];
  const need = (key) => {
    const source = snapshot[key];
    if (typeof source !== "string") failures.push(`${PATHS[key]}: required file is missing`);
    return typeof source === "string" ? source : "";
  };

  const explorer = stripComments(need("explorer"));
  const webCart = stripComments(need("webCart"));
  const gate = need("gate");

  // Explorer: one required purchase act, no marketing state/control.
  requireToken(
    explorer,
    "const [termsAccepted, setTermsAccepted] = useState<boolean>(false);",
    "Explorer purchase terms",
    failures,
  );
  requireToken(
    explorer,
    "accessibilityLabel={PURCHASE_TERMS_DISCLOSURE_TEXT}",
    "Explorer purchase control",
    failures,
  );
  requireToken(
    explorer,
    'scopes: ["transactional"]',
    "Explorer consent audit",
    failures,
  );
  forbidToken(
    explorer,
    'scopes: ["marketing"]',
    "Explorer consent audit",
    failures,
  );
  forbidToken(explorer, "setMarketingOptIn", "Explorer checkout", failures);
  forbidToken(explorer, "toggleMarketing", "Explorer checkout", failures);
  forbidToken(explorer, "CHECKOUT_MARKETING_", "Explorer checkout", failures);

  requireToken(
    explorer,
    "marketingOptIn: boolean;",
    "Explorer checkout payload type",
    failures,
  );
  requireToken(
    explorer,
    "marketingOptIn: true,",
    "Explorer account-level marketing payload",
    failures,
  );
  requireToken(
    explorer,
    "purchaseTermsAccepted: termsAccepted,",
    "Explorer purchase payload",
    failures,
  );
  forbidToken(
    explorer,
    "marketingOptIn: false",
    "Explorer account-level marketing payload",
    failures,
  );
  if (count(explorer, /\bmarketingOptIn\b/g) !== 2) {
    failures.push(
      "Explorer checkout: marketingOptIn must appear exactly twice after comments are removed — once in the payload type and once as the literal account-level `true`; any other occurrence recreates checkout marketing state/control",
    );
  }

  // Buyer web: purchase terms and optional marketing are separate and off by default.
  const emptyBuyer = objectLiteralAfter(webCart, "const EMPTY_BUYER: BuyerDetails =");
  if (emptyBuyer === null) {
    failures.push("Buyer web defaults: EMPTY_BUYER object is missing or malformed");
  } else {
    requireToken(
      emptyBuyer,
      "marketingOptIn: false,",
      "Buyer web defaults",
      failures,
    );
    requireToken(
      emptyBuyer,
      "termsAccepted: false,",
      "Buyer web defaults",
      failures,
    );
    forbidToken(emptyBuyer, "marketingOptIn: true", "Buyer web defaults", failures);
    forbidToken(emptyBuyer, "termsAccepted: true", "Buyer web defaults", failures);
  }

  for (const key of WEB_BUYER_KEYS) {
    const source = stripComments(need(key));
    const label = PATHS[key];
    requireToken(
      source,
      "const termsAccepted = buyer.termsAccepted === true;",
      `${label} purchase state`,
      failures,
    );
    requireToken(
      source,
      "setBuyer({ termsAccepted: next });",
      `${label} purchase control`,
      failures,
    );
    requireToken(
      source,
      "setBuyer({ marketingOptIn: !buyer.marketingOptIn });",
      `${label} optional marketing control`,
      failures,
    );
    requireToken(
      source,
      'scopes: ["transactional"]',
      `${label} purchase audit`,
      failures,
    );
    requireToken(
      source,
      'scopes: ["marketing"]',
      `${label} optional marketing audit`,
      failures,
    );
    requireToken(source, "onPress={toggleTerms}", `${label} purchase UI`, failures);
    requireToken(source, "onPress={toggleMarketing}", `${label} marketing UI`, failures);

    const buyerPatches = [...source.matchAll(/setBuyer\s*\(\s*\{([\s\S]*?)\}\s*\)/g)];
    if (
      buyerPatches.some(
        (match) =>
          /\btermsAccepted\b/.test(match[1]) && /\bmarketingOptIn\b/.test(match[1]),
      )
    ) {
      failures.push(
        `${label}: one setBuyer patch couples purchase acceptance to optional marketing`,
      );
    }
  }

  const declaration =
    `${LOCAL_DECLARATION_PREFIX}I-PROPOSED-3859-CONSENT-SEPARATION | issue #3859 |`;
  if (!gate.includes(declaration)) {
    failures.push(`Invariant declaration: missing local declaration ${declaration}`);
  }

  return failures;
}

function verifyHostileMutations() {
  const webBuyer = `
    const termsAccepted = buyer.termsAccepted === true;
    setBuyer({ termsAccepted: next });
    setBuyer({ marketingOptIn: !buyer.marketingOptIn });
    recordConsent({ scopes: ["transactional"] });
    recordConsent({ scopes: ["marketing"] });
    <Pressable onPress={toggleTerms} />;
    <Pressable onPress={toggleMarketing} />;
  `;
  const clean = {
    explorer: `
      interface CheckoutSubmission { marketingOptIn: boolean; }
      const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
      recordConsent({ scopes: ["transactional"] });
      <Pressable accessibilityLabel={PURCHASE_TERMS_DISCLOSURE_TEXT} />;
      onCheckout({ marketingOptIn: true, purchaseTermsAccepted: termsAccepted, });
    `,
    webCart: `
      const EMPTY_BUYER: BuyerDetails = {
        marketingOptIn: false,
        termsAccepted: false,
      };
    `,
    webEvent: webBuyer,
    webTrip: webBuyer,
    webExperience: webBuyer,
    gate:
      `${LOCAL_DECLARATION_PREFIX}I-PROPOSED-3859-CONSENT-SEPARATION | issue #3859 | clean`,
  };

  const cleanFailures = checkSnapshot(clean);
  if (cleanFailures.length > 0) {
    throw new Error(`clean fixture failed: ${cleanFailures.join("; ")}`);
  }

  const mutations = [
    [
      "Explorer marketing state",
      "explorer",
      `${clean.explorer}\nconst [marketingOptIn, setMarketingOptIn] = useState(false);`,
    ],
    [
      "Explorer purchase terms prechecked",
      "explorer",
      clean.explorer.replace("useState<boolean>(false)", "useState<boolean>(true)"),
    ],
    [
      "Explorer account flag off",
      "explorer",
      clean.explorer.replace("marketingOptIn: true,", "marketingOptIn: false,"),
    ],
    [
      "Explorer audit grants marketing",
      "explorer",
      clean.explorer.replace('scopes: ["transactional"]', 'scopes: ["marketing"]'),
    ],
    [
      "Buyer web marketing prechecked",
      "webCart",
      clean.webCart.replace("marketingOptIn: false", "marketingOptIn: true"),
    ],
    [
      "Buyer web purchase terms prechecked",
      "webCart",
      clean.webCart.replace("termsAccepted: false", "termsAccepted: true"),
    ],
    [
      "Buyer web acts coupled",
      "webTrip",
      clean.webTrip.replace(
        "setBuyer({ termsAccepted: next });",
        "setBuyer({ termsAccepted: next, marketingOptIn: next });",
      ),
    ],
    [
      "Local invariant declaration removed",
      "gate",
      "// consent rule deleted",
    ],
  ];

  for (const [label, key, value] of mutations) {
    const planted = { ...clean, [key]: value };
    if (checkSnapshot(planted).length === 0) {
      throw new Error(`${label}: hostile mutation escaped`);
    }
  }

  process.stdout.write(
    "[ORCH-0847/#3859 consent separation] MUTATION PROOF PASS — 8 hostile consent mutations detected.\n",
  );
}

verifyHostileMutations();
const failures = checkSnapshot(readSnapshot());
if (failures.length > 0) {
  process.stderr.write(
    `[ORCH-0847/#3859 consent separation] FAIL\n${failures
      .map((failure) => `- ${failure}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "[ORCH-0847/#3859 consent separation] PASS — Explorer purchase-only checkout and independent default-off buyer-web marketing are intact.\n",
  );
}
