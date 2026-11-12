// Phase 2 — read the LIVE Burnrate Vault program's real decisions on Solana devnet.
//
// The sim (src/run.ts) shows the policy LOGIC; this shows the DEPLOYED PROGRAM actually making those
// decisions on chain. `policy_swap` ends every run with `set_return_data([1])` (allowed) or
// `set_return_data([0, reason])` (denied), which Solana surfaces as a `Program return: <pid> <base64>`
// log line — so each verdict is readable from the transaction with no IDL or account decoding.
//
// DenyReason index order is the on-chain enum (solana_trust/src/policy.rs):
//   0 Cooldown 1 NoScore 2 StaleScore 3 LowConfidence 4 RiskAboveMax 5 ExposureCap 6 TradeTooLarge 7 DailyCapReached
//
// It fabricates nothing: if the RPC is unreachable or no decisions are found, it says so.
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("GevpvzKYiGLpbdFtoK1ZYcWxMm2JBaWYtwFo27SdFbPd");
const REASONS = ["Cooldown", "NoScore", "StaleScore", "LowConfidence",
                 "RiskAboveMax", "ExposureCap", "TradeTooLarge", "DailyCapReached"];
const LIMIT = Number(process.env.LIMIT ?? 60);

function decodeReturn(logs: string[]): { verdict: "ALLOWED" | "DENIED"; reason?: string } | null {
  const line = logs.find(l => l.startsWith("Program return:") && l.includes(PROGRAM.toBase58()));
  if (!line) return null;
  const b64 = line.trim().split(/\s+/).pop()!;
  let bytes: Buffer;
  try { bytes = Buffer.from(b64, "base64"); } catch { return null; }
  if (bytes.length === 0) return null;
  if (bytes[0] === 1) return { verdict: "ALLOWED" };
  if (bytes[0] === 0) return { verdict: "DENIED", reason: REASONS[bytes[1]] ?? `#${bytes[1]}` };
  return null;
}

async function main() {
  console.log(`\n=== Burnrate Vault — LIVE devnet decisions (phase 2) ===`);
  console.log(`  program ${PROGRAM.toBase58()}  rpc ${RPC}\n`);
  const conn = new Connection(RPC, "confirmed");

  const info = await conn.getAccountInfo(PROGRAM).catch(() => null);
  if (!info) { console.log("  program account not found / RPC unreachable — nothing asserted."); return; }
  console.log(`  program deployed: ${info.executable ? "yes" : "NO"} (${info.data.length} bytes)\n`);

  const sigs = await conn.getSignaturesForAddress(PROGRAM, { limit: LIMIT });
  console.log(`  scanning ${sigs.length} recent transactions...\n`);

  let allowed = 0;
  const denied: Record<string, number> = {};
  const examples: { verdict: string; sig: string }[] = [];
  for (const s of sigs) {
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
    const logs = tx?.meta?.logMessages ?? [];
    const d = decodeReturn(logs);
    if (!d) continue;
    if (d.verdict === "ALLOWED") { allowed++; if (examples.length < 6) examples.push({ verdict: "ALLOWED", sig: s.signature }); }
    else { denied[d.reason!] = (denied[d.reason!] ?? 0) + 1; if (examples.length < 6) examples.push({ verdict: `DENIED ${d.reason}`, sig: s.signature }); }
  }

  const deniedTotal = Object.values(denied).reduce((a, b) => a + b, 0);
  const total = allowed + deniedTotal;
  if (total === 0) {
    console.log("  no policy_swap verdicts in the scanned window (program is deployed, but these "
      + "transactions carried no verdict). Increase LIMIT or point SOLANA_RPC at a fuller node.");
    return;
  }
  console.log(`  live verdicts decoded: ${total}  (ALLOWED ${allowed} | DENIED ${deniedTotal})`);
  for (const [r, n] of Object.entries(denied).sort((a, b) => b[1] - a[1])) {
    console.log(`     DENIED ${r}: ${n}`);
  }
  console.log(`\n  real on-chain examples (verify in explorer, ?cluster=devnet):`);
  for (const e of examples) {
    console.log(`     ${e.verdict.padEnd(22)} https://explorer.solana.com/tx/${e.sig}?cluster=devnet`);
  }
  console.log(`\n  These are the DEPLOYED program's own decisions. The same DenyReason set drives the`);
  console.log(`  sim in src/run.ts — phase 1 logic ↔ phase 2 chain, same rules.`);
}

main().catch(e => { console.error("  devnet read failed:", e?.message ?? e); process.exit(1); });
