/**
 * #4490 P6 — the step before a member goes in (from the list or a scanned
 * member pass): who they are, their plan, whether this billing period is still owed
 * (they can still go in until the grace ends), and how many guests come in on
 * their guest passes. One visit a day; guests only while the day has room
 * (the server says so in plain words when it doesn't).
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../../constants/designSystem";
import type { CheckInMember } from "../../../../types/venueOffers";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { NumberStepper } from "../../../ui/NumberStepper";
import { Pill } from "../../../ui/Pill";

export interface VenueMemberCheckInProps {
  member: CheckInMember;
  admitting: boolean;
  onAdmit: (guests: number) => void;
  onClose: () => void;
}

export function VenueMemberCheckIn({ member, admitting, onAdmit, onClose }: VenueMemberCheckInProps): React.ReactElement {
  const maxGuests = Math.min(20, Math.max(0, member.guestPassesLeft));
  const period = member.planPeriod;
  const [guests, setGuests] = useState(0);
  return (
    <View style={styles.host} testID="venue-checkin-member-step">
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{member.holderName}</Text>
        <Pill variant="info">Member</Pill>
      </View>
      <Text style={styles.meta}>{member.planName}</Text>
      {member.inToday ? (
        <Banner tone="warning" title="Already in today" body="Members check in once a day." testID="venue-checkin-member-in" />
      ) : member.paymentDue ? (
        <Banner tone="warning" title={`This ${period} isn't paid yet`} body="Let them in and remind them to pay from their member page." testID="venue-checkin-member-due" />
      ) : null}
      {!member.inToday ? (
        maxGuests > 0 ? (
          <>
            <NumberStepper label="Guests on their passes" value={guests} min={0} max={maxGuests} onChange={setGuests} testID="venue-checkin-member-guests" />
            <Text style={styles.meta}>{`${member.guestPassesLeft} guest ${member.guestPassesLeft === 1 ? "pass" : "passes"} left this ${period}.`}</Text>
          </>
        ) : (
          <Text style={styles.meta}>{`No guest passes left this ${period}. Guests can buy entry.`}</Text>
        )
      ) : null}
      <View style={styles.actions}>
        <Button label="Close" variant="secondary" size="md" onPress={onClose} testID="venue-checkin-member-close" />
        {!member.inToday ? (
          <Button
            label={guests > 0 ? `Check in ${guests + 1}` : "Check in"}
            variant="primary"
            size="md"
            loading={admitting}
            onPress={() => onAdmit(guests)}
            testID="venue-checkin-member-admit"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[3] },
  head: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" },
  title: { ...type.h2, color: color.text1 },
  meta: { ...type.small, color: color.text2 },
  actions: { flexDirection: "row", gap: space[2], justifyContent: "flex-end", flexWrap: "wrap" },
});
