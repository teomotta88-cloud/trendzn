import { useEffect, useState } from "react";
import { Trash2, Plus, Pencil, X } from "lucide-react";
import {
  type Rubrica,
  type TemplateConstraint,
  type LayerType,
  listRubriche,
  createRubrica,
  updateRubrica,
  listTemplateConstraints,
  replaceTemplateConstraints,
} from "@/lib/autographics";

// SBAM AutoGraphics — editor visuale delle rubriche. Sostituisce l'inserimento
// manuale via SQL: qui l'utente compone la rubrica come una sequenza di
// "card" (una card = una slide, per i carousel multi-formato), ognuna con
// campi tipizzati (#title, #subtitle, #text, #image). I campi dello stesso
// tipo vengono numerati in automatico in modo progressivo e globale
// sull'intera rubrica (non per singola card), es. #title1, poi #title2 anche
// se si trova in una card diversa.

type FieldKind = "title" | "subtitle" | "text" | "image";

const FIELD_KINDS: FieldKind[] = ["title", "subtitle", "text", "image"];

const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  title: "Titolo (#title)",
  subtitle: "Sottotitolo (#subtitle)",
  text: "Testo (#text)",
  image: "Immagine (#image)",
};

function kindToLayerType(kind: FieldKind): LayerType {
  return kind === "image" ? "image" : "text";
}

interface LocalField {
  localId: string;
  kind: FieldKind;
  maxChars: string;
  obbligatorio: boolean;
}

interface LocalCard {
  localId: string;
  fields: LocalField[];
}

function newId(): string {
  return crypto.randomUUID();
}

function emptyCard(): LocalCard {
  return { localId: newId(), fields: [] };
}

// Assegna il layer_name progressivo globale per tipo, nell'ordine card ->
// campo. Ritorna una mappa localId -> layer_name pronta sia per l'anteprima
// live nell'editor sia per il salvataggio finale.
function computeLayerNames(cards: LocalCard[]): Map<string, string> {
  const counters: Record<FieldKind, number> = { title: 0, subtitle: 0, text: 0, image: 0 };
  const names = new Map<string, string>();
  for (const card of cards) {
    for (const field of card.fields) {
      counters[field.kind] += 1;
      names.set(field.localId, `#${field.kind}${counters[field.kind]}`);
    }
  }
  return names;
}

