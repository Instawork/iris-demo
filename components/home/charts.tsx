"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { moneyCompact, money } from "@/lib/format"
import type { FillPoint, SpendPoint } from "@/lib/metrics"
import { SUPPLIERS, supplier } from "@/lib/reference"

const supplierConfig = Object.fromEntries(SUPPLIERS.map((s) => [s.id, { label: s.shortName, color: s.color }])) satisfies ChartConfig

export function SpendChart({ data, height = 240 }: { data: SpendPoint[]; height?: number }) {
  const active = SUPPLIERS.filter((s) => data.some((d) => (d[s.id] as number) > 0))
  return (
    <ChartContainer config={supplierConfig} className="w-full" style={{ height }}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={10} tickFormatter={(v) => `Wk of ${v}`} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => moneyCompact(Number(v))} fontSize={12} />
        <ChartTooltip
          cursor={{ fill: "var(--hover)", radius: 6 }}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => `Week of ${label}`}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-faded">
                    <span className="size-2 rounded-[3px]" style={{ background: supplier(String(name)).color }} />
                    {supplier(String(name)).shortName}
                  </span>
                  <span className="font-semibold tabular">{money(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        {active.map((s, i) => (
          <Bar
            key={s.id}
            dataKey={s.id}
            stackId="spend"
            fill={`var(--color-${s.id})`}
            radius={i === active.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            animationDuration={350}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
export function MixDonut({
  slices,
  centerLabel,
  centerValue,
  height = 200,
}: {
  slices: { id: string; label: string; value: number; color: string }[]
  centerLabel: string
  centerValue: string
  height?: number
}) {
  const config = Object.fromEntries(slices.map((s) => [s.id, { label: s.label, color: s.color }])) satisfies ChartConfig
  return (
    <ChartContainer config={config} className="mx-auto aspect-square w-full" style={{ height }}>
      <PieChart>
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-faded">{slices.find((s) => s.id === name)?.label}</span>
                  <span className="font-semibold tabular">{money(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <Pie data={slices} dataKey="value" nameKey="id" innerRadius="66%" outerRadius="92%" paddingAngle={1.5} strokeWidth={0} animationDuration={350}>
          {slices.map((s) => (
            <Cell key={s.id} fill={s.color} />
          ))}
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox)) return null
              return (
                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                  <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 6} className="fill-foreground text-[17px] font-semibold tracking-[-0.03em]">
                    {centerValue}
                  </tspan>
                  <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 14} className="fill-faded text-[11px]">
                    {centerLabel}
                  </tspan>
                </text>
              )
            }}
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  )
}

export function FillTrendChart({ data, height = 220, color = "var(--foreground)" }: { data: FillPoint[]; height?: number; color?: string }) {
  const config = { fillRate: { label: "Fill rate", color }, noShowRate: { label: "No-show rate", color: "var(--critical)" } } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-trend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={10} tickFormatter={(v) => `Wk of ${v}`} fontSize={12} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} fontSize={12} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => `Week of ${label}`}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-faded">{name === "fillRate" ? "Fill rate" : "No-show rate"}</span>
                  <span className="font-semibold tabular">{Number(value).toFixed(1)}%</span>
                </div>
              )}
            />
          }
        />
        <Area type="monotone" dataKey="fillRate" stroke={color} strokeWidth={2} fill="url(#fill-trend)" animationDuration={400} dot={{ r: 2.5, fill: "var(--card)", strokeWidth: 1.75 }} activeDot={{ r: 4 }} />
        <Area type="monotone" dataKey="noShowRate" stroke="var(--critical)" strokeWidth={1.5} strokeDasharray="4 4" fill="transparent" animationDuration={400} dot={false} />
      </AreaChart>
    </ChartContainer>
  )
}

export function MiniBars({ values, color = "var(--foreground)" }: { values: number[]; color?: string }) {
  const max = Math.max(1, ...values)
  return (
    <span className="flex h-8 items-end gap-1">
      {values.map((v, i) => (
        <span key={i} className="w-1.5 rounded-[2px] transition-[height] duration-200" style={{ height: `${Math.max(12, (v / max) * 100)}%`, background: color, opacity: 0.25 + (i / values.length) * 0.75 }} />
      ))}
    </span>
  )
}
