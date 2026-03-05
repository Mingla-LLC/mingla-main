import { useEffect, useState } from 'react';

// Import NetInfo with error handling
let NetInfo: any = null;
try {
  NetInfo = require('@react-native-community/netinfo');
} catch (error) {
  console.warn('NetInfo not available, using fallback network detection');
}

export interface NetworkState {
  isConnected: boolean;
  isInternetReachable: boolean;
  type: string;
}

/**
 * Monitor network connectivity
 */
export const useNetworkMonitor = () => {
  const [networkState, setNetworkState] = useState<NetworkState>({
    isConnected: true,
    isInternetReachable: true,
    type: 'unknown',
  });

  useEffect(() => {
    if (!NetInfo) {
      // Fallback: assume connected if NetInfo not available
      return;
    }

    // Get initial state
    NetInfo.fetch().then((state: any) => {
      setNetworkState({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? false,
        type: state.type,
      });
    });

    // Subscribe to network state updates
    const unsubscribe = NetInfo.addEventListener((state: any) => {
      setNetworkState({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? false,
        type: state.type,
      });
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  return networkState;
};

/**
 * Check if device is online
 */
export const isOnline = async (): Promise<boolean> => {
  if (!NetInfo) {
    // Fallback: assume online if NetInfo not available
    return true;
  }
  const state = await NetInfo.fetch();
  return state.isConnected ?? false;
};

