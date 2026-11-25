/**
 * #4490 O3B — web build of NativeTabletColumn: a pure passthrough, so the web
 * boot bundle carries none of the native tablet logic (web's own desktop
 * layouts own wide screens). Native: NativeTabletColumn.tsx.
 */
import React from "react";

export const NativeTabletColumn: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
