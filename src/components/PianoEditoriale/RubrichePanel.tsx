import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trash2, Plus, Pencil, Palette } from "lucide-react";
import {
  type Rubrica,
  listRubriche,
  createRubrica,
  updateRubrica,
  deleteRubrica,
} from "@/lib/autographics";

// SBAM AutoGraphics — elenco rubriche. I campi tipizzati (#title, #image...)
// non si definiscono più qui: si aggiungono direttamente nell'editor grafico
// (impostando il "nome layer" di un elemento), che è anche l'unico posto da
// cui il wizard di composizione post li legge. Questo pannello resta solo
// per creare/rinominare/attivare/eliminare la rubrica.

export function RubrichePanel() {
  const [rubriche, setRubriche] = useState<Rubrica[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setRubriche(await listRubriche(false));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setEditingId("new");
    setNome("");
    setError(null);
  }

  function startEdit(r: Rubrica) {
    setError(null);
    setNome(r.nome);
    setEditingId(r.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function handleSave() {
    const trimmedNome = nome.trim();
    if (!trimmedNome || editingId === null) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId === "new") {
        await createRubrica({
          nome: trimmedNome,
          tipo_template: "text_icon_card",
          figma_file_key: null,
          figma_component_id: null,
          attiva: true,
        });
      } else {
        await updateRubrica(editingId, { nome: trimmedNome });
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleAttiva(r: Rubrica) {
    await updateRubrica(r.id, { attiva: !r.attiva });
    await load();
  }

  async function handleDelete(r: Rubrica) {
    if (!window.confirm(`Eliminare la rubrica "${r.nome}"? L'azione non è reversibile.`)) return;
    setDeletingId(r.id);
    setError(null);
    try {
      await deleteRubrica(r.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  const isEditing = editingId !== null;

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Rubriche usate dall'editor grafico per organizzare i template. Il template vero e proprio
        (elementi, campi dinamici) si disegna nell'Editor grafico di ciascuna rubrica.
      </p>

      {!isEditing && (
        <button
          type="button"
          onClick={startNew}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Plus className="size-4" />
          Nuova rubrica
        </button>
      )}

      {isEditing && (
        <div className="space-y-4 rounded-2xl border border-border bg-card/50 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Nome rubrica</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Es. Photo Card prodotto"
              className="max-w-sm rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !nome.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              Salva rubrica
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-lg border border-border px-3.5 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Caricamento rubriche…</div>
      ) : rubriche.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Nessuna rubrica configurata.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Attiva</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rubriche.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{r.nome}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => toggleAttiva(r)}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        r.attiva ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.attiva ? "attiva" : "disattiva"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex gap-1.5">
                      <Link
                        to="/editor-grafico/$rubricaId"
                        params={{ rubricaId: r.id }}
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-primary hover:text-primary"
                        title="Editor grafico"
                      >
                        <Palette className="size-3.5" />
                      </Link>
                      <button
                        onClick={() => startEdit(r)}
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-primary hover:text-primary"
                        title="Modifica"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(r)}
                        disabled={deletingId === r.id}
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
                        title="Elimina rubrica"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
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
