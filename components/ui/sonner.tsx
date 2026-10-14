"use client"

import { useTheme } from "@/hooks/use-theme"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-positive" />,
        info: <InfoIcon className="size-4 text-foreground" />,
        warning: <TriangleAlertIcon className="size-4 text-warning-fg" />,
        error: <OctagonXIcon className="size-4 text-critical-fg" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-overlay !font-sans",
          title: "!text-body-3 !font-semibold",
          description: "!text-caption-1 !text-faded",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
