"use client";
// Elysium (chain 99901, gas en HYPE) -- trading y lanzamiento de tokens
// usando el RPC de BOXA (Brai, 2026-10-31: "lanzamos como si fuera mainnet
// con el rpc de boxa").
//
// Como funciona una transaccion en Elysium hoy (modo "queued-inbox" del RPC
// de BOXA):
//   1. La wallet firma la tx de Elysium y la manda a rpc.boxa.club, que la
//      guarda en cola (no se ejecuta todavia).
//   2. Pedimos a BOXA el mensaje listo para el Inbox (0x04 + tx firmada).
//   3. La wallet cambia a HyperEVM (999) y llama Inbox.sendL2Message(msg),
//      pagando el gas en HYPE de HyperEVM. Eso es lo que la mete en la cadena.
//   4. Avisamos a BOXA el hash de HyperEVM (boxa_recordParentTransaction) y
//      esperamos a que Elysium la incluya.
// Todo lo de abajo fue verificado contra el RPC (simulaciones de compra,
// venta, aprobacion y lanzamiento con eth_simulateV1) antes de usarlo.

import { AbiCoder, Interface, MaxUint256, ZeroAddress, getAddress, hexlify, keccak256, randomBytes, toQuantity } from "ethers";

export const ELYSIUM = {
  chainId: 99901,
  chainIdHex: "0x1863d",
  name: "Elysium",
  rpcUrl: "https://rpc.boxa.club",
  symbol: "HYPE",
} as const;

export const HYPEREVM = {
  chainId: 999,
  chainIdHex: "0x3e7",
  name: "HyperEVM",
  rpcUrl: "https://rpc.hyperliquid.xyz/evm",
  explorer: "https://hyperevmscan.io",
} as const;

export const INBOX = "0xce59f8b65ad41c9dae4c07a0571a39824bd92cff";

// Contratos BOXA v4 en Elysium (los mismos que usa boxa.club).
export const BOXA_V4 = {
  hook: getAddress("0xbcc1f22d137c1d98dfa5548e4d4261d7aee06acc"),
  launcher: getAddress("0x00d4c904f74f74c6920c95e3ee807ab3c52dd205"),
  router: getAddress("0x7d812380c241b331d753e8eef1cefdea4e539496"),
  quoter: getAddress("0x1ad2186a2734dc8715dea55967df823fd6e6fea4"),
};
export const MULTICALL3 = getAddress("0xca11bde05977b3631167028862be2a173976ca11");

// Fee de ZODD en las compras (se cobra en la misma tx, via Multicall3).
// Si no se configura NEXT_PUBLIC_ELYSIUM_FEE_RECIPIENT, no se cobra fee.
export const ZODD_FEE_RECIPIENT = (process.env.NEXT_PUBLIC_ELYSIUM_FEE_RECIPIENT || "").trim();
export const ZODD_FEE_BPS = BigInt(process.env.NEXT_PUBLIC_ELYSIUM_FEE_BPS || "100");

const MAX_L2_GAS = 2_000_000n;

const KEY = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const routerIface = new Interface([
  `function buy(${KEY} key,uint256 minTokensOut,address recipient,uint256 deadline) payable returns(uint256)`,
  `function sell(${KEY} key,uint256 amountIn,uint256 minHypeOut,address recipient,uint256 deadline) returns(uint256)`,
]);
const quoterIface = new Interface([
  `function quoteExactInputSingle((${KEY} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)`,
]);
const erc20Iface = new Interface([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
]);
const launcherIface = new Interface([
  "function launch((string name,string symbol,bytes32 salt,uint16 creatorBps,uint16 buybackBps,uint16 holdersBps,bool antiSnipe,uint24 buyFeePips,uint24 sellFeePips,uint256 minTokensOut,uint256 deadline,string metadata) params) payable returns (address token, bytes32 poolId)",
  "function predictToken(address creator, string name, string symbol, bytes32 salt) view returns (address)",
  "event Launched(address indexed token, bytes32 indexed poolId, address indexed creator, string name, string symbol, uint256 tokensInLiquidity, uint256 firstBuyTokens, uint256 firstBuyHype, uint16 creatorBps, uint16 buybackBps, uint16 holdersBps, bool antiSnipe, string metadata)",
]);
const multicallIface = new Interface([
  "function aggregate3Value((address target,bool allowFailure,uint256 value,bytes callData)[] calls) payable returns((bool success,bytes returnData)[] returnData)",
]);
const inboxIface = new Interface(["function sendL2Message(bytes messageData) returns (uint256)", "function depositEth() payable returns(uint256)"]);

// ---------- lectura (RPC de BOXA directo, tiene CORS abierto) ----------

