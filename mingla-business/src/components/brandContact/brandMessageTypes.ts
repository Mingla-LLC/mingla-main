/**
 * #4111 — the shared shapes of the Business "Message {Brand}" controller. A
 * leaf module so useBrandMessage (light) and BrandMessageHost (lazy) never
 * import each other (I-PROPOSED-K require cycles).
 */
import type { ResolvedTheme } from "@mingla/offering-rendering";
import type {
  EnquiryEntry,
  EnquiryOffering,
  EnquiryPick,
  EnquiryVenue,
} from "@mingla/brand-rendering/enquiry/enquiryTopics";

export interface BrandMessageTarget {
  id: string;
  name: string;
  slug: string;
  theme: ResolvedTheme;
  /** ISO country the phone picker starts on (brand or venue). */
  countryIso?: string | null;
}

export interface BrandMessageViewer {
  userId: string | null;
  /** Shown in "Sending as {name}." */
  name: string | null;
}

export interface UseBrandMessageInput {
  brand: BrandMessageTarget | null;
  viewer: BrandMessageViewer;
  entry: EnquiryEntry;
  offerings?: ReadonlyArray<EnquiryOffering>;
  venue?: EnquiryVenue | null;
  /** Where sign-in returns to (native signed-out). */
  resumePath?: string;
  onBookTable?: (pick: EnquiryPick) => void;
}
