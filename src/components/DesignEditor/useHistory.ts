import { useCallback, useRef, useState } from "react";

// Storico generico per undo/redo (Fase 5). Non è specifico agli elementi
// dell'editor apposta: qualunque snapshot serializzabile va bene, così
// "annulla rimozione sfondo" non è una feature a parte — è solo un'altra
// modifica che passa da commit() come tutte le altre.
//
// Le modifiche continue (drag di uno slider, digitazione in un campo
// numerico, trascinamento di un color picker) usano commit(next, { debounceMs })
// così una sequenza di eventi ravvicinati diventa UN solo passo di undo
// invece di uno per keystroke. Le azioni discrete (aggiungi/elimina
// elemento, fine drag/resize/rotate, upload immagine, rimozione sfondo)
// committano subito.
const MAX_HISTORY = 50;

export function useHistory<T>(initial: T) {
  const [state, setState] = useState(initial);
  const stackRef = useRef<T[]>([initial]);
  const indexRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Nessuno stato derivato da stackRef/indexRef è letto da React se non
  // tramite questo contatore: forza un re-render quando serve aggiornare
  // canUndo/canRedo, senza rendere stackRef/indexRef stato React (sarebbe
  // ridondante con `state` e complicherebbe il debounce).
  const [, setVersion] = useState(0);

  const pushNow = useCallback((next: T) => {
    const truncated = stackRef.current.slice(0, indexRef.current + 1);
    const nextStack = [...truncated, next].slice(-MAX_HISTORY);
    stackRef.current = nextStack;
    indexRef.current = nextStack.length - 1;
    setVersion((v) => v + 1);
  }, []);

  const clearPendingDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const commit = useCallback(
    (next: T, options?: { debounceMs?: number }) => {
      setState(next);
      clearPendingDebounce();
      if (options?.debounceMs) {
        debounceRef.current = setTimeout(() => pushNow(next), options.debounceMs);
      } else {
        pushNow(next);
      }
    },
    [clearPendingDebounce, pushNow],
  );

  const undo = useCallback(() => {
    clearPendingDebounce();
    if (indexRef.current <= 0) return;
    indexRef.current -= 1;
    setState(stackRef.current[indexRef.current]);
    setVersion((v) => v + 1);
  }, [clearPendingDebounce]);

  const redo = useCallback(() => {
    clearPendingDebounce();
    if (indexRef.current >= stackRef.current.length - 1) return;
    indexRef.current += 1;
    setState(stackRef.current[indexRef.current]);
    setVersion((v) => v + 1);
  }, [clearPendingDebounce]);

  return {
    state,
    commit,
    undo,
    redo,
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < stackRef.current.length - 1,
  };
}
