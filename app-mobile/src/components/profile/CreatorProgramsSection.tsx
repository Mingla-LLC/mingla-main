import React from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { localProgramService, type LocalLanding } from '../../services/localProgramService';
import SettingsRow from './SettingsRow';
import { PublicCreatorSection } from './PublicCreatorSection';
import { PublicLocalSection } from './PublicLocalSection';

type Props = {
  userId: string | null;
  onOpenCreator: () => void;
  onOpenLocal: () => void;
};

const APPLICATION_STATUS: Record<string, string> = {
  submitted: 'Application received. We’ll let you know here.',
  shortlisted: 'You’re shortlisted. We’ll be in touch soon.',
  accepted: 'You’re in. Open to start your first month.',
  waitlisted: 'You’re on the waitlist for the next open seat.',
  rejected: 'Not selected this time.',
};

function localDescription(local: LocalLanding | undefined): string {
  if (local?.local) return `Your Local seat in ${local.local.city}`;
  const application = local?.applications[0];
  if (application) return APPLICATION_STATUS[application.status] ?? 'Application received.';
  const open = local?.programs[0];
  if (open) {
    const monthly = Math.round(open.monthly_usd_minor / 100);
    return `Get paid $${monthly} a month to review one place in ${open.city}. Limited seats.`;
  }
  return 'Get paid to review one place in your city each month.';
}

/**
 * The durable Profile entry point for both sides of the creator programme.
 * Creator is always available; Local is shown only when a city is open or the
 * signed-in person already has an application/seat to track. Your own public
 * cards sit here too, so they read as part of this section.
 */
export function CreatorProgramsSection({ userId, onOpenCreator, onOpenLocal }: Props): React.ReactElement {
  const landing = useQuery({
    queryKey: ['creator-programs', 'local-landing'],
    queryFn: () => localProgramService.landing(),
    staleTime: 60_000,
    retry: 1,
  });
  const local = landing.data;
  const showLocal = Boolean(
    local &&
      (local.local || local.applications.length > 0 || (local.enabled && local.programs.length > 0)),
  );

  return (
    <View>
      <Text style={{ color: '#ffffff', fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
        Creator programs
      </Text>
      <SettingsRow
        icon="videocam"
        label="Mingla Creator"
        description="Get paid by hosts to make short videos about their events and places"
        showChevron
        onPress={onOpenCreator}
        isLast={!showLocal}
      />
      {showLocal ? (
        <SettingsRow
          icon="location-outline"
          label="Mingla Local"
          description={localDescription(local)}
          showChevron
          onPress={onOpenLocal}
          isLast
        />
      ) : null}
      {userId ? <PublicCreatorSection userId={userId} embedded /> : null}
      {userId ? <PublicLocalSection userId={userId} embedded /> : null}
    </View>
  );
}
