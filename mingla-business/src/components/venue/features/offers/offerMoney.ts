/**
 * #4490 — a venue money label ("₦5,000", "—" with no currency). A leaf, split
 * from offersModel so the Guest pages and the booking models that only need
 * this one line do not load the whole Host offers model.
 */
import { formatCurrency } from "../../../../utils/currency";

export function money(minor: number, currency: string | null): string {
  if (currency === null) return "—";
  return formatCurrency(minor, currency, true).replace(/\.00$/, "");
}
