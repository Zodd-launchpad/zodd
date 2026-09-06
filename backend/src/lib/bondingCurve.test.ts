import assert from "node:assert/strict";
import {
  DEFAULT_CURVE_CONFIG,
  currentPrice,
  quoteBuy,
  quoteSell,
  isGraduated,
  type CurveState,
} from "./bondingCurve.js";

let state: CurveState = { realZecReserves: 0, tokensSold: 0 };

// 1. Starting price matches the virtual reserve
const p0 = currentPrice(state);
assert.equal(p0, DEFAULT_CURVE_CONFIG.virtualZecReserves / DEFAULT_CURVE_CONFIG.virtualTokenReserves);

// 2. Buying raises the price (constant-product curve)
const buy1 = quoteBuy(state, 0.01);
assert.ok(buy1.tokensOut > 0, "must deliver tokens");
state = buy1.newState;
const p1 = currentPrice(state);
assert.ok(p1 > p0, `price must rise after a buy (${p0} -> ${p1})`);

// 3. Sanity check against the numbers shown in the screenshot (0.01 ZEC -> ~362,500 tokens early on)
console.log(`Buy of 0.01 ZEC -> ${buy1.tokensOut.toFixed(0)} tokens (execution price ${buy1.executionPrice})`);

// 4. Selling everything back should return ~the same money (minus float rounding)
const sell1 = quoteSell(state, buy1.tokensOut);
assert.ok(Math.abs(sell1.zecOut - 0.01) < 1e-9, "buying then selling the same amount with no one else trading should be ~neutral");
state = sell1.newState;
assert.ok(Math.abs(state.realZecReserves) < 1e-9, "real reserve should return to ~0");
assert.ok(Math.abs(state.tokensSold) < 1e-6, "tokens sold should return to ~0");

// 5. Can't sell more than the curve has issued
assert.throws(() => quoteSell(state, 1));

// 6. Graduation
let bigState: CurveState = { realZecReserves: 0, tokensSold: 0 };
bigState = quoteBuy(bigState, 25).newState;
assert.ok(isGraduated(bigState), "25 real ZEC should graduate with the default 21 threshold");

console.log("bondingCurve: all tests passed");
