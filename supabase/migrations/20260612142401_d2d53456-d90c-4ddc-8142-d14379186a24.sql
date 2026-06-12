CREATE TYPE public.trend_submission_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.trend_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  submitted_by TEXT,
  raw_email TEXT,
  status public.trend_submission_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trend_submissions TO authenticated;
GRANT ALL ON public.trend_submissions TO service_role;

ALTER TABLE public.trend_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage submissions"
ON public.trend_submissions
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);