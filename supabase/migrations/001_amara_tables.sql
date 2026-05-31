-- Amara Bot — EEM26 Student Coaching Bot
-- Migration 001: Core tables

-- amara_students: one row per student, drives the entire state machine
CREATE TABLE IF NOT EXISTS public.amara_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id TEXT UNIQUE NOT NULL,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  country TEXT,

  -- State machine: current_day=0 is onboarding, 1-4 are coaching days
  -- current_step=0 is the sentinel "day complete, awaiting next-day unlock"
  current_day INTEGER NOT NULL DEFAULT 0,
  current_step INTEGER NOT NULL DEFAULT 1,

  -- Day completion timestamps
  day1_completed_at TIMESTAMPTZ,
  day2_completed_at TIMESTAMPTZ,
  day3_completed_at TIMESTAMPTZ,
  day4_completed_at TIMESTAMPTZ,

  -- When to unlock the next day (8AM Nigeria time = 07:00 UTC)
  next_day_unlocks_at TIMESTAMPTZ,

  -- Day 1 assets
  selar_account_created BOOLEAN NOT NULL DEFAULT FALSE,
  payhip_account_created BOOLEAN NOT NULL DEFAULT FALSE,
  payhip_link TEXT,

  -- Day 2 assets
  github_username TEXT,
  github_repo_normal TEXT,
  github_repo_premium TEXT,
  sales_page_link TEXT,

  -- Day 3 assets (student's own bot)
  bot_token TEXT,
  supabase_url TEXT,
  supabase_anon_key TEXT,

  -- Day 4 / certificate
  certificate_issued BOOLEAN NOT NULL DEFAULT FALSE,
  certificate_issued_at TIMESTAMPTZ,

  -- Bot status
  status TEXT NOT NULL DEFAULT 'ACTIVE',

  -- Screenshot attempt counter (resets to 0 on step advance)
  screenshot_attempts INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- amara_conversations: conversation history per student
CREATE TABLE IF NOT EXISTS public.amara_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.amara_students(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  message TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- amara_step_completions: audit log of completed steps
CREATE TABLE IF NOT EXISTS public.amara_step_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.amara_students(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  step INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  screenshot_verified BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_students_chat_id
  ON public.amara_students(telegram_chat_id);

CREATE INDEX IF NOT EXISTS idx_students_unlock
  ON public.amara_students(next_day_unlocks_at, status, current_day)
  WHERE next_day_unlocks_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_student
  ON public.amara_conversations(student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_step_completions_student
  ON public.amara_step_completions(student_id, day, step);

-- Enable RLS
ALTER TABLE public.amara_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amara_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amara_step_completions ENABLE ROW LEVEL SECURITY;

-- Service role full access (Edge Functions use service_role key)
CREATE POLICY "Service role full access on students"
  ON public.amara_students FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on conversations"
  ON public.amara_conversations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on step_completions"
  ON public.amara_step_completions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER students_updated_at
  BEFORE UPDATE ON public.amara_students
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
