import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type EditorialPost, addMedia } from "@/lib/editorialPlan";
import {
  type Rubrica,
  type RubricaFormato,
  listRubriche,
  listRubricaFormati,
} from "@/lib/autographics";
import {
  type CustomFont,
  type TemplateElement,
  type TemplateElementInput,
  listCustomFonts,
  listTemplateElementsAllCards,
  uploadEditorImage,
} from "@/lib/designElements";
import {
  computeScale,
  DesignEditor,
  toStoredElement,
} from "@/components/DesignEditor/DesignEditor";
import type { EditorElement } from "@/components/DesignEditor/ElementBox";
import { FramePreview } from "@/components/DesignEditor/FramePreview";
import { materializeElements } from "@/components/DesignEditor/materialize";
import { CURATED_FONTS } from "@/components/DesignEditor/constants";
import { useCustomFontFaces } from "@/components/DesignEditor/useCustomFontFaces";
import { useGoogleFontsLink } from "@/components/DesignEditor/useGoogleFontsLink";

// Wizard di composizione post (Fase 9): sostituisce, per le rubriche che
// usano il nuovo editor grafico interno (template_elements), il vecchio giro
// "copy per layer -> export .xlsx -> Canva Bulk Create" di AutoGraphicsPanel.
// Tre passi: 1) scegli rubrica/formato, 2) compila i campi frame per frame
// con anteprima live, 3) rifinisci nell'editor completo e genera i PNG,
// caricati come editorial_post_media (stesso posto in cui vive già la
// galleria del post, PostMediaGallery — scaricabili da lì).

type Step = "setup" | "compose" | "tweak" | "done";

function wrapAsTemplateElement(
  input: TemplateElementInput,
  ctx: { rubricaId: string; formato: string | null; cardIndex: number },
): TemplateElement {
  const now = new Date().toISOString();
  return {
    id: `wizard-${crypto.randomUUID()}`,
    rubrica_id: ctx.rubricaId,
    formato: ctx.formato,
    card_index: ctx.cardIndex,
    created_at: now,
    updated_at: now,
    ...input,
  };
}

interface TemplateField {
  layerName: string;
  tipo: "text" | "image";
}

function fieldsForCard(elements: TemplateElement[], cardIndex: number): TemplateField[] {
  const seen = new Set<string>();
  const fields: TemplateField[] = [];
  for (const el of elements) {
    if (el.card_index !== cardIndex || !el.layer_name) continue;
    if (seen.has(el.layer_name)) continue;
    if (el.tipo !== "text" && el.tipo !== "image") continue;
    seen.add(el.layer_name);
    fields.push({ layerName: el.layer_name, tipo: el.tipo });
  }
  return fields;
}

