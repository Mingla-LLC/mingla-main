import { openExternal } from "../../services/guestFunnelLink";

export async function openHelpCentre(url: string): Promise<void> {
  openExternal(url);
}
