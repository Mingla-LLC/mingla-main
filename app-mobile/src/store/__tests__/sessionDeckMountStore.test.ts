import { useSessionDeckMountStore } from '../sessionDeckMountStore';

export function runOrch0918MutexHappyPathTest(): boolean {
  const store = useSessionDeckMountStore.getState();
  store.release('s1');
  const acquiredByChat = store.acquire('s1', 'in-chat-sheet');
  store.release('s1');
  const acquiredByDedicated = useSessionDeckMountStore.getState().acquire('s1', 'dedicated-screen');
  const finalOwner = useSessionDeckMountStore.getState().mountedBy;
  useSessionDeckMountStore.getState().release('s1');
  return acquiredByChat && acquiredByDedicated && finalOwner === 'dedicated-screen';
}

export function runOrch0918MutexConflictTest(): boolean {
  const store = useSessionDeckMountStore.getState();
  store.release('s1');
  const first = store.acquire('s1', 'in-chat-sheet');
  const second = useSessionDeckMountStore.getState().acquire('s1', 'dedicated-screen');
  useSessionDeckMountStore.getState().release('s1');
  return first === true && second === false;
}

export const ORCH_0918_MUTEX_TEST_RECEIPTS = {
  'T-06': 'fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs',
  'T-07': 'fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs',
};
