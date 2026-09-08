import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { LanguageProvider } from "@/lib/i18n";
import { ZecPriceProvider } from "@/lib/zecPrice";
import DemoBanner from "./DemoBanner";
import TickerBar from "./TickerBar";
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
            <WalletProvider>
              <DemoBanner />
              <TickerBar />
              <HeaderBar />
              {/* Brai, 2026-09-08: "el live activity que este siempre
                  presente, en todas las... [paginas]" / "cuando estas en
                  un token que tambien este" -- site-wide now, not just the
                  home page. */}
              <ActivityFeed />
              {children}
              <DisclaimerBanner />
            </WalletProvider>
          </ZecPriceProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
