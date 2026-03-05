import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface DescriptionSectionProps {
  title: string;
  description: string;
  fullDescription?: string;
}

export default function DescriptionSection({
  title,
  description,
  fullDescription,
}: DescriptionSectionProps) {
  // Use full description if available, otherwise use regular description
  const displayDescription = fullDescription || description;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{displayDescription}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 24,
  },
});

