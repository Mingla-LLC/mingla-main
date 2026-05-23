import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontWeights } from '../../../constants/designSystem';
import { Icon } from '../../ui/Icon';

export const CircleEmptyState: React.FC = () => (
  <View style={styles.container} testID="circle-empty-state">
    <View style={styles.iconWrap}>
      <Icon name="people-outline" size={24} color={colors.primary[500]} />
    </View>
    <Text style={styles.text}>
      Your circle will grow as you meet people through Mingla
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    height: 148,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 18,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(235, 120, 37, 0.12)',
    borderColor: 'rgba(235, 120, 37, 0.24)',
    borderWidth: 1,
  },
  text: {
    color: colors.gray[200],
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.medium,
    textAlign: 'center',
  },
});

export default CircleEmptyState;
