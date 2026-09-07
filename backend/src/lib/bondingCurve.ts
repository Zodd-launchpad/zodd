/**
 * Constant-product bonding curve, same model as pump.fun/SHLD.fun:
 * a virtual curve (so the price starts low instead of at zero) plus a real
 * ZEC reserve that actually gets held.
 *
 * k = virtualZec * virtualTokens stays constant on every buy/sell.
 * Buying ZEC pushes virtualZec up and virtualTokens down (price goes up);
 * selling is the reverse.
 */

export interface CurveConfig {
  /** Initial "virtual" ZEC, anchors the starting price. Not real money. */
  virtualZecReserves: number;
  /** Initial "virtual" tokens available on the curve. */
  virtualTokenReserves: number;
  /** Real ZEC accumulated on the curve before graduating to a real pool. */
  graduationZecThreshold: number;
}

export const DEFAULT_CURVE_CONFIG: CurveConfig = {
  // Same conceptual order of magnitude as pump.fun (30 virtual SOL / 1.073B tokens),
  // but in ZEC. Adjustable per token if a custom curve is ever needed.
  virtualZecReserves: 3,
  virtualTokenReserves: 1_073_000_000,
  graduationZecThreshold: 21,
};

export interface CurveState {
  /** Real ZEC received and held in this token's reserve. */
  realZecReserves: number;
  /** Tokens already sold off the curve (outside the virtual reserve). */
  tokensSold: number;
}

export function currentPrice(state: CurveState, cfg: CurveConfig = DEFAULT_CURVE_CONFIG): number {
  const zec = cfg.virtualZecReserves + state.realZecReserves;
  const tokens = cfg.virtualTokenReserves - state.tokensSold;
  if (tokens <= 0) throw new Error("curve exhausted");
  return zec / tokens; // marginal price in ZEC per token
}

export function marketCapZec(state: CurveState, totalSupply: number, cfg: CurveConfig = DEFAULT_CURVE_CONFIG): number {
  return currentPrice(state, cfg) * totalSupply;
}

export interface BuyResult {
  tokensOut: number;
  newState: CurveState;
  executionPrice: number; // ZEC per token, average for this buy
}

/** How many tokens come out for putting `zecIn` of real money into the curve. */
export function quoteBuy(state: CurveState, zecIn: number, cfg: CurveConfig = DEFAULT_CURVE_CONFIG): BuyResult {
  if (zecIn <= 0) throw new Error("zecIn must be > 0");

  const zecBefore = cfg.virtualZecReserves + state.realZecReserves;
  const tokensBefore = cfg.virtualTokenReserves - state.tokensSold;
  const k = zecBefore * tokensBefore;

  const zecAfter = zecBefore + zecIn;
  const tokensAfter = k / zecAfter;
  const tokensOut = tokensBefore - tokensAfter;

  if (tokensOut <= 0 || tokensOut > tokensBefore) {
    throw new Error("invalid buy: exceeds available curve supply");
  }

  const newState: CurveState = {
    realZecReserves: state.realZecReserves + zecIn,
    tokensSold: state.tokensSold + tokensOut,
  };

  return { tokensOut, newState, executionPrice: zecIn / tokensOut };
}

export interface SellResult {
  zecOut: number;
  newState: CurveState;
  executionPrice: number;
}

/** How much real ZEC comes out for selling `tokensIn` back into the curve. */
export function quoteSell(state: CurveState, tokensIn: number, cfg: CurveConfig = DEFAULT_CURVE_CONFIG): SellResult {
  if (tokensIn <= 0) throw new Error("tokensIn must be > 0");
  if (tokensIn > state.tokensSold) throw new Error("cannot sell more than the curve has issued");

  const zecBefore = cfg.virtualZecReserves + state.realZecReserves;
  const tokensBefore = cfg.virtualTokenReserves - state.tokensSold;
  const k = zecBefore * tokensBefore;

  const tokensAfter = tokensBefore + tokensIn;
  const zecAfter = k / tokensAfter;
  let zecOut = zecBefore - zecAfter;

  // store.ts persists tokensSold/balances as whole tokens (BigInt(Math.round(...))
  // -- see updateTokenCurve/creditBalance) while realZecReserves stays an exact
  // float. That rounding is one-directional (up, on average), so selling back
  // the FULL rounded balance a curve issued can legitimately compute a zecOut
  // a hair above realZecReserves -- found 2026-09-07 on a real full-supply sell:
  // 350,399 tokens (rounded up from 350,398.8697) priced out to 0.00098000036
  // ZEC against a real reserve of exactly 0.00098. That's rounding noise, not
  // an actual shortfall, so it's clamped rather than rejected. The max this
  // can ever be off by is ~half a token's worth of ZEC at the current
  // marginal price -- nowhere near enough to let a sell drain more than what
  // the curve actually holds.
  const ROUNDING_EPSILON_ZEC = 1e-6;
  if (zecOut > state.realZecReserves && zecOut - state.realZecReserves <= ROUNDING_EPSILON_ZEC) {
    zecOut = state.realZecReserves;
  }

  if (zecOut <= 0 || zecOut > state.realZecReserves) {
    throw new Error("invalid sell: exceeds the real ZEC reserve");
  }

  const newState: CurveState = {
    realZecReserves: state.realZecReserves - zecOut,
    tokensSold: state.tokensSold - tokensIn,
  };

  return { zecOut, newState, executionPrice: zecOut / tokensIn };
}

export function isGraduated(state: CurveState, cfg: CurveConfig = DEFAULT_CURVE_CONFIG): boolean {
  return state.realZecReserves >= cfg.graduationZecThreshold;
}
