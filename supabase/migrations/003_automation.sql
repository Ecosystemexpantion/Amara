-- Migration 003: GitHub OAuth token, activity tracking, student bot tables

-- New columns on amara_students
ALTER TABLE public.amara_students
  ADD COLUMN IF NOT EXISTS github_access_token TEXT,
  ADD COLUMN IF NOT EXISTS last_activity_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_proactive_at    TIMESTAMPTZ;

-- Index for silence-nudge queries
CREATE INDEX IF NOT EXISTS idx_students_activity
  ON public.amara_students(last_activity_at)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_students_proactive
  ON public.amara_students(last_proactive_at)
  WHERE status = 'ACTIVE';

-- Shared tables for all student bots (hosted in Amara's Supabase)

CREATE TABLE IF NOT EXISTS public.student_bot_leads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.amara_students(id) ON DELETE CASCADE,
  chat_id    TEXT NOT NULL,
  name       TEXT,
  phone      TEXT,
  stage      TEXT NOT NULL DEFAULT 'NEW',
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, chat_id)
);

CREATE TABLE IF NOT EXISTS public.student_bot_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.amara_students(id) ON DELETE CASCADE,
  chat_id    TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_bot_leads_lookup
  ON public.student_bot_leads(student_id, chat_id);

CREATE INDEX IF NOT EXISTS idx_student_bot_conv_lookup
  ON public.student_bot_conversations(student_id, chat_id, created_at DESC);

-- RLS: service role full access only
ALTER TABLE public.student_bot_leads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_bot_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on student_bot_leads"
  ON public.student_bot_leads FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on student_bot_conversations"
  ON public.student_bot_conversations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Auto-update updated_at on leads
CREATE TRIGGER student_bot_leads_updated_at
  BEFORE UPDATE ON public.student_bot_leads
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
