import { describe, it, expect, afterAll } from "vitest";
import { runScenario, llmMode, type RunResult } from "./harness";
import { SCENARIOS } from "./scenarios";

const RUNS = [1, 2, 3];
const results: RunResult[] = [];

describe("conversational scenarios", () => {
  for (const scenario of SCENARIOS) {
    for (const run of RUNS) {
      it(
        `${scenario.id} run ${run}${scenario.hard ? " [HARD]" : ""}: ${scenario.title}`,
        async () => {
          const mode = llmMode();
          const result = await runScenario(scenario, run, mode);
          results.push(result);
          if (!result.passed) {
            console.log(`\n--- ${scenario.id} run ${run} FAILED ---`);
            for (const f of result.failures) console.log(`  ${f}`);
          }
          expect(result.failures).toEqual([]);
        },
        240000,
      );
    }
  }

  afterAll(() => {
    const passed = results.filter((r) => r.passed).length;
    console.log(`\nconvo suite: ${passed}/${results.length} scenario-runs passed (${llmMode()})`);
  });
});
