import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { LanguageProvider } from "@/lib/i18n";
import { ZecPriceProvider } from "@/lib/zecPrice";
import { TokenListProvider } from "@/lib/tokenList";
import DemoBanner from "./DemoBanner";
import HeaderBar from "./HeaderBar";
import DisclaimerBanner from "./DisclaimerBanner";
import ActivityFeed from "./ActivityFeed";

export const metadata = {
  title: "ZODD — Zodl community mascot (experimental demo)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>
          <ZecPriceProvider>
            <TokenListProvider>
              <WalletProvider>
                {/* ZODD (2026-09-26, "OPERATIVO GASTO CERO"): Brai: "la barra
                    de arriba con los tokens que subio o bajo, lo borres
                    totalmente" -- TickerBar removed site-wide. Component
                    file (TickerBar.tsx) left in place, just unmounted, in
                    case this gets turned back on later. */}
                <DemoBanner />
                <HeaderBar />
                {/* Brai, 2026-09-08: "el live activity que este siempre
                    presente, en todas las... [paginas]" / "cuando estas en
                    un token que tambien este" -- site-wide now, not just the
                    home page. */}
                <ActivityFeed />
                {children}
                <DisclaimerBanner />
              </WalletProvider>
            </TokenListProvider>
          </ZecPriceProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
