import React from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { localProgramService } from '../../services/localProgramService';
import SettingsRow from './SettingsRow';

type Props = {
  onOpenCreator: () => void;
  onOpenLocal: () => void;
};

/**
 * The durable Profile entry point for both sides of the creator programme.
 * Creator is always available; Local is shown only when a city is open or the
 * signed-in person already has an application/seat to track.
 */
export function CreatorProgramsSection({ onOpenCreator, onOpenLocal }: Props): React.ReactElement {
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
        description="Build your profile, find paid gigs and manage active work"
        showChevron
        onPress={onOpenCreator}
        isLast={!showLocal}
      />
      {showLocal ? (
        <SettingsRow
          icon="location-outline"
          label="Mingla Local"
          description={
            local?.local
              ? `Your independent reviewer seat in ${local.local.city}`
              : local?.applications.length
                ? `Application: ${local.applications[0].status.replaceAll('_', ' ')}`
                : 'Apply to review one place honestly each month'
          }
          showChevron
          onPress={onOpenLocal}
          isLast
        />
      ) : null}
    </View>
  );
}
