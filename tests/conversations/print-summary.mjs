#!/usr/bin/env node
/** Merges per-run row JSONs (vitest files + Playwright S15) into the PART C summary table. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROWS = join(HERE, "..", "..", "test-output", "_rows");

function main() {
  if (!existsSync(ROWS)) {
    console.log("no test-output/_rows yet — run the suite first");
    return;
  }
  const rows = [];
  for (const f of readdirSync(ROWS)) {
    if (!f.endsWith(".json")) continue;
    try {
      rows.push(JSON.parse(readFileSync(join(ROWS, f), "utf8")));
    } catch {
      /* ignore partial writes */
    }
  }
  const byScenario = new Map();
  for (const r of rows) {
    if (!byScenario.has(r.id)) byScenario.set(r.id, []);
    byScenario.get(r.id).push(r);
  }
  const ids = [...byScenario.keys()].sort();
  console.log("");
  console.log("| scenario | runs passed (x/3) | HARD? | failures |");
  console.log("|----------|-------------------|-------|----------|");
  let hardOk = true;
  let softOk = true;
  for (const id of ids) {
    const runs = byScenario.get(id).sort((a, b) => a.run - b.run);
    const title = runs[0]?.title ?? "";
    const hard = !!runs[0]?.hard;
    const passed = runs.filter((r) => r.passed).length;
    const need = hard ? 3 : 2;
    const ok = passed >= need;
    if (hard && !ok) hardOk = false;
    if (!hard && !ok) softOk = false;
    const fails = runs
      .flatMap((r) => r.failures.map((f) => `r${r.run}:${f}`))
      .join(" // ")
      .slice(0, 220);
    console.log(
      `| ${id} ${title} | ${passed}/3 | ${hard ? "HARD" : "no"} | ${ok ? "OK" : fails || "?"}`,
    );
  }
  console.log("");
  console.log(`HARD scenarios: ${hardOk ? "ALL 3/3 PASS" : "FAILING"} | others: ${softOk ? ">=2/3 PASS" : "FAILING"}`);
}

main();
