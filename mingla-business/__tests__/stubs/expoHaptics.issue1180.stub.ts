// #1180 tester render-proof — headless stub for expo-haptics (native-only; the
// receipt/pill/explainer UI does not depend on real haptics firing).
export const selectionAsync = async (): Promise<void> => undefined;
export const impactAsync = async (): Promise<void> => undefined;
export const notificationAsync = async (): Promise<void> => undefined;
export const ImpactFeedbackStyle = { Light: "light", Medium: "medium", Heavy: "heavy" } as const;
export const NotificationFeedbackType = { Success: "success", Warning: "warning", Error: "error" } as const;
