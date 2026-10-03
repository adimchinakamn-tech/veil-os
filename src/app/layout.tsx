import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Veil — Full-Screen Web Viewer",
  description:
    "Browse any site in a distraction-free, full-screen view. Pages load server-side, history stays local, nothing calls out from your browser.",
  keywords: ["Veil", "full-screen browser", "web viewer", "privacy"],
  authors: [{ name: "Veil" }],
  /* favicon: the local Veil mark (src/app/icon.svg + apple-icon.png) —
     Next picks these up by file convention, so the tab shows Veil's
     shield, not the platform's default logo. */
  openGraph: {
    title: "Veil — Full-Screen Web Viewer",
    description: "The whole web, through the veil.",
    siteName: "Veil",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        {/* Sonner toasts — Veil Chat (and other dynamic imports) fire these
            via `import("sonner").toast(...)`. Without this mount every one
            of them was invisible: coin gifts, purchases and profile updates
            completed silently and looked "broken". */}
        <SonnerToaster
          position="bottom-right"
          theme="dark"
          richColors
          closeButton
          toastOptions={{ duration: 4000 }}
        />
      </body>
    </html>
  );
}
