import React from 'react';
import { Text } from 'react-native';

import { ProgramRow, ProgramSheet, programStyles as s } from '../programs/ProgramUi';

/**
 * #3872 W1 — one place that explains the three ways to earn, for people who
 * aren't creators yet. Each row hands off to the program it describes.
 */
export function EarnWithMinglaSheet({ visible, onClose, localHint, onOpenCreator, onOpenLocal, onOpenReferrals }: {
  visible: boolean;
  onClose: () => void;
  /** City-aware Local copy, or null when no city is open. */
  localHint: string | null;
  onOpenCreator: () => void;
  onOpenLocal: () => void;
  onOpenReferrals: () => void;
}): React.ReactElement {
  const go = (open: () => void) => (): void => { onClose(); open(); };
  return <ProgramSheet visible={visible} onClose={onClose} title="Earn with Mingla" snapPoints={['62%']}>
    <Text style={s.copy}>Three ways to get paid. Pick one to see what it takes.</Text>
    <ProgramRow icon="videocam" title="Make videos for hosts" subtitle="Hosts hire you per gig. Set your rates once." onPress={go(onOpenCreator)} />
    {localHint ? <ProgramRow icon="map-pin" title="Become a Mingla Local" subtitle={localHint} onPress={go(onOpenLocal)} /> : null}
    <ProgramRow icon="gift-outline" title="Bring friends" subtitle="Share an event. Earn when a friend books." onPress={go(onOpenReferrals)} isLast />
  </ProgramSheet>;
}
