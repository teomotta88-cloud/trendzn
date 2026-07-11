import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Search, Wand2, Download, Loader2, AlertTriangle } from "lucide-react";
import type { EditorialPost } from "@/lib/editorialPlan";
import {
  type GettyCandidate,
  type GraphicJob,
  type GraphicJobFormat,
  type Rubrica,
  type TemplateConstraint,
  createGraphicJobFormatsFromRubrica,
  getJobForPost,
  listGettyCandidates,
  listGraphicJobFormats,
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
// foto Getty (per le rubriche photo_card), approvazione e stato del render
// in tempo reale.

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
  ready_for_render: "in coda al render",
  rendering: "in rendering",
  done: "completato",
  error: "errore",
};

export function AutoGraphicsPanel({ post }: { post: EditorialPost }) {
  const [open, setOpen] = useState(false);
  const [rubriche, setRubriche] = useState<Rubrica[]>([]);
  const [rubricaId, setRubricaId] = useState<string>("");
  const [constraints, setConstraints] = useState<TemplateConstraint[]>([]);
  const [copyPayload, setCopyPayload] = useState<Record<string, string>>({});
  const [job, setJob] = useState<GraphicJob | null>(null);
  const [formats, setFormats] = useState<GraphicJobFormat[]>([]);
  const [candidates, setCandidates] = useState<GettyCandidate[]>([]);
  const [keywords, setKeywords] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const selectedRubrica = rubriche.find((r) => r.id === rubricaId) ?? null;
  const isPhotoCard = selectedRubrica?.tipo_template === "photo_card";

  const refreshJobState = useCallback(
    async (jobId: string) => {
      const [fmts, cands] = await Promise.all([
        listGraphicJobFormats(jobId),
        listGettyCandidates(jobId),
      ]);
      setFormats(fmts);
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
          const [cons, fmts, cands] = await Promise.all([
            listTemplateConstraints(existing.rubrica_id),
            listGraphicJobFormats(existing.id),
            listGettyCandidates(existing.id),
          ]);
          if (cancelled) return;
          setConstraints(cons);
          setFormats(fmts);
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

  // Validazione lato UI: nessun layer obbligatorio vuoto, nessuno oltre max_chars.
  const validation = constraints.map((c) => {
    const value = copyPayload[c.layer_name] ?? "";
    const overMax = c.max_chars != null && value.length > c.max_chars;
    const requiredEmpty = c.obbligatorio && !value.trim();
    return { constraint: c, overMax, requiredEmpty };
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

  // Testo su cui basare l'estrazione keyword: preferisci il copy visual del
  // post, poi il layer #body/#title, poi tutti i valori del copy_payload.
  function sourceCopyForKeywords(): string {
    if (post.copy_visual?.trim()) return post.copy_visual;
    const body = copyPayload["#body"] || copyPayload["#title"];
    if (body?.trim()) return body;
    return Object.values(copyPayload).filter(Boolean).join(". ");
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
    const formato = formats[0]?.formato;
    const result = await callHook<{
      candidates: Array<Omit<GettyCandidate, "id" | "job_id" | "created_at" | "selected">>;
    }>("getty-search", { keywords: kwList, formato });
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
      // Assicura che i formati esistano già (li crea approve-job, ma li
      // pre-creiamo per poter mostrare subito le righe di stato).
      if (formats.length === 0) {
        await createGraphicJobFormatsFromRubrica(job.id, job.rubrica_id);
      }
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
              Rubrica (template Figma)
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
                <code>rubriche</code> (vedi figma-plugin/README.md).
              </p>
            )}
          </div>

          {/* Composizione copy per layer con contatori live */}
          {constraints.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Copy per layer
              </span>
              {validation.map(({ constraint: c, overMax, requiredEmpty }) => {
                const value = copyPayload[c.layer_name] ?? "";
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
                      placeholder={
                        c.layer_name.startsWith("#photo") || c.layer_name.startsWith("#icon")
                          ? "URL immagine (di norma popolato dalla selezione Getty)"
                          : `Testo per ${c.layer_name}…`
                      }
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

              {formats.length > 0 && (
                <div className="space-y-1">
                  {formats.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="font-medium text-foreground">{f.formato}</span>
                      <span className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] ${
                            f.status === "done"
                              ? "bg-green-500/15 text-green-600"
                              : f.status === "error"
                                ? "bg-destructive/15 text-destructive"
                                : f.status === "rendering"
                                  ? "bg-yellow-500/15 text-yellow-600"
                                  : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {f.status}
                        </span>
                        {f.status === "done" && f.output_url && (
                          <a
                            href={f.output_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <Download className="size-3.5" />
                            Scarica
                          </a>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
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
