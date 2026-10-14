import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";

import "./globals.css";
import { Providers } from "@/components/providers";
import { themeInitScript } from "@/lib/theme";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  applicationName: "CrUber",
  title: {
    default: "CrUber · Staffing, from every supplier, in one place",
    template: "%s · CrUber",
  },
  description: "Book, approve and pay every staffing supplier from one place.",
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: "CrUber · Staffing, from every supplier, in one place",
    description: "Book, approve and pay every staffing supplier from one place.",
    siteName: "CrUber",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "CrUber · Staffing, from every supplier, in one place",
    description: "Book, approve and pay every staffing supplier from one place.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#2c2a27" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head>
        <Script id="cruber-theme" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body className="h-full overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
