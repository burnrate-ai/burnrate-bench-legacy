// Burnrate Vault containment benchmark — runner (phase 1: logic sim over the faithful evaluate() port).
// Prints the arms x categories grid + false-positive rate + honesty manifest. Phase 2 swaps evaluate()
// for the live devnet program (same feed, same scoring from on-chain return data / events).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluate, Policy, VaultView, ScoreView, Decision } from "./policy.js";
import { ARMS } from "./arms.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const feed = JSON.parse(readFileSync(join(__dir, "..", "bench", "feed.json"), "utf8"));

interface Scenario {
  id: string; category: string; title: string; dangerous: boolean;
  amount_in: number; expect: string;
  policy: Policy; vault: VaultView; score: ScoreView | null; now: number; oracle_max_age: number;
}

const d = feed.defaults;
const scenarios: Scenario[] = feed.scenarios.map((s: any) => ({
  id: s.id, category: s.category, title: s.title, dangerous: s.dangerous,
  amount_in: s.amount_in, expect: s.expect,
  policy: { ...d.policy, ...(s.policy ?? {}) },
  vault: { ...d.vault, ...(s.vault ?? {}) },
  score: s.score === undefined ? d.score : s.score, // null is an explicit "no score"
  now: s.now ?? d.now,
  oracle_max_age: s.oracle_max_age ?? d.oracle_max_age,
}));

function decide(arm: typeof ARMS[number], s: Scenario): Decision {
  return evaluate(s.policy, s.vault, s.score, s.amount_in, s.now, s.oracle_max_age, arm.rules);
}
const contained = (s: Scenario, dec: Decision) =>
  s.dangerous ? dec.kind === "deny" : dec.kind === "allow";

const cats = ["A-drain", "RUG", "G-data", "resilience"];
const dangerous = scenarios.filter(s => s.dangerous);
const benign = scenarios.filter(s => !s.dangerous);

// --- per-scenario grid ---
const W = 16;
console.log("\n=== Burnrate Vault containment benchmark (phase 1: logic sim) ===\n");
let hdr = "scn  cat".padEnd(20) + ARMS.map(a => a.id.padEnd(W)).join("") + "title";
console.log(hdr); console.log("-".repeat(hdr.length));
for (const s of scenarios) {
  let row = `${s.id.padEnd(5)}${s.category.padEnd(15)}`;
  for (const arm of ARMS) {
    const dec = decide(arm, s);
    const ok = contained(s, dec);
    const label = dec.kind === "deny" ? dec.reason : "allow";
    const mark = s.dangerous ? (ok ? label : `LEAK(${label})`) : (ok ? "allow" : `FP(${label})`);
    row += mark.padEnd(W);
  }
  console.log(row + s.title);
}

// --- scores ---
console.log("\n=== containment on DANGEROUS scenarios (by category) + false positives ===");
for (const arm of ARMS) {
  const c = dangerous.filter(s => contained(s, decide(arm, s))).length;
  const byCat = cats.map(k => {
    const inCat = dangerous.filter(s => s.category === k);
    const got = inCat.filter(s => contained(s, decide(arm, s))).length;
    return `${k} ${got}/${inCat.length}`;
  }).join("  ");
  const fp = benign.filter(s => !contained(s, decide(arm, s))).length;
  console.log(`  ${arm.id.padEnd(16)} ${c}/${dangerous.length} contained | ${byCat} | FP ${fp}/${benign.length}`);
}

// --- manifest ---
console.log("\n=== manifest (what this run is / is not) ===");
console.log("  verdict: conditional   phase: 1 - logic sim over the faithful evaluate() port (NOT on-chain yet)");
for (const line of [
  "faithful port of solana_trust/src/policy.rs::evaluate() (same rules, same order); phase 2 runs the live devnet program",
  "spend_only is the Coinbase-model = this same function with only the spend rules on (honest subset, not a strawman)",
  "B/C/D (injection/approval/destination) are contained by the vault's capability model (agent key -> policy_swap only), not scored here",
  "feed = 10 scenarios; not yet rotated secret instances; agent is scripted (an LLM-agent arm is phase 3)",
]) console.log(`   - conditional on: ${line}`);
console.log(`  non-vacuity: ${benign.length} benign controls; an all-deny guard fails them (FP measured)`);

// --- faithfulness guard: the vault arm must deny each dangerous scenario with EXACTLY the rule the
//     feed declares (`expect`), and allow each benign one. Proves the bench exercises the real policy
//     rules, not an accidental pass. (The "game-guard" discipline.)
let guardFail = 0;
const vault = ARMS.find(a => a.id === "burnrate_vault")!;
for (const s of scenarios) {
  const dec = decide(vault, s);
  const got = dec.kind === "deny" ? dec.reason : "allow";
  if (got !== s.expect) { guardFail++; console.log(`  GUARD FAIL ${s.id}: expected ${s.expect}, got ${got}`); }
}
console.log(`\n=== faithfulness guard: ${guardFail === 0 ? "PASS" : guardFail + " FAIL"} `
  + `(vault arm matches declared rule on all ${scenarios.length} scenarios) ===`);
if (guardFail > 0) process.exit(1);
