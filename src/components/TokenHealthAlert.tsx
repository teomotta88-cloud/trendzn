import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { TokenCheckResult } from "@/routes/api/public/hooks/check-token-health";

// Banner di avviso da montare nella sezione UI che usa un certo token (vedi
// check-token-health.ts per la verifica vera e propria, chiamata anche da
// un workflow schedulato per un controllo periodico indipendente dalla UI).
// Mostra qualcosa SOLO quando c'è un problema o una scadenza vicina — nel
// caso normale (token valido, scadenza lontana o sconosciuta) non renderizza
// nulla, per non aggiungere rumore visivo permanente.
const WARNING_WINDOW_DAYS = 14;

export function TokenHealthAlert({ tokenName }: { tokenName: string }) {
  const [result, setResult] = useState<TokenCheckResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/hooks/check-token-health?name=${encodeURIComponent(tokenName)}`)
      .then((res) => res.json())
      .then((data: { results?: TokenCheckResult[] }) => {
        if (!cancelled) setResult(data.results?.[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tokenName]);

  if (!result || !result.configured) return null;

  const expiringSoon =
    result.valid && result.daysRemaining != null && result.daysRemaining <= WARNING_WINDOW_DAYS;

  if (result.valid && !expiringSoon) return null;

  return (
    <div
      className={`flex items-start gap-1.5 rounded-lg border p-2 text-[11px] ${
        result.valid === false
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-yellow-500/40 bg-yellow-500/5 text-yellow-700"
      }`}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      {result.valid === false ? (
        <span>
          {result.label}: token non valido o non raggiungibile. {result.detail}
        </span>
      ) : (
        <span>
          {result.label}: il token scade tra {result.daysRemaining} giorni
          {result.expiresAt ? ` (${new Date(result.expiresAt).toLocaleDateString("it-IT")})` : ""}.
          Rinnovalo per evitare interruzioni.
        </span>
      )}
    </div>
  );
}
