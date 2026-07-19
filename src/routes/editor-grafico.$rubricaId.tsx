import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  getRubrica,
  listRubricaFormati,
  listTemplateConstraints,
  upsertRubricaFormato,
  type Rubrica,
  type RubricaFormato,
} from "@/lib/autographics";
import {
  listTemplateElementsAllCards,
  deleteTemplateCard,
  listCustomFonts,
  type TemplateElement,
  type CustomFont,
} from "@/lib/designElements";
import { DesignEditor } from "@/components/DesignEditor/DesignEditor";
import { CustomFontsPanel } from "@/components/DesignEditor/CustomFontsPanel";
import { useCustomFontFaces } from "@/components/DesignEditor/useCustomFontFaces";
import {
  CURATED_FONTS,
  GOOGLE_FONTS_STYLESHEET_URL,
  SOCIAL_FORMAT_PRESETS,
} from "@/components/DesignEditor/constants";

// Editor grafico interno (sostituisce progressivamente Figma plugin/Canva
// Bulk Create, vedi docs/sbam-autographics-canva.md): disegna qui il design
// di una rubrica, un formato alla volta. I formati (rubrica_formati) non
// avevano finora nessuna UI di gestione — questa pagina aggiunge anche quella
// minima (nome + dimensioni), essendo un prerequisito diretto per poter
// disegnare qualcosa.

export const Route = createFileRoute("/editor-grafico/$rubricaId")({
  head: () => ({
    meta: [{ title: "Editor grafico — TRENDZN" }],
    // Il render finale cattura il DOM vero (design-capture.ts): i font del
    // set curato devono essere davvero caricati dal browser, non solo
    // referenziati per nome, altrimenti sia l'editor sia l'export
    // userebbero silenziosamente un font di fallback. crossOrigin è
    // necessario perché html-to-image, in fase di cattura, deve poter
    // leggere .cssRules di questo stylesheet per incorporare i @font-face
    // nell'SVG esportato — senza crossOrigin il browser lo tratta come
    // "opaco" e lancia SecurityError su qualunque lettura di .cssRules.
    links: [{ rel: "stylesheet", href: GOOGLE_FONTS_STYLESHEET_URL, crossOrigin: "anonymous" }],
  }),
  component: Page,
});

