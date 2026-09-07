import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { LanguageProvider } from "@/lib/i18n";
import { ZecPriceProvider } from "@/lib/zecPrice";
import DemoBanner from "./DemoBanner";
import TickerBar from "./TickerBar";
import HeaderBar from "./HeaderBar";
import DisclaimerBanner from "./DisclaimerBanner";

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
              {children}
              <DisclaimerBanner />
            </WalletProvider>
          </ZecPriceProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
