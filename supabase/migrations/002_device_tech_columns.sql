-- Migration 002: Student device type and technical skill level
-- device_type: 'phone' | 'laptop' | 'unknown'
-- tech_level:  'technical' | 'non_technical' | 'unknown'

ALTER TABLE public.amara_students
  ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS tech_level  TEXT NOT NULL DEFAULT 'unknown';
