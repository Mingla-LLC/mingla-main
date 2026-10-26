import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { creatorProgramService } from '../../services/creatorProgramService';
import { creatorGigsService } from '../../services/creatorGigsService';
import { localProgramService } from '../../services/localProgramService';
import { creatorOwnsNextStep, formatMoney, hostsSeeYouAs, localRowCopy, nicheLabel } from '../../utils/programFormat';
import { Icon } from '../ui/Icon';
import { glass } from '../../constants/designSystem';
import SettingsRow from './SettingsRow';
import { EarnWithMinglaSheet } from './EarnWithMinglaSheet';

type Props = {
  userId: string | null;
  onOpenCreator: () => void;
  onOpenLocal: () => void;
  onOpenEarnings: () => void;
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'M';
}

/**
 * Profile › Creator programs. Creators get their status at the top ("You're a
 * Mingla Creator" and how hosts see them), then their gigs and Local. Everyone
 * else gets "Earn with Mingla", which explains the three ways to earn.
 */
export function CreatorProgramsSection({ userId, onOpenCreator, onOpenLocal, onOpenEarnings }: Props): React.ReactElement {
  const [earnOpen, setEarnOpen] = useState(false);
  const status = useQuery({ queryKey: ['creator-programs', 'status', userId], queryFn: () => creatorProgramService.status(), enabled: Boolean(userId), staleTime: 60_000, retry: 1 });
  const isCreator = Boolean(status.data?.profile);
  const profile = useQuery({ queryKey: ['creator-programs', 'own-profile', userId], queryFn: () => creatorProgramService.ownProfile(), enabled: isCreator, staleTime: 60_000, retry: 1 });
  const home = useQuery({ queryKey: ['creator-programs', 'home', userId], queryFn: () => creatorGigsService.home(), enabled: isCreator, staleTime: 60_000, retry: 1 });
  const earnings = useQuery({ queryKey: ['creator-programs', 'earnings', userId], queryFn: () => creatorGigsService.earningsSummary(), enabled: isCreator, staleTime: 60_000, retry: 0 });
  const landing = useQuery({ queryKey: ['creator-programs', 'local-landing', userId], queryFn: () => localProgramService.landing(), enabled: Boolean(userId), staleTime: 60_000, retry: 1 });

  const local = landing.data;
  const localCopy = localRowCopy(local);
  const hasLocalSeatOrApplication = Boolean(local?.local || (local?.applications.length ?? 0) > 0);
  const verified = status.data?.verification === 'verified';
  const name = profile.data?.display_name ?? '';
  const seenAs = hostsSeeYouAs(name, profile.data?.niches ?? [], nicheLabel);

  const needsYou = (home.data?.contracts ?? []).filter((c) => creatorOwnsNextStep(c.state)).length;
  const summary = earnings.data;
  const gigsLine = [
    needsYou > 0 ? `${needsYou} need${needsYou === 1 ? 's' : ''} you` : null,
    summary && summary.ready_minor > 0 ? `${formatMoney(summary.ready_minor, summary.currency)} ready` : null,
    summary && summary.on_the_way_minor > 0 ? `${formatMoney(summary.on_the_way_minor, summary.currency)} on the way` : null,
  ].filter(Boolean).join(' · ') || (verified ? 'Find gigs and manage your work' : 'Finish setup to start getting gigs');

  return <View>
    <Text style={styles.title}>Creator programs</Text>
    {isCreator ? <>
      <Pressable accessibilityRole="button" accessibilityLabel={`You're a Mingla Creator. ${seenAs}`} onPress={onOpenCreator} style={({ pressed }) => [styles.me, pressed && styles.pressed]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
        <View style={styles.flex}>
          <Text style={styles.meTitle}>You’re a Mingla Creator</Text>
          {seenAs ? <Text style={styles.meSub} numberOfLines={2}>{verified ? `Hosts see you as ${seenAs}` : `Hosts will see you as ${seenAs} once setup is done`}</Text> : null}
        </View>
        <Icon name="chevron-forward" size={16} color={glass.profile.settingsRow.chevronColor} />
      </Pressable>
      <SettingsRow icon="videocam" label="Gigs and contracts" description={gigsLine} showChevron onPress={onOpenCreator} isLast={!localCopy} />
      {localCopy ? <SettingsRow icon="location-outline" label="Mingla Local" description={localCopy} showChevron onPress={onOpenLocal} isLast /> : null}
    </> : <>
      {hasLocalSeatOrApplication && localCopy ? <SettingsRow icon="location-outline" label="Mingla Local" description={localCopy} showChevron onPress={onOpenLocal} /> : null}
      <SettingsRow icon="sparkles" label="Earn with Mingla" description="Make videos for hosts, review places as a Local, or earn from friends you bring" showChevron onPress={() => setEarnOpen(true)} isLast />
      <EarnWithMinglaSheet
        visible={earnOpen}
        onClose={() => setEarnOpen(false)}
        localHint={hasLocalSeatOrApplication ? null : localCopy ? `Mingla picks a few Locals per city. ${localCopy}.` : null}
        onOpenCreator={onOpenCreator}
        onOpenLocal={onOpenLocal}
        onOpenReferrals={onOpenEarnings}
      />
    </>}
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { ...glass.profile.text.cardTitle, marginBottom: 8 },
  me: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: glass.profile.settingsRow.rowDivider },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(235, 120, 37, 0.18)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#eb7825', fontWeight: '900', fontSize: 15 },
  meTitle: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  meSub: { color: 'rgba(255, 255, 255, 0.55)', fontSize: 13, marginTop: 2 },
  pressed: { opacity: 0.75 },
});
