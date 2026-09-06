import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { LanguageProvider } from "@/lib/i18n";
import DemoBanner from "./DemoBanner";
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
          <WalletProvider>
            <DemoBanner />
            <HeaderBar />
            {children}
            <DisclaimerBanner />
          </WalletProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
