#!/usr/bin/env node
/**
 * ORCH-0847 gate #3, retargeted by issue #3859 and again by issue #4273.
 *
 * #4273 (Seth, 2026-11-06): anybody who buys is opted in to the brand's
 * marketing. Buyer web now matches Explorer: checkout exposes only the
 * required purchase-terms act, which records only transactional scope and must
 * never become a marketing control. Buyer web shows a plain opt-in notice
 * instead of a box; the grant is recorded at order ingest.
 *
 * Keep this historical filename stable because the batched strict-grep manifest
 * already owns its class-A registration.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// MINGLA-INVARIANT: I-PROPOSED-3859-CONSENT-SEPARATION | issue #3859 | Explorer and buyer-web checkout each have one required transactional purchase act and no marketing control; purchase terms default off; buyer web shows the #4273 opt-in notice.

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

  // Buyer web (#4273): one required purchase act, terms default off, no
  // marketing control or marketing write, and the plain opt-in notice.
  const emptyBuyer = objectLiteralAfter(webCart, "const EMPTY_BUYER: BuyerDetails =");
  if (emptyBuyer === null) {
    failures.push("Buyer web defaults: EMPTY_BUYER object is missing or malformed");
  } else {
    requireToken(emptyBuyer, "termsAccepted: false,", "Buyer web defaults", failures);
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
    requireToken(source, "setBuyer({ termsAccepted: next });", `${label} purchase control`, failures);
    requireToken(source, 'scopes: ["transactional"]', `${label} purchase audit`, failures);
    requireToken(source, "onPress={toggleTerms}", `${label} purchase UI`, failures);
    requireToken(source, "{CHECKOUT_MARKETING_NOTICE}", `${label} opt-in notice`, failures);
    forbidToken(source, 'scopes: ["marketing"]', `${label} consent audit`, failures);
    forbidToken(source, "toggleMarketing", `${label} checkout`, failures);
    forbidToken(source, "marketingOptIn", `${label} checkout`, failures);
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
    recordConsent({ scopes: ["transactional"] });
    <Pressable onPress={toggleTerms} />;
    <Text>{CHECKOUT_MARKETING_NOTICE}</Text>;
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
        marketingOptIn: true,
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
      "Buyer web marketing box restored",
      "webEvent",
      `${clean.webEvent}\n<Pressable onPress={toggleMarketing} />;`,
    ],
    [
      "Buyer web checkbox marketing write restored",
      "webExperience",
      `${clean.webExperience}\nrecordConsent({ scopes: ["marketing"] });`,
    ],
    [
      "Buyer web opt-in notice removed",
      "webEvent",
      clean.webEvent.replace("{CHECKOUT_MARKETING_NOTICE}", ""),
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
    "[ORCH-0847/#3859 consent separation] MUTATION PROOF PASS — 10 hostile consent mutations detected.\n",
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
    "[ORCH-0847/#3859 consent separation] PASS — Explorer and buyer-web purchase-only checkout, with the buyer-web opt-in notice, are intact.\n",
  );
}
