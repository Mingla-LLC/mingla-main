-- Server-side notification storage (replaces AsyncStorage-only approach)
-- Source of truth for all in-app notifications, synced to client via Realtime
CREATE TABLE public.notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,

    -- Structured context for rendering and navigation
    data            JSONB NOT NULL DEFAULT '{}',

    -- Related entities (for dedup, grouping, and deep linking)
    actor_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    related_id      TEXT,
    related_type    TEXT,

    -- State
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMPTZ,

    -- Delivery tracking
    push_sent       BOOLEAN NOT NULL DEFAULT FALSE,
    push_sent_at    TIMESTAMPTZ,
    push_clicked    BOOLEAN NOT NULL DEFAULT FALSE,
    push_clicked_at TIMESTAMPTZ,

    -- Dedup: prevent duplicate notifications for the same event
    idempotency_key TEXT UNIQUE,

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Expiry (optional, for transient notifications)
    expires_at      TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_idempotency ON public.notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_notifications_expires ON public.notifications(expires_at) WHERE expires_at IS NOT NULL;

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
    ON public.notifications FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications (mark read)"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
    ON public.notifications FOR DELETE
    USING (auth.uid() = user_id);

-- No INSERT policy needed — service role bypasses RLS entirely.
-- Explicitly block all non-service-role inserts for defense-in-depth.
CREATE POLICY "Only service role can insert notifications"
    ON public.notifications FOR INSERT
    WITH CHECK (false);

-- Add to Realtime publication for instant client delivery
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Cron: auto-cleanup expired + 90-day-old notifications (weekly Sunday 3 AM UTC)
SELECT cron.schedule(
    'cleanup-old-notifications',
    '0 3 * * 0',
    $$
    DELETE FROM public.notifications
    WHERE (expires_at IS NOT NULL AND expires_at < NOW())
       OR created_at < NOW() - INTERVAL '90 days';
    $$
);
