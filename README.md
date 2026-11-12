# Burnrate Bench

Containment benchmark for the **Burnrate Vault** (`burnrate-ai/solana-scam-check`): does an AI trading
agent get **contained** when told to make a dangerous swap? Compares three arms over one feed —
`naive` (raw agent) · `spend_only` (Coinbase Agentic Wallets / SPL-allowance model) · `burnrate_vault`
(the real on-chain policy). Standalone: it does **not** modify solana-scam-check; it ports the policy
for phase 1 and calls the deployed devnet program for phase 2.

## Run
```bash
npm install        # tsx + typescript
npm run bench      # tsx src/run.ts
```

## Phase-1 headline (logic sim over the faithful `evaluate()` port)
| arm | contained | A-drain | RUG | G-data | resilience | FP |
|---|---|---|---|---|---|---|
| naive | **0/8** | 0/2 | 0/2 | 0/3 | 0/1 | 0/2 |
| spend_only (Coinbase-model) | **2/8** | 2/2 | 0/2 | 0/3 | 0/1 | 0/2 |
| **burnrate_vault** | **8/8** | 2/2 | 2/2 | 3/3 | 1/1 | **0/2** |

The delta `spend_only → vault` is the pitch number: a spend-limit wallet stops crude drains but misses
rug tokens, stale/low-confidence/absent scores (the Moonwell data-integrity class), grey-zone exposure
and post-denial hammering — all of which the Vault contains, with no over-blocking of clean tokens.

## Layout
```
src/policy.ts     faithful TS port of solana_trust/src/policy.rs::evaluate() + a RuleMask (arm = rule subset)
src/arms.ts       naive / spend_only / burnrate_vault
src/run.ts        runner: arms x categories grid, FP rate, honesty manifest, faithfulness guard
bench/feed.json   separate feed (10 scenarios; jury demo/feed.json stays untouched)
BENCH_SPEC.md     the spec; BENCHMARK_PLAN.md the pitch/design doc
```

## Faithfulness & honesty
`run.ts` asserts the vault arm returns **exactly** the DenyReason each scenario declares (`expect`) —
the bench provably exercises the real rules, not an accidental pass. The run prints a manifest in the
`proved/conditional/open` vocabulary: phase 1 is a logic sim, `spend_only` is an honest subset of the
same function, B/C/D are contained by the vault's capability model (agent key → `policy_swap` only).

## Phases
1. **logic sim** (`npm run bench`) — fast, deterministic, demoable now.
2. **live devnet** (`npm run bench:devnet`) — reads the DEPLOYED program's real decisions
   (`GevpvzKY…SdFbPd`) off Solana devnet, decoding each `policy_swap` verdict from its
   `Program return:` log (`[1]`=allowed / `[0,reason]`=denied). No IDL, no account decoding, nothing
   fabricated. Point `SOLANA_RPC` at a real endpoint to avoid public-node 429s (`LIMIT` caps the scan).

   First run (public devnet RPC, 12 verdicts decoded): **ALLOWED 2 · DENIED 10** —
   `StaleScore ×4`, `DailyCapReached ×3`, `TradeTooLarge ×2`, `NoScore ×1`. The live program really
   refuses on stale data (the Moonwell class) and spend caps, with the **same DenyReason set** the sim
   uses — phase-1 logic ↔ phase-2 chain. Example txs print as `explorer.solana.com/tx/…?cluster=devnet`.
3. **real-LLM arm** — scripted agent → LLM agent (Anthropic key in a gitignored `.env`) to reproduce
   SolVerdict's "safe alone, drains inside a kit → contained by the Vault".

## Safety
Sim now; phase 2 runs in devnet/localnet, cheatcode-funded, **never real funds**, no attacks on any
live third-party product.
