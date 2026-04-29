import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { NavigationProp } from '@react-navigation/native';

interface NavigationContextType {
  // Modal states
  isCreateSessionModalOpen: boolean;
  isCreateBoardModalOpen: boolean;
  isSessionSwitcherOpen: boolean;
  isPreferencesModalOpen: boolean;
  
  // Modal actions
  openCreateSessionModal: () => void;
  closeCreateSessionModal: () => void;
  openCreateBoardModal: () => void;
  closeCreateBoardModal: () => void;
  openSessionSwitcher: () => void;
  closeSessionSwitcher: () => void;
  openPreferencesModal: () => void;
  closePreferencesModal: () => void;
  
  // Navigation helpers
  navigateToExperience: (experienceId: string) => void;
  navigateToBoard: (boardId: string) => void;
  navigateToSession: (sessionId: string) => void;
  navigateToConnections: () => void;
  navigateToSaved: () => void;
  navigateToSchedule: () => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

interface NavigationProviderProps {
  children: ReactNode;
  navigation?: NavigationProp<Record<string, object | undefined>>;
}

export const NavigationProvider: React.FC<NavigationProviderProps> = ({ children, navigation }) => {
  const [isCreateSessionModalOpen, setIsCreateSessionModalOpen] = useState(false);
  const [isCreateBoardModalOpen, setIsCreateBoardModalOpen] = useState(false);
  const [isSessionSwitcherOpen, setIsSessionSwitcherOpen] = useState(false);
  const [isPreferencesModalOpen, setIsPreferencesModalOpen] = useState(false);

  // ORCH-0679 Wave 2A: useCallback wraps stabilize handler identities so the
  // provider value below remains referentially equal across renders when no
  // modal-flag state changes. Without this, every parent render rebuilt the
  // value object → every context consumer re-rendered → memo barriers bust.
  const openCreateSessionModal = useCallback(() => setIsCreateSessionModalOpen(true), []);
  const closeCreateSessionModal = useCallback(() => setIsCreateSessionModalOpen(false), []);

  const openCreateBoardModal = useCallback(() => setIsCreateBoardModalOpen(true), []);
  const closeCreateBoardModal = useCallback(() => setIsCreateBoardModalOpen(false), []);

  const openSessionSwitcher = useCallback(() => setIsSessionSwitcherOpen(true), []);
  const closeSessionSwitcher = useCallback(() => setIsSessionSwitcherOpen(false), []);

  const openPreferencesModal = useCallback(() => setIsPreferencesModalOpen(true), []);
  const closePreferencesModal = useCallback(() => setIsPreferencesModalOpen(false), []);

  const navigateToExperience = useCallback((_experienceId: string) => {
    // Stub — requires stack navigation (not yet built)
  }, []);

  const navigateToBoard = useCallback((_boardId: string) => {
    // Stub — requires stack navigation (not yet built)
  }, []);

  const navigateToSession = useCallback((_sessionId: string) => {
    // Stub — requires stack navigation (not yet built)
  }, []);

  const navigateToConnections = useCallback(() => {
    if (navigation) {
      navigation.navigate('Connections');
    }
  }, [navigation]);

  const navigateToSaved = useCallback(() => {
    if (navigation) {
      navigation.navigate('Activity', { initialTab: 'saved' });
    }
  }, [navigation]);

  const navigateToSchedule = useCallback(() => {
    if (navigation) {
      navigation.navigate('Activity');
    }
  }, [navigation]);

  // ORCH-0679 Wave 2A: useMemo wrap (I-PROVIDER-VALUE-MEMOIZED) — value
  // identity is stable when no modal-flag state changes. Critical for memo
  // barriers on tab screens that consume Navigation context.
  const value = useMemo<NavigationContextType>(() => ({
    isCreateSessionModalOpen,
    isCreateBoardModalOpen,
    isSessionSwitcherOpen,
    isPreferencesModalOpen,
    openCreateSessionModal,
    closeCreateSessionModal,
    openCreateBoardModal,
    closeCreateBoardModal,
    openSessionSwitcher,
    closeSessionSwitcher,
    openPreferencesModal,
    closePreferencesModal,
    navigateToExperience,
    navigateToBoard,
    navigateToSession,
    navigateToConnections,
    navigateToSaved,
    navigateToSchedule,
  }), [
    isCreateSessionModalOpen,
    isCreateBoardModalOpen,
    isSessionSwitcherOpen,
    isPreferencesModalOpen,
    openCreateSessionModal,
    closeCreateSessionModal,
    openCreateBoardModal,
    closeCreateBoardModal,
    openSessionSwitcher,
    closeSessionSwitcher,
    openPreferencesModal,
    closePreferencesModal,
    navigateToExperience,
    navigateToBoard,
    navigateToSession,
    navigateToConnections,
    navigateToSaved,
    navigateToSchedule,
  ]);

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};
