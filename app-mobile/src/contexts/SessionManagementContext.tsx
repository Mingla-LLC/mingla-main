import React, { createContext, useContext } from "react";
import {
  useSessionManagementController,
} from "../hooks/useSessionManagement";

type SessionManagementController = ReturnType<
  typeof useSessionManagementController
>;

const SessionManagementContext = createContext<
  SessionManagementController | null
>(null);

/**
 * Owns Explorer's session reads and `session_pills:<user>` realtime channel.
 * Keep this provider above every Home-route consumer so nested surfaces share
 * one controller instead of registering callbacks after the channel subscribes.
 */
export function SessionManagementProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const controller = useSessionManagementController();

  return (
    <SessionManagementContext.Provider value={controller}>
      {children}
    </SessionManagementContext.Provider>
  );
}

export function useSessionManagement(): SessionManagementController {
  const controller = useContext(SessionManagementContext);

  if (!controller) {
    throw new Error(
      "useSessionManagement must be used within SessionManagementProvider",
    );
  }

  return controller;
}
