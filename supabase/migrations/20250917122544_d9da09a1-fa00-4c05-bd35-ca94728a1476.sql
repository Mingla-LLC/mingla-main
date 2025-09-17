-- Clean up orphaned records first
DELETE FROM session_participants 
WHERE session_id NOT IN (SELECT id FROM collaboration_sessions);

DELETE FROM collaboration_invites 
WHERE invited_by NOT IN (SELECT id FROM profiles) 
   OR invited_user_id NOT IN (SELECT id FROM profiles);

DELETE FROM collaboration_sessions 
WHERE created_by NOT IN (SELECT id FROM profiles);

-- Now add foreign key constraints
ALTER TABLE collaboration_invites 
ADD CONSTRAINT collaboration_invites_invited_by_fkey 
FOREIGN KEY (invited_by) REFERENCES profiles(id);

ALTER TABLE collaboration_invites 
ADD CONSTRAINT collaboration_invites_invited_user_id_fkey 
FOREIGN KEY (invited_user_id) REFERENCES profiles(id);

ALTER TABLE collaboration_sessions 
ADD CONSTRAINT collaboration_sessions_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES profiles(id);

ALTER TABLE collaboration_sessions 
ADD CONSTRAINT collaboration_sessions_board_id_fkey 
FOREIGN KEY (board_id) REFERENCES boards(id);

ALTER TABLE session_participants 
ADD CONSTRAINT session_participants_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES profiles(id);

ALTER TABLE session_participants 
ADD CONSTRAINT session_participants_session_id_fkey 
FOREIGN KEY (session_id) REFERENCES collaboration_sessions(id) ON DELETE CASCADE;