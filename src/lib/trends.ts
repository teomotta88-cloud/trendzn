import data from "@/data/trends.json";

export type TrendItem = {
  category: string | null;
  links: string[];
  descrizione: string | null;
  nome_trend: string | null;
  industry: string | null;
  applicazione: string | null;
  canali: string | null;
};

export type AccountRef = {
  platform: string;
  handle: string;
  url: string;
  date?: string | null;
  caption?: string | null;
};
export type CanaleInspo = {
  id: string;
  name: string;
  urls: string[];
  descrizione: string | null;
  accounts: AccountRef[];
};

export const trendRealTime = data.trend_real_time as TrendItem[];
export const trendAttuali = data.trend_attuali as TrendItem[];
export const trendEvergreen = data.trend_evergreen as TrendItem[];
export const canaliInspo = data.canali_inspo as CanaleInspo[];

export function detectPlatform(url: string): "instagram" | "tiktok" | "youtube" | "linkedin" | "web" {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/linkedin\.com/.test(url)) return "linkedin";
  return "web";
}

export function embedUrl(url: string): string | null {
  const ig = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([^/?#]+)/);
  if (ig) return `https://www.instagram.com/p/${ig[1]}/embed/captioned/`;
  const tt = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  const ttp = url.match(/tiktok\.com\/@[^/]+\/photo\/(\d+)/);
  if (ttp) return `https://www.tiktok.com/embed/v2/${ttp[1]}`;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;

  // LinkedIn: l'ID può comparire come:
  // - urn:li:activity:1234567890 (URL normale del post o link "copy link to post")
  // - urn:li:share:1234567890 (codice embed copiato direttamente da LinkedIn)
  // - "-activity-1234567890-" dentro un URL /posts/...
  // In tutti i casi, l'URL embed risultante usa lo stesso schema con il tipo corretto.
  const liEmbed = url.match(/urn:li:(share|activity|ugcPost):(\d+)/);
  if (liEmbed) return `https://www.linkedin.com/embed/feed/update/urn:li:${liEmbed[1]}:${liEmbed[2]}`;
  const liActivity = url.match(/-activity-(\d+)-/);
  if (liActivity) return `https://www.linkedin.com/embed/feed/update/urn:li:activity:${liActivity[1]}`;

  return null;
}
