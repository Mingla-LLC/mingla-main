import { supabase } from "./supabase";

export interface ServerScanResult {
  result: "success" | "duplicate" | "wrong_event" | "not_found" | "void";
  scanId: string | null;
  ticketId: string | null;
  orderId: string | null;
  buyerName: string | null;
  ticketName: string | null;
}

export const scanTicket = async (
  eventId: string,
  qrPayload: string,
): Promise<ServerScanResult> => {
  const { data, error } = await supabase.functions.invoke("scan-ticket", {
    body: { eventId, qrPayload },
  });
  if (error) throw new Error(error.message);
  return data as ServerScanResult;
};
