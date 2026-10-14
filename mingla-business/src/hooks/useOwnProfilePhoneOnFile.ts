/**
 * #3380 — does the signed-in viewer's account already have a phone number?
 *
 * `public-submit-rsvp` fills a signed-in guest's name, email and phone from the
 * account (`profiles`) and refuses the RSVP when the phone is missing. Knowing
 * this up front lets the RSVP page ask for the phone in the Going step instead
 * of failing first. Reads only the viewer's own row (RLS: `auth.uid() = id`).
 *
 * Returns `true` / `false` once known, and `null` while loading, when signed out,
 * when disabled, or when the read fails. `null` keeps the page on its existing
 * path; if the server then refuses for a missing phone, the shared RSVP body
 * reveals the phone field from the refusal itself, so a failed read never
 * becomes a dead end.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";

export const ownProfilePhoneKeys = {
  all: ["own-profile-phone"] as const,
  byUser: (userId: string): readonly [string, string] =>
    ["own-profile-phone", userId] as const,
};

/** Same test the server applies: a non-blank `profiles.phone`. */
export const profilePhoneIsOnFile = (phone: unknown): boolean =>
  typeof phone === "string" && phone.trim().length > 0;

export const fetchOwnProfilePhoneOnFile = async (
  userId: string,
): Promise<boolean> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();
  if (error !== null) throw error;
  return profilePhoneIsOnFile((data as { phone?: unknown } | null)?.phone);
};

export const useOwnProfilePhoneOnFile = (
  userId: string | null,
  enabled: boolean,
): boolean | null => {
  // ORCH-1004: `profiles` is auth.uid()-scoped, so wait for the session token
  // (an early read returns no row, which would wrongly read as "no phone").
  const { isAuthReady } = useAuth();
  const active = isAuthReady && userId !== null && enabled;
  const query = useQuery({
    queryKey: ownProfilePhoneKeys.byUser(userId ?? "anon"),
    queryFn: () => fetchOwnProfilePhoneOnFile(userId as string),
    enabled: isAuthReady && active,
    staleTime: 60_000,
    retry: 1,
  });
  useEffect(() => {
    // Not silent: the RSVP body still reveals the phone field if the server
    // refuses, so the guest is never stuck; this only loses the head start.
    if (active && query.isError) {
      console.warn("[rsvp] own profile phone read failed", String(query.error));
    }
  }, [active, query.isError, query.error]);
  if (!active || query.isError) return null;
  return query.data ?? null;
};
