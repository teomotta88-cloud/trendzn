import { useEffect, useState } from "react";
import { Trash2, Plus, Facebook } from "lucide-react";
import {
  CHANNELS,
  type EditorialClientChannel,
  type MetaConnectionStatus,
  listClientChannels,
  addClientChannel,
  deleteClientChannel,
  listMetaConnectionStatus,
} from "@/lib/editorialPlan";

const META_ERROR_MESSAGES: Record<string, string> = {
  denied: "Login Meta annullato dall'utente.",
  state_mismatch: "Sessione di login scaduta, riprova.",
  missing_code: "Login Meta incompleto, riprova.",
  no_instagram_business_account:
    "Nessun account Instagram Business/Creator collegato a una Pagina Facebook trovato su questo account Meta.",
  exchange_failed: "Errore nel collegamento con Meta, riprova o contatta il supporto.",
};

export function ClientChannelsPanel() {
  const [channels, setChannels] = useState<EditorialClientChannel[]>([]);
  const [metaConnections, setMetaConnections] = useState<MetaConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [canale, setCanale] = useState<string>(CHANNELS[0].code);
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metaStatusParam =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const metaConnected = metaStatusParam?.get("meta_connected");
  const metaError = metaStatusParam?.get("meta_error");

  async function load() {
    setLoading(true);
    const [channelsData, connectionsData] = await Promise.all([
      listClientChannels(),
      listMetaConnectionStatus().catch(() => []),
    ]);
    setChannels(channelsData);
    setMetaConnections(connectionsData);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function connectionFor(channel: EditorialClientChannel): MetaConnectionStatus | undefined {
    return metaConnections.find((c) => c.client_channel_id === channel.id);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmedHandle = handle.trim();
    const trimmedUrl = url.trim();
    if (!trimmedHandle || !trimmedUrl) return;
    setSaving(true);
    setError(null);
    try {
      await addClientChannel({ canale, handle: trimmedHandle, url: trimmedUrl });
      setHandle("");
      setUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante il salvataggio");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Eliminare questo canale cliente?")) return;
    await deleteClientChannel(id);
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Account ufficiali del cliente. I canali Instagram collegati via Meta leggono post e insight
        reali dalla Graph API; gli altri restano riconosciuti automaticamente tra i post importati
        da n8n.
      </p>

      {metaConnected && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600">
          {metaConnected} canale/i Instagram collegato/i con successo.
        </div>
      )}
      {metaError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {META_ERROR_MESSAGES[metaError] ?? "Errore nel collegamento con Meta."}
        </div>
      )}

      <a
        href="/api/meta/oauth-start"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/50 px-3.5 py-2 text-sm font-medium transition hover:border-primary hover:text-primary"
      >
        <Facebook className="size-4" />
        Connetti account Instagram/Facebook del cliente
      </a>

      <form
        onSubmit={handleAdd}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card/50 p-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Canale</label>
          <select
            value={canale}
            onChange={(e) => setCanale(e.target.value)}
            className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {CHANNELS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 min-w-[160px] flex-col gap-1">
          <label className="text-xs text-muted-foreground">Handle</label>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@namedsport"
            className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-[2] min-w-[220px] flex-col gap-1">
          <label className="text-xs text-muted-foreground">URL canale</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.instagram.com/namedsport"
            className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          <Plus className="size-4" />
          Aggiungi
        </button>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </form>

      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento canali cliente…</div>
      ) : channels.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Nessun canale cliente inserito.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Canale</th>
                <th className="px-4 py-2">Handle</th>
                <th className="px-4 py-2">URL</th>
                <th className="px-4 py-2">Connessione Meta</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => {
                const connection = connectionFor(c);
                return (
                  <tr key={c.id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{c.canale}</td>
                    <td className="px-4 py-2">{c.handle}</td>
                    <td className="px-4 py-2 truncate">
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {c.url}
                      </a>
                    </td>
                    <td className="px-4 py-2">
                      {!connection ? (
                        <span className="text-xs text-muted-foreground">
                          Non collegato (dati da n8n)
                        </span>
                      ) : connection.status === "active" ? (
                        <span className="text-xs text-emerald-600">Connesso via Graph API</span>
                      ) : (
                        <span className="text-xs text-amber-600">Da ricollegare</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive"
                        title="Elimina"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
