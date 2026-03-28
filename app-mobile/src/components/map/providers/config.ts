import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { DiscoverMapProviderKind } from './types';

const DEMO_MAPLIBRE_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const IOS_DISCOVER_MAP_PROVIDER: DiscoverMapProviderKind = 'react-native-maps';
const ANDROID_DISCOVER_MAP_PROVIDER: DiscoverMapProviderKind = 'maplibre';

const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function readExpoExtraString(key: string) {
  const extraValue = expoExtra[key];
  return typeof extraValue === 'string' && extraValue.trim().length > 0
    ? extraValue.trim()
    : undefined;
}

// [TRANSITIONAL] Keep Android on MapLibre, but force iOS back to the proven
// react-native-maps path until the iOS MapLibre renderer is stable enough for Discover.
export const ACTIVE_DISCOVER_MAP_PROVIDER =
  Platform.OS === 'ios'
    ? IOS_DISCOVER_MAP_PROVIDER
    : ANDROID_DISCOVER_MAP_PROVIDER;

export const MAPLIBRE_STYLE_URL =
  process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL ??
  readExpoExtraString('EXPO_PUBLIC_MAPLIBRE_STYLE_URL') ??
  DEMO_MAPLIBRE_STYLE_URL;
