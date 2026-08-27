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
import { Calendar, Filter, Smile, Tag, MapPin, X } from "lucide-react";

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

interface AggregationFilters {
  startDate?: string;
  endDate?: string;
  sentiments?: Set<Sentiment>;
  topics?: Set<string>;
  location?: string;
}

function aggregateData(canali: CanaleInspo[], filters: AggregationFilters) {
  const allPosts: AccountRef[] = [];
  for (const canale of canali) {
    allPosts.push(...(canale.accounts || []));
  }

  // Apply all filters
  let posts = allPosts.filter((p) => {
    // Date filter
    if (p.date) {
      const d = p.date.slice(0, 10);
      if (filters.startDate && d < filters.startDate) return false;
      if (filters.endDate && d > filters.endDate) return false;
    } else {
      if (filters.startDate || filters.endDate) return false;
    }

    // Sentiment filter
    if (filters.sentiments && filters.sentiments.size > 0) {
      if (!p.sentiment || !filters.sentiments.has(p.sentiment)) return false;
    }

    // Topics filter - post must have at least one matching topic
    if (filters.topics && filters.topics.size > 0) {
      if (!p.topics || !Array.isArray(p.topics)) return false;
      const hasMatchingTopic = p.topics.some((t) => filters.topics!.has(t));
      if (!hasMatchingTopic) return false;
    }

    // Location filter
    if (filters.location && p.location !== filters.location) return false;

    return true;
  });

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
  const [selectedSentiments, setSelectedSentiments] = useState<Set<Sentiment>>(new Set());
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [expandedTopics, setExpandedTopics] = useState(false);

  // Collect all unique locations and topics
  const allLocations = useMemo(() => {
    const locs = new Set<string>();
    for (const canale of bluserenaCanali) {
      for (const account of canale.accounts || []) {
        if (account.location) locs.add(account.location);
      }
    }
    return Array.from(locs).sort();
  }, []);

  // Collect all topics for filter
  const allTopics = useMemo(() => {
    const topics = new Set<string>();
    for (const canale of bluserenaCanali) {
      for (const account of canale.accounts || []) {
        if (account.topics && Array.isArray(account.topics)) {
          for (const topic of account.topics) {
            topics.add(topic);
          }
        }
      }
    }
    return Array.from(topics).sort();
  }, []);

  // Aggregate data based on all filters
  const aggregated = useMemo(
    () =>
      aggregateData(bluserenaCanali, {
        startDate: dateRange.start,
        endDate: dateRange.end,
        sentiments: selectedSentiments.size > 0 ? selectedSentiments : undefined,
        topics: selectedTopics.size > 0 ? selectedTopics : undefined,
        location: selectedResort || undefined,
      }),
    [dateRange, selectedSentiments, selectedTopics, selectedResort],
  );

  const topicData = aggregated.topicArray.slice(0, 10);
  const locationData = aggregated.locationArray.slice(0, 8);

  const sentimentPieData = [
    { name: "Positivo", value: aggregated.sentimentStats.positive },
    { name: "Neutrale", value: aggregated.sentimentStats.neutral },
    { name: "Negativo", value: aggregated.sentimentStats.negative },
    { name: "Non analizzato", value: aggregated.sentimentStats.unanalyzed },
  ].filter((d) => d.value > 0);

  const toggleSentiment = (sentiment: Sentiment) => {
    setSelectedSentiments((prev) => {
      const next = new Set(prev);
      if (next.has(sentiment)) {
        next.delete(sentiment);
      } else {
        next.add(sentiment);
      }
      return next;
    });
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
  };

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
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="size-4" />
          Filtri
        </div>

        {/* Date and location */}
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

        {/* Sentiment filter */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2">Sentimento</label>
          <div className="flex flex-wrap gap-2">
            {["positive", "neutral", "negative"].map((s) => {
              const sentiment = s as Sentiment;
              const isSelected = selectedSentiments.has(sentiment);
              const colorClass =
                sentiment === "positive"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : sentiment === "negative"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400";

              return (
                <button
                  key={sentiment}
                  onClick={() => toggleSentiment(sentiment)}
                  className={`px-3 py-1.5 text-xs rounded-full font-medium transition ${
                    isSelected
                      ? colorClass
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {sentiment === "positive" ? "😊 Positivo" : sentiment === "negative" ? "😞 Negativo" : "😐 Neutrale"}
                </button>
              );
            })}
            {selectedSentiments.size > 0 && (
              <button
                onClick={() => setSelectedSentiments(new Set())}
                className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Topics filter */}
        {allTopics.length > 0 && (
          <div>
            <button
              onClick={() => setExpandedTopics(!expandedTopics)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
            >
              Topic ({selectedTopics.size > 0 ? `${selectedTopics.size} selezionati` : "tutti disponibili"})
              {expandedTopics ? "▼" : "▶"}
            </button>
            {expandedTopics && (
              <div className="flex flex-wrap gap-2 p-2 bg-muted/30 rounded-lg max-h-32 overflow-y-auto">
                {allTopics.slice(0, 20).map((topic) => {
                  const isSelected = selectedTopics.has(topic);
                  return (
                    <button
                      key={topic}
                      onClick={() => toggleTopic(topic)}
                      className={`px-2.5 py-1 text-xs rounded-full font-medium transition ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {topic}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

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

        {/* Topic list */}
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
            <Tag className="size-4" />
            Tutti i Topic ({aggregated.topicArray.length})
          </h3>
          {aggregated.topicArray.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {aggregated.topicArray.map((topic, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground truncate">{topic.topic}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-32 bg-gradient-to-r from-primary/20 to-primary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${(topic.count / Math.max(...aggregated.topicArray.map((t) => t.count), 1)) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-foreground w-6 text-right">{topic.count}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nessun topic nel filtro selezionato
            </p>
          )}
        </div>

        {/* Location distribution */}
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
            <MapPin className="size-4" />
            Location Distribution ({aggregated.locationArray.length})
          </h3>
          {aggregated.locationArray.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {aggregated.locationArray.map((loc, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground truncate">{loc.location}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-32 bg-gradient-to-r from-primary/20 to-primary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${(loc.count / Math.max(...aggregated.locationArray.map((l) => l.count), 1)) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs font-medium text-foreground w-6 text-right">{loc.count}</span>
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
