import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { DailySentimentPoint } from "@/lib/brandReputation";

// trendzn non definisce --chart-N: riusiamo i token del tema esistente
// (vedi src/styles.css), coerenti col resto della UI shadcn del repo.
const chartConfig = {
  positive: { label: "Positivo", color: "var(--primary)" },
  neutral: { label: "Neutro", color: "var(--muted-foreground)" },
  negative: { label: "Negativo", color: "var(--destructive)" },
} satisfies ChartConfig;

export function SentimentTrendChart({ data }: { data: DailySentimentPoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <AreaChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: string) => value.slice(5)}
          minTickGap={24}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area dataKey="positive" type="monotone" stackId="a" fill="var(--color-positive)" stroke="var(--color-positive)" fillOpacity={0.4} />
        <Area dataKey="neutral" type="monotone" stackId="a" fill="var(--color-neutral)" stroke="var(--color-neutral)" fillOpacity={0.4} />
        <Area dataKey="negative" type="monotone" stackId="a" fill="var(--color-negative)" stroke="var(--color-negative)" fillOpacity={0.4} />
      </AreaChart>
    </ChartContainer>
  );
}
