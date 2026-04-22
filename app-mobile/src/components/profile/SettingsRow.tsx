import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Icon } from '../ui/Icon';
import Toggle from './Toggle';
import { glass } from '../../constants/designSystem';

interface SettingsRowProps {
  label: string;
  hint?: string;
  // Toggle rows
  toggle?: boolean;
  toggleValue?: boolean;
  onToggle?: () => void;
  // Value-cycling rows
  value?: string;
  // Navigation rows
  icon?: string;
  description?: string;
  showChevron?: boolean;
  // Shared
  onPress?: () => void;
  isLast?: boolean;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  hint,
  toggle,
  toggleValue,
  onToggle,
  value,
  icon,
  description,
  showChevron,
  onPress,
  isLast,
}) => {
  const isInteractive = !!(onPress || onToggle);

  const content = (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      {icon && (
        <View style={styles.iconContainer}>
          <Icon name={icon} size={glass.profile.settingsRow.iconSize} color={glass.profile.settingsRow.iconColor} />
        </View>
      )}
      <View style={styles.labelContainer}>
        <Text style={[styles.label, icon && styles.labelBold]}>{label}</Text>
        {hint && <Text style={styles.hint}>{hint}</Text>}
        {description && <Text style={styles.description}>{description}</Text>}
      </View>
      {toggle && onToggle && (
        <Toggle value={!!toggleValue} onToggle={onToggle} />
      )}
      {value != null && (
        <View style={styles.valueRow}>
          <Text style={styles.value}>{value}</Text>
          <Icon name="chevron-forward" size={glass.profile.settingsRow.chevronSize} color={glass.profile.settingsRow.chevronColor} />
        </View>
      )}
      {showChevron && !value && (
        <Icon name="chevron-forward" size={glass.profile.settingsRow.chevronSize} color={glass.profile.settingsRow.chevronColor} />
      )}
    </View>
  );

  if (isInteractive && !toggle) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: glass.profile.settingsRow.verticalPadding,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: glass.profile.settingsRow.rowDivider,
  },
  iconContainer: {
    width: glass.profile.settingsRow.iconCircleSize,
    height: glass.profile.settingsRow.iconCircleSize,
    borderRadius: glass.profile.settingsRow.iconCircleRadius,
    backgroundColor: glass.profile.settingsRow.iconCircleBg,
    borderWidth: 1,
    borderColor: glass.profile.settingsRow.iconCircleBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  labelContainer: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
  },
  labelBold: {
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.55)',
    marginTop: 2,
  },
  description: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.55)',
    marginTop: 2,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: {
    fontSize: 14,
    color: '#eb7825',
    fontWeight: '700',
  },
});

export default SettingsRow;
