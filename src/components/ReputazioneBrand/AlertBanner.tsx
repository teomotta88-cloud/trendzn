import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BrandSentimentAlert } from "@/lib/brandReputation";

const LEVEL_LABEL: Record<number, string> = {
  2: "Level 2 — Investigate",
  3: "Level 3 — Respond",
  4: "Level 4 — Crisis",
};

export function AlertBanner({
  alerts,
  onResolve,
}: {
  alerts: BrandSentimentAlert[];
  onResolve: (id: string) => void;
}) {
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-start justify-between gap-4 rounded-md border border-destructive/50 bg-destructive/10 p-3"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="text-sm">
              <div className="font-medium">
                {LEVEL_LABEL[alert.level] ?? `Level ${alert.level}`}
                {alert.platform ? ` · ${alert.platform}` : ""}
              </div>
              <div className="text-muted-foreground">{alert.reason}</div>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => onResolve(alert.id)}>
            Segna come risolto
          </Button>
        </div>
      ))}
    </div>
  );
}
