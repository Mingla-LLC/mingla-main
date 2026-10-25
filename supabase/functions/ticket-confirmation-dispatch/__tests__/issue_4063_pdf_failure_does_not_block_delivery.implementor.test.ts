import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("#4063 PDF rendering is isolated from the email render failure gate", () => {
  assertStringIncludes(source, "let pdfRenderError:");
  assertStringIncludes(source, "ticket_pdf_render_failed order=");
  assertStringIncludes(source, "renderError: renderError ?? pdfRenderError");
  assertStringIncludes(source, "if (!renderedEmail) {");
  assert(
    !source.includes("if (!renderedEmail || !renderedPdf)"),
    "a private PDF failure must not make buyer email retry",
  );
});

Deno.test("#4063 confirmation attachments start empty and add only the ICS", () => {
  const start = source.indexOf(
    "const attachments: Array<{ filename: string; content: string }> = [];",
  );
  const end = source.indexOf("let attendanceWebClaimUrl", start);
  assert(start >= 0 && end > start, "confirmation attachment block missing");
  const block = source.slice(start, end);
  assertStringIncludes(block, "filename: calendarLinks.icsFilename");
  assertStringIncludes(block, "content: icsToBase64(calendarLinks.icsContent)");
  assert(
    !/renderedPdf|\.pdf/i.test(block),
    "PDF returned to email attachments",
  );
});
