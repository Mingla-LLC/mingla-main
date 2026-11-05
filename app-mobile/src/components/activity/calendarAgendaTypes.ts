/**
 * Issue #4265 — the app's real row types bound to the pure agenda model.
 * Kept apart from `calendarAgendaModel.ts` so the model stays import-free.
 */
import type { MyStayReservationGroup } from "@mingla/brand-rendering/stayGuest";
import type {
  BusinessEventCalendarRow,
  ConsumerRsvpRow,
} from "../../services/calendarService";
import type { MyReservationRow } from "../../hooks/useMyReservations";
import type { CanonicalDiscoveryPrice } from "../../utils/priceTiers";

/** A scheduled saved card, as AppStateManager hands it to LikesPage. */
export interface CalendarEntry extends Partial<CanonicalDiscoveryPrice> {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  date: string;
  time: string;
  source: "solo" | "collaboration";
  sourceDetails: string;
  priceRange: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  socialStats: {
    views: number;
    likes: number;
    saves: number;
  };
  status: "confirmed" | "pending" | "completed";
  experience?: any;
  suggestedDates?: string[];
  sessionType?: string;
  sessionName?: string;
  purchaseOption?: any;
  isPurchased?: boolean;
  dateTimePreferences?: any;
  phoneNumber?: string;
  website?: string;
  duration_minutes?: number;
  scheduled_at?: string;
  device_calendar_event_id?: string | null;
}

export interface CalendarAgendaSources {
  calendar: CalendarEntry;
  ticket: BusinessEventCalendarRow;
  reservation: MyReservationRow;
  stay: MyStayReservationGroup;
  rsvp: ConsumerRsvpRow;
}
