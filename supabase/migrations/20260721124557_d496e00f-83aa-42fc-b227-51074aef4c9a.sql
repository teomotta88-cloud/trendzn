ALTER TABLE public.viral_trend_content
  ADD COLUMN IF NOT EXISTS audio_fingerprint double precision[],
  ADD COLUMN IF NOT EXISTS audio_trend_matched_by text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();