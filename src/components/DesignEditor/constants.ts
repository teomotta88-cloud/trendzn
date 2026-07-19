// Set curato per la Fase 2 (font/icone selezionabili): il caricamento di
// font custom (Fase 3) e il picker icone completo restano fuori da questo
// primo taglio.
export const CURATED_FONTS = [
  "Inter",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Playfair Display",
  "Oswald",
  "Lora",
  "Nunito",
] as const;

// Il render finale cattura il DOM vero (src/lib/design-capture.ts): perché
// il testo non vada in un font di fallback (sia a schermo che nell'export)
// il browser deve avere questi font effettivamente caricati — un <link>
// stylesheet Google Fonts con tutti i pesi usati dal pannello proprietà,
// iniettato dalla route editor-grafico (head()).
const CURATED_FONT_WEIGHTS = [400, 500, 600, 700, 800];
export const GOOGLE_FONTS_STYLESHEET_URL = `https://fonts.googleapis.com/css2?${CURATED_FONTS.map(
  (f) => `family=${encodeURIComponent(f)}:wght@${CURATED_FONT_WEIGHTS.join(";")}`,
).join("&")}&display=swap`;

// Sottoinsieme di icone lucide-react comuni per grafiche social (badge,
// frecce, punti di interesse). L'elenco completo (migliaia di icone) è
// rimandato a un secondo momento: qui serve un picker già usabile.
export const CURATED_ICONS = [
  "Star",
  "Heart",
  "Sparkles",
  "Flame",
  "Zap",
  "TrendingUp",
  "ArrowRight",
  "ArrowUpRight",
  "Check",
  "CheckCircle2",
  "Tag",
  "Clock",
  "MapPin",
  "Calendar",
  "MessageCircle",
  "ThumbsUp",
  "Award",
  "Gift",
  "Camera",
  "Play",
  "Instagram",
  "Megaphone",
  "BadgeCheck",
  "Quote",
] as const;

// Dimensione massima (in px CSS) del canvas nell'editor: gli elementi sono
// salvati/renderizzati nelle dimensioni reali del formato (es. 1080x1080),
// qui si calcola solo un fattore di scala per mostrarli comodamente a
// schermo — vedi scaleForFormat in DesignEditor.tsx.
export const MAX_EDITOR_CANVAS_PX = 480;

// Formati social preimpostati: l'utente sceglie da qui invece di inserire
// nome/larghezza/altezza a mano (fonte di formati incoerenti tra rubriche).
// "formato" è lo slug salvato su rubrica_formati.formato.
export interface SocialFormatPreset {
  label: string;
  formato: string;
  width: number;
  height: number;
}

export const SOCIAL_FORMAT_PRESETS: SocialFormatPreset[] = [
  { label: "Feed 1:1 (Instagram/Facebook)", formato: "feed_1x1", width: 1080, height: 1080 },
  { label: "Feed 4:5 (Instagram/Facebook)", formato: "feed_4x5", width: 1080, height: 1350 },
  {
    label: "Story/Reels 9:16 (Instagram/Facebook)",
    formato: "story_9x16",
    width: 1080,
    height: 1920,
  },
  { label: "Feed orizzontale 1.91:1", formato: "feed_landscape_1.91x1", width: 1080, height: 566 },
  { label: "Post LinkedIn 1.91:1", formato: "linkedin_1.91x1", width: 1200, height: 627 },
  { label: "Post X/Twitter 16:9", formato: "twitter_16x9", width: 1200, height: 675 },
  { label: "Copertina Facebook", formato: "facebook_cover", width: 820, height: 312 },
  { label: "Copertina YouTube/thumbnail 16:9", formato: "youtube_16x9", width: 1280, height: 720 },
];
