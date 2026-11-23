// #4490 spec 08 O3 — the one delivery rail for server-made PDFs, extracted from
// venue-qr-sheet (#1789): decode the rendered PDF, upload it to a PRIVATE
// bucket, and hand back a short-lived signed URL. Nothing here is ever public;
// callers decide who may ask, this only delivers.
//
// Used by venue-qr-sheet (venue-qr-sheets bucket) and venue-floor-pdf
// (venue-floor-pdfs bucket). Each failure names its stage so the caller logs
// it and answers its own error code.

export interface PdfStorageBucket {
  upload: (
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ) => Promise<{ error: { message: string } | null }>;
  createSignedUrl: (
    path: string,
    expiresIn: number,
  ) => Promise<
    { data: { signedUrl: string } | null; error: { message: string } | null }
  >;
}

export interface PdfStorage {
  from: (bucket: string) => PdfStorageBucket;
}

export interface PdfDeliveryInput {
  bucket: string;
  objectPath: string;
  contentBase64: string;
  ttlSeconds: number;
}

export type PdfDeliveryResult =
  | { ok: true; signedUrl: string; expiresAt: string }
  | { ok: false; stage: "upload" | "sign"; message: string };

export function pdfBytesFromBase64(contentBase64: string): Uint8Array {
  return Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
}

export async function deliverPdf(
  storage: PdfStorage,
  input: PdfDeliveryInput,
  now: () => number = () => Date.now(),
): Promise<PdfDeliveryResult> {
  const pdfBytes = pdfBytesFromBase64(input.contentBase64);
  const { error: uploadError } = await storage
    .from(input.bucket)
    .upload(input.objectPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    return { ok: false, stage: "upload", message: uploadError.message };
  }
  const { data: signedData, error: signError } = await storage
    .from(input.bucket)
    .createSignedUrl(input.objectPath, input.ttlSeconds);
  if (signError || !signedData?.signedUrl) {
    return {
      ok: false,
      stage: "sign",
      message: signError?.message ?? "no_signed_url",
    };
  }
  return {
    ok: true,
    signedUrl: signedData.signedUrl,
    expiresAt: new Date(now() + input.ttlSeconds * 1000).toISOString(),
  };
}
