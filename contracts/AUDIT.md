# ArkhamPad contracts: review guide

ArkhamPad is a meme-coin launchpad. Coins start on a bonding curve priced in a dollar token
(USDC on Base, USDG on Robinhood Chain, USDC with 18 decimals on BNB Chain). When a curve sells
out, the coin "graduates" into a locked Uniswap v4 pool. Users never hold ETH: they sign EIP-712
messages and a relayer submits them, taking a small network fee in the dollar token.

Solidity 0.8.26, OpenZeppelin 5.1, Uniswap v4 (core + periphery). ~1,600 lines in `src/`.
Build and run everything: `forge build && forge test` (96 tests; fork tests need RPC env vars,
see `.github/workflows/contracts.yml`).

## Contracts in scope

| File | Role |
|---|---|
| `PadCoin.sol` | Fixed-supply ERC20 (1B, 18 decimals) with EIP-2612 permit. Optional creator lock. |
| `PadCurve.sol` | One per coin. Constant-product virtual curve, 1% trade fee (0.7% platform / 0.3% creator or buyback), creator launch buy, graduation trigger. Creator fees settle to the creator or buy back and burn. |
| `PadHub.sol` | Factory + registry. Creates coin + curve, holds global settings (curve params, treasury, guardian pause), `createCoinFor` callable only by the router. |
| `PadPoolBuilder.sol` | On graduation: takes the curve's dollars + reserved coins, opens a Uniswap v4 pool at the curve's last price, holds the LP position forever (locked), collects pool fees (70% platform / 30% creator or buyback), runs buybacks in steps of at most $100. |
| `PadInitGuard.sol` | v4 hook (mined address) that allows pool initialization only by the builder, so nobody can front-run the pool at a bad price. |
| `PadRouter.sol` | Gasless entry point. Verifies EIP-712 signatures (EOA or ERC-1271), one-time nonces, deadlines. Buy / sell / launch / withdraw / promote on the curve, and buy / sell in graduated coins' pools (`poolBuy`, `poolSell`, `quotePool`). Pays the relayer the signed fee. |
| `PadPromote.sol` | Paid promotion plans (6h $10, 24h $20, 7d $99, scaled to the token's decimals). |
| `PadExtSwap.sol` | Gasless trading of coins from other DEXs through an allowlisted aggregator (KyberSwap), 1% fee. |
| `interfaces.sol` | Shared interfaces. |

`TestUSDC.sol` is testnet-only (public faucet mint) and is not deployed on mainnet.

## Trust model

- **Users** sign every action; amounts, minimum outputs, fee and deadline are inside the signature.
- **Relayer** (hot wallet) only submits signed messages and pays gas. It must not be able to move
  user funds beyond what was signed, change amounts, or replay a message. It *does* choose when to
  submit (used for limit / take-profit / stop-loss orders, which are pre-signed trades).
- **Admin** (will be a Safe): treasury address, guardian, pause/unpause new buys, ExtSwap aggregator
  allowlist, promote plan prices. Sells are never pausable.
- **Guardian** (hot key): can only pause new buys.

## Where we'd most like your eyes

1. **Router signatures and replay**: `_use` (deadline, nonce, `SignatureChecker`), every typehash
   matches the encoded fields; cross-chain replay (chainId in the domain); ERC-1271 wallets.
2. **Router pool trading**: `unlockCallback` access control, exact-input swaps with price limits,
   partial-fill refunds, `quotePool` (runs the swap inside `unlock` and always reverts with the
   result; make sure no state change can survive), the router must never keep user funds.
3. **Curve math**: rounding direction on buys and sells (`_divUp`), the final fill that sells
   exactly `coinsForSale`, fees on the launch buy, graduation trigger and that no USDC/coins are
   stranded or double-counted.
4. **Graduation / pool builder**: pool price equals the curve's last price for both token orders
   and for 6 and 18-decimal dollars; LP position is unrecoverable (locked); `collectFees` and
   `buyback` cannot be used to drain the builder or manipulate the pool in a single transaction.
5. **PadExtSwap**: arbitrary call to an allowlisted aggregator with user-signed calldata (hash);
   approvals reset to zero; output measured by balance delta; unused input refunded; the contract
   must never hold funds between transactions; fee-on-transfer coins.
6. **Admin powers**: nothing the admin can do should let them take user funds or locked liquidity.
7. **Decimals**: dollar tokens with 6 (USDC, USDG) and 18 (BNB USDC) decimals; BNB USDC has no
   permit, so users approve the router once.

## Tests worth knowing

- `test/Router.t.sol`: signatures, replay, tampering, slippage, fees.
- `test/PoolLocal.t.sol` + `test/PoolFlow.sol`: full flow on a local Uniswap v4 (launch, trade,
  graduate, pool trades, buyback, guard) for USDC sorting first/last and for an 18-decimal dollar.
- `test/PoolFork.t.sol`: the same flow on forks of Base Sepolia, Base, Robinhood testnet,
  Robinhood mainnet (USDG) and BNB Chain (18-decimal USDC).
- `test/ExtSwap.t.sol`, `test/ExtSwapFork.t.sol`: other-DEX swaps (mocked and on real Base Uniswap).

Thank you! Findings can be sent as a simple list (severity, file:line, description, suggested fix).

## Round 1 findings and fixes

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `PadHub._create` refunded the hub's whole USDC balance after a launch buy, so USDC already sitting in the hub (sent by mistake) could go to the next launcher | High | **Fixed**: refund is now `balanceAfter - balanceBefore`. Test `HubRefundTest.test_launchRefundOnlyOwnLeftover` fails on the old code and passes on the fix. |
| 2 | Router / builder `unlockCallback` only checked `msg.sender == poolManager` | Medium (hardening) | **Fixed**: both set a flag only while they themselves are inside `PoolManager.unlock`; the callback reverts otherwise (`test_callbacksLocked`). |
| 3 | No way to return tokens sent to the router / ExtSwap by mistake | Low | **Fixed**: `sweep(token, to)`, admin only. Both contracts hold nothing between transactions, so a sweep can never touch a user's trade (`test_routerSweep`). |
| 4 | Builder: USDC sent to it by mistake mixes with its own funds | Low | **Tested**: stray USDC is not swept into new pools (`test_builderStrayUsdc`); it stays outside `usdcHeld`. Documented. |
| 5 | Builder: coin fee transfer to the treasury could revert for blacklisting / fee-on-transfer coins | Medium (general) | **Not applicable**: pool coins are always our own `PadCoin` (no blacklist, no transfer fee; the creator lock only blocks transfers *from* the creator). |
| 6 | Rounding dust USDC stays in the builder at graduation | Info | By design (tracked in `usdcHeld`, tiny); documented. |
| 7 | Pool price slightly above the curve price after graduation (floor on coins) | Info | By design, economically negligible; graduation tests check pool price vs curve price for both token orders and 6/18 decimals. |

## PadFeeVault (added Oct 6, 2026)
The treasury address given to PadHub and PadPromote (and to PadExtSwap at its deploy) is a
`PadFeeVault`. All platform fees land there.
- `owner` (the treasury wallet) can `withdraw(token, to, amount)` any token, any amount, any time;
  can change the payer and the daily cap; ownership moves in two steps (`proposeOwner` / `acceptOwner`).
- `payer` (the relayer's hot key) can only call `payReferral(to, amount, ref)` — referral rewards in
  the dollar token — and at most `dailyCap` per UTC day in total. A stolen relayer key can take at
  most one day's cap; everything else needs the owner.
- Deploy env: `TREASURY` = vault owner, `RELAYER` = payer address (required on mainnet; the constructor rejects a zero payer), `VAULT_DAILY_CAP` = whole dollars (default 500). `setPayer(address(0))` later switches payouts off.
- `DeployExtSwap` reads the vault from `deployments/<chainId>.json`, so PadExtSwap's treasury is always the same vault.
- Review rounds 1 and 2 (Oct 6, 2026): no critical/high/medium; lows fixed (zero payer at deploy, zero-amount payouts/withdrawals now revert).
- After every deploy run `script/Verify.s.sol` (read-only): asserts Hub/Promote/ExtSwap treasury == vault, vault owner == TREASURY, payer == RELAYER, cap > 0, router and admin wiring.
