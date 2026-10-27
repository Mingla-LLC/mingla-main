import React from 'react';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { payoutService } from '../../../src/services/payoutService';
import { goToNextStep, stepTitle } from '../../../src/components/creator/setupNav';
import { ProgramButton, ProgramScreen } from '../../../src/components/programs/ProgramUi';
import { PayoutConnect } from '../../../src/components/wallet/PayoutConnect';

export default function CreatorPayoutStep(): React.ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['creator', 'payout'], queryFn: () => payoutService.status(), retry: 0 });
  return <ProgramScreen title={stepTitle('payout')}
    footer={<ProgramButton label={status.data?.connected ? 'Continue' : 'Connect a bank to continue'} disabled={!status.data?.connected} onPress={() => void goToNextStep(router, queryClient, 'payout')} />}>
    <PayoutConnect onConnected={() => void goToNextStep(router, queryClient, 'payout')} />
  </ProgramScreen>;
}
