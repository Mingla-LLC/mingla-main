/**
 * #4420 (round-3 item 18) — whether someone is signed in to Mingla Host on
 * this device, for the guest pages' "Back to Mingla Host" bar. Reads the
 * stored session once, WITHOUT an auth hook or AuthContext: the guest routes
 * that use it are anon-tolerant (I-anon-buyer-routes, #1793 R1).
 */
import { useEffect, useState } from "react";

/** True once a stored Mingla Host session is found on this device. */
export function useSignedInHostViewer(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let active = true;
    void import("../../services/supabase")
      .then(({ supabase }) => supabase.auth.getSession())
      .then(({ data }) => {
        if (active) setSignedIn(data.session?.user != null);
      })
      .catch(() => {
        // No session readable: the guest page stays exactly as it was.
      });
    return () => {
      active = false;
    };
  }, []);
  return signedIn;
}

