-- Expand student_bot_leads to support the full EEM26 sales funnel
ALTER TABLE student_bot_leads
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS struggle TEXT,
  ADD COLUMN IF NOT EXISTS wind_down_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS download_link_sent_at TIMESTAMPTZ;
