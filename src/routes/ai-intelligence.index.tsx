import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { bluserenaCanali } from "@/lib/bluserenaMonitoring";
import { type CanaleInspo, type AccountRef, type Sentiment } from "@/lib/trends";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Calendar, Filter, Smile, Tag, MapPin } from "lucide-react";

export const Route = createFileRoute("/ai-intelligence")({
  head: () => ({
    meta: [
      { title: "AI Intelligence — Bluserena" },
      { name: "description", content: "Analytics dashboard con sentiment, topic e location analysis." },
    ],
  }),
  component: AIIntelligencePage,
});

// Data aggregation

interface SentimentStats {
  positive: number;
  negative: number;
  neutral: number;
  unanalyzed: number;
}

interface TopicFrequency {
  topic: string;
  count: number;
}

interface LocationStats {
  location: string;
  count: number;
}

interface TimelineData {
  date: string;
  positive: number;
  negative: number;
  neutral: number;
}

function aggregateData(canali: CanaleInspo[], startDate?: string, endDate?: string) {
  const allPosts: AccountRef[] = [];
  for (const canale of canali) {
    allPosts.push(...(canale.accounts || []));
  }

  // Filter by date if provided
  let posts = allPosts;
  if (startDate || endDate) {
    posts = posts.filter((p) => {
      if (!p.date) return false;
      const d = p.date.slice(0, 10);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
  }

  // Sentiment stats
  const sentimentStats: SentimentStats = {
    positive: 0,
    negative: 0,
    neutral: 0,
    unanalyzed: 0,
  };
  const topicFreq = new Map<string, number>();
  const locationFreq = new Map<string, number>();
  const timelineMap = new Map<string, { positive: number; negative: number; neutral: number }>();

  for (const post of posts) {
    // Sentiment
    if (post.sentiment) {
      sentimentStats[post.sentiment as Sentiment]++;
    } else {
      sentimentStats.unanalyzed++;
    }

    // Topics
    if (post.topics && Array.isArray(post.topics)) {
      for (const topic of post.topics) {
        topicFreq.set(topic, (topicFreq.get(topic) || 0) + 1);
      }
    }

    // Location
    if (post.location) {
      locationFreq.set(post.location, (locationFreq.get(post.location) || 0) + 1);
    }

    // Timeline
    if (post.date && post.sentiment) {
      const date = post.date.slice(0, 10);
      const entry = timelineMap.get(date) || { positive: 0, negative: 0, neutral: 0 };
      entry[post.sentiment]++;
      timelineMap.set(date, entry);
    }
  }

  // Convert to arrays
  const topicArray = Array.from(topicFreq.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);

  const locationArray = Array.from(locationFreq.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count);

  const timelineArray = Array.from(timelineMap.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    sentimentStats,
    topicArray,
    locationArray,
    timelineArray,
    totalPosts: posts.length,
  };
}

// Chart colors
const SENTIMENT_COLORS = {
  positive: "#10b981",
  negative: "#ef4444",
  neutral: "#6b7280",
  unanalyzed: "#d1d5db",
};

function AIIntelligencePage() {
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedResort, setSelectedResort] = useState("");

  // Collect all unique locations from data
  const allLocations = useMemo(() => {
    const locs = new Set<string>();
    for (const canale of bluserenaCanali) {
      for (const account of canale.accounts || []) {
        if (account.location) locs.add(account.location);
      }
    }
    return Array.from(locs).sort();
  }, []);

  // Aggregate data based on filters
  const aggregated = useMemo(
    () => aggregateData(bluserenaCanali, dateRange.start, dateRange.end),
    [dateRange],
  );

  const topicData = aggregated.topicArray.slice(0, 10);
  const locationData = selectedResort
    ? aggregated.locationArray.filter((l) => l.location === selectedResort)
    : aggregated.locationArray.slice(0, 8);

  const sentimentPieData = [
    { name: "Positivo", value: aggregated.sentimentStats.positive },
    { name: "Neutrale", value: aggregated.sentimentStats.neutral },
    { name: "Negativo", value: aggregated.sentimentStats.negative },
    { name: "Non analizzato", value: aggregated.sentimentStats.unanalyzed },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-bold">AI Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          Analisi sentiment, topic e location dei post Bluserena (luglio-agosto 2025 e 2026)
        </p>
      </header>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="size-4" />
          Filtri
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Data inizio
            </label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange((p) => ({ ...p, start: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Data fine
            </label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange((p) => ({ ...p, end: e.target.value }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Resort
            </label>
            <select
              value={selectedResort}
              onChange={(e) => setSelectedResort(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Tutti</option>
              {allLocations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Totale post analizzati: <strong>{aggregated.totalPosts}</strong>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-xs text-muted-foreground">Positivi</div>
          <div className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
            {aggregated.sentimentStats.positive}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-xs text-muted-foreground">Neutrali</div>
          <div className="mt-1 text-2xl font-bold text-gray-600 dark:text-gray-400">
            {aggregated.sentimentStats.neutral}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-xs text-muted-foreground">Negativi</div>
          <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
            {aggregated.sentimentStats.negative}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <div className="text-xs text-muted-foreground">Unici Topic</div>
          <div className="mt-1 text-2xl font-bold text-primary">
            {aggregated.topicArray.length}
          </div>
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Sentiment distribution */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
            <Smile className="size-4" />
            Distribuzione Sentiment
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={sentimentPieData.filter((d) => d.value > 0)}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                <Cell fill={SENTIMENT_COLORS.positive} />
                <Cell fill={SENTIMENT_COLORS.neutral} />
                <Cell fill={SENTIMENT_COLORS.negative} />
                <Cell fill={SENTIMENT_COLORS.unanalyzed} />
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top topics */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
            <Tag className="size-4" />
            Top 10 Topic
          </h3>
          {topicData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={topicData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="topic" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 12 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">
              Nessun topic analizzato nel filtro selezionato
            </p>
          )}
        </div>

        {/* Timeline sentiment trend */}
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
            <Calendar className="size-4" />
            Timeline Sentiment
          </h3>
          {aggregated.timelineArray.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={aggregated.timelineArray}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="positive"
                  stroke={SENTIMENT_COLORS.positive}
                  name="Positivi"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="neutral"
                  stroke={SENTIMENT_COLORS.neutral}
                  name="Neutrali"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="negative"
                  stroke={SENTIMENT_COLORS.negative}
                  name="Negativi"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">
              Nessun dato nel filtro selezionato
            </p>
          )}
        </div>

        {/* Location distribution */}
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
            <MapPin className="size-4" />
            Location Distribution
          </h3>
          {locationData.length > 0 ? (
            <div className="space-y-2">
              {locationData.map((loc, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground truncate">{loc.location}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-48 bg-gradient-to-r from-primary/20 to-primary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${(loc.count / Math.max(...locationData.map((l) => l.count), 1)) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-foreground w-8 text-right">{loc.count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nessun location nel filtro selezionato
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
