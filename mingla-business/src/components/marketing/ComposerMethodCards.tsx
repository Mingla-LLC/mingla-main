/**
 * #4273 — where the SMS and push cards sit in the composer.
 *
 * Native: their own keyboard-aware scroll region, which is what keeps the email
 * editor's WebView out of any ScrollView (pell inside one blocks taps on iOS).
 * Web: in flow, because Band B is already the page scroller.
 */
import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { ScrollView } from "../../wrappers/SmartScrollView";

export interface ComposerMethodCardsProps {
  inFlow: boolean;
  style: StyleProp<ViewStyle>;
  testID: string;
  children: React.ReactNode;
}

export function ComposerMethodCards({
  inFlow,
  style,
  testID,
  children,
}: ComposerMethodCardsProps): React.ReactElement {
  if (inFlow) {
    return <View style={style} testID={testID}>{children}</View>;
  }
  return (
    <ScrollView style={style} testID={testID} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}
