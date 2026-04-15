import React from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, typography, fontWeights, spacing } from '../../constants/designSystem';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ToggleSectionProps {
  title: string;
  subtitle: string;
  isOn: boolean;
  onToggle: (newValue: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export const ToggleSection: React.FC<ToggleSectionProps> = ({
  title,
  subtitle,
  isOn,
  onToggle,
  disabled,
  children,
}) => {
  const handleToggle = (newValue: boolean): void => {
    if (!newValue && disabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle(newValue);
  };

  return (
    <View style={toggleStyles.container}>
      <View style={toggleStyles.headerRow}>
        <View style={toggleStyles.textContainer}>
          <Text style={toggleStyles.title}>{title}</Text>
          <Text style={toggleStyles.subtitle}>{subtitle}</Text>
        </View>
        <Switch
          value={isOn}
          onValueChange={handleToggle}
          trackColor={{ false: colors.gray[300], true: colors.accent }}
          thumbColor="#ffffff"
          ios_backgroundColor={colors.gray[300]}
          accessibilityLabel={`${title} toggle`}
          accessibilityRole="switch"
        />
      </View>
      {isOn && (
        <View style={toggleStyles.content}>
          {children}
        </View>
      )}
    </View>
  );
};

const toggleStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    marginTop: 28,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  textContainer: {
    flex: 1,
    marginRight: spacing.md,
  },
  title: {
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  content: {
    marginTop: 14,
  },
});