let rpcId = 1;
export async function rpc<T = any>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(ELYSIUM.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "Elysium RPC error");
  return json.result as T;
}

export function poolKey(token: string) {
  return { currency0: ZeroAddress, currency1: getAddress(token), fee: 0, tickSpacing: 200, hooks: BOXA_V4.hook };
}

export function poolId(token: string) {
  const k = poolKey(token);
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]),
  );
}

export async function hypeBalance(addr: string): Promise<bigint> {
  return BigInt(await rpc<string>("eth_getBalance", [addr, "latest"]));
}

export async function tokenBalance(token: string, addr: string): Promise<bigint> {
  const r = await rpc<string>("eth_call", [{ to: token, data: erc20Iface.encodeFunctionData("balanceOf", [addr]) }, "latest"]);
  return BigInt(r);
}

export async function tokenAllowance(token: string, owner: string, spender: string): Promise<bigint> {
  const r = await rpc<string>("eth_call", [{ to: token, data: erc20Iface.encodeFunctionData("allowance", [owner, spender]) }, "latest"]);
  return BigInt(r);
}

export function buyFeeSplit(grossWei: bigint) {
  if (!ZODD_FEE_RECIPIENT || ZODD_FEE_BPS <= 0n) return { fee: 0n, swap: grossWei };
  const fee = (grossWei * ZODD_FEE_BPS) / 10000n;
  return { fee, swap: grossWei - fee };
}

export async function quote(token: string, side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  const exact = side === "buy" ? buyFeeSplit(amountIn).swap : amountIn;
  const data = quoterIface.encodeFunctionData("quoteExactInputSingle", [
    { poolKey: poolKey(token), zeroForOne: side === "buy", exactAmount: exact, hookData: "0x" },
  ]);
  const r = await rpc<string>("eth_call", [{ to: BOXA_V4.quoter, data }, "latest"]);
  return quoterIface.decodeFunctionResult("quoteExactInputSingle", r)[0] as bigint;
}

// ---------- armado de transacciones ----------

export type L2Tx = { to: string; data: string; value: bigint; gasFallback: bigint };

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 2 * 24 * 3600); // 48h: la cola puede tardar

export function buildBuy(token: string, account: string, grossWei: bigint, minOut: bigint): L2Tx {
  const { fee, swap } = buyFeeSplit(grossWei);
  const buyData = routerIface.encodeFunctionData("buy", [poolKey(token), minOut, getAddress(account), deadline()]);
  if (fee === 0n) return { to: BOXA_V4.router, data: buyData, value: grossWei, gasFallback: 600_000n };
  const data = multicallIface.encodeFunctionData("aggregate3Value", [
    [
      [getAddress(ZODD_FEE_RECIPIENT), false, fee, "0x"],
      [BOXA_V4.router, false, swap, buyData],
    ],
  ]);
  return { to: MULTICALL3, data, value: grossWei, gasFallback: 650_000n };
}

export function buildApprove(token: string): L2Tx {
  return { to: getAddress(token), data: erc20Iface.encodeFunctionData("approve", [BOXA_V4.router, MaxUint256]), value: 0n, gasFallback: 120_000n };
}

export function buildSell(token: string, account: string, amountIn: bigint, minOut: bigint): L2Tx {
  return {
    to: BOXA_V4.router,
    data: routerIface.encodeFunctionData("sell", [poolKey(token), amountIn, minOut, getAddress(account), deadline()]),
    value: 0n,
    gasFallback: 450_000n,
  };
}

export type LaunchInput = {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  firstBuyWei: bigint;
  taxPct: number; // 1..10, va todo al creador
  antiSnipe: boolean;
};

export function buildLaunch(input: LaunchInput) {
  const name = input.name.trim();
  const symbol = input.symbol.trim().toUpperCase();
  if (!name || name.length > 32) throw new Error("Name must be 1 to 32 characters.");
  if (!/^[A-Za-z0-9$]{1,10}$/.test(symbol)) throw new Error("Ticker must be 1 to 10 letters or numbers.");
  const pips = Math.round(input.taxPct * 10000);
  if (pips < 10000 || pips > 100000) throw new Error("Tax must be between 1% and 10%.");
  const meta = Object.fromEntries(
    Object.entries({
      description: input.description?.trim(),
      image: input.image?.trim(),
      website: input.website?.trim(),
      twitter: input.twitter?.trim(),
      telegram: input.telegram?.trim(),
      launchedFrom: "zodd.fun",
    }).filter(([, v]) => v),
  );
  const params = {
    name,
    symbol,
    salt: hexlify(randomBytes(32)),
    creatorBps: 10000,
    buybackBps: 0,
    holdersBps: 0,
    antiSnipe: input.antiSnipe,
    buyFeePips: pips,
    sellFeePips: pips,
    minTokensOut: 0n,
    deadline: deadline(),
    metadata: JSON.stringify(meta),
  };
  const tx: L2Tx = { to: BOXA_V4.launcher, data: launcherIface.encodeFunctionData("launch", [params]), value: input.firstBuyWei, gasFallback: 1_900_000n };
  return { params, tx };
}

