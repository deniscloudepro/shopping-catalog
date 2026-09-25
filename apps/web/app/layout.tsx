import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Мой каталог",
  description: "Каталог личных покупок и вещей",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
