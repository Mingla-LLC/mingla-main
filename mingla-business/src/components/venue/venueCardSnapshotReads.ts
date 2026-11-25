/** On-intent, summary-only reads for the Hub venue-card snapshots (#4490). */
import { supabase } from "../../services/supabase";
import type {
  StayReservationEnvelope,
  StayStaffReservationList,
} from "../../types/stayReservation";
import type {
  Reservation,
  WaitlistEntry,
} from "../../types/venueReservation";
import type { VenueRequestsList } from "../../types/venueOffers";

type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export async function readRequestSnapshot(
  venueId: string,
): Promise<VenueRequestsList> {
  const { data, error } = await supabase.rpc("issue_4490_requests_list", {
    p_venue_id: venueId,
    p_filter: "all",
  });
  if (error !== null) throw error;
  const counts = record(record(data).counts);
  return {
    counts: {
      toAnswer: number(counts.toAnswer),
      waitingForDeposit: number(counts.waitingForDeposit),
      confirmed: number(counts.confirmed),
      closed: number(counts.closed),
      moneyDue: number(counts.moneyDue),
    },
    requests: [],
  };
}

export async function readStaySnapshot(
  venueId: string,
): Promise<StayStaffReservationList> {
  const { data, error } = await supabase.functions.invoke<
    StayReservationEnvelope<StayStaffReservationList>
  >("stay-reservations", {
    body: {
      action: "list_staff_groups",
      payload: { venueId },
    },
  });
  if (error !== null) throw error;
  if (data?.kind !== "success") {
    throw new Error(data?.code ?? "stay_reservation_failed");
  }
  return data.data;
}

interface ReservationSnapshotRow {
  reserved_for: string;
  status: Reservation["status"];
}

interface WaitlistSnapshotRow {
  status: WaitlistEntry["status"];
}

interface AvailabilitySnapshotRow {
  iana_timezone: string | null;
}

const timeZone = (candidate: string | null | undefined): string => {
  if (candidate === null || candidate === undefined || candidate.trim() === "") {
    return "UTC";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "UTC";
  }
};

export interface TableSnapshotRead {
  reservations: Pick<Reservation, "reservedFor" | "status">[] | undefined;
  waitlist: Pick<WaitlistEntry, "status">[] | undefined;
  timeZone: string | undefined;
}

export async function readTableSnapshot(
  brandId: string,
  venueId: string,
): Promise<TableSnapshotRead> {
  const [reservations, waitlist, availability] = await Promise.all([
    supabase
      .from("reservations")
      .select("reserved_for,status")
      .eq("brand_id", brandId)
      .eq("venue_id", venueId)
      .returns<ReservationSnapshotRow[]>(),
    supabase
      .from("venue_waitlist")
      .select("status")
      .eq("brand_id", brandId)
      .eq("venue_id", venueId)
      .returns<WaitlistSnapshotRow[]>(),
    supabase
      .from("venue_availability_config")
      .select("iana_timezone")
      .eq("brand_id", brandId)
      .eq("venue_id", venueId)
      .maybeSingle<AvailabilitySnapshotRow>(),
  ]);

  return {
    reservations:
      reservations.error === null
        ? (reservations.data ?? []).map((row) => ({
            reservedFor: row.reserved_for,
            status: row.status,
          }))
        : undefined,
    waitlist:
      waitlist.error === null
        ? (waitlist.data ?? []).map((row) => ({ status: row.status }))
        : undefined,
    timeZone:
      availability.error === null
        ? timeZone(availability.data?.iana_timezone)
        : undefined,
  };
}