// Ricostruisce card/campi locali a partire dai template_constraints salvati,
// raggruppando per card_index e ordinando deterministicamente per tipo e
// numero (l'ordine esatto di inserimento originale non viene conservato, ma
// il raggruppamento per card e la numerazione per tipo sì).
function constraintsToCards(constraints: TemplateConstraint[]): LocalCard[] {
  if (constraints.length === 0) return [emptyCard()];
  const byCard = new Map<number, TemplateConstraint[]>();
  for (const c of constraints) {
    const list = byCard.get(c.card_index) ?? [];
    list.push(c);
    byCard.set(c.card_index, list);
  }
  const cardIndexes = [...byCard.keys()].sort((a, b) => a - b);
  return cardIndexes.map((idx) => {
    const fields = [...byCard.get(idx)!].sort((a, b) => {
      const kindA = a.layer_name.replace(/[0-9]+$/, "").replace(/^#/, "") as FieldKind;
      const kindB = b.layer_name.replace(/[0-9]+$/, "").replace(/^#/, "") as FieldKind;
      const priorityA = FIELD_KINDS.indexOf(kindA);
      const priorityB = FIELD_KINDS.indexOf(kindB);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.layer_name.localeCompare(b.layer_name, undefined, { numeric: true });
    });
    return {
      localId: newId(),
      fields: fields.map((c) => ({
        localId: newId(),
        kind: c.layer_name.replace(/[0-9]+$/, "").replace(/^#/, "") as FieldKind,
        maxChars: c.max_chars != null ? String(c.max_chars) : "",
        obbligatorio: c.obbligatorio,
      })),
    };
  });
}

export function RubrichePanel() {
  const [rubriche, setRubriche] = useState<Rubrica[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [nome, setNome] = useState("");
  const [cards, setCards] = useState<LocalCard[]>([emptyCard()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setCards([emptyCard()]);
    setError(null);
  }

  async function startEdit(r: Rubrica) {
    setError(null);
    try {
      const constraints = await listTemplateConstraints(r.id);
      setNome(r.nome);
      setCards(constraintsToCards(constraints));
      setEditingId(r.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  function addCard() {
    setCards((prev) => [...prev, emptyCard()]);
  }

  function removeCard(cardLocalId: string) {
    setCards((prev) => (prev.length > 1 ? prev.filter((c) => c.localId !== cardLocalId) : prev));
  }

  function addField(cardLocalId: string, kind: FieldKind) {
    setCards((prev) =>
      prev.map((c) =>
        c.localId === cardLocalId
          ? {
              ...c,
              fields: [...c.fields, { localId: newId(), kind, maxChars: "", obbligatorio: true }],
            }
          : c,
      ),
    );
  }

  function removeField(cardLocalId: string, fieldLocalId: string) {
    setCards((prev) =>
      prev.map((c) =>
        c.localId === cardLocalId
          ? { ...c, fields: c.fields.filter((f) => f.localId !== fieldLocalId) }
          : c,
      ),
    );
  }

  function updateField(cardLocalId: string, fieldLocalId: string, patch: Partial<LocalField>) {
    setCards((prev) =>
      prev.map((c) =>
        c.localId === cardLocalId
          ? {
              ...c,
              fields: c.fields.map((f) => (f.localId === fieldLocalId ? { ...f, ...patch } : f)),
            }
          : c,
      ),
    );
  }

  async function handleSave() {
    const trimmedNome = nome.trim();
    const allFields = cards.flatMap((c) => c.fields);
    if (!trimmedNome || allFields.length === 0 || editingId === null) return;
    setSaving(true);
    setError(null);
    try {
      const layerNames = computeLayerNames(cards);
      const tipoTemplate = allFields.some((f) => f.kind === "image")
        ? "photo_card"
        : "text_icon_card";

      const rubricaId =
        editingId === "new"
          ? (
              await createRubrica({
                nome: trimmedNome,
                tipo_template: tipoTemplate,
                figma_file_key: null,
                figma_component_id: null,
                attiva: true,
              })
            ).id
          : editingId;

      if (editingId !== "new") {
        await updateRubrica(editingId, { nome: trimmedNome, tipo_template: tipoTemplate });
      }

      const constraints = cards.flatMap((card, cardIdx) =>
        card.fields.map((f) => ({
          layer_name: layerNames.get(f.localId)!,
          layer_type: kindToLayerType(f.kind),
          card_index: cardIdx + 1,
          max_chars: f.maxChars.trim() ? Number(f.maxChars.trim()) : null,
          min_font_size: null,
          max_font_size: null,
          max_lines: null,
          obbligatorio: f.obbligatorio,
        })),
      );
      await replaceTemplateConstraints(rubricaId, constraints);

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

  const layerNames = computeLayerNames(cards);
  const isEditing = editingId !== null;

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Rubriche e template usati da SBAM AutoGraphics per generare i copy visual dei post. Ogni
        rubrica è composta da una o più card (slide, per i carousel), ciascuna con campi #title,
        #subtitle, #text o #image: i campi dello stesso tipo vengono numerati automaticamente su
        tutta la rubrica.
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

          <div className="space-y-3">
            {cards.map((card, cardIdx) => (
              <div
                key={card.localId}
                className="rounded-xl border border-border/70 bg-background/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Card {cardIdx + 1}
                  </span>
                  {cards.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCard(card.localId)}
                      className="rounded-lg border border-border p-1 text-muted-foreground hover:border-destructive hover:text-destructive"
                      title="Rimuovi card"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {card.fields.map((field) => (
                    <div key={field.localId} className="flex flex-wrap items-center gap-2">
                      <span className="w-24 shrink-0 rounded-md bg-primary/10 px-2 py-1 text-center text-xs font-mono text-primary">
                        {layerNames.get(field.localId)}
                      </span>
                      <select
                        value={field.kind}
                        onChange={(e) =>
                          updateField(card.localId, field.localId, {
                            kind: e.target.value as FieldKind,
                          })
                        }
                        className="rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
                      >
                        {FIELD_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {FIELD_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      {field.kind !== "image" && (
                        <input
                          value={field.maxChars}
                          onChange={(e) =>
                            updateField(card.localId, field.localId, { maxChars: e.target.value })
                          }
                          placeholder="max caratteri"
                          inputMode="numeric"
                          className="w-28 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
                        />
                      )}
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={field.obbligatorio}
                          onChange={(e) =>
                            updateField(card.localId, field.localId, {
                              obbligatorio: e.target.checked,
                            })
                          }
                        />
                        obbligatorio
                      </label>
                      <button
                        type="button"
                        onClick={() => removeField(card.localId, field.localId)}
                        className="ml-auto rounded-lg border border-border p-1 text-muted-foreground hover:border-destructive hover:text-destructive"
                        title="Rimuovi campo"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {FIELD_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => addField(card.localId, k)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      <Plus className="size-3" />
                      {FIELD_KIND_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addCard}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="size-3.5" />
            Aggiungi card
          </button>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !nome.trim() || cards.every((c) => c.fields.length === 0)}
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
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2">Attiva</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rubriche.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{r.nome}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.tipo_template}</td>
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
                    <button
                      onClick={() => startEdit(r)}
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-primary hover:text-primary"
                      title="Modifica"
                    >
                      <Pencil className="size-3.5" />
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
