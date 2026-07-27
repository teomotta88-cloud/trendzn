import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addBrandProfile,
  getCollabCounts,
  listInfluencerIndustries,
  listInfluencerIndustryMap,
  listMonitoredProfiles,
  type CollabWindow,
  type MonitoredProfile,
} from "@/lib/instagramCollab";

export const Route = createFileRoute("/collab-instagram/")({
  head: () => ({
    meta: [
      { title: "Collab Instagram" },
      {
        name: "description",
        content: "Monitoraggio delle collaborazioni Instagram tra brand e influencer.",
      },
    ],
  }),
  component: CollabInstagramPage,
});

const WINDOW_OPTIONS: { value: CollabWindow; label: string }[] = [
  { value: "1m", label: "Ultimo mese" },
  { value: "3m", label: "Ultimi 3 mesi" },
  { value: "6m", label: "Ultimi 6 mesi" },
  { value: "1y", label: "Ultimo anno" },
];

function formatLastChecked(value: string | null): string {
  // null = non ancora controllato: il worker (sync-instagram-collab.yml,
  // cron orario + workflow_dispatch manuale) lo considera "dovuto" fin da
  // subito, quindi partirà al prossimo scatto dell'ora, non serve un
  // backfill immediato.
  if (!value) return "in attesa del primo check";
  return new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function CollabInstagramPage() {
  const [profiles, setProfiles] = useState<MonitoredProfile[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [industryMap, setIndustryMap] = useState<Map<string, string[]>>(new Map());
  const [collabCounts, setCollabCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [window, setWindow] = useState<CollabWindow>("3m");
  const [industryFilter, setIndustryFilter] = useState<string>("all");

  const [newUsername, setNewUsername] = useState("");
  const [newIndustry, setNewIndustry] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [profilesData, industriesData, industryMapData, countsData] = await Promise.all([
        listMonitoredProfiles(),
        listInfluencerIndustries(),
        listInfluencerIndustryMap(),
        getCollabCounts(window),
      ]);
      setProfiles(profilesData);
      setIndustries(industriesData);
      setIndustryMap(industryMapData);
      setCollabCounts(countsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  const brands = useMemo(() => profiles.filter((p) => p.kind === "brand"), [profiles]);
  const influencers = useMemo(() => {
    const list = profiles.filter((p) => p.kind === "influencer");
    if (industryFilter === "all") return list;
    return list.filter((p) => (industryMap.get(p.username) ?? []).includes(industryFilter));
  }, [profiles, industryFilter, industryMap]);

  const rankedInfluencers = useMemo(
    () =>
      [...influencers].sort(
        (a, b) => (collabCounts.get(b.username) ?? 0) - (collabCounts.get(a.username) ?? 0),
      ),
    [influencers, collabCounts],
  );

  async function handleAddBrand(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormMessage(null);
    try {
      await addBrandProfile({ username: newUsername, industry: newIndustry });
      setFormMessage(`"${newUsername}" aggiunto — verrà controllato al primo run utile.`);
      setNewUsername("");
      setNewIndustry("");
      await reload();
    } catch (err) {
      setFormMessage(`Errore: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Collab Instagram</h1>
        <p className="text-sm text-muted-foreground">
          Brand monitorati e influencer scoperti automaticamente tramite le loro collaborazioni.
        </p>
      </div>

      <form
        onSubmit={handleAddBrand}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brand-username">Profilo Instagram brand</Label>
          <Input
            id="brand-username"
            placeholder="namedsport"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brand-industry">Industry</Label>
          <Input
            id="brand-industry"
            placeholder="sport-nutrition"
            value={newIndustry}
            onChange={(e) => setNewIndustry(e.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Aggiungo…" : "Aggiungi brand"}
        </Button>
        {formMessage && <p className="w-full text-sm text-muted-foreground">{formMessage}</p>}
      </form>

      <div>
        <h2 className="mb-2 text-lg font-medium">Brand monitorati ({brands.length})</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Ultimo check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.map((b) => (
              <TableRow key={b.id}>
                <TableCell>@{b.username}</TableCell>
                <TableCell>{b.industry}</TableCell>
                <TableCell>{formatLastChecked(b.last_checked_at)}</TableCell>
              </TableRow>
            ))}
            {brands.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  Nessun brand aggiunto ancora.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Influencer scoperti ({rankedInfluencers.length})</h2>
          <div className="flex gap-2">
            <Select value={industryFilter} onValueChange={setIndustryFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le industry</SelectItem>
                {industries.map((ind) => (
                  <SelectItem key={ind} value={ind}>
                    {ind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={window} onValueChange={(v) => setWindow(v as CollabWindow)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Collab nella finestra</TableHead>
                <TableHead>Ultimo check</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rankedInfluencers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      to="/collab-instagram/$username"
                      params={{ username: p.username }}
                      className="font-medium text-primary hover:underline"
                    >
                      @{p.username}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(industryMap.get(p.username) ?? []).map((ind) => (
                        <Badge key={ind} variant="secondary">
                          {ind}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{collabCounts.get(p.username) ?? 0}</TableCell>
                  <TableCell>{formatLastChecked(p.last_checked_at)}</TableCell>
                </TableRow>
              ))}
              {rankedInfluencers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    Nessun influencer trovato ancora — verranno scoperti automaticamente dai collab
                    dei brand monitorati.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
