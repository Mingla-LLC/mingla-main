import Constants from 'expo-constants';
import type { DiscoverMapProviderKind } from './types';

const DEMO_MAPLIBRE_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

const expoExtra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function readExpoExtraString(key: string) {
  const extraValue = expoExtra[key];
  return typeof extraValue === 'string' && extraValue.trim().length > 0
    ? extraValue.trim()
    : undefined;
}

// ORCH-0410: Unified to react-native-maps on both platforms.
// iOS: Apple Maps (default). Android: Google Maps (API key in app.config.ts).
// Previously Android used MapLibre which had: MarkerView performance issues
// (100+ React views per frame), blank gray background (no tiles), and
// received less testing than the iOS path.
// History: dual-provider introduced in 649d2d1e (March 28). MapLibre was the
// first implementation; iOS fell back to react-native-maps when MapLibre crashed
// (EXC_BAD_ACCESS with 30+ MarkerViews). Android was never tested with
// react-native-maps — MapLibre was kept because "it worked."
// Revert: change to `Platform.OS === 'ios' ? 'react-native-maps' : 'maplibre'`
export const ACTIVE_DISCOVER_MAP_PROVIDER: DiscoverMapProviderKind = 'react-native-maps';

// [DEAD CODE after ORCH-0410] MapLibre style URL — only referenced by MapLibreProvider.tsx
// which is no longer the active provider. Kept for rollback path.
export const MAPLIBRE_STYLE_URL =
  process.env.EXPO_PUBLIC_MAPLIBRE_STYLE_URL ??
  readExpoExtraString('EXPO_PUBLIC_MAPLIBRE_STYLE_URL') ??
  DEMO_MAPLIBRE_STYLE_URL;
