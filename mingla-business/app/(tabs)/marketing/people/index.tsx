import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { canvas, spacing, text, typography } from "../../../../src/constants/designSystem";
import { Skeleton } from "../../../../src/components/ui/Skeleton";

const PeoplePage = React.lazy(() => import("../../../../src/components/people/people"));

function PeopleRouteFallback(): React.ReactElement {
  return <View style={styles.host}><Text accessibilityRole="header" style={styles.title}>People</Text>{[0,1,2].map((row)=><Skeleton key={row} width="100%" height={96} radius="lg" />)}</View>;
}

export default function MarketingPeopleRoute(): React.ReactElement {
  return <React.Suspense fallback={<PeopleRouteFallback />}><PeoplePage /></React.Suspense>;
}

const styles=StyleSheet.create({host:{flex:1,backgroundColor:canvas.discover,padding:spacing.md,gap:spacing.md},title:{...typography.h2,color:text.primary}});
