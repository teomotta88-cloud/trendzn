import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BrandMention, Sentiment } from "@/lib/brandReputation";

const SENTIMENT_VARIANT: Record<Sentiment, "default" | "destructive" | "secondary"> = {
  positive: "default",
  negative: "destructive",
  neutral: "secondary",
};

export function MentionsTable({ mentions }: { mentions: BrandMention[] }) {
  if (mentions.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessuna mention trovata per i filtri selezionati.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Piattaforma</TableHead>
          <TableHead>Autore</TableHead>
          <TableHead>Contenuto</TableHead>
          <TableHead>Sentiment</TableHead>
          <TableHead className="text-right">Engagement</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mentions.map((m) => (
          <TableRow key={m.id}>
            <TableCell className="capitalize">{m.platform}</TableCell>
            <TableCell>{m.author ?? "—"}</TableCell>
            <TableCell className="max-w-md truncate">
              <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">
                {m.content || m.url}
              </a>
            </TableCell>
            <TableCell>
              <Badge variant={SENTIMENT_VARIANT[m.sentiment]}>{m.sentiment}</Badge>
            </TableCell>
            <TableCell className="text-right">{m.engagement}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