export async function predictLaunchToken(creator: string, params: { name: string; symbol: string; salt: string }) {
  const data = launcherIface.encodeFunctionData("predictToken", [getAddress(creator), params.name, params.symbol, params.salt]);
  const r = await rpc<string>("eth_call", [{ to: BOXA_V4.launcher, data }, "latest"]);
  return getAddress(launcherIface.decodeFunctionResult("predictToken", r)[0]);
}

export type LaunchMeta = { name: string; symbol: string; creator: string; description?: string; image?: string; website?: string; twitter?: string; telegram?: string; launchedFrom?: string };

/** Lee la metadata del lanzamiento (evento Launched del launcher BOXA v4). */
export async function fetchLaunchMetadata(token: string, createdBlock?: number | null): Promise<LaunchMeta | null> {
  const ev = launcherIface.getEvent("Launched")!;
  const topics = [ev.topicHash, AbiCoder.defaultAbiCoder().encode(["address"], [getAddress(token)])];
  const head = Number(BigInt(await rpc<string>("eth_blockNumber")));
  const ranges: [number, number][] = createdBlock
    ? [[Math.max(0, createdBlock - 2), createdBlock + 2]]
    : [[Math.max(0, head - 9999), head]];
  for (const [from, to] of ranges) {
    const logs = await rpc<any[]>("eth_getLogs", [{ address: BOXA_V4.launcher, topics, fromBlock: toQuantity(from), toBlock: toQuantity(to) }]).catch(() => []);
    if (logs?.length) {
      const parsed = launcherIface.parseLog(logs[0]);
      if (!parsed) continue;
      let meta: any = {};
      try {
        meta = JSON.parse(parsed.args.metadata || "{}");
      } catch {
        meta = {};
      }
      return { ...meta, name: parsed.args.name, symbol: parsed.args.symbol, creator: parsed.args.creator };
    }
  }
  return null;
}

// ---------- wallet ----------

function eth(): any {
  const e = typeof window !== "undefined" ? (window as any).ethereum : null;
  if (!e) throw new Error("MetaMask or Rabby not found in this browser.");
  return e;
}

export async function connectWallet(): Promise<string> {
  const accounts: string[] = await eth().request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("No account connected.");
  return getAddress(accounts[0]);
}

async function ensureChain(target: "elysium" | "hyperevm") {
  const e = eth();
  const cfg =
    target === "elysium"
      ? {
          chainId: ELYSIUM.chainIdHex,
          chainName: ELYSIUM.name,
          nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
          rpcUrls: [ELYSIUM.rpcUrl],
        }
      : {
          chainId: HYPEREVM.chainIdHex,
          chainName: HYPEREVM.name,
          nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
          rpcUrls: [HYPEREVM.rpcUrl],
          blockExplorerUrls: [HYPEREVM.explorer],
        };
  const current: string = await e.request({ method: "eth_chainId" });
  if (parseInt(current, 16) === parseInt(cfg.chainId, 16)) return;
  try {
    await e.request({ method: "wallet_switchEthereumChain", params: [{ chainId: cfg.chainId }] });
  } catch (err: any) {
    if (err?.code === 4902 || /unrecognized|not added|unknown chain/i.test(err?.message || "")) {
      await e.request({ method: "wallet_addEthereumChain", params: [cfg] });
    } else {
      throw err;
    }
  }
}

export type Stage = "sign-l2" | "fetch-queue" | "sign-parent" | "queued" | "confirmed";

export type SendResult = { hash: string; parentHash: string };

async function estimateGas(from: string, tx: L2Tx): Promise<bigint> {
  try {
    const g = BigInt(await rpc<string>("eth_estimateGas", [{ from, to: tx.to, data: tx.data, value: toQuantity(tx.value) }, "pending"]));
    const padded = (g * 13n) / 10n;
    return padded > MAX_L2_GAS ? MAX_L2_GAS : padded;
  } catch {
    // Una venta despues de una aprobacion que todavia esta en cola no se
    // puede estimar (la aprobacion aun no se ejecuto) -> usamos el fallback.
    return tx.gasFallback;
  }
}

