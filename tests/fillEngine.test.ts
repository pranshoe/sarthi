import { describe, expect, it, beforeEach } from "vitest";
import { fillPortal } from "@/portal/fillEngine";
import { emptyState } from "@/state/grievanceState";

/**
 * The entity-type dropdown speaks portal vocabulary ("Registered
 * Intermediary") while state speaks ours ("broker"). Regression test for the
 * bug where every broker complaint left the dropdown on "-- Select --" with
 * `No option matched "broker"`.
 */
const ENTITY_SELECT = `
  <select id="entityType" name="entityType">
    <option value="">-- Select --</option>
    <option>Registered Intermediary</option>
    <option>Listed Company</option>
    <option>Market Infrastructure Institution</option>
  </select>`;

function stateWith(entityType: "broker" | "listed company" | "RTA" | null) {
  return {
    ...emptyState(),
    entityType,
    userLanguage: "en-IN",
  };
}

describe("entityType select mapping", () => {
  beforeEach(() => {
    document.body.innerHTML = ENTITY_SELECT;
  });

  it("fills Registered Intermediary for a broker", async () => {
    const report = await fillPortal(stateWith("broker"));
    const row = report.results.find((r) => r.key === "entityType")!;
    expect(row.status).toBe("filled");
    const sel = document.getElementById("entityType") as HTMLSelectElement;
    expect(sel.value).toBe("Registered Intermediary");
    expect(sel.hasAttribute("data-sarthi-filled")).toBe(true);
  });

  it("fills Listed Company for a listed company", async () => {
    const report = await fillPortal(stateWith("listed company"));
    const row = report.results.find((r) => r.key === "entityType")!;
    expect(row.status).toBe("filled");
    const sel = document.getElementById("entityType") as HTMLSelectElement;
    expect(sel.value).toBe("Listed Company");
  });

  it("reports ambiguous for RTA instead of mis-filing", async () => {
    const report = await fillPortal(stateWith("RTA"));
    const row = report.results.find((r) => r.key === "entityType")!;
    expect(row.status).toBe("ambiguous");
    const sel = document.getElementById("entityType") as HTMLSelectElement;
    expect(sel.value).toBe("");
  });
});
