ALTER TABLE public.trend_submissions
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

-- Gli ID dei video TikTok sono "snowflake": i 32 bit più significativi
-- codificano il timestamp Unix (in secondi) di creazione del post.
-- Eseguiamo un backfill per le righe già presenti.
UPDATE public.trend_submissions
SET posted_at = to_timestamp((substring(url from '/video/(\d+)')::bigint) >> 32)
WHERE section = 'tiktok-hashtag'
  AND url ~ '/video/\d+'
  AND posted_at IS NULL;
