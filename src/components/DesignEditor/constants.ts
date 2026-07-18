// Set curato per la Fase 2 (font/icone selezionabili): il caricamento di
// font custom (Fase 3) e il picker icone completo restano fuori da questo
// primo taglio, qui basta una selezione utilizzabile da subito che il
// motore di rendering (src/lib/design-render.ts) sa già risolvere via
// Google Fonts a runtime.
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
