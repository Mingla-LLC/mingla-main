/** Issue #1447 — route-local anonymous RSVP pass recovery calls.
 *
 * Kept separate from the shared RSVP authoring service so the PDF/recovery
 * implementation remains in the lazy `/rsvp/pass` web route chunk.
 */
import { supabase } from "./supabase";

export const fetchPublicRsvpPassMetadata = async (
  entityType: "primary" | "guest",
  entityId: string,
  recoveryToken: string | null,
): Promise<import("@mingla/offering-rendering").RsvpPassCredential> => {
  const { data, error } = await supabase.functions.invoke("rsvp-pass-fetch", {
    body: { entityType, entityId, recoveryToken },
    headers: { Accept: "application/json" },
  });
  if (error) throw error;
  const result = data as {
    credentials?: import("@mingla/offering-rendering").RsvpPassCredential[];
  };
  const credential = result.credentials?.[0];
  if (!credential) throw new Error("rsvp_pass_metadata_missing");
  return credential;
};

export const fetchPublicRsvpPassPdf = async (
  entityType: "primary" | "guest",
  entityId: string,
  recoveryToken: string | null,
): Promise<{ filename: string; blob: Blob }> => {
  const { data, error, response } = await supabase.functions.invoke<Blob>(
    "rsvp-pass-fetch",
    {
      body: { entityType, entityId, recoveryToken },
      headers: { Accept: "application/pdf" },
    },
  );
  if (error) throw error;
  if (!(data instanceof Blob) || data.type !== "application/pdf") {
    throw new Error("rsvp_pdf_invalid_content_type");
  }
  const disposition = response?.headers.get("content-disposition") ?? null;
  const filename = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ??
    "rsvp-pass.pdf";
  return { filename, blob: data };
};
