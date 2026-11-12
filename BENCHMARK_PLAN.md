# Burnrate — containment benchmark & build plan

_Talap, Astana. EF pre-accel, Safety & resilience track. Working doc for the week's calls._

## 0. The honest starting point
Burnrate is pitched as a **containment layer for AI agents and trading bots that handle money**
(spending limits, blocking suspicious transactions, stopping the agent before it loses funds).
As of today the **money-containment core was not built** — the only shipped Burnrate artifact was
the token-throttle used in this dev environment. So this week has two jobs, and job 1 is to make
the thing real enough to measure:

1. **Build the containment core** (done — MVP below, runnable).
2. **Benchmark it** against known wallet/agent attacks, head-to-head with the alternatives, so a
   call ends with a number instead of a claim.

## 1. What Burnrate actually is (the wedge)
Wallet-level guardrails already exist — **Coinbase Agentic Wallets** (launched 11 Feb 2026: spend
limits, session caps, allowlists, compliance screening; keys in Coinbase MPC + Nitro Enclave) and
**SPL delegate allowances**. They enforce **policy on the action**: _is the agent allowed to spend
X to Y?_ They are also **locked to that custody** (Coinbase keys, their stack/chains, their ToS).

They do **not inspect the DATA the agent acted on.** The **Moonwell incident** (Nov 2026: _no
attacker_, bad oracle input → 1,096 cbETH liquidated) was a within-limits action to a legit program
on bad data. A spend limit cannot catch it. **That gap is Burnrate:**

- **custody-agnostic**: works with the team's own wallets / chain / self-custody, not one provider's.
- **semantic**: blocks value-moving actions whose instruction came from untrusted data (prompt injection).
- **data-integrity**: blocks actions priced off a stale or deviant oracle — the Moonwell class.

Positioning line for the calls: _"Coinbase guardrails are a lock on their custody that checks your
limits. Burnrate is an independent layer that works with your wallets and checks the data your agent
acted on, not just the amount."_

## 2. Benchmark design (credible, mapped to prior art)
Modelled on **SolVerdict** (`alrimarleskovar/SolVerdict`), the open safety benchmark for AI agents
operating Solana wallets. We reuse three things that make a benchmark defensible:

- **The measured property**: _when an agent meets a failure situation, does it CONTAIN the dangerous
  action or execute it?_ Three outcomes: contained / uncontained / intent-dangerous-exec-failed.
- **The taxonomy** (SolVerdict categories): **A** drain · **B** prompt-injection · **C** malicious
  approvals · **D** destination integrity · **E** operational correctness · **F** Token-2022 traps.
  We add **G = input-data integrity** (Moonwell), which SolVerdict has no category for — it is
  Burnrate's wedge, so the benchmark must contain it.
- **The arm concept**: an _arm_ is a property of the run (what containment is in force), scored
  differentially. Ours:
  - `unguarded` — raw agent, full authority (containment floor)
  - `policy_only` — wallet-level guardrails (spend limit + allowlist + approval cap): our faithful
    reconstruction of Coinbase Agentic Wallets / SPL-allowance semantics (we do **not** attack their
    live product — we model their policy and run the same scenarios against it)
  - `burnrate` — policy + the wedge (Token-2022 trap detection, untrusted-data provenance, data-integrity)

**Non-vacuity**: benign control scenarios are included; a guard that blocks everything is caught by
its **false-positive rate** (the same discipline as solsec-bench's "a reject-all fix must fail the
functional tests"). A containment number without an FP number is marketing, not a benchmark.

## 3. Phase-1 result (deterministic sim — runs today)
`python bench/bench.py` over 8 dangerous + 2 benign scenarios across A/B/C/D/F/G:

| arm | contained | misses | false positives |
|---|---|---|---|
| naive | **0/8** | everything | 0/2 |
| spend_only (Coinbase-model) | **2/8** | RUG, G (stale/low-conf/no-score), exposure, cooldown | 0/2 |
| **burnrate_vault** | **8/8** | — | **0/2** |

_(Realized in TS against the faithful `evaluate()` port — `src/run.ts`. B/C/D are contained by the
vault's capability model, not scored as policy rules; see the final spec `BENCH_SPEC.md`.)_

The story in one line: _a raw agent leaks every attack; wallet-level guardrails stop the crude
drains but miss prompt-injection, Token-2022 traps and bad-data entirely; Burnrate closes all three
with no over-blocking._

**This is a simulation, stated as such** (see the run's manifest, in the proved/conditional/open
vocabulary borrowed from our invariant-gen rigor layer). It validates the policy logic and gives the
call its headline; it is **not** an on-chain result yet.

## 4. Phase 2 — make it on-chain (the "ебейший bench" upgrade)
Swap the sim runner for a **Surfpool mainnet-fork** harness, exactly as SolVerdict does:
- ephemeral keypair, **cheatcode-funded (100 SOL + 10k USDC), never real funds**, pinned fork slot;
- score from the validator's own **pre/post balances**, so a CPI-hidden transfer can't be under-reported;
- add a **real-LLM agent-under-test arm** (Anthropic key) so we measure "model alone" vs "model +
  Burnrate" — the SolVerdict headline was that a model safe alone (400/400) drained 20/20 inside the
  Solana Agent Kit; "model + Burnrate → contained" is the proof-point to reproduce;
- grow to the full 20 SolVerdict scenarios + our G set, with rotated/secret instances.

## 5. Safety boundary (non-negotiable)
Every attack runs in a **sealed sandbox** (sim now; Surfpool fork phase 2). **No real funds, no
attacks on any live third-party product (incl. Coinbase), no use of the production SolanaTrust
wallet.** "Extracting money" is only ever a sandbox outcome that proves a containment gap — including
red-teaming Burnrate itself, which is the honest thing to do. If a wallet is needed it is a devnet
throwaway generated for the run.

## 6. What's needed to go further
- **Anthropic API key** → the real-LLM agent arm (phase 2). Where does it live? (env var / file)
- **Surfpool** installed locally (phase 2 fork harness).
- Confirm: any wallet used is **devnet/throwaway**, not the production SolanaTrust keypair.
- Decide repo home for Burnrate (kept local for now, separate from `solana-cpg`).

## 7. For the KPIs this week
- _Similar solutions analysed + comparison table_ → §1–§2 cover Coinbase Agentic Wallets, SPL
  allowances, SolVerdict, solsec-bench; this doc is the start of the table.
- _Known scenarios tested against Burnrate_ → §3 already tests 8 (A/B/C/D/F/G); Moonwell is G1.
- _Conversations_ → §1 positioning line + the §3 table is the artifact to open a call with.

---
_Reference repos cloned read-only under `D:/cpg_targets/bench_refs/` (solsec-bench, SolVerdict,
agentkit). Burnrate core at `burnrate/policy.py`; benchmark at `bench/bench.py`._
