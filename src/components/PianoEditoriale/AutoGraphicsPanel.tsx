import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Search, Wand2, Loader2, AlertTriangle } from "lucide-react";
import type { EditorialPost } from "@/lib/editorialPlan";
import {
  type GettyCandidate,
  type GraphicJob,
  type Rubrica,
  type TemplateConstraint,
  getJobForPost,
  listGettyCandidates,
  listRubriche,
  listTemplateConstraints,
  replaceGettyCandidates,
  selectGettyCandidate,
  setPostRubricaId,
  subscribeToJob,
  upsertGraphicJob,
} from "@/lib/autographics";

// SBAM AutoGraphics — pannello agganciato in fondo alla PostCard. Gestisce
// tutto il flusso lato copywriter: scelta rubrica strutturata, composizione
// del copy per layer con contatori live e blocco oltre max_chars, ricerca
// foto Getty (per le rubriche photo_card), approvazione. Il rendering vero e
// proprio non avviene qui: un job approvato (ready_for_render) diventa
// esportabile in .xlsx per Canva Bulk Create dal pannello "Export Canva Bulk
// Create" in cima al Piano Editoriale (vedi CanvaExportPanel.tsx).

async function callHook<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/public/hooks/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `Richiesta ${path} fallita (${res.status})`);
  }
  return json;
}

// Soglia visiva del contatore caratteri: verde < 80%, giallo < 100%, rosso ≥.
function counterColor(len: number, max: number | null): string {
  if (max == null) return "text-muted-foreground";
  const ratio = len / max;
  if (ratio >= 1) return "text-destructive";
  if (ratio >= 0.8) return "text-yellow-600";
  return "text-green-600";
}

const STATUS_LABEL: Record<string, string> = {
  pending_validation: "bozza",
  pending_image: "in attesa foto",
  ready_for_render: "pronto per l'export",
  rendering: "in rendering",
  done: "esportato in .xlsx",
  error: "errore",
};

