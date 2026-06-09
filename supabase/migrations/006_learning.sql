-- Amara learning system: knowledge base + escalation queue

CREATE TABLE IF NOT EXISTS amara_knowledge (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  use_count   INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS amara_escalations (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id       UUID REFERENCES amara_students(id) ON DELETE CASCADE,
  student_chat_id  TEXT NOT NULL,
  student_name     TEXT,
  question         TEXT NOT NULL,
  answer           TEXT,
  status           TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','ANSWERED','SKIPPED')),
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE amara_knowledge    ENABLE ROW LEVEL SECURITY;
ALTER TABLE amara_escalations  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all" ON amara_knowledge   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON amara_escalations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_knowledge_question  ON amara_knowledge   USING GIN (to_tsvector('english', question));
CREATE INDEX idx_escalations_status  ON amara_escalations (status, created_at);
