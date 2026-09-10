import React from "react";

const router = {
  push: () => { throw new Error("capture_harness_blocked_navigation"); },
  replace: () => { throw new Error("capture_harness_blocked_navigation"); },
  back: () => undefined,
  canGoBack: () => false,
};

export const useRouter = () => router;
export const useLocalSearchParams = () => ({});
export const Link = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export default function Head({ children }: { children?: React.ReactNode }) { return <>{children}</>; }
