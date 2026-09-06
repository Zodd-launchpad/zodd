/**
 * In-memory store for the demo (same entities as prisma/schema.prisma).
 * Resets on restart — on purpose, so it doesn't fake persistence that
 * doesn't exist. Migrating to Postgres/Prisma is mechanical: same data shapes.
 */
import { randomUUID } from "node:crypto";
import { CurveState, DEFAULT_CURVE_CONFIG } from "./bondingCurve.js";

export interface InternalWallet {
  id: string;
  walletTag: string;
  words: string[]; // Stored in plaintext ONLY in the demo, so it can be displayed; never do this with real data.
  createdAt: string;
}

export interface Token {
  id: string;
  symbol: string;
  name: string;
  totalSupply: number;
  creatorWalletId: string;
  curve: CurveState;
  createdAt: string;
}

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "PENDING" | "FILLED" | "FAILED";

export interface Order {
  id: string;
  internalWalletId: string;
  tokenId: string;
  side: OrderSide;
  status: OrderStatus;
  zecAddress?: string;
  refundAddress?: string;
  zecAmount: number;
  tokenAmount?: number;
  executionTxid?: string;
  createdAt: string;
  filledAt?: string;
}

export const wallets = new Map<string, InternalWallet>();
export const tokens = new Map<string, Token>(); // key = symbol
export const orders = new Map<string, Order>();
// balances[walletId][symbol] = amount
export const balances = new Map<string, Map<string, number>>();

export function newWalletTag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

export function getBalance(walletId: string, symbol: string): number {
  return balances.get(walletId)?.get(symbol) ?? 0;
}

export function creditBalance(walletId: string, symbol: string, amount: number) {
  if (!balances.has(walletId)) balances.set(walletId, new Map());
  const map = balances.get(walletId)!;
  map.set(symbol, (map.get(symbol) ?? 0) + amount);
}

export function debitBalance(walletId: string, symbol: string, amount: number) {
  const current = getBalance(walletId, symbol);
  if (current < amount) throw new Error("insufficient balance");
  balances.get(walletId)!.set(symbol, current - amount);
}

export function freshCurveState(): CurveState {
  return { realZecReserves: 0, tokensSold: 0 };
}

export { DEFAULT_CURVE_CONFIG };
