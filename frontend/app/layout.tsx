import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
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
        <WalletProvider>
          <DemoBanner />
          <HeaderBar />
          {children}
          <DisclaimerBanner />
        </WalletProvider>
      </body>
    </html>
  );
}
