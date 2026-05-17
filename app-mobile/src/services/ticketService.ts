// ORCH-0842 — TicketService.fetchTicketPdfUrl.
//
// Calls the `ticket-pdf-fetch` edge function (verify_jwt = true) and returns
// a 60-second signed URL the mobile client uses to download the buyer's
// ticket PDF. Owner check enforced server-side per invariant
// I-PROPOSED-AK TICKET_PDF_FETCHABLE_BY_OWNER.

import { supabase } from "./supabase";
import { extractFunctionError } from "../utils/edgeFunctionError";

export interface TicketPdfFetchResponse {
  signedUrl: string;
  expiresAt: string;
  filename: string;
}

export class TicketService {
  /**
   * Fetch a short-lived signed URL for the buyer's ticket PDF.
   *
   * Errors thrown by this method already carry user-facing messages
   * extracted via `edgeFunctionError`. The caller should surface them
   * directly (toast / sheet error state) rather than re-mapping.
   */
  static async fetchTicketPdfUrl(
    orderId: string,
  ): Promise<TicketPdfFetchResponse> {
    const { data, error } = await supabase.functions.invoke<
      TicketPdfFetchResponse
    >("ticket-pdf-fetch", {
      body: { orderId },
    });
    if (error) {
      const msg = await extractFunctionError(
        error,
        "Couldn't load ticket PDF",
      );
      throw new Error(msg);
    }
    if (!data || typeof data.signedUrl !== "string") {
      throw new Error("Couldn't load ticket PDF");
    }
    return {
      signedUrl: data.signedUrl,
      expiresAt: data.expiresAt,
      filename: data.filename,
    };
  }
}
