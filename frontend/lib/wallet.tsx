"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";

interface WalletData {
  walletId: string;
  walletTag: string;
  words: string[];
}

interface WalletCtx {
  wallet: WalletData | null;
  loading: boolean;
  createWallet: () => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);

const STORAGE_KEY = "zodd-wallet";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setWallet(JSON.parse(raw));
    } catch {
      // localStorage puede fallar (ventana privada, etc.) — arrancamos sin wallet.
    }
    setLoading(false);
  }, []);

  async function createWallet() {
    const data = await api.createWallet();
    setWallet(data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignorar */
    }
  }

  function logout() {
    setWallet(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignorar */
    }
  }

  return <Ctx.Provider value={{ wallet, loading, createWallet, logout }}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet debe usarse dentro de WalletProvider");
  return ctx;
}
