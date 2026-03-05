import React, { createContext, useContext, useState, ReactNode } from 'react';
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

  const openCreateSessionModal = () => setIsCreateSessionModalOpen(true);
  const closeCreateSessionModal = () => setIsCreateSessionModalOpen(false);
  
  const openCreateBoardModal = () => setIsCreateBoardModalOpen(true);
  const closeCreateBoardModal = () => setIsCreateBoardModalOpen(false);
  
  const openSessionSwitcher = () => setIsSessionSwitcherOpen(true);
  const closeSessionSwitcher = () => setIsSessionSwitcherOpen(false);
  
  const openPreferencesModal = () => setIsPreferencesModalOpen(true);
  const closePreferencesModal = () => setIsPreferencesModalOpen(false);

  const navigateToExperience = (experienceId: string) => {
    // This will be implemented when we add stack navigation
  };

  const navigateToBoard = (boardId: string) => {
    // This will be implemented when we add stack navigation
  };

  const navigateToSession = (sessionId: string) => {
    // This will be implemented when we add stack navigation
  };

  const navigateToConnections = () => {
    // Navigate to Connections tab
    if (navigation) {
      navigation.navigate('Connections');
    } else {
    }
  };

  const navigateToSaved = () => {
    // Navigate to Activity tab with saved tab active
    if (navigation) {
      navigation.navigate('Activity', { initialTab: 'saved' });
    } else {
    }
  };

  const navigateToSchedule = () => {
    // Navigate to Activity tab (which contains scheduled activities)
    if (navigation) {
      navigation.navigate('Activity');
    } else {
    }
  };

  const value: NavigationContextType = {
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
  };

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
