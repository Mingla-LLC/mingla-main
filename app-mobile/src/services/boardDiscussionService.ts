import { supabase } from './supabase';

// --- Types ---

export interface BoardMessage {
  id: string;
  session_id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  mentions: string[];
  reply_to_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  user?: { id: string; name: string; avatar_url: string | null };
  reactions?: BoardMessageReaction[];
  read_by?: BoardMessageRead[];
}

export interface BoardMessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface BoardMessageRead {
  id: string;
  message_id: string;
  user_id: string;
  read_at: string;
}

// --- Queries ---

/** Fetch messages for a session, paginated, newest first. */
export async function fetchSessionMessages(
  sessionId: string,
  cursor?: string,
  limit: number = 30
): Promise<BoardMessage[]> {
  let query = supabase
    .from('board_messages')
    .select(`
      *,
      user:profiles!user_id(id, name, avatar_url),
      reactions:board_message_reactions(*),
      read_by:board_message_reads(*)
    `)
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Send a new message (text and/or image). */
export async function sendMessage(params: {
  sessionId: string;
  userId: string;
  content: string;
  imageUrl?: string;
  mentions?: string[];
  replyToId?: string;
}): Promise<BoardMessage> {
  const { data, error } = await supabase
    .from('board_messages')
    .insert({
      session_id: params.sessionId,
      user_id: params.userId,
      content: params.content,
      image_url: params.imageUrl ?? null,
      mentions: params.mentions ?? [],
      reply_to_id: params.replyToId ?? null,
    })
    .select(`
      *,
      user:profiles!user_id(id, name, avatar_url),
      reactions:board_message_reactions(*),
      read_by:board_message_reads(*)
    `)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** Toggle an emoji reaction on a message. */
export async function toggleReaction(
  messageId: string,
  userId: string,
  emoji: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('board_message_reactions')
    .select('id')
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('board_message_reactions')
      .delete()
      .eq('id', existing.id);
    return false;
  } else {
    const { error } = await supabase
      .from('board_message_reactions')
      .insert({ message_id: messageId, user_id: userId, emoji });
    if (error) throw new Error(error.message);
    return true;
  }
}

/** Mark messages as read by the current user. */
export async function markMessagesAsRead(
  messageIds: string[],
  userId: string
): Promise<void> {
  if (messageIds.length === 0) return;

  const rows = messageIds.map((id) => ({
    message_id: id,
    user_id: userId,
  }));

  await supabase
    .from('board_message_reads')
    .upsert(rows, { onConflict: 'message_id,user_id' });
}

/** Upload an image to Supabase Storage and return the signed URL. */
export async function uploadMessageImage(
  sessionId: string,
  messageId: string,
  uri: string,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  const extension = mimeType.split('/')[1] || 'jpg';
  const filePath = `${sessionId}/${messageId}/image.${extension}`;

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error } = await supabase.storage
    .from('board-attachments')
    .upload(filePath, blob, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) throw new Error(error.message);

  const { data: signedData } = await supabase.storage
    .from('board-attachments')
    .createSignedUrl(filePath, 365 * 24 * 60 * 60);

  return signedData?.signedUrl ?? '';
}
