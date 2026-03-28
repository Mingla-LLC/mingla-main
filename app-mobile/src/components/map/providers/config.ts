import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { DiscoverMapProviderKind } from './types';

const DEMO_MAPLIBRE_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function readExpoExtraString(key: string) {
  const extraValue = expoExtra[key];
  return typeof extraValue === 'string' && extraValue.trim().length > 0
    ? extraValue.trim()
    : undefined;
}

// [TRANSITIONAL] iOS uses react-native-maps (Apple Maps) — MapLibre native renderer
// crashes on iOS with 30+ MarkerViews during zoom/pan gestures (native EXC_BAD_ACCESS,
// no JS error). Android uses MapLibre which handles MarkerViews stably.
// Exit condition: MapLibre iOS MarkerView stability fix (upstream library issue).
export const ACTIVE_DISCOVER_MAP_PROVIDER: DiscoverMapProviderKind =
  Platform.OS === 'ios' ? 'react-native-maps' : 'maplibre';

export const MAPLIBRE_STYLE_URL =
  process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL ??
  readExpoExtraString('EXPO_PUBLIC_MAPLIBRE_STYLE_URL') ??
  DEMO_MAPLIBRE_STYLE_URL;
