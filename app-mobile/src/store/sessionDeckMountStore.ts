import { create } from 'zustand';

export type SessionDeckMountOwner = 'in-chat-sheet' | 'dedicated-screen';

interface DeckMountState {
  mountedSessionId: string | null;
  mountedBy: SessionDeckMountOwner | null;
  acquire: (sessionId: string, owner: SessionDeckMountOwner) => boolean;
  release: (sessionId: string) => void;
}

export const useSessionDeckMountStore = create<DeckMountState>((set, get) => ({
  mountedSessionId: null,
  mountedBy: null,
  acquire: (sessionId, owner) => {
    const current = get();
    if (current.mountedSessionId === null) {
      set({ mountedSessionId: sessionId, mountedBy: owner });
      return true;
    }
    if (current.mountedSessionId === sessionId && current.mountedBy === owner) {
      return true;
    }
    return false;
  },
  release: (sessionId) => {
    const current = get();
    if (current.mountedSessionId === sessionId) {
      set({ mountedSessionId: null, mountedBy: null });
    }
  },
}));
