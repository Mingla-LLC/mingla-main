import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { CollaborationSession, Board, Save } from '../types';

export class RealtimeService {
  private channels: Map<string, RealtimeChannel> = new Map();

  // Session collaboration
  subscribeToSession(sessionId: string, callbacks: {
    onParticipantJoined?: (participant: any) => void;
    onParticipantLeft?: (participant: any) => void;
    onSessionUpdated?: (session: CollaborationSession) => void;
    onMessage?: (message: any) => void;
  }) {
    const channelName = `session:${sessionId}`;
    
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName);
    }

    const channel = supabase.channel(channelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'session_participants',
        filter: `session_id=eq.${sessionId}`
      }, (payload) => {
        console.log('Participant joined:', payload);
        callbacks.onParticipantJoined?.(payload.new);
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'session_participants',
        filter: `session_id=eq.${sessionId}`
      }, (payload) => {
        console.log('Participant left:', payload);
        callbacks.onParticipantLeft?.(payload.old);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'collaboration_sessions',
        filter: `id=eq.${sessionId}`
      }, (payload) => {
        console.log('Session updated:', payload);
        callbacks.onSessionUpdated?.(payload.new as CollaborationSession);
      })
      .on('broadcast', { event: 'message' }, (payload) => {
        console.log('Message received:', payload);
        callbacks.onMessage?.(payload);
      })
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  // Board collaboration
  subscribeToBoard(boardId: string, callbacks: {
    onBoardUpdated?: (board: Board) => void;
    onExperienceAdded?: (experience: any) => void;
    onExperienceRemoved?: (experienceId: string) => void;
    onCollaboratorJoined?: (collaborator: any) => void;
    onCollaboratorLeft?: (collaborator: any) => void;
  }) {
    const channelName = `board:${boardId}`;
    
    if (this.channels.has(channelName)) {
      return this.channels.get(channelName);
    }

    const channel = supabase.channel(channelName)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'boards',
        filter: `id=eq.${boardId}`
      }, (payload) => {
        console.log('Board updated:', payload);
        callbacks.onBoardUpdated?.(payload.new as Board);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'board_collaborators',
        filter: `board_id=eq.${boardId}`
      }, (payload) => {
        console.log('Collaborator joined:', payload);
        callbacks.onCollaboratorJoined?.(payload.new);
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'board_collaborators',
        filter: `board_id=eq.${boardId}`
      }, (payload) => {
        console.log('Collaborator left:', payload);
        callbacks.onCollaboratorLeft?.(payload.old);
      })
      .on('broadcast', { event: 'experience_added' }, (payload) => {
        console.log('Experience added:', payload);
        callbacks.onExperienceAdded?.(payload);
      })
      .on('broadcast', { event: 'experience_removed' }, (payload) => {
        console.log('Experience removed:', payload);
        callbacks.onExperienceRemoved?.(payload.experienceId);
      })
      .subscribe();

    this.channels.set(channelName, channel);
    return channel;
  }

  // Send message to session
  sendSessionMessage(sessionId: string, message: {
    type: 'text' | 'experience_shared' | 'board_created' | 'status_update';
    content: string;
    data?: any;
  }) {
    const channel = this.channels.get(`session:${sessionId}`);
    if (channel) {
      channel.send({
        type: 'broadcast',
        event: 'message',
        payload: {
          ...message,
          timestamp: new Date().toISOString(),
          sessionId,
        }
      });
    }
  }

  // Send board update
  sendBoardUpdate(boardId: string, event: 'experience_added' | 'experience_removed', data: any) {
    const channel = this.channels.get(`board:${boardId}`);
    if (channel) {
      channel.send({
        type: 'broadcast',
        event,
        payload: data
      });
    }
  }

  // Unsubscribe from channel
  unsubscribe(channelName: string) {
    const channel = this.channels.get(channelName);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(channelName);
    }
  }

  // Unsubscribe from all channels
  unsubscribeAll() {
    this.channels.forEach((channel, channelName) => {
      supabase.removeChannel(channel);
    });
    this.channels.clear();
  }

  // Get active channels
  getActiveChannels(): string[] {
    return Array.from(this.channels.keys());
  }
}

export const realtimeService = new RealtimeService();
