import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/lib/theme";

// Pulsante flottante, sempre in basso a destra su ogni pagina (montato in
// __root.tsx). L'icona resta vuota finché il componente non è montato lato
// client: il tema iniziale lo decide lo script bloccante in <head> (vedi
// theme.ts), e leggerlo di nuovo qui prima del mount rischierebbe di
// disallineare l'HTML renderizzato dal server da quello del client.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Passa al tema chiaro" : "Passa al tema scuro"}
      title={theme === "dark" ? "Tema chiaro" : "Tema scuro"}
      className="fixed bottom-5 right-5 z-50 flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg shadow-black/10 transition hover:bg-secondary active:scale-95"
    >
      {mounted ? (
        theme === "dark" ? (
          <Sun className="size-5" />
        ) : (
          <Moon className="size-5" />
        )
      ) : (
        <span className="size-5" />
      )}
    </button>
  );
}
