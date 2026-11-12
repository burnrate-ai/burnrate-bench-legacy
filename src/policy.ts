// Faithful TypeScript port of the Burnrate Vault policy:
//   solana-scam-check/anchor/programs/solana_trust/src/policy.rs :: evaluate()
// Same rules, same fixed order (cheapest/most-absolute first), fail-closed. The ONLY addition is a
// `RuleMask`: an ARM is a containment layer that enforces a SUBSET of these rules, which is how the
// benchmark compares `naive` / `spend_only` (Coinbase-model) / `burnrate_vault` without strawmanning
// — spend_only is literally this same function with only the spend rules switched on.

export type DenyReason =
  | "Cooldown" | "NoScore" | "StaleScore" | "LowConfidence"
  | "RiskAboveMax" | "ExposureCap" | "TradeTooLarge" | "DailyCapReached";

export interface Policy {
  max_risk: number;            // hard ceiling; score above -> never bought
  soft_risk: number;           // above this counts toward exposure cap
  max_exposure_bps_above: number; // bps of vault allowed in grey-zone tokens (2000 = 20%)
  cooldown_secs: number;       // after a denial, no swaps for this long (0 disables)
  require_confidence: number;  // below this, a score is treated as no score
  max_score_age: number;       // seconds; 0 = use oracle default
  allow_unscored: boolean;     // may an unscored token be bought? off by default
  max_trade: number;           // max lamports per swap (0 = no limit)
  max_daily: number;           // max lamports per rolling 24h window (0 = no limit)
}

export interface ScoreView { score: number; confidence: number; updated_at: number; }
export interface VaultView {
  balance: number; risky_exposure: number; last_denied_at: number;
  spent_today: number; day_started_at: number;
}

export const DAY_SECS = 86_400;

export type Decision =
  | { kind: "allow"; counts_as_risky: boolean }
  | { kind: "deny"; reason: DenyReason };

// which rules an arm enforces
export interface RuleMask {
  cooldown: boolean; spend: boolean; scoreExistence: boolean;
  freshness: boolean; confidence: boolean; risk: boolean; exposure: boolean;
}
export const ALL_RULES: RuleMask = {
  cooldown: true, spend: true, scoreExistence: true,
  freshness: true, confidence: true, risk: true, exposure: true,
};
export const SPEND_ONLY: RuleMask = {
  cooldown: false, spend: true, scoreExistence: false,
  freshness: false, confidence: false, risk: false, exposure: false,
};
export const NO_RULES: RuleMask = {
  cooldown: false, spend: false, scoreExistence: false,
  freshness: false, confidence: false, risk: false, exposure: false,
};

function spentInWindow(v: VaultView, now: number): number {
  return v.day_started_at > 0 && now - v.day_started_at < DAY_SECS ? v.spent_today : 0;
}

export function evaluate(
  policy: Policy, vault: VaultView, score: ScoreView | null,
  amount_in: number, now: number, oracle_max_age: number,
  rules: RuleMask = ALL_RULES,
): Decision {
  // 1. Cooldown
  if (rules.cooldown && policy.cooldown_secs > 0 && vault.last_denied_at > 0
      && now - vault.last_denied_at < policy.cooldown_secs) {
    return { kind: "deny", reason: "Cooldown" };
  }
  // 2. Spending limits (absolute, token-agnostic)
  if (rules.spend) {
    if (policy.max_trade > 0 && amount_in > policy.max_trade) {
      return { kind: "deny", reason: "TradeTooLarge" };
    }
    if (policy.max_daily > 0 && spentInWindow(vault, now) + amount_in > policy.max_daily) {
      return { kind: "deny", reason: "DailyCapReached" };
    }
  }
  // 3. A score must exist (silence is refusal unless opted in)
  if (rules.scoreExistence && score === null) {
    return policy.allow_unscored
      ? { kind: "allow", counts_as_risky: true }
      : { kind: "deny", reason: "NoScore" };
  }
  if (score === null) return { kind: "allow", counts_as_risky: true }; // scoreExistence off
  // 4. Freshness
  if (rules.freshness) {
    const max_age = policy.max_score_age > 0 ? policy.max_score_age : oracle_max_age;
    if (max_age > 0 && now - score.updated_at > max_age) {
      return { kind: "deny", reason: "StaleScore" };
    }
  }
  // 5. Confidence
  if (rules.confidence && score.confidence < policy.require_confidence) {
    return { kind: "deny", reason: "LowConfidence" };
  }
  // 6. Hard ceiling
  if (rules.risk && score.score > policy.max_risk) {
    return { kind: "deny", reason: "RiskAboveMax" };
  }
  // 7. Grey-zone exposure cap (u128 math in Rust; numbers fine for bench magnitudes)
  const risky = score.score > policy.soft_risk;
  if (rules.exposure && risky && vault.balance > 0) {
    const after = vault.risky_exposure + amount_in;
    const bps = Math.floor((after * 10_000) / vault.balance);
    if (bps > policy.max_exposure_bps_above) {
      return { kind: "deny", reason: "ExposureCap" };
    }
  }
  return { kind: "allow", counts_as_risky: risky };
}
