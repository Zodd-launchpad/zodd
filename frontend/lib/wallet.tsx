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
  importWallet: (words: string[]) => Promise<void>;
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

  // Logging back in with the 12 words shown at creation time: the backend
  // just re-finds the same wallet (see /api/wallets/import), it doesn't
  // hand back a fresh one, so this is the way back in after a logout --
  // previously logout() was a dead end that only offered creating a new
  // (empty) wallet, with no way back to the tokens in the old one.
  async function importWallet(words: string[]) {
    const data = await api.importWallet(words);
    const walletData: WalletData = { ...data, words };
    setWallet(walletData);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
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

  return <Ctx.Provider value={{ wallet, loading, createWallet, importWallet, logout }}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet debe usarse dentro de WalletProvider");
  return ctx;
}
