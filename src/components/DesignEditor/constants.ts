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
