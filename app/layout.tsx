import type { Metadata } from "next";
import "./globals.css";
import { AppConfigProvider } from "@/app/contexts/AppConfigContext";
import { DialogProvider } from "@/app/contexts/DialogContext"; // <--- 1. IMPORTAR

// app/layout.tsx

export const metadata: Metadata = {
  title: "NFSe Goo",
  description: "Seu SaaS moderno para notas fiscais",
  icons: {
    // Aqui você aponta para o caminho dentro da pasta public
    // Note que não precisa escrever "public", o Next já entende
    icon: "/icons/favicon.ico", // ou .png / .svg, dependendo da sua extensão
    shortcut: "/icons/favicon.ico",
    apple: "/icons/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>
        <AppConfigProvider>
          {/* 2. ENVOLVER A APLICAÇÃO */}
          <DialogProvider>
            {children}
          </DialogProvider>
        </AppConfigProvider>
      </body>
    </html>
  );
}
