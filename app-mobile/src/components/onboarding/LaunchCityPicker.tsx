/**
 * LaunchCityPicker — ORCH-1028 Part 1 (launch-city gate, §B.2 / DESIGN §3.B).
 *
 * In-onboarding picker rendered inside the `location` substep when the captured
 * GPS point is OUTSIDE every live city. Picks ONLY from the FROZEN `liveCities`
 * list returned by `check-launch-city` (DEC-1028-6 — never free-text geo, so the
 * user cannot pick a non-live city and re-land on an empty deck).
 *
 * The confirm CTA + write live on the parent (OnboardingFlow) via the shell bottom
 * bar; this component owns the headline/body/filter/rows + selection only.
 */
import React, { useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, Platform } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useTranslation } from 'react-i18next'
import { Icon } from '../ui/Icon'
import type { LaunchCityWithBbox } from '../../hooks/useLaunchCityGate'
import {
  colors,
  spacing,
  radius,
  fontWeights,
  glass,
  responsiveTypography,
  responsiveSpacing,
} from '../../constants/designSystem'

interface LaunchCityPickerProps {
  cities: LaunchCityWithBbox[]
  selectedCityId: string | null
  onSelect: (city: LaunchCityWithBbox) => void
  /** Real captured GPS point — drives nearest-first sort. Null → name-asc. */
  origin: { lat: number; lng: number } | null
  /** When true the rows + filter are non-interactive (write in flight). */
  disabled?: boolean
}

const FILTER_THRESHOLD = 8

// Cheap haversine (km). Nearest-first sort only — precision irrelevant.
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export const LaunchCityPicker: React.FC<LaunchCityPickerProps> = ({
  cities,
  selectedCityId,
  onSelect,
  origin,
  disabled = false,
}) => {
  const { t } = useTranslation('onboarding')
  const [query, setQuery] = useState('')

  // Sort: nearest-first from the real GPS point (DESIGN §3.B), name-asc fallback.
  const sorted = useMemo(() => {
    const copy = [...cities]
    if (origin) {
      copy.sort(
        (a, b) =>
          distanceKm(origin.lat, origin.lng, a.center_lat, a.center_lng) -
          distanceKm(origin.lat, origin.lng, b.center_lat, b.center_lng)
      )
    } else {
      copy.sort((a, b) => a.name.localeCompare(b.name))
    }
    return copy
  }, [cities, origin])

  const showFilter = cities.length > FILTER_THRESHOLD
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((c) => c.name.toLowerCase().includes(q))
  }, [sorted, query])

  return (
    <View style={styles.root}>
      <Text style={styles.headline}>{t('launch_gate.picker_headline')}</Text>
      <Text style={styles.body}>{t('launch_gate.picker_body')}</Text>

      {showFilter && (
        <View style={styles.filter}>
          <Icon name="search-outline" size={18} color={colors.text.tertiary} />
          <TextInput
            style={styles.filterInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('launch_gate.picker_search_placeholder')}
            placeholderTextColor={colors.text.tertiary}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            editable={!disabled}
            accessibilityLabel={t('launch_gate.picker_search_placeholder')}
          />
        </View>
      )}

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="search-outline" size={28} color={colors.text.tertiary} />
          <Text style={styles.emptyText}>{t('launch_gate.picker_empty_search')}</Text>
        </View>
      ) : (
        <View
          style={[styles.list, disabled && styles.listDisabled]}
          pointerEvents={disabled ? 'none' : 'auto'}
          accessibilityRole="radiogroup"
        >
          {filtered.map((city) => {
            const selected = city.id === selectedCityId
            return (
              <Pressable
                key={city.id}
                style={[styles.row, selected ? styles.rowSelected : styles.rowUnselected]}
                onPress={() => {
                  Haptics.selectionAsync()
                  onSelect(city)
                }}
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled }}
                accessibilityLabel={city.name}
              >
                <View style={styles.rowLeft}>
                  <Icon
                    name="location-outline"
                    size={20}
                    color={selected ? colors.primary[500] : colors.text.tertiary}
                  />
                  <Text style={styles.rowLabel} numberOfLines={1} ellipsizeMode="tail">
                    {city.name}
                  </Text>
                </View>
                {/* Reserved 22pt trailing slot — selecting never reflows the row. */}
                <View style={styles.rowTrailing}>
                  {selected && (
                    <Icon name="checkmark-circle" size={22} color={colors.primary[500]} />
                  )}
                </View>
              </Pressable>
            )
          })}
        </View>
      )}
    </View>
  )
}

// Android opaque-glass fallback (META-ORCH-1002 ANDROID_GLASS_USES_OPAQUE_FALLBACK):
// translucent row fills degrade on Android — use an opaque >=0.92 fill, clip with
// overflow:'hidden', and drop the Android shadow under the rounded fill.
const rowSurfaceBg = Platform.select({
  ios: glass.surface.backgroundColor, // rgba(255,255,255,0.55)
  android: 'rgba(255,255,255,0.94)',
  default: glass.surface.backgroundColor,
}) as string

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
  headline: {
    ...responsiveTypography.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: 'left',
    letterSpacing: -0.4,
    marginTop: responsiveSpacing.lg,
    marginBottom: responsiveSpacing.xs,
  },
  body: {
    ...responsiveTypography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: 'left',
    marginBottom: responsiveSpacing.lg,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    borderRadius: radius.lg,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    backgroundColor: Platform.select({
      ios: glass.buttonSecondary.backgroundColor,
      android: 'rgba(255,255,255,0.94)',
      default: glass.buttonSecondary.backgroundColor,
    }) as string,
    borderColor: glass.buttonSecondary.borderColor,
    borderWidth: glass.buttonSecondary.borderWidth,
    marginBottom: responsiveSpacing.md,
  },
  filterInput: {
    flex: 1,
    ...responsiveTypography.md,
    color: colors.text.primary,
    paddingVertical: 0,
  },
  list: {
    width: '100%',
    gap: responsiveSpacing.sm,
  },
  listDisabled: {
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingVertical: responsiveSpacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  rowUnselected: {
    backgroundColor: rowSurfaceBg,
    borderColor: glass.surface.borderColor,
    borderWidth: 1,
    // Light shadow on iOS only — no Android shadow under the rounded opaque fill
    // (META-ORCH-1002 — opaque Android fill carries the surface, no elevation).
    ...(Platform.OS === 'ios' ? glass.shadowLight : {}),
  },
  rowSelected: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[500],
    borderWidth: 1.5,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  rowLabel: {
    ...responsiveTypography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    flexShrink: 1,
  },
  rowTrailing: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: responsiveSpacing.xl,
  },
  emptyText: {
    ...responsiveTypography.md,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: responsiveSpacing.sm,
  },
})
