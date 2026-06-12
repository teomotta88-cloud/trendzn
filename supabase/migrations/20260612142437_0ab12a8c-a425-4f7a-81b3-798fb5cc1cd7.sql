DROP POLICY IF EXISTS "Authenticated users can manage submissions" ON public.trend_submissions;

CREATE POLICY "Authenticated users can view submissions"
ON public.trend_submissions
FOR SELECT
TO authenticated
USING (true);