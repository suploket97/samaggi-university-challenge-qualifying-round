import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter, Noto_Sans_Thai, Outfit, Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Headers and titles only.
const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-bebas", display: "swap" });
// Scores, timers and other numbers.
const stm = Share_Tech_Mono({ weight: "400", subsets: ["latin"], variable: "--font-stm", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
// Thai questions and answers: a modern loopless sans-serif. Only downloaded when Thai text appears.
const thai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-thai", display: "swap" });

export const metadata: Metadata = {
  title: "Samaggi University Challenge – Qualifying Round",
  description: "Samaggi University Challenge qualifying round: live quiz with projector stage, host console and phone controllers.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} ${thai.variable} ${bebas.variable} ${stm.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
