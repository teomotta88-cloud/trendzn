// Tema chiaro/scuro dell'app. Un solo componente (ThemeToggle) legge/scrive
// il tema: niente Context/Provider, sarebbe indirection senza uno scopo.

import { useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "trendzn-theme";

// Eseguito come <script> bloccante nell'<head>, PRIMA che React idrati:
// legge subito la preferenza salvata (o quella di sistema, se non se n'è
// mai scelta una) e applica/rimuove .dark sull'<html> prima che il browser
// dipinga qualunque cosa — nessun flash del tema sbagliato al caricamento.
// RootShell non imposta MAI className sull'<html>: questo script ne resta
// l'unico proprietario, così l'idratazione di React non ha nulla con cui
// essere in conflitto (vedi commento in RootShell).
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});var d=s==="light"?false:s==="dark"?true:!window.matchMedia("(prefers-color-scheme: light)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const toggle = () => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage non disponibile (es. navigazione privata): il tema resta
        // comunque applicato per la sessione corrente, solo non sopravvive
        // al reload.
      }
      return next;
    });
  };

  return { theme, toggle };
}