async function waitQueued(hash: string, tries = 20): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const rec = await rpc<any>("boxa_getQueuedTransaction", [hash]);
      if (rec && (rec.inboxMessage || rec.rawTransaction)) return rec;
    } catch {
      /* todavia no aparece */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(
    "Your wallet did not send the transaction to the BOXA RPC. In MetaMask/Rabby, edit the Elysium network (chain 99901), set the RPC to https://rpc.boxa.club and try again.",
  );
}

/** Firma la tx en Elysium y la envia al Inbox de HyperEVM. Dos firmas en la wallet. */
export async function sendElysium(account: string, tx: L2Tx, onStage?: (s: Stage) => void): Promise<SendResult> {
  const e = eth();
  const from = getAddress(account);
  await ensureChain("elysium");
  const gas = await estimateGas(from, tx);
  onStage?.("sign-l2");
  const hash: string = await e.request({
    method: "eth_sendTransaction",
    params: [{ from, to: tx.to, data: tx.data, value: toQuantity(tx.value), gas: toQuantity(gas) }],
  });
  onStage?.("fetch-queue");
  const rec = await waitQueued(hash);
  const message: string = rec.inboxMessage || "0x04" + String(rec.rawTransaction).slice(2);
  if (rec.parentTransactionHash) {
    onStage?.("queued");
    return { hash, parentHash: rec.parentTransactionHash };
  }
  await ensureChain("hyperevm");
  onStage?.("sign-parent");
  const parentHash: string = await e.request({
    method: "eth_sendTransaction",
    params: [{ from, to: INBOX, value: "0x0", data: inboxIface.encodeFunctionData("sendL2Message", [message]) }],
  });
  try {
    await rpc("boxa_recordParentTransaction", [hash, parentHash]);
  } catch {
    /* no bloquea: es solo para que BOXA siga el estado */
  }
  onStage?.("queued");
  // Dejamos la wallet de nuevo en Elysium para la proxima operacion.
  ensureChain("elysium").catch(() => {});
  return { hash, parentHash };
}

/** Puente HyperEVM -> Elysium: Inbox.depositEth() con HYPE de HyperEVM. Una firma. */
export async function depositToElysium(account: string, amountWei: bigint): Promise<string> {
  const e = eth();
  await ensureChain("hyperevm");
  const hash: string = await e.request({
    method: "eth_sendTransaction",
    params: [{ from: getAddress(account), to: INBOX, value: toQuantity(amountWei), data: inboxIface.encodeFunctionData("depositEth", []) }],
  });
  ensureChain("elysium").catch(() => {});
  return hash;
}

export type QueueStatus = { status: string; confirmed: boolean; failed: boolean };

export async function queueStatus(hash: string): Promise<QueueStatus> {
  try {
    const rec = await rpc<any>("boxa_getQueuedTransaction", [hash]);
    const status = String(rec?.status || "queued");
    const receiptStatus = rec?.receipt?.status;
    return {
      status,
      confirmed: status === "confirmed" && receiptStatus !== "0x0",
      failed: receiptStatus === "0x0" || status === "failed" || status === "expired" || status === "dropped",
    };
  } catch {
    const r = await rpc<any>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) return { status: r.status === "0x1" ? "confirmed" : "failed", confirmed: r.status === "0x1", failed: r.status !== "0x1" };
    return { status: "queued", confirmed: false, failed: false };
  }
}

export function friendlyError(e: any): string {
  if (e?.code === 4001 || /user rejected|denied/i.test(e?.message || "")) return "You rejected the request in your wallet.";
  return e?.shortMessage || e?.message || "Something went wrong. Please try again.";
}

// ---------- tokens (lista via /api/elysium/tokens, que hace de proxy a BOXA) ----------

export type ElysiumToken = {
  address: string;
  name: string;
  symbol: string;
  priceHype: number | null;
  marketCapHype: number | null;
  volume24hHype: number | null;
  priceChange24h: number | null;
  holders: number | null;
  createdAt: number | null;
  image: string | null;
  description: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  creator: string | null;
  createdBlock: number | null;
  tradable: boolean; // pool BOXA v4 verificado (los que podemos operar desde zodd)
  launchedFromZodd: boolean;
};

export async function listTokens(opts: { sort?: "mcap" | "newest" | "volume"; search?: string; limit?: number } = {}): Promise<ElysiumToken[]> {
  const q = new URLSearchParams({ sort: opts.sort || "mcap", search: opts.search || "", limit: String(opts.limit || 60) });
  const res = await fetch(`/api/elysium/tokens?${q}`);
  if (!res.ok) throw new Error("Could not load Elysium tokens.");
  return (await res.json()).tokens;
}

export async function getToken(address: string): Promise<ElysiumToken | null> {
  const res = await fetch(`/api/elysium/tokens?address=${address}`);
  if (!res.ok) return null;
  const j = await res.json();
  return j.tokens?.[0] ?? null;
}
