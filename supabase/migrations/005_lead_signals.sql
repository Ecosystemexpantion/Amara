-- Add interest tracking, objection capture, and contact timestamp to student_bot_leads
ALTER TABLE student_bot_leads
  ADD COLUMN IF NOT EXISTS interest_level TEXT DEFAULT 'warm',
  ADD COLUMN IF NOT EXISTS objections_raised TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
