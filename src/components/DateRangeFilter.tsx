// Estratto da influencer.$id.tsx (era inline, unico uso) per essere riusato
// anche da TrendGrid.tsx sui filtri data di Trend Attuali/Real Time/Evergreen.

export type DatePreset = "tutto" | "7g" | "30g" | "90g" | "custom";

export type DateRange = { from: Date | null; to: Date | null } | null;

export function computeDateRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): DateRange {
  const now = new Date();
  if (preset === "tutto") return null;
  if (preset === "custom") {
    const from = customFrom ? new Date(customFrom) : null;
    const to = customTo ? new Date(customTo + "T23:59:59") : null;
    if (!from && !to) return null;
    return { from, to };
  }
  const days = preset === "7g" ? 7 : preset === "30g" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from, to: now };
}

export function isWithinDateRange(dateStr: string | null | undefined, range: DateRange): boolean {
  if (!range) return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-foreground text-background"
          : "border border-border bg-background/50 text-muted-foreground hover:border-primary"
      }`}
    >
      {label}
    </button>
  );
}

export function DateRangeFilter({
  label,
  preset,
  setPreset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
}: {
  label?: string;
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
}) {
  const presets: { key: DatePreset; label: string }[] = [
    { key: "tutto", label: "Tutto" },
    { key: "7g", label: "Ultima settimana" },
    { key: "30g", label: "Ultimo mese" },
    { key: "90g", label: "Ultimi 3 mesi" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
      {presets.map((p) => (
        <FilterPill
          key={p.key}
          label={p.label}
          active={preset === p.key}
          onClick={() => setPreset(p.key)}
        />
      ))}
      <FilterPill
        label="Personalizzato"
        active={preset === "custom"}
        onClick={() => setPreset("custom")}
      />
      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-lg border border-border bg-background/60 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-lg border border-border bg-background/60 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
        </div>
      )}
    </div>
  );
}
