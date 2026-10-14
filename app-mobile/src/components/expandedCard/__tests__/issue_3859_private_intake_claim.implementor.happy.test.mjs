import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appMobileRoot = process.env.MINGLA_ISSUE_3859_SOURCE_ROOT ??
  fileURLToPath(new URL("../../../..", import.meta.url));

const readSource = (relativePath) =>
  readFileSync(`${appMobileRoot}/${relativePath}`, "utf8");

const form = readSource("src/components/expandedCard/ConsumerIntakeForm.tsx");
const cart = readSource("src/components/expandedCard/TicketCartSheet.tsx");
const service = readSource("src/services/tripIntakeSchemaService.ts");
const checkout = readSource("src/payments/nativeCheckoutFlow.ts");

test("#3859 Explorer renders the canonical private file intake lifecycle", () => {
  assert.match(form, /DocumentPicker\.getDocumentAsync/);
  assert.match(form, /type: allowedMimeTypes/);
  assert.match(form, /question\.allow_images === false/);
  assert.match(form, /question\.allow_pdfs === false/);
  assert.match(form, /question\.allow_docs === false/);
  assert.match(form, /allowedMimeTypes\.length === 0/);
  assert.match(form, /File upload is unavailable for this question/);
  assert.match(form, /replaceClaimId: value\[0\]\.claim_id/);
  assert.match(form, /await onRemove\(file\.claim_id\)/);
  assert.match(form, /Uploaded file ·/);
  assert.doesNotMatch(form, /file\.filename/);
});

test("#3859 Explorer binds upload, replacement, removal, and checkout to one draft", () => {
  assert.match(cart, /intakeUploadSessionRef = React\.useRef<string>/);
  assert.match(cart, /uploadSessionId: intakeUploadSessionRef\.current/);
  assert.match(cart, /uploadTripIntakeFile\(/);
  assert.match(cart, /revokeTripIntakeFileClaim\(/);
  assert.match(cart, /intakeUploadSessionId: intakeUploadSessionRef\.current/);
  assert.match(checkout, /intake_upload_session_id: input\.intakeUploadSessionId/);
});

test("#3859 Explorer accepts only server-verified claim metadata", () => {
  assert.match(service, /action: "accept"/);
  assert.match(service, /typeof accepted\?\.claim_id !== "string"/);
  assert.match(service, /mime_type: accepted\.mime_type/);
  assert.match(service, /size_bytes: accepted\.size_bytes/);
  assert.match(service, /action: "revoke"/);
  assert.doesNotMatch(service, /filename:\s*accepted/);
  assert.doesNotMatch(service, /path:\s*accepted/);
});
