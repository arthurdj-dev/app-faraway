import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../constants/theme';

export default function Stats() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Statistiques</Text>
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🏆</Text>
        <Text style={styles.emptyText}>Pas encore de statistiques</Text>
        <Text style={styles.emptySubtext}>
          Jouez quelques parties pour voir vos statistiques apparaître ici.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  title: {
    fontSize: FONTS.title,
    fontWeight: '700',
    color: COLORS.text,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.sm,
  },
  emptyText: {
    fontSize: FONTS.subtitle,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONTS.body,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});
