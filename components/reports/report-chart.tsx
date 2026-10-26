"use client"

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { supplier } from "@/lib/reference"
import { chartRows, formatValue, isTimeDimension, measureInfo, type ReportResult } from "@/lib/reports"
import type { ReportMeasure } from "@/lib/types"

const SINGLE = "var(--brand-strong)"

/** Weeks and months read as a trend left to right; everything else ranks as horizontal bars. */
export function ReportChart({ result, measure }: { result: ReportResult; measure: ReportMeasure }) {
  const info = measureInfo(measure)
  const rows = chartRows(result, measure)
  const time = isTimeDimension(result.spec.groupBy)
  const series = result.series.length ? result.series : [{ key: "value", label: info.label, color: SINGLE }]
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig
  const stacked = info.additive && result.series.length > 0
  const pct = info.kind === "pct"
  const tick = (v: number) => formatValue(measure, v, true)
  const short = (label: string) => {
    const bare = label.replace(", so far", "")
    return result.spec.groupBy === "week" ? bare.replace("Week of ", "") : result.spec.groupBy === "month" ? bare.replace(/ (\d{4})$/, "") : bare
  }

  const tooltip = (
    <ChartTooltip
      cursor={time && !info.additive ? undefined : { fill: "var(--hover)", radius: 6 }}
      content={
        <ChartTooltipContent
          labelFormatter={(label) => String(label)}
          formatter={(value, name, item) => (
            <div className="flex w-full items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-faded">
                <span
                  className="size-2 rounded-[3px]"
                  style={{ background: result.spec.groupBy === "agency" && !result.series.length ? supplier(String(item?.payload?.key)).color : config[String(name)]?.color }}
                />
                {config[String(name)]?.label}
              </span>
              <span className="font-semibold tabular">{formatValue(measure, value === null ? null : Number(value))}</span>
            </div>
          )}
        />
      }
    />
  )

  if (time && !info.additive)
    return (
      <ChartContainer config={config} className="w-full" style={{ height: 260 }}>
        <LineChart data={rows} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} tickFormatter={short} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={tick} fontSize={12} domain={pct ? [0, "auto"] : ["auto", "auto"]} />
          {tooltip}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 2.5, fill: "var(--card)", strokeWidth: 1.75 }} activeDot={{ r: 4 }} connectNulls animationDuration={350} />
          ))}
        </LineChart>
      </ChartContainer>
    )

  if (time)
    return (
      <ChartContainer config={config} className="w-full" style={{ height: 260 }}>
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} tickFormatter={short} fontSize={12} />
          <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={tick} fontSize={12} />
          {tooltip}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={stacked ? "total" : undefined}
              fill={s.color}
              radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={48}
              animationDuration={350}
            />
          ))}
        </BarChart>
      </ChartContainer>
    )

  const byAgency = result.spec.groupBy === "agency" && !result.series.length
  const longest = Math.max(...rows.map((r) => r.label.length), 4)
  const height = Math.max(200, rows.length * (series.length > 1 && !stacked ? 18 * series.length + 14 : 34) + 40)
  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="20%">
        <CartesianGrid horizontal={false} stroke="var(--grid)" />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={tick} fontSize={12} domain={pct ? [0, 1] : [0, "auto"]} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={Math.min(220, Math.max(80, longest * 6.8))} fontSize={12} />
        {tooltip}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={stacked ? "total" : undefined}
            fill={s.color}
            radius={!stacked || i === series.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
            maxBarSize={26}
            animationDuration={350}
          >
            {byAgency && rows.map((r) => <Cell key={r.key} fill={supplier(r.key).color} />)}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  )
}
