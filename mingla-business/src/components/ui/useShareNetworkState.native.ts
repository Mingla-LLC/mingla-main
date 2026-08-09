import { useNetInfo } from '@react-native-community/netinfo';

export function useShareNetworkState(): boolean {
  const state = useNetInfo();
  return state.isConnected === true && state.isInternetReachable !== false;
}
