import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Clínica Turnos" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="min-h-screen bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
