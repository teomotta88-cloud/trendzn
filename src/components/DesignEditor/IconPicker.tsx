import { useState } from "react";
import { ALL_ICON_NAMES, getLucideIcon } from "./iconLibrary";

// Selettore di icone cercabile su tutta la libreria lucide-react (migliaia
// di icone): niente elenco fisso, l'utente digita e vede i risultati.
// Il campo resta vuoto finché non si digita per evitare di renderizzare
// migliaia di pulsanti inutilmente ad ogni apertura del pannello proprietà.
const MAX_RESULTS = 48;

export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [query, setQuery] = useState("");

  const matches =
    query.trim().length === 0
      ? []
      : ALL_ICON_NAMES.filter((name) =>
          name.toLowerCase().includes(query.trim().toLowerCase()),
        ).slice(0, MAX_RESULTS);

  const SelectedIcon = getLucideIcon(value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {SelectedIcon && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60">
            <SelectedIcon className="size-4" />
          </div>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Cerca tra ${ALL_ICON_NAMES.length} icone… (es. "star", "arrow")`}
          className="flex-1 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
        />
      </div>

      {matches.length > 0 && (
        <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-border bg-background/40 p-1.5">
          {matches.map((name) => {
            const Icon = getLucideIcon(name);
            if (!Icon) return null;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => {
                  onChange(name);
                  setQuery("");
                }}
                className={`flex size-7 items-center justify-center rounded-md border transition ${
                  value === name
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-transparent text-muted-foreground hover:border-border"
                }`}
              >
                <Icon className="size-3.5" />
              </button>
            );
          })}
        </div>
      )}
      {query.trim().length > 0 && matches.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Nessuna icona trovata per "{query}".</p>
      )}
    </div>
  );
}
