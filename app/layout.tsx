import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "TCFme C2 Pro · Votre français, sans limites",
  description:
    "Préparation exigeante au TCF Canada. Simulations, exercices C2 et progression. Plateforme indépendante de FEI.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
