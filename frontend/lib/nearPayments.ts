/**
 * Client-side helpers for actually SENDING the NEAR-launch $8 fee on the
 * EVM/Solana payment methods (Brai, 2026-09-30: "tiene que ser multiwallet,
 * soportar evm como pago ... y tambien usdc de solana"). ZEC has no
 * equivalent here -- it stays the existing scan-a-QR/wallet-of-your-choice
 * flow (see the launchpad's buy/sell modals), since zcashReal.ts detects
 * it automatically. These, by contrast, need the creator's EVM/Solana
 * wallet extension to actually construct and send a transaction, which is
 * new to this codebase.
 *
 * No ethers/web3 library for the EVM side on purpose -- window.ethereum's
 * raw JSON-RPC methods (eth_sendTransaction, wallet_switchEthereumChain)
 * are all that's needed, and connectEvm() in wallet.tsx already
 * hand-rolls the equivalent for signing (personal_sign) rather than
 * pulling in a library for one call. Solana genuinely needs
 * @solana/web3.js + @solana/spl-token: constructing a valid SPL-token
 * transfer instruction (and its associated-token-account bookkeeping) by
 * hand isn't a reasonable thing to hand-roll the way a single ERC-20
 * transfer's calldata is.
 */
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction, getAccount } from "@solana/spl-token";
import type { NearLaunchEvmChainConfig } from "./api";

function toHexQuantity(baseUnits: string): string {
  return "0x" + BigInt(baseUnits).toString(16);
}

function padHex32Bytes(hex: string): string {
  return hex.replace(/^0x/i, "").padStart(64, "0");
}

/** ERC-20 `transfer(address,uint256)` calldata, built by hand (function
 * selector = first 4 bytes of keccak256("transfer(address,uint256)"),
 * which is the well-known, unchanging 0xa9059cbb -- same value every ERC-20
 * in existence uses, not something specific to USDC/USDG). */
function erc20TransferCalldata(toAddress: string, amountBaseUnits: string): string {
  const selector = "a9059cbb";
  const addr = padHex32Bytes(toAddress);
  const amt = padHex32Bytes(BigInt(amountBaseUnits).toString(16));
  return `0x${selector}${addr}${amt}`;
}

/** Switches the connected wallet to `cfg`'s chain, adding it first if the
 * wallet doesn't know it yet (error code 4902 -- standard EIP-3085/3326
 * behavior). Robinhood Chain especially needs this: it's 2 months old at
 * time of writing, so most wallets don't have it pre-configured the way
 * they do Base. */
async function ensureEvmChain(cfg: NearLaunchEvmChainConfig): Promise<any> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("evm-not-installed");
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: cfg.chainIdHex }] });
  } catch (err: any) {
    if (err?.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: cfg.chainIdHex,
            chainName: cfg.chainName,
            rpcUrls: [cfg.rpcUrl],
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            blockExplorerUrls: [cfg.explorerBaseUrl],
          },
        ],
      });
    } else {
      throw err;
    }
  }
  return eth;
}

/** Sends native ETH on `cfg`'s chain. Returns the tx hash to hand to
 * api.submitNearLaunchPaymentProof. Throws Error("evm-not-installed") if
 * no window.ethereum, same convention as connectEvm() in wallet.tsx. */
export async function payEvmNative(cfg: NearLaunchEvmChainConfig, toAddress: string, amountBaseUnits: string): Promise<string> {
  const eth = await ensureEvmChain(cfg);
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const from = accounts?.[0];
  if (!from) throw new Error("evm-not-installed");
  return eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: toAddress, value: toHexQuantity(amountBaseUnits) }],
  });
}

/** Sends the chain's stablecoin (USDC on Base, USDG on Robinhood Chain --
 * cfg.stablecoinAddress already points at the right one, see
 * evmPayments.ts on the backend). Same return/throw contract as
 * payEvmNative above. */
export async function payEvmStablecoin(cfg: NearLaunchEvmChainConfig, toAddress: string, amountBaseUnits: string): Promise<string> {
  const eth = await ensureEvmChain(cfg);
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  const from = accounts?.[0];
  if (!from) throw new Error("evm-not-installed");
  return eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: cfg.stablecoinAddress, data: erc20TransferCalldata(toAddress, amountBaseUnits) }],
  });
}

/** Sends USDC on Solana via Phantom (window.solana -- the de facto
 * standard injected provider other Solana wallets also expose, same
 * "one flow covers every wallet that injects the standard interface"
 * reasoning as connectEvm() in wallet.tsx for window.ethereum). Creates
 * the recipient's associated token account first if it doesn't exist yet
 * (a brand-new treasury address won't have one) -- the creator's own
 * transaction pays for that, same as any first-ever SPL transfer to a
 * new holder. Returns the transaction signature. Throws
 * Error("solana-not-installed") if no Phantom-compatible provider. */
export async function paySolanaUsdc(mintAddress: string, toOwnerAddress: string, amountBaseUnits: string, rpcUrl: string): Promise<string> {
  const provider = (window as any).solana;
  if (!provider) throw new Error("solana-not-installed");

  const resp = await provider.connect();
  const fromPubkey: PublicKey | undefined = resp?.publicKey ?? provider.publicKey;
  if (!fromPubkey) throw new Error("solana-not-installed");

  const connection = new Connection(rpcUrl, "confirmed");
  const mint = new PublicKey(mintAddress);
  const toOwner = new PublicKey(toOwnerAddress);

  const fromAta = await getAssociatedTokenAddress(mint, fromPubkey);
  const toAta = await getAssociatedTokenAddress(mint, toOwner);

  const tx = new Transaction();
  try {
    await getAccount(connection, toAta);
  } catch {
    tx.add(createAssociatedTokenAccountInstruction(fromPubkey, toAta, toOwner, mint));
  }
  tx.add(createTransferInstruction(fromAta, toAta, fromPubkey, BigInt(amountBaseUnits)));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = fromPubkey;

  const { signature } = await provider.signAndSendTransaction(tx);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}