export function AutoGraphicsPanel({ post }: { post: EditorialPost }) {
  const [open, setOpen] = useState(false);
  const [rubriche, setRubriche] = useState<Rubrica[]>([]);
  const [rubricaId, setRubricaId] = useState<string>("");
  const [constraints, setConstraints] = useState<TemplateConstraint[]>([]);
  const [copyPayload, setCopyPayload] = useState<Record<string, string>>({});
  const [job, setJob] = useState<GraphicJob | null>(null);
  const [candidates, setCandidates] = useState<GettyCandidate[]>([]);
  const [keywords, setKeywords] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const selectedRubrica = rubriche.find((r) => r.id === rubricaId) ?? null;
  const isPhotoCard = selectedRubrica?.tipo_template === "photo_card";

  const refreshJobState = useCallback(
    async (jobId: string) => {
      const cands = await listGettyCandidates(jobId);
      setCandidates(cands);
      const fresh = await getJobForPost(post.id);
      if (fresh) setJob(fresh);
    },
    [post.id],
  );

  // Caricamento iniziale: rubriche attive + eventuale job già esistente.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [rubs, existing] = await Promise.all([listRubriche(true), getJobForPost(post.id)]);
        if (cancelled) return;
        setRubriche(rubs);
        if (existing) {
          setJob(existing);
          setRubricaId(existing.rubrica_id);
          setCopyPayload(existing.copy_payload ?? {});
          const [cons, cands] = await Promise.all([
            listTemplateConstraints(existing.rubrica_id),
            listGettyCandidates(existing.id),
          ]);
          if (cancelled) return;
          setConstraints(cons);
          setCandidates(cands);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, post.id]);

  // Sottoscrizione Realtime allo stato del job quando ne esiste uno.
  useEffect(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    if (!job) return;
    const jobId = job.id;
    unsubRef.current = subscribeToJob(jobId, () => {
      refreshJobState(jobId).catch(() => undefined);
    });
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [job, refreshJobState]);

  async function handleSelectRubrica(id: string) {
    setError(null);
    setRubricaId(id);
    setCopyPayload({});
    setConstraints([]);
    if (!id) return;
    try {
      const cons = await listTemplateConstraints(id);
      setConstraints(cons);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Validazione lato UI: solo i layer di TESTO possono bloccare il
  // salvataggio (obbligatorio vuoto o oltre max_chars). I layer immagine si
  // riempiono dalla selezione Getty dopo il salvataggio, quindi non entrano
  // in questa validazione — altrimenti si crea un cortocircuito.
  const validation = constraints.map((c) => {
    const value = copyPayload[c.layer_name] ?? "";
    const isImage = c.layer_type === "image";
    const overMax = !isImage && c.max_chars != null && value.length > c.max_chars;
    const requiredEmpty = !isImage && c.obbligatorio && !value.trim();
    return { constraint: c, isImage, overMax, requiredEmpty };
  });
  const canSave = rubricaId !== "" && validation.every((v) => !v.overMax && !v.requiredEmpty);

  async function handleSaveDraft() {
    if (!canSave || !selectedRubrica) return;
    setBusy("save");
    setError(null);
    try {
      await setPostRubricaId(post.id, rubricaId);
      const saved = await upsertGraphicJob({
        post_id: post.id,
        rubrica_id: rubricaId,
        copy_payload: copyPayload,
      });
      setJob(saved);
      await refreshJobState(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // Testo su cui basare l'estrazione keyword: il copy visual del post se c'è,
  // altrimenti la concatenazione dei soli layer di TESTO (i layer immagine
  // contengono URL, non testo utile).
  function sourceCopyForKeywords(): string {
    if (post.copy_visual?.trim()) return post.copy_visual;
    const textValues = constraints
      .filter((c) => c.layer_type !== "image")
      .map((c) => copyPayload[c.layer_name])
      .filter((v): v is string => !!v && v.trim().length > 0);
    return textValues.join(". ");
  }

  async function handleExtractAndSearch() {
    if (!job) {
      setError("Salva prima la bozza grafica.");
      return;
    }
    setBusy("keywords");
    setError(null);
    try {
      const copy = sourceCopyForKeywords();
      if (!copy.trim()) throw new Error("Nessun testo disponibile per estrarre le keyword.");
      const kw = await callHook<{ keywords_en: string[]; keywords_it: string[] }>(
        "extract-keywords",
        {
          copy,
        },
      );
      // Italiano prima, inglese come fallback (rubriche locali) — l'utente può
      // comunque modificare la stringa e rilanciare la ricerca a mano.
      const merged = [...kw.keywords_it, ...kw.keywords_en];
      setKeywords(merged.join(", "));
      await runGettySearch(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runGettySearch(kwList: string[]) {
    if (!job) return;
    const result = await callHook<{
      candidates: Array<Omit<GettyCandidate, "id" | "job_id" | "created_at" | "selected">>;
    }>("getty-search", { keywords: kwList });
    const saved = await replaceGettyCandidates(job.id, result.candidates);
    setCandidates(saved);
  }

  async function handleManualSearch() {
    const kwList = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (kwList.length === 0) {
      setError("Inserisci almeno una keyword.");
      return;
    }
    setBusy("search");
    setError(null);
    try {
      await runGettySearch(kwList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSelectCandidate(candidateId: string) {
    if (!job) return;
    setBusy("select");
    try {
      await selectGettyCandidate(job.id, candidateId);
      setCandidates((prev) => prev.map((c) => ({ ...c, selected: c.id === candidateId })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove() {
    if (!job) return;
    setBusy("approve");
    setError(null);
    try {
      await callHook("approve-job", { job_id: job.id });
      await refreshJobState(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const selectedCandidate = candidates.find((c) => c.selected) ?? null;
  const readyToApprove =
    !!job && canSave && (!isPhotoCard || !!selectedCandidate) && job.status !== "rendering";

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"
      >
        <Sparkles className="size-3.5" />
        Grafica automatica{" "}
        {job && (
          <span className="text-muted-foreground">· {STATUS_LABEL[job.status] ?? job.status}</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-background/40 p-3">
          {/* Rubrica strutturata (tabella rubriche) */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Rubrica (template Canva)
            </label>
            <select
              value={rubricaId}
              onChange={(e) => handleSelectRubrica(e.target.value)}
              className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">— Seleziona una rubrica —</option>
              {rubriche.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome} ({r.tipo_template})
                </option>
              ))}
            </select>
            {rubriche.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Nessuna rubrica configurata. Registra le rubriche nella tabella{" "}
                <code>rubriche</code> (vedi docs/sbam-autographics-canva.md).
              </p>
            )}
          </div>

          {/* Composizione copy per layer con contatori live */}
          {constraints.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Copy per layer
              </span>
              {validation.map(({ constraint: c, isImage, overMax, requiredEmpty }) => {
                const value = copyPayload[c.layer_name] ?? "";
                // I layer immagine non si digitano: mostrano lo stato della
                // foto Getty (gestita nella sezione sotto), non una textarea.
                if (isImage) {
                  return (
                    <div key={c.id} className="space-y-1">
                      <label className="text-[11px] font-medium text-foreground">
                        {c.layer_name}
                        {c.obbligatorio && <span className="text-destructive"> *</span>}
                        <span className="ml-1 font-normal text-muted-foreground">(immagine)</span>
                      </label>
                      <p className="rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
                        {selectedCandidate
                          ? "Foto Getty selezionata ✓ (vedi sotto)"
                          : "Da popolare con la selezione Getty qui sotto dopo il salvataggio."}
                      </p>
                    </div>
                  );
                }
                return (
                  <div key={c.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[11px] font-medium text-foreground">
                        {c.layer_name}
                        {c.obbligatorio && <span className="text-destructive"> *</span>}
                      </label>
                      {c.max_chars != null && (
                        <span
                          className={`text-[10px] tabular-nums ${counterColor(value.length, c.max_chars)}`}
                        >
                          {value.length}/{c.max_chars}
                        </span>
                      )}
                    </div>
                    <textarea
                      value={value}
                      onChange={(e) =>
                        setCopyPayload((prev) => ({ ...prev, [c.layer_name]: e.target.value }))
                      }
                      className={`w-full rounded-lg border bg-background/60 px-3 py-2 text-[11px] leading-snug outline-none ${
                        overMax || requiredEmpty
                          ? "border-destructive"
                          : "border-border focus:border-primary"
                      } scrollbar-thin max-h-32 min-h-12 overflow-y-auto`}
                      placeholder={`Testo per ${c.layer_name}…`}
                    />
                    {overMax && (
                      <p className="text-[10px] text-destructive">
                        Supera il limite di {c.max_chars} caratteri: accorcia prima di salvare.
                      </p>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={!canSave || busy === "save"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {busy === "save" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wand2 className="size-3.5" />
                )}
                Salva bozza grafica
              </button>
            </div>
          )}

          {/* Ricerca Getty (solo photo_card, dopo aver salvato la bozza) */}
          {isPhotoCard && job && (
            <div className="space-y-2 border-t border-border pt-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Foto stock (Getty)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExtractAndSearch}
                  disabled={busy === "keywords"}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-[11px] font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
                >
                  {busy === "keywords" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  Estrai keyword e cerca
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="keyword separate da virgola…"
                  className="flex-1 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-[11px] outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={handleManualSearch}
                  disabled={busy === "search"}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {busy === "search" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Search className="size-3.5" />
                  )}
                  Cerca
                </button>
              </div>

              {candidates.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCandidate(c.id)}
                      disabled={busy === "select"}
                      className={`group relative overflow-hidden rounded-lg border-2 transition ${
                        c.selected ? "border-primary" : "border-transparent hover:border-border"
                      }`}
                      title={c.title ?? c.asset_id}
                    >
                      <img
                        src={c.preview_url}
                        alt={c.title ?? ""}
                        className="aspect-square w-full object-cover"
                      />
                      {c.selected && (
                        <span className="absolute bottom-1 right-1 rounded bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                          selezionata
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Le anteprime sono bozzetti Getty con watermark. Nessun asset licenziato viene
                scaricato in questa fase.
              </p>
            </div>
          )}

          {/* Approvazione + stato render in tempo reale */}
          {job && (
            <div className="space-y-2 border-t border-border pt-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={!readyToApprove || busy === "approve"}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {busy === "approve" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Approva e genera
              </button>

              {job.status === "ready_for_render" && (
                <p className="text-[11px] text-muted-foreground">
                  Pronto: sarà incluso nel prossimo export .xlsx per questa rubrica (vedi "Export
                  Canva Bulk Create" in cima alla pagina).
                </p>
              )}
              {job.status === "done" && (
                <p className="text-[11px] text-muted-foreground">
                  Esportato in .xlsx. Carica il file in Canva Bulk Create per generare la grafica.
                </p>
              )}

              {job.status === "error" && job.error_detail && (
                <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {job.error_detail}
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
