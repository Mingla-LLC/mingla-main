/**
 * #4111 — shapes shared by useExplorerBrandMessage (light) and the lazy
 * ExplorerBrandMessageHost, in a leaf module so the two never import each other.
 */
import type { ResolvedTheme } from "@mingla/offering-rendering";
import type { EnquiryPrefill } from "@mingla/brand-rendering/enquiry/enquiryTopics";

export interface ExplorerBrandTarget {
  id: string;
  name: string;
  slug: string | null;
  theme: ResolvedTheme;
}

export interface ExplorerMessageTrigger {
  nonce: number;
  prefill: EnquiryPrefill | null;
}
