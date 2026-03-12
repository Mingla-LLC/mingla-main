import { supabase } from './supabase';
import { Board, BoardCollaborator } from '../types';

// ─── Types ───────────────────────────────────────────────────────

/** A board experience join record with the nested experience data. */
export interface BoardExperienceRecord {
  id: string;
  board_id: string;
  experience_id: string;
  added_by: string;
  created_at: string;
  experiences: Record<string, unknown> | null;
}

/** A board collaborator with nested profile info from the join query. */
export interface BoardCollaboratorWithProfile extends BoardCollaborator {
  profiles: {
    display_name?: string;
    email?: string;
    avatar_url?: string;
    first_name?: string;
    last_name?: string;
  } | null;
}

export interface BoardWithDetails extends Board {
  collaborators: BoardCollaboratorWithProfile[];
  experiences: BoardExperienceRecord[];
  experience_count: number;
  last_activity: string;
}

export interface CreateBoardParams {
  name: string;
  description?: string;
  /** User IDs (UUIDs). For email-based lookup, use addCollaboratorByEmail() after board creation. */
  collaborators?: string[];
  isPublic?: boolean;
}

// ─── Queries ─────────────────────────────────────────────────────

/** Fetch all boards owned by a user, ordered by most recently updated. */
export async function fetchUserBoards(userId: string): Promise<BoardWithDetails[]> {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('created_by', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  // Transform to BoardWithDetails with computed fields
  return (data || []).map(board => ({
    ...board,
    collaborators: [],
    experiences: [],
    experience_count: 0,
    last_activity: board.updated_at,
  }));
}

/** Fetch a single board by ID. */
export async function fetchBoard(boardId: string): Promise<Board> {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('id', boardId)
    .single();

  if (error) throw error;
  return data;
}

/** Fetch collaborators for a board, including profile info. */
export async function fetchBoardCollaborators(boardId: string): Promise<BoardCollaboratorWithProfile[]> {
  const { data, error } = await supabase
    .from('board_collaborators')
    .select(`*, profiles (*)`)
    .eq('board_id', boardId);

  if (error) throw error;
  return (data || []) as BoardCollaboratorWithProfile[];
}

/** Fetch experiences for a board. */
export async function fetchBoardExperiences(boardId: string): Promise<BoardExperienceRecord[]> {
  const { data, error } = await supabase
    .from('board_experiences')
    .select(`*, experiences(*)`)
    .eq('board_id', boardId);

  if (error) throw error;
  return (data || []) as BoardExperienceRecord[];
}

// ─── Mutations ───────────────────────────────────────────────────

/** Create a new board. Optionally add collaborators by user ID (UUIDs only). */
export async function createBoard(
  userId: string,
  params: CreateBoardParams,
): Promise<Board> {
  const { data: board, error: boardError } = await supabase
    .from('boards')
    .insert({
      name: params.name,
      description: params.description,
      created_by: userId,
      is_public: params.isPublic || false,
    })
    .select()
    .single();

  if (boardError) throw boardError;

  // Add collaborators if provided (these must be user IDs, not emails)
  if (params.collaborators && params.collaborators.length > 0) {
    const collaboratorInserts = params.collaborators.map(collabUserId => ({
      board_id: board.id,
      user_id: collabUserId,
      role: 'collaborator' as const,
    }));

    const { error: collabError } = await supabase
      .from('board_collaborators')
      .insert(collaboratorInserts);

    if (collabError) {
      console.warn('Error adding collaborators:', collabError);
      // Don't throw — board was created successfully
    }
  }

  return board;
}

/** Update an existing board. */
export async function updateBoard(
  boardId: string,
  updates: Partial<Board>,
): Promise<Board> {
  const { data, error } = await supabase
    .from('boards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', boardId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Delete a board. */
export async function deleteBoard(boardId: string): Promise<void> {
  const { error } = await supabase
    .from('boards')
    .delete()
    .eq('id', boardId);

  if (error) throw error;
}

/** Add a collaborator to a board by email (looks up user ID first). */
export async function addCollaboratorByEmail(
  boardId: string,
  userEmail: string,
  role: string = 'member',
): Promise<BoardCollaborator> {
  const { data: invitedUser, error: userError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', userEmail)
    .single();

  if (userError || !invitedUser) {
    throw new Error('User not found');
  }

  const { data, error } = await supabase
    .from('board_collaborators')
    .insert({ board_id: boardId, user_id: invitedUser.id, role })
    .select()
    .single();

  if (error) throw error;
  return data as BoardCollaborator;
}

/** Add a collaborator to a board by user ID. */
export async function addCollaboratorById(
  boardId: string,
  userId: string,
  role: 'owner' | 'collaborator' = 'collaborator',
): Promise<void> {
  const { error } = await supabase
    .from('board_collaborators')
    .insert({ board_id: boardId, user_id: userId, role });

  if (error) throw error;
}

/** Remove a collaborator from a board. */
export async function removeCollaborator(
  boardId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('board_collaborators')
    .delete()
    .eq('board_id', boardId)
    .eq('user_id', userId);

  if (error) throw error;
}

/** Add an experience to a board. */
export async function addExperienceToBoard(
  boardId: string,
  experienceId: string,
  userId: string,
): Promise<BoardExperienceRecord> {
  const { data, error } = await supabase
    .from('board_experiences')
    .insert({
      board_id: boardId,
      experience_id: experienceId,
      added_by: userId,
    })
    .select()
    .single();

  if (error) throw error;
  return data as BoardExperienceRecord;
}

/** Remove an experience from a board. */
export async function removeExperienceFromBoard(
  boardId: string,
  experienceId: string,
): Promise<void> {
  const { error } = await supabase
    .from('board_experiences')
    .delete()
    .eq('board_id', boardId)
    .eq('experience_id', experienceId);

  if (error) throw error;
}
