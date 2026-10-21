/**
 * issue #3827 — the round trip from the private-link sheet's empty state to the
 * ticket editor and back.
 *
 * Rendered by the guests screen ONLY while a trip is in progress (after the
 * host taps "Add a hidden paid ticket" / "Add a free guest-list ticket"). On
 * its first focus it opens the editor; when the guests screen is focused again
 * (the host saved or backed out) it calls `onReturn` once, and the screen
 * reopens New link. Mounting it per trip keeps the focus listener out of the
 * guests screen's normal render.
 */
import React, { useCallback, useRef } from "react";
import { useFocusEffect, useRouter } from "expo-router";

export interface AddTicketTypeForLinkTripProps {
  route: string;
  onReturn(): void;
}

export const AddTicketTypeForLinkTrip: React.FC<AddTicketTypeForLinkTripProps> = ({ route, onReturn }) => {
  const router = useRouter();
  const leftRef = useRef(false);
  const returnRef = useRef(onReturn);
  returnRef.current = onReturn;
  useFocusEffect(
    useCallback(() => {
      if (!leftRef.current) {
        leftRef.current = true;
        router.push(route as never);
        return;
      }
      returnRef.current();
    }, [route, router]),
  );
  return null;
};

export default AddTicketTypeForLinkTrip;
