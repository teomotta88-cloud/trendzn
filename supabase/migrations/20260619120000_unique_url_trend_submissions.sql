ALTER TABLE public.trend_submissions
  ADD CONSTRAINT trend_submissions_url_key UNIQUE (url);
