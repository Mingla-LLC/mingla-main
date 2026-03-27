import React, { createContext, useCallback, useContext, useRef } from 'react';

export interface TourTargetLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TourTargetContextValue {
  registerTarget: (id: string, layout: TourTargetLayout) => void;
  unregisterTarget: (id: string) => void;
  getTargetLayout: (id: string) => TourTargetLayout | null;
}

const TourTargetContext = createContext<TourTargetContextValue | null>(null);

export function TourTargetProvider({ children }: { children: React.ReactNode }) {
  const targetsRef = useRef<Map<string, TourTargetLayout>>(new Map());

  const registerTarget = useCallback((id: string, layout: TourTargetLayout) => {
    targetsRef.current.set(id, layout);
  }, []);

  const unregisterTarget = useCallback((id: string) => {
    targetsRef.current.delete(id);
  }, []);

  const getTargetLayout = useCallback((id: string): TourTargetLayout | null => {
    return targetsRef.current.get(id) ?? null;
  }, []);

  return (
    <TourTargetContext.Provider value={{ registerTarget, unregisterTarget, getTargetLayout }}>
      {children}
    </TourTargetContext.Provider>
  );
}

export function useTourTargets(): TourTargetContextValue {
  const ctx = useContext(TourTargetContext);
  if (!ctx) {
    throw new Error('useTourTargets must be used within a TourTargetProvider');
  }
  return ctx;
}
