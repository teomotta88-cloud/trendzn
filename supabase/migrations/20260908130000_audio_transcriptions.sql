-- Trascrizione Audio: pagina standalone (non in menu, link condiviso a
-- mano) per caricare un file audio grande (100+MB), trascriverlo con
-- riconoscimento degli interlocutori (speaker diarization) e scaricare il
-- risultato come file Word.
--
-- Il file audio viene caricato dal browser direttamente nello storage
-- Supabase (mai attraverso il server dell'app, che gira su Cloudflare
-- Workers con limiti di dimensione/tempo poco adatti a file così grandi).
-- La trascrizione vera e propria è delegata ad AssemblyAI: gli passiamo
-- l'URL pubblico del file (fetch loro lato server, nessun limite di
-- dimensione sul nostro hook) e la diarization è un parametro nativo della
-- loro API (speaker_labels), niente da implementare qui.
--
-- Stesso pattern di accesso pubblico del resto di trendzn (nessun login).
create table public.audio_transcriptions (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  storage_path text not null,
  file_size_bytes bigint,
  language text,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'error')),
  provider_job_id text,
  transcript_text text,
  utterances jsonb,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index audio_transcriptions_status_idx on public.audio_transcriptions (status);

alter table public.audio_transcriptions enable row level security;

create policy "public full access" on public.audio_transcriptions for all using (true) with check (true);

-- Bucket pubblico per i file audio caricati (audio-transcriptions/{uuid}.{ext}).
-- Limite dimensione alzato a 2GB per supportare registrazioni lunghe; il
-- limite effettivo dipende comunque anche dal "Global file size limit" del
-- progetto Supabase (Dashboard > Storage > Settings), da alzare oltre i
-- 50MB di default se non già fatto.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-transcriptions',
  'audio-transcriptions',
  true,
  2147483648,
  array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm',
    'audio/flac', 'audio/x-flac', 'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do nothing;

create policy "audio-transcriptions public read" on storage.objects
  for select using (bucket_id = 'audio-transcriptions');

create policy "audio-transcriptions public insert" on storage.objects
  for insert with check (bucket_id = 'audio-transcriptions');

create policy "audio-transcriptions public update" on storage.objects
  for update using (bucket_id = 'audio-transcriptions');

create policy "audio-transcriptions public delete" on storage.objects
  for delete using (bucket_id = 'audio-transcriptions');
