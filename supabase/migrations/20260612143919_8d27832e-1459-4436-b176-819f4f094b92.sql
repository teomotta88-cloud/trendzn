ALTER TABLE public.trend_submissions
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS industry text;