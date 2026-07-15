import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./admin.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spartan — Construction Operations",
  description: "Projects, crews, schedules, time, punch work, and labor reporting in one field-ready workspace.",
  openGraph: {
    title: "Spartan — Construction Operations",
    description: "Construction operations. Under control.",
    type: "website",
    images: [{ url: "/og.png", width: 1743, height: 877, alt: "Spartan construction operations platform" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Spartan — Construction Operations",
    description: "Construction operations. Under control.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
