"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";
import { getNoirWallet, isNoirWalletInstalled } from "@noir-wallet/sdk";

interface WalletData {
  walletId: string;
  walletTag: string;
  // Vacio para una wallet conectada por Noir (ver noirAddress abajo) -- esa
  // wallet no tiene frase de 12 palabras, nada para mostrar/exportar aca.
  words: string[];
  // Presente solo si esta wallet se conecto via la extension Noir en vez
  // de crearse/importarse con 12 palabras (Brai, 2026-09-18). El frontend
  // lo usa para: (a) ocultar la UI de "tus 12 palabras" para esta wallet,
  // y (b) saber que puede ofrecer "pagar con Noir" en vez de (o ademas de)
  // escanear el QR en los modales de compra/mint.
  noirAddress?: string;
}

interface WalletCtx {
  wallet: WalletData | null;
  loading: boolean;
  createWallet: () => Promise<void>;
  importWallet: (words: string[]) => Promise<void>;
  // Devuelve null si el usuario canceló la aprobación en la extensión
  // (no es un error real, solo "no eligió conectar todavía").
  connectNoir: () => Promise<void>;
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

  // Brai, 2026-09-18: "conectas la extension de la wallet NOIR para
  // navegador y ya te asocia tu wallet". Sign-in-with-wallet: pedimos un
  // challenge de un solo uso al backend, le pedimos a la extension que lo
  // firme (prueba que el usuario controla esa direccion sin que nosotros
  // veamos ninguna clave privada), y mandamos esa firma de vuelta para que
  // el backend nos de la InternalWallet que corresponde (existente o
  // nueva). No genera ni guarda ningun seed phrase.
  async function connectNoir() {
    if (!isNoirWalletInstalled()) {
      throw new Error("noir-not-installed");
    }
    const noirWallet = getNoirWallet();
    if (!noirWallet) throw new Error("noir-not-installed");
    const zcash = noirWallet.zcash;

    const connection = await zcash.connect(); // popup de aprobacion
    const { nonce, message } = await api.getNoirChallenge();
    // signingMode "current" (default): firma con la clave de la direccion
    // transparente principal -- es la que verificamos server-side.
    const signed = await zcash.signMessage(message);

    const data = await api.connectNoir({
      nonce,
      signature: signed.signature,
      pubkey: signed.pubkey,
      transparentAddress: signed.address,
      shieldedAddress: connection.shielded,
    });
    const walletData: WalletData = { walletId: data.walletId, walletTag: data.walletTag, words: [], noirAddress: data.noirAddress };
    setWallet(walletData);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
    } catch {
      /* ignorar */
    }
  }

  return (
    <Ctx.Provider value={{ wallet, loading, createWallet, importWallet, connectNoir, logout }}>{children}</Ctx.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet debe usarse dentro de WalletProvider");
  return ctx;
}
