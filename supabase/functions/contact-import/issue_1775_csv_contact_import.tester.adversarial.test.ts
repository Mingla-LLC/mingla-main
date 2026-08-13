import {
  assert,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const here = new URL(".", import.meta.url);
const edge = await Deno.readTextFile(new URL("index.ts", here));
const migration = await Deno.readTextFile(
  new URL("../../migrations/20270328001775_issue_1775_csv_contact_import.sql", here),
);
const cors = await Deno.readTextFile(new URL("../_shared/cors.ts", here));

Deno.test("#1775 adversarial: browser preflight allows authorization metadata", () => {
  assertMatch(edge, /new Response\("ok", \{ headers: (?:corsHeaders|contactImportCorsHeaders) \}\)/,
    "OPTIONS must use the same shared CORS headers as success/error responses");
  assertMatch(edge, /headers:[\s\S]{0,100}\.\.\.(?:corsHeaders|contactImportCorsHeaders)[\s\S]{0,100}"Content-Type": "application\/json"/,
    "JSON success and error responses must retain shared CORS headers");
  assertMatch(`${cors}\n${edge}`, /Access-Control-Allow-Headers[\s\S]{0,300}x-mingla-import-action/i);
  assertMatch(`${cors}\n${edge}`, /Access-Control-Allow-Headers[\s\S]{0,350}x-mingla-brand-id/i);
});

Deno.test("#1775 adversarial: upload authority precedes bounded body consumption", () => {
  const authorizeAt = edge.indexOf("await authorize");
  const consumeAt = Math.max(
    edge.indexOf("authorizedMultipart(req)"),
    edge.indexOf("req.formData()"),
  );
  const fileCapAt = edge.indexOf("file.size > CONTACT_IMPORT_MAX_BYTES");
  const fileBytesAt = edge.indexOf("file.arrayBuffer()");
  assert(authorizeAt >= 0 && consumeAt >= 0 && authorizeAt < consumeAt,
    "brand/rank/flag authority must run before multipart bytes are consumed");
  assert(fileCapAt >= 0 && fileBytesAt >= 0 && fileCapAt < fileBytesAt,
    "the verified file-size cap must run before converting the bounded file to bytes");
  assertMatch(edge, /(getReader\(|TransformStream|ByteLengthQueuingStrategy)/,
    "the server must enforce a streaming byte cap");
});

Deno.test("#1775 adversarial: mapping version and durable recovery are bound", () => {
  assertMatch(edge, /mappingVersion[\s\S]{0,400}CONTACT_IMPORT_MAPPING_VERSION/,
    "preview must reject, not ignore, a changed mappingVersion");
  assertMatch(migration, /action[^;]*'retry_resumed'/s);
  assertMatch(migration, /state\s*=\s*'failed'/,
    "a retryable execution failure must become durably resumable");
  assertMatch(migration, /failed_at\s*=/);
  assertMatch(migration, /'retry_resumed'/);
});

Deno.test("#1775 adversarial: retry preserves exactly one durable consent event", () => {
  const execute = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_1775_execute_import"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_1775_mark_failed"),
  );
  const replayAt = execute.indexOf("b.state='completed'");
  const retryAt = execute.indexOf("'retry_resumed'");
  const attestedAt = execute.indexOf("'attested'");

  assert(replayAt >= 0 && retryAt >= 0 && attestedAt >= 0);
  assert(replayAt < retryAt && replayAt < attestedAt,
    "same-idempotency completed replay must return before audit insertion");
  assertMatch(execute, /'retry_resumed'[\s\S]{0,700}'attested'/,
    "a successful failed-batch retry must append retry_resumed and then its durable attestation");
  assertMatch(execute, /'attested'[\s\S]{0,300}p_attestation_version[\s\S]{0,120}p_attestation/,
    "the durable attested event must contain the exact accepted version and text");
  assertMatch(execute, /VALUES\(p_batch,p_brand,p_actor,'attested'/,
    "the durable attested event must bind the authenticated actor");
  assertNotMatch(execute, /IF\s+b\.state='failed'[\s\S]{0,500}ELSE[\s\S]{0,500}'attested'/,
    "retry must not choose between retry_resumed and attested; it needs both");
});

Deno.test("#1775 adversarial: rollback preserves scoped status and complete results", () => {
  assertMatch(edge, /action\s*===\s*"status"[\s\S]*resultRows/,
    "status must return scoped durable row outcomes");
  assertMatch(edge, /action\s*===\s*"execute"[\s\S]*resultRows/,
    "execute must return durable result rows");
  assertMatch(edge, /reviewHref/);
  assertMatch(edge, /(authorizeStatus|authorizeRead|status_authorized|allowDisabledStatus|newWork[\s\S]{0,250}authorize)/,
    "completed/import status must remain readable while creation is flag-disabled");
});

Deno.test("#1775 adversarial: database refusals keep stable public codes/statuses", () => {
  for (const [sqlCode, publicCode, status] of [
    ["idempotency_conflict", "IDEMPOTENCY_CONFLICT", 409],
    ["cannot_cancel_execution", "CANNOT_CANCEL_EXECUTION", 409],
    ["contact_import_not_found", "BATCH_NOT_FOUND", 404],
  ] as const) {
    assertMatch(edge, new RegExp(`${sqlCode}[\\s\\S]{0,600}${publicCode}`));
    assertMatch(edge, new RegExp(`${publicCode}[\\s\\S]{0,250}${status}`));
  }
});

Deno.test("#1775 adversarial: zero importable rows refuse preview before mutation", () => {
  const previewRpcAt = edge.indexOf('"issue_1775_store_preview"');
  const refusalAt = edge.indexOf("NO_IMPORTABLE_ROWS");
  assert(refusalAt >= 0 && previewRpcAt >= 0 && refusalAt < previewRpcAt,
    "422 NO_IMPORTABLE_ROWS must be decided before preview rows/batch mutate");
  assertMatch(edge, /NO_IMPORTABLE_ROWS[\s\S]{0,300}422/);
});

Deno.test("#1775 adversarial: expired inspections/previews become durable evidence", () => {
  assertMatch(migration, /state\s*=\s*'expired'/);
  assertMatch(migration, /'expired'[\s\S]{0,500}brand_contact_import_audit|brand_contact_import_audit[\s\S]{0,500}'expired'/);
  assertMatch(edge, /(issue_1775_expire|expire_import|mark_expired)/,
    "stale/expiry handling must invoke durable expiration authority");
});

Deno.test("#1775 adversarial: malformed mapping JSON is a typed client error", () => {
  assertMatch(edge, /(parseMapping|parseJsonMapping|mappingJson)[\s\S]{0,900}INVALID_MAPPING/,
    "mapping JSON parsing must be contained by an INVALID_MAPPING boundary");
  assertMatch(edge, /INVALID_MAPPING[\s\S]{0,250}400/);
});
