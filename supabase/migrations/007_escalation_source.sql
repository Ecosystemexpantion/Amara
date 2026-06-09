-- Extend escalations table for student-bot escalations

ALTER TABLE amara_escalations
  ADD COLUMN IF NOT EXISTS source          TEXT DEFAULT 'amara',
  ADD COLUMN IF NOT EXISTS customer_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS bot_token        TEXT,
  ADD COLUMN IF NOT EXISTS bot_name         TEXT;
