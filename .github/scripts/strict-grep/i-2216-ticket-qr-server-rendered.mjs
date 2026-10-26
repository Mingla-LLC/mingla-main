#!/usr/bin/env node
/**
 * G-QR — I-4063-NO-TICKET-QR-OFF-EXPLORER.
 *
 * I-2216-QR-IMAGE-SINGLE-OWNER, I-2216-CAROUSEL-PLACEHOLDER-GUARD-INTACT
 * and I-2197-QR-IMPORT-NOT-SUPPRESSED are retired. The credential is now owned
 * by signed-in Explorer. Public Business and email surfaces carry claim
 * pointers only. ShareModalContent.tsx remains an explicit non-ticket QR
 * exception because it renders the public share URL, never a pass credential.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PRODUCERS = [
  "supabase/functions/ticket-checkout-create/index.ts",
  "supabase/functions/ticket-checkout-confirm/index.ts",
  "supabase/functions/ticket-checkout-status/index.ts",
];
const RSVP_FETCH = "supabase/functions/rsvp-pass-fetch/index.ts";
const RSVP_SUBMIT = "supabase/functions/public-submit-rsvp/index.ts";
const DISPATCH = "supabase/functions/ticket-confirmation-dispatch/index.ts";
const ACTIVE_MESSAGE_FILES = [
  "supabase/functions/_shared/orderConfirmationMessage.ts",
  "supabase/functions/_shared/rsvpPassMessage.ts",
  "supabase/functions/_shared/waitlistSpotMessage.ts",
  "supabase/functions/_shared/email/purchaseBody.ts",
  "supabase/functions/_shared/email/purchaseCopy.ts",
  "supabase/functions/_shared/sms/buyerSms.ts",
];
const BUSINESS_ROOTS = [
  "mingla-business/app",
  "mingla-business/src/components/checkout",
  "mingla-business/src/components/event",
  "mingla-business/src/components/ticketLinks",
  "mingla-business/src/components/venue",
  "mingla-business/src/components/attendance",
];
const GATE_QR_IMPORT_ALLOWLIST = new Set([
  "mingla-business/src/components/checkout/DownloadMinglaCta.tsx",
  "mingla-business/src/components/event/SeeWhosGoingGate.tsx",
  "mingla-business/src/components/attendance/ContinueOnPhoneSheet.tsx",
]);

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const sourceFilesUnder = (root) => {
  const absolute = join(ROOT, root);
  if (!existsSync(absolute)) return [];
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (
        /\.(?:ts|tsx)$/.test(entry) &&
        !/\.(?:test|spec)\./.test(entry)
      ) {
        found.push(relative(ROOT, path));
      }
    }
  };
  walk(absolute);
  return found;
};

export function check(files, violations) {
  for (const path of [
    ...PRODUCERS,
    RSVP_FETCH,
    RSVP_SUBMIT,
    DISPATCH,
    ...ACTIVE_MESSAGE_FILES,
  ]) {
    if (files[path] == null)
      violations.push({ file: path, msg: "Scoped source is missing." });
  }

  for (const path of PRODUCERS) {
    const source = files[path] == null ? "" : stripComments(files[path]);
    for (const token of [
      "qrImageDataUrl",
      "qrPayload",
      "attachQrImageDataUrls",
      "qr_code",
    ]) {
      if (source.includes(token)) {
        violations.push({
          file: path,
          msg: `Public checkout producer contains forbidden credential token ${token}. I-4063-NO-TICKET-QR-OFF-EXPLORER.`,
        });
      }
    }
  }

  const fetchSource =
    files[RSVP_FETCH] == null ? "" : stripComments(files[RSVP_FETCH]);
  if (
    !/return\s+reply\(403,\s*\{\s*error:\s*["']sign_in_required["']\s*\}\s*\)/.test(
      fetchSource,
    )
  ) {
    violations.push({
      file: RSVP_FETCH,
      msg: "Anonymous RSVP pass reads must return 403 sign_in_required.",
    });
  }

  const submitSource =
    files[RSVP_SUBMIT] == null ? "" : stripComments(files[RSVP_SUBMIT]);
  if (
    !/credentials:\s*userId\s*!==\s*null\s*&&\s*passEligible/.test(submitSource)
  ) {
    violations.push({
      file: RSVP_SUBMIT,
      msg: "RSVP credentials must be built only for a signed-in eligible owner.",
    });
  }

  for (const path of ACTIVE_MESSAGE_FILES) {
    const source = stripComments(files[path] ?? "");
    if (/QR in attached PDF/i.test(source)) {
      violations.push({
        file: path,
        msg: "Email copy promises a ticket credential attachment.",
      });
    }
    if (/(?:qr[\s\S]{0,180}<img|<img[\s\S]{0,180}qr)/i.test(source)) {
      violations.push({ file: path, msg: "Email source builds a QR image." });
    }
    if (/filename\s*:\s*[^,\n]*\.pdf/i.test(source)) {
      violations.push({
        file: path,
        msg: "Email source builds a PDF attachment.",
      });
    }
  }

  const dispatch =
    files[DISPATCH] == null ? "" : stripComments(files[DISPATCH]);
  if (
    !/renderEmailBody\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]{0,700}?renderTransactionalEmail\(\s*\{\s*variant:\s*["']purchase_message["']/.test(
      dispatch,
    )
  ) {
    violations.push({
      file: DISPATCH,
      msg: "Buyer ticket confirmation email must render through purchase_message.",
    });
  }
  if (
    /renderTransactionalEmail\(\s*\{\s*variant:\s*["']ticket_confirmation_(?:free|paid)["']/.test(
      dispatch,
    )
  ) {
    violations.push({
      file: DISPATCH,
      msg: "Legacy ticket_confirmation variants cannot be used for active email delivery.",
    });
  }
  if (
    /const\s+attachments[^=]*=\s*\[\s*\{/.test(dispatch) ||
    /attachments\.push\(\s*\{(?![\s\S]{0,160}icsFilename)/.test(dispatch)
  ) {
    violations.push({
      file: DISPATCH,
      msg: "Ticket confirmation attachments must start empty and only add the calendar .ics.",
    });
  }
  const attachmentPushes = [
    ...dispatch.matchAll(/attachments\.push\(\s*\{([\s\S]*?)\}\s*\)/g),
  ];
  for (const push of attachmentPushes) {
    if (!/icsFilename|\.ics/.test(push[1])) {
      violations.push({
        file: DISPATCH,
        msg: "Ticket confirmation contains a non-.ics attachment.",
      });
    }
  }

  const businessFiles = Object.keys(files).filter((item) =>
    BUSINESS_ROOTS.some((root) => item.startsWith(`${root}/`)),
  );
  for (const path of businessFiles) {
    const source = stripComments(files[path] ?? "");
    if (
      /from\s+["'][^"']*TicketQrCarousel["']|import\s*\([^)]*TicketQrCarousel/.test(
        source,
      )
    ) {
      violations.push({
        file: path,
        msg: "Business public surface imports TicketQrCarousel.",
      });
    }
    if (/react-native-qrcode-svg/.test(source)) {
      violations.push({
        file: path,
        msg: "Business public surface imports the pass QR renderer.",
      });
    }
    if (
      /import\s*\{\s*GateQr\s*\}/.test(source) &&
      !GATE_QR_IMPORT_ALLOWLIST.has(path)
    ) {
      violations.push({
        file: path,
        msg: "GateQr import is outside the reviewed non-credential allow-list.",
      });
    }
    for (const match of source.matchAll(/<RsvpOfferingBody\b([\s\S]*?)>/g)) {
      if (!/passPresentation\s*=\s*["']claim["']/.test(match[1])) {
        violations.push({
          file: path,
          msg: "Business must render RsvpOfferingBody with passPresentation=claim.",
        });
      }
    }
  }
}

if (process.argv.includes("--self-test")) {
  const failures = [];
  const base = {
    ...Object.fromEntries(
      PRODUCERS.map((path) => [
        path,
        "const tickets = rows.map(toPublicTicketSummary);",
      ]),
    ),
    [RSVP_FETCH]:
      'if (!owner) return reply(403, { error: "sign_in_required" });',
    [RSVP_SUBMIT]:
      "return { credentials: userId !== null && passEligible ? passEntities.map(toCredential) : [] };",
    [DISPATCH]:
      'renderEmailBody = () => { return renderTransactionalEmail({ variant: "purchase_message" }); }; const attachments = []; if (calendarLinks) attachments.push({ filename: calendarLinks.icsFilename, content: calendarLinks.icsContent });',
    ...Object.fromEntries(
      ACTIVE_MESSAGE_FILES.map((path) => [
        path,
        "const body = renderClaimButton();",
      ]),
    ),
    "mingla-business/src/components/event/FoundationRsvpPreview.tsx":
      '<RsvpOfferingBody passPresentation="claim" />',
    "mingla-business/src/components/checkout/DownloadMinglaCta.tsx":
      'import { GateQr } from "../event/GateQr";',
  };
  const run = (overrides) => {
    const violations = [];
    check({ ...base, ...overrides }, violations);
    return violations;
  };
  if (run({}).length !== 0)
    failures.push(`compliant fixture failed: ${JSON.stringify(run({}))}`);
  const bad = [
    [
      "checkout credential",
      { [PRODUCERS[0]]: "const qrPayload = row.qr_code;" },
    ],
    ["anonymous RSVP pass", { [RSVP_FETCH]: "return reply(200, pass);" }],
    [
      "anonymous RSVP credentials",
      { [RSVP_SUBMIT]: "return { credentials: passEntities };" },
    ],
    [
      "email QR badge",
      {
        "supabase/functions/_shared/email/purchaseCopy.ts":
          'const badge = "QR in attached PDF";',
      },
    ],
    [
      "legacy delivery variant",
      {
        [DISPATCH]:
          'renderEmailBody = () => { return renderTransactionalEmail({ variant: "ticket_confirmation_free" }); }; const attachments = [];',
      },
    ],
    [
      "PDF attachment",
      {
        [DISPATCH]:
          "const attachments = [{ filename: renderedPdf.filename, content: renderedPdf.contentBase64 }];",
      },
    ],
    [
      "Business QR import",
      {
        "mingla-business/app/rsvp/pass.tsx":
          'import Qr from "react-native-qrcode-svg";',
      },
    ],
    [
      "Ticket carousel import",
      {
        "mingla-business/app/o/[id].tsx":
          'import { TicketQrCarousel } from "../../TicketQrCarousel";',
      },
    ],
    [
      "GateQr outside allow-list",
      {
        "mingla-business/src/components/venue/Bad.tsx":
          'import { GateQr } from "../event/GateQr";',
      },
    ],
    [
      "RSVP QR presentation",
      {
        "mingla-business/src/components/event/FoundationRsvpPreview.tsx":
          "<RsvpOfferingBody />",
      },
    ],
  ];
  for (const [name, fixture] of bad) {
    if (run(fixture).length === 0)
      failures.push(`${name} violation was not detected`);
  }
  if (failures.length > 0) {
    console.error("I-4063-NO-TICKET-QR-OFF-EXPLORER self-test FAIL:");
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }
  const cases = bad.length + 1;
  console.log(
    `I-4063-NO-TICKET-QR-OFF-EXPLORER self-test PASS (${cases}/${cases} cases).`,
  );
  process.exit(0);
}

const paths = new Set([
  ...PRODUCERS,
  RSVP_FETCH,
  RSVP_SUBMIT,
  DISPATCH,
  ...ACTIVE_MESSAGE_FILES,
  ...BUSINESS_ROOTS.flatMap(sourceFilesUnder),
]);
const files = Object.fromEntries(
  [...paths].map((path) => {
    const absolute = join(ROOT, path);
    return [path, existsSync(absolute) ? readFileSync(absolute, "utf8") : null];
  }),
);
const violations = [];
check(files, violations);
if (violations.length > 0) {
  console.error("I-4063-NO-TICKET-QR-OFF-EXPLORER FAIL:");
  violations.forEach(({ file, msg }) => console.error(`  - ${file}: ${msg}`));
  process.exit(1);
}
console.log("I-4063-NO-TICKET-QR-OFF-EXPLORER PASS.");