export function VisualWizardModal({
  post,
  open,
  onOpenChange,
  onUploaded,
}: {
  post: EditorialPost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded?: () => void;
}) {
  const [rubriche, setRubriche] = useState<Rubrica[]>([]);
  const [rubricaId, setRubricaId] = useState("");
  const [formati, setFormati] = useState<RubricaFormato[]>([]);
  const [formatoId, setFormatoId] = useState("");
  const [allElements, setAllElements] = useState<TemplateElement[] | null>(null);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [step, setStep] = useState<Step>("setup");
  const [activeCardIndex, setActiveCardIndex] = useState(1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [materializedByCard, setMaterializedByCard] = useState<Record<number, TemplateElement[]>>(
    {},
  );
  const [tweakedByCard, setTweakedByCard] = useState<Record<number, TemplateElement[]>>({});
  const [generating, setGenerating] = useState(false);
  const [generationLabel, setGenerationLabel] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [captureCardIndex, setCaptureCardIndex] = useState<number | null>(null);
  const [generationPass, setGenerationPass] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [elementsError, setElementsError] = useState<string | null>(null);
  const capturedBlobsRef = useRef<Blob[]>([]);
  const captureResolveRef = useRef<((blob: Blob) => void) | null>(null);

  useGoogleFontsLink();
  useCustomFontFaces(customFonts);
  const fontOptions = useMemo(
    () => [
      ...CURATED_FONTS,
      ...customFonts.map((f) => f.family_name).filter((n, i, a) => a.indexOf(n) === i),
    ],
    [customFonts],
  );

  // Reset completo alla chiusura: la prossima apertura riparte da zero
  // invece di mostrare lo stato dell'ultima sessione del wizard.
  useEffect(() => {
    if (open) return;
    setRubricaId("");
    setFormatoId("");
    setAllElements(null);
    setStep("setup");
    setActiveCardIndex(1);
    setValues({});
    setMaterializedByCard({});
    setTweakedByCard({});
    setGenerating(false);
    setGenerateError(null);
    setCaptureCardIndex(null);
    setUploadedCount(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRubriche(true).then(setRubriche);
    listCustomFonts().then(setCustomFonts);
  }, [open]);

  useEffect(() => {
    if (!rubricaId) {
      setFormati([]);
      setFormatoId("");
      return;
    }
    listRubricaFormati(rubricaId, true).then((list) => {
      setFormati(list);
      setFormatoId((prev) =>
        list.some((f) => f.id === prev)
          ? prev
          : (list.find((f) => f.formato === post.formato)?.id ?? list[0]?.id ?? ""),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubricaId]);

  const selectedRubrica = rubriche.find((r) => r.id === rubricaId) ?? null;
  const selectedFormato = formati.find((f) => f.id === formatoId) ?? null;

  useEffect(() => {
    if (!rubricaId || !selectedFormato) {
      setAllElements(null);
      setElementsError(null);
      return;
    }
    setAllElements(null);
    setElementsError(null);
    listTemplateElementsAllCards(rubricaId, selectedFormato.formato)
      .then(setAllElements)
      .catch((err) => setElementsError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubricaId, selectedFormato?.id, selectedFormato?.formato]);

  const cardIndexes = allElements
    ? Array.from(new Set(allElements.map((el) => el.card_index))).sort((a, b) => a - b)
    : [];

  function handleStartCompose() {
    if (cardIndexes.length === 0) return;
    setActiveCardIndex(cardIndexes[0]);
    setStep("compose");
  }

  const currentCardIdxPos = cardIndexes.indexOf(activeCardIndex);
  const isLastCard = currentCardIdxPos === cardIndexes.length - 1;

  async function handleUploadImageField(layerName: string, file: File) {
    setUploadingField(layerName);
    try {
      const url = await uploadEditorImage(file);
      setValues((prev) => ({ ...prev, [layerName]: url }));
    } finally {
      setUploadingField(null);
    }
  }

  function handleFinishCompose() {
    if (!selectedFormato) return;
    const materialized: Record<number, TemplateElement[]> = {};
    for (const idx of cardIndexes) {
      materialized[idx] = materializeElements(
        (allElements ?? []).filter((el) => el.card_index === idx),
        values,
      );
    }
    setMaterializedByCard(materialized);
    setTweakedByCard({});
    setActiveCardIndex(cardIndexes[0]);
    setStep("tweak");
  }

  function elementsForTweak(cardIndex: number): TemplateElement[] {
    return tweakedByCard[cardIndex] ?? materializedByCard[cardIndex] ?? [];
  }

  function handleTweakElementsChange(cardIndex: number, elements: EditorElement[]) {
    if (!selectedFormato) return;
    const scale = computeScale(selectedFormato.width_px, selectedFormato.height_px);
    const templateElements = elements.map((el) =>
      wrapAsTemplateElement(toStoredElement(el, scale), {
        rubricaId,
        formato: selectedFormato.formato,
        cardIndex,
      }),
    );
    setTweakedByCard((prev) => ({ ...prev, [cardIndex]: templateElements }));
  }

  async function runGeneration() {
    if (!selectedFormato || cardIndexes.length === 0) return;
    setGenerating(true);
    setGenerateError(null);
    capturedBlobsRef.current = [];
    const pass = generationPass + 1;
    setGenerationPass(pass);
    try {
      for (const idx of cardIndexes) {
        setGenerationLabel(`Genero il frame ${idx} di ${cardIndexes.length}…`);
        const blob = await new Promise<Blob>((resolve) => {
          captureResolveRef.current = resolve;
          setCaptureCardIndex(idx);
        });
        capturedBlobsRef.current.push(blob);
      }
      setCaptureCardIndex(null);
      setGenerationLabel("Carico i visual nel post…");
      for (let i = 0; i < capturedBlobsRef.current.length; i++) {
        const file = new File([capturedBlobsRef.current[i]], `visual-frame-${i + 1}.png`, {
          type: "image/png",
        });
        await addMedia(post.id, file);
      }
      setUploadedCount(capturedBlobsRef.current.length);
      setStep("done");
      onUploaded?.();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
      setCaptureCardIndex(null);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Crea il visual del post
          </DialogTitle>
        </DialogHeader>

        {step === "setup" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Rubrica
              </label>
              <select
                value={rubricaId}
                onChange={(e) => setRubricaId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">— Seleziona una rubrica —</option>
                {rubriche.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                  </option>
                ))}
              </select>
            </div>

            {rubricaId && (
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Formato
                </label>
                <select
                  value={formatoId}
                  onChange={(e) => setFormatoId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
                >
                  {formati.length === 0 && <option value="">Nessun formato configurato</option>}
                  {formati.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.formato} ({f.width_px}×{f.height_px})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {elementsError && <p className="text-xs text-destructive">Errore: {elementsError}</p>}
            {selectedFormato && !elementsError && allElements === null && (
              <p className="text-xs text-muted-foreground">Carico il template…</p>
            )}
            {selectedFormato && allElements !== null && cardIndexes.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                Nessun design trovato per "{selectedRubrica?.nome}" ({selectedFormato.formato}).
                Disegnalo prima dall'Editor grafico della rubrica.
              </p>
            )}

            <button
              type="button"
              onClick={handleStartCompose}
              disabled={!selectedFormato || cardIndexes.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Wand2 className="size-3.5" />
              Inizia
            </button>
          </div>
        )}

        {step === "compose" && selectedFormato && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Card {activeCardIndex} di {cardIndexes.length}
              </span>
              <FramePreview
                formato={selectedFormato}
                elements={materializeElements(
                  (allElements ?? []).filter((el) => el.card_index === activeCardIndex),
                  values,
                )}
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="space-y-3">
                {fieldsForCard(allElements ?? [], activeCardIndex).map((field) => (
                  <div key={field.layerName} className="space-y-1">
                    <label className="text-[11px] font-medium text-foreground">
                      {field.layerName}
                    </label>
                    {field.tipo === "text" ? (
                      <textarea
                        value={values[field.layerName] ?? ""}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [field.layerName]: e.target.value }))
                        }
                        placeholder={`Testo per ${field.layerName}…`}
                        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        {values[field.layerName] ? (
                          <img
                            src={values[field.layerName]}
                            alt=""
                            className="size-12 rounded border border-border object-cover"
                          />
                        ) : (
                          <div className="flex size-12 items-center justify-center rounded border border-dashed border-border text-muted-foreground">
                            <ImageIcon className="size-4" />
                          </div>
                        )}
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
                          {uploadingField === field.layerName ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Upload className="size-3" />
                          )}
                          Carica immagine
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={uploadingField === field.layerName}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleUploadImageField(field.layerName, file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                ))}
                {fieldsForCard(allElements ?? [], activeCardIndex).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Questa card non ha campi dinamici (nessun layer con nome impostato).
                  </p>
                )}
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setActiveCardIndex(cardIndexes[currentCardIdxPos - 1])}
                  disabled={currentCardIdxPos <= 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  <ChevronLeft className="size-3.5" />
                  Card precedente
                </button>
                {isLastCard ? (
                  <button
                    type="button"
                    onClick={handleFinishCompose}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    <Wand2 className="size-3.5" />
                    Genera anteprima
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveCardIndex(cardIndexes[currentCardIdxPos + 1])}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Prossima card
                    <ChevronRight className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {step === "tweak" && selectedFormato && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Rifinitura frame:</span>
              {cardIndexes.map((idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveCardIndex(idx)}
                  disabled={generating}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${
                    idx === activeCardIndex
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Frame {idx}
                </button>
              ))}
            </div>

            <DesignEditor
              key={`tweak-${activeCardIndex}`}
              rubricaId={rubricaId}
              formato={selectedFormato}
              cardIndex={activeCardIndex}
              initialElements={elementsForTweak(activeCardIndex)}
              layerNameSuggestions={[]}
              fontOptions={fontOptions}
              hideSaveButton
              onElementsChange={(els) => handleTweakElementsChange(activeCardIndex, els)}
            />

            {generateError && <p className="text-xs text-destructive">{generateError}</p>}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              {generating && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {generationLabel}
                </span>
              )}
              <button
                type="button"
                onClick={runGeneration}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Genera e salva visual finale
              </button>
            </div>

            {/* Mount fuori schermo usato solo per catturare in sequenza il PNG
                di ogni frame (Fase 9): stesso DOM/motore di rendering
                dell'editor visibile sopra, un frame alla volta, invisibile
                all'utente ma comunque presente nel documento (necessario
                perché html-to-image cattura il layout reale del nodo). */}
            {captureCardIndex !== null && (
              <div style={{ position: "fixed", left: -99999, top: 0 }} aria-hidden="true">
                <DesignEditor
                  key={`gen-${generationPass}-${captureCardIndex}`}
                  rubricaId={rubricaId}
                  formato={selectedFormato}
                  cardIndex={captureCardIndex}
                  initialElements={elementsForTweak(captureCardIndex)}
                  layerNameSuggestions={[]}
                  fontOptions={fontOptions}
                  hideSaveButton
                  autoCapture
                  onFrameCaptured={(blob) => {
                    captureResolveRef.current?.(blob);
                    captureResolveRef.current = null;
                  }}
                />
              </div>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-foreground">
              Fatto! {uploadedCount} frame caricati nel visual del post.
            </p>
            <p className="text-xs text-muted-foreground">
              Li trovi nella galleria "Visual" della card del post, da cui puoi anche scaricarli.
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Chiudi
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
