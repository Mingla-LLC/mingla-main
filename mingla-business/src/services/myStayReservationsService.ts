import type { MyStayReservationGroup } from "@mingla/brand-rendering/stayGuest";

import { supabase } from "./supabase";

export async function fetchMyStayReservations(): Promise<
  MyStayReservationGroup[]
> {
  const { data, error } = await supabase.rpc("pg_my_stay_reservation_groups");
  if (error) throw error;
  return Array.isArray(data) ? (data as MyStayReservationGroup[]) : [];
}
