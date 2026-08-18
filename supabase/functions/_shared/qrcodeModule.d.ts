// Local type declaration for the `qrcode` ESM bundle served by esm.sh.
//
// WHY THIS FILE EXISTS (issue #2160 CI, but the defect predates it).
// `ticketPdf.ts` does `import QRCode from "https://esm.sh/qrcode@1.5.4?bundle"`.
// esm.sh answers with an `X-TypeScript-Types` header pointing at
// `@types/qrcode@~1.5.6`, a DefinitelyTyped package that declares its API with
// a CommonJS `export =`. A `export =` declaration has no default export, so a
// stricter TypeScript/Deno version rejects the default import with:
//
//   TS2613: Module '"…/@types/qrcode@1.5.6/index.d.ts"' has no default export.
//
// The RUNTIME import is correct and unchanged — the `?bundle` build really does
// expose the API as the default export, which is why this has shipped and
// worked in production. Only the type resolution was wrong.
//
// WHY LOCAL TYPES RATHER THAN PINNING. Pinning `@types/qrcode` to a version
// whose shape happens to satisfy a default import just moves the goalposts to
// the next upstream release, and the range in the header (`~1.5.6`) is not ours
// to control. Declaring the shape here makes the import version-independent:
// the upstream `.d.ts` is never consulted for this specifier, so no future
// DefinitelyTyped change or Deno version can reintroduce this failure.
//
// SCOPE: exactly the one member `ticketPdf.ts` calls. This is deliberately NOT
// a full re-declaration of the qrcode API — a fuller shim would be a second,
// drifting copy of upstream types for no benefit. Add a member here only when
// something actually calls it.
declare const QRCode: {
  toDataURL: (
    text: string,
    opts: Record<string, unknown>,
  ) => Promise<string>;
};

export default QRCode;
