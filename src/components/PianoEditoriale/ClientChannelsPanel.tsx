import { useEffect, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import {
  CHANNELS,
  type EditorialClientChannel,
  listClientChannels,
  addClientChannel,
  deleteClientChannel,
} from "@/lib/editorialPlan";

export function ClientChannelsPanel() {
  const [channels, setChannels] = useState<EditorialClientChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [canale, setCanale] = useState<string>(CHANNELS[0].code);
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setChannels(await listClientChannels());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

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
        Account ufficiali del cliente, usati per riconoscere automaticamente i post pubblicati importati da n8n.
      </p>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card/50 p-4">
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
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{c.canale}</td>
                  <td className="px-4 py-2">{c.handle}</td>
                  <td className="px-4 py-2 truncate">
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {c.url}
                    </a>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
