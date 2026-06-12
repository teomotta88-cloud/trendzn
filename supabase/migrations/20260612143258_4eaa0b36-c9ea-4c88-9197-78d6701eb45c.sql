CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'poll-gmail-every-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--54afe560-3e1f-4196-977c-05f75da520ec.lovable.app/api/public/hooks/poll-gmail',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);