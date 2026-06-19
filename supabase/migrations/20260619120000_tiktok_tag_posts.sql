CREATE TYPE public.tiktok_tag_post_status AS ENUM ('pending', 'synced', 'rejected');

CREATE TABLE public.tiktok_tag_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag TEXT NOT NULL,
  video_url TEXT NOT NULL,
  author_handle TEXT,
  caption TEXT,
  posted_at TIMESTAMP WITH TIME ZONE,
  status public.tiktok_tag_post_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (video_url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tiktok_tag_posts TO authenticated;
GRANT ALL ON public.tiktok_tag_posts TO service_role;

ALTER TABLE public.tiktok_tag_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage tiktok tag posts"
ON public.tiktok_tag_posts
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