function NewFormatoForm({ rubricaId, onCreated }: { rubricaId: string; onCreated: () => void }) {
  const [presetIndex, setPresetIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preset = SOCIAL_FORMAT_PRESETS[presetIndex];

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await upsertRubricaFormato({
        rubrica_id: rubricaId,
        formato: preset.formato,
        figma_component_id: null,
        width_px: preset.width,
        height_px: preset.height,
        attivo: true,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Formato social
        <select
          value={presetIndex}
          onChange={(e) => setPresetIndex(Number(e.target.value))}
          className="w-64 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus:border-primary"
        >
          {SOCIAL_FORMAT_PRESETS.map((p, idx) => (
            <option key={p.formato} value={idx}>
              {p.label} ({p.width}×{p.height})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={handleCreate}
        disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        <Plus className="size-3.5" />
        Aggiungi formato
      </button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Page() {
  const { rubricaId } = Route.useParams();
  const [rubrica, setRubrica] = useState<Rubrica | null>(null);
  const [formati, setFormati] = useState<RubricaFormato[]>([]);
  const [selectedFormatoId, setSelectedFormatoId] = useState<string | null>(null);
  const [allCardElements, setAllCardElements] = useState<TemplateElement[] | null>(null);
  const [elementsError, setElementsError] = useState<string | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(1);
  // Frame appena creati con "Aggiungi frame" ma non ancora salvati: non
  // hanno righe in template_elements, quindi non comparirebbero in
  // cardIndexes (derivato da allCardElements). Senza questo stato, appena si
  // naviga via da un frame nuovo la sua tab spariva (bug segnalato
  // dall'utente: "posso solo eliminare i frame e non posso navigare").
  const [pendingCardIndexes, setPendingCardIndexes] = useState<number[]>([]);
  const [layerNameSuggestions, setLayerNameSuggestions] = useState<string[]>([]);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewFormato, setShowNewFormato] = useState(false);

  async function loadFormati() {
    const list = await listRubricaFormati(rubricaId, false);
    setFormati(list);
    setSelectedFormatoId((prev) => prev ?? list[0]?.id ?? null);
    setShowNewFormato(false);
  }

  async function loadCustomFonts() {
    setCustomFonts(await listCustomFonts());
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [r] = await Promise.all([getRubrica(rubricaId), loadFormati(), loadCustomFonts()]);
      const constraints = await listTemplateConstraints(rubricaId);
      setRubrica(r);
      setLayerNameSuggestions(constraints.map((c) => c.layer_name));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubricaId]);

  // I font custom vanno effettivamente caricati dal browser (non solo
  // referenziati per nome) sia per l'editor a schermo sia per la cattura
  // dell'export, che legge i @font-face del documento — vedi
  // useCustomFontFaces.ts.
  useCustomFontFaces(customFonts);

  const fontOptions = [
    ...CURATED_FONTS,
    ...customFonts.map((f) => f.family_name).filter((name, idx, arr) => arr.indexOf(name) === idx),
  ];

  const selectedFormato = formati.find((f) => f.id === selectedFormatoId) ?? null;

  useEffect(() => {
    if (!selectedFormato) {
      setAllCardElements(null);
      setElementsError(null);
      return;
    }
    setAllCardElements(null);
    setElementsError(null);
    setActiveCardIndex(1);
    setPendingCardIndexes([]);
    listTemplateElementsAllCards(rubricaId, selectedFormato.formato)
      .then(setAllCardElements)
      .catch((err) => setElementsError(err instanceof Error ? err.message : String(err)));
    // selectedFormato deriva da formati (già in scope) tramite .find(): usare
    // solo id/formato come dipendenze evita un re-fetch a ogni render in cui
    // formati non è cambiato ma la entry .find() è una nuova reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubricaId, selectedFormato?.id, selectedFormato?.formato]);

  // Frame/card presenti per questo formato (carousel, Fase 8): sempre almeno
  // il frame 1, anche se il design è ancora vuoto, altrimenti non ci sarebbe
  // nessuna tab su cui cliccare per iniziare a disegnare.
  const cardIndexes = allCardElements
    ? Array.from(new Set(allCardElements.map((el) => el.card_index))).sort((a, b) => a - b)
    : [];
  if (cardIndexes.length === 0) cardIndexes.push(1);
  // Frame salvati + frame nuovi non ancora salvati (pendingCardIndexes):
  // tutti restano visibili nella tab bar indipendentemente da quale sia
  // attivo in questo momento.
  const displayCardIndexes = Array.from(new Set([...cardIndexes, ...pendingCardIndexes])).sort(
    (a, b) => a - b,
  );

  const currentCardElements = (allCardElements ?? []).filter(
    (el) => el.card_index === activeCardIndex,
  );

  function handleAddFrame() {
    const nextIndex = Math.max(0, ...cardIndexes, ...pendingCardIndexes) + 1;
    setPendingCardIndexes((prev) => [...prev, nextIndex]);
    setActiveCardIndex(nextIndex);
  }

  async function handleFrameSaved(cardIndex: number) {
    if (!selectedFormato) return;
    setPendingCardIndexes((prev) => prev.filter((idx) => idx !== cardIndex));
    try {
      const refreshed = await listTemplateElementsAllCards(rubricaId, selectedFormato.formato);
      setAllCardElements(refreshed);
    } catch (err) {
      setElementsError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteFrame(cardIndex: number) {
    if (!selectedFormato) return;
    if (displayCardIndexes.length <= 1) return;
    // Un frame appena aggiunto e mai salvato non ha righe su template_elements:
    // basta dimenticarlo localmente, senza conferma né chiamata al backend.
    if (!cardIndexes.includes(cardIndex)) {
      setPendingCardIndexes((prev) => prev.filter((idx) => idx !== cardIndex));
      if (activeCardIndex === cardIndex) setActiveCardIndex(cardIndexes[0] ?? 1);
      return;
    }
    if (cardIndexes.length <= 1) return;
    if (!window.confirm(`Eliminare il frame ${cardIndex}? L'azione non è reversibile.`)) return;
    try {
      await deleteTemplateCard(rubricaId, selectedFormato.formato, cardIndex);
      const refreshed = await listTemplateElementsAllCards(rubricaId, selectedFormato.formato);
      setAllCardElements(refreshed);
      if (activeCardIndex === cardIndex) {
        const remaining = Array.from(new Set(refreshed.map((el) => el.card_index))).sort(
          (a, b) => a - b,
        );
        setActiveCardIndex(remaining[0] ?? 1);
      }
    } catch (err) {
      setElementsError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Caricamento…</div>;
  }

  if (!rubrica) {
    return <div className="p-8 text-sm text-destructive">Rubrica non trovata.</div>;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6 lg:px-10">
      <Link
        to="/piano-editoriale"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-4" />
        Torna al Piano Editoriale
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-foreground">Editor grafico — {rubrica.nome}</h1>
        <p className="text-sm text-muted-foreground">
          Disegna il template di questa rubrica per formato. I campi con "layer_name" impostato
          vengono popolati automaticamente dal copy/foto del post in fase di generazione bulk.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {formati.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setSelectedFormatoId(f.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs ${
              f.id === selectedFormatoId
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {f.formato} ({f.width_px}×{f.height_px})
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowNewFormato((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="size-3.5" />
          Nuovo formato
        </button>
      </div>

      {showNewFormato && <NewFormatoForm rubricaId={rubricaId} onCreated={loadFormati} />}

      <CustomFontsPanel fonts={customFonts} onChange={loadCustomFonts} />

      {!selectedFormato ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Nessun formato configurato per questa rubrica. Aggiungine uno per iniziare a disegnare.
        </div>
      ) : elementsError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Errore nel caricamento del design: {elementsError}
        </div>
      ) : allCardElements === null ? (
        <div className="text-sm text-muted-foreground">Caricamento design…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Frame (carousel):</span>
            {displayCardIndexes.map((idx) => (
              <div key={idx} className="group relative">
                <button
                  type="button"
                  onClick={() => setActiveCardIndex(idx)}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${
                    idx === activeCardIndex
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Frame {idx}
                </button>
                {displayCardIndexes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteFrame(idx)}
                    title="Elimina frame"
                    className="absolute -right-1.5 -top-1.5 hidden size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover:flex"
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={handleAddFrame}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Plus className="size-3.5" />
              Aggiungi frame
            </button>
          </div>

          <DesignEditor
            key={`${selectedFormato.id}-${activeCardIndex}`}
            rubricaId={rubricaId}
            formato={selectedFormato}
            cardIndex={activeCardIndex}
            initialElements={currentCardElements}
            layerNameSuggestions={layerNameSuggestions}
            fontOptions={fontOptions}
            onSaved={() => handleFrameSaved(activeCardIndex)}
          />
        </>
      )}
    </div>
  );
}
