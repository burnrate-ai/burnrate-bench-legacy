// ARMS — the containment layers compared. All run the SAME agent over the SAME feed; they differ only
// in which policy rules are in force (a RuleMask over the faithful evaluate() port).
import { RuleMask, ALL_RULES, SPEND_ONLY, NO_RULES } from "./policy.js";

export interface Arm { id: string; label: string; models: string; rules: RuleMask; }

export const ARMS: Arm[] = [
  { id: "naive", label: "Naive agent (full wallet authority)",
    models: "a raw trading agent with the keys — the containment floor", rules: NO_RULES },
  { id: "spend_only", label: "Spend-only guardrail",
    models: "Coinbase Agentic Wallets / SPL allowance — value policy, no token-risk, no data checks",
    rules: SPEND_ONLY },
  { id: "burnrate_vault", label: "Burnrate Vault (full policy)",
    models: "the real on-chain PolicyVault — all 8 DenyReasons", rules: ALL_RULES },
];
