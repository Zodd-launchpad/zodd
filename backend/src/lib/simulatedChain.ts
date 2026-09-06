/**
 * Purely cosmetic, clearly-labeled SIMULATION of the "inscribed as a shielded
 * memo on Zcash mainnet" proof that a real deployment would show. Nothing
 * here touches a real chain or a real explorer — it exists so the demo UI
 * can show what that section will look like once real ZEC integration
 * replaces zcashMock.ts. Never present this as a real transaction.
 */
import { createHash } from "node:crypto";

// A recent-looking Zcash mainnet block height, just for cosmetic realism.
const BASE_BLOCK = 3_470_000;

function fakeTxid(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function fakeBlock(seed: string, spread: number): number {
  const n = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return BASE_BLOCK + (n % spread);
}

export interface SimulatedInscription {
  simulated: true;
  issuedTxid: string;
  issuedBlock: number;
  finalizedTxid: string;
  finalizedBlock: number;
}

/** Deterministic per token, so it stays stable across requests without needing to persist it. */
export function simulatedInscriptionFor(tokenId: string): SimulatedInscription {
  const issuedBlock = fakeBlock(`${tokenId}:issued`, 50_000);
  return {
    simulated: true,
    issuedTxid: fakeTxid(`${tokenId}:issued`),
    issuedBlock,
    finalizedTxid: fakeTxid(`${tokenId}:finalized`),
    finalizedBlock: issuedBlock + 3 + (parseInt(fakeTxid(`${tokenId}:gap`).slice(0, 2), 16) % 8),
  };
}
