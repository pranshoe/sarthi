import { useState } from "react";
import { config } from "@/shared/config";

export function AffidavitCopilot() {
  const [deceasedName, setDeceasedName] = useState("");
  const [heirName, setHeirName] = useState("");
  const [relation, setRelation] = useState("");
  const [survivors, setSurvivors] = useState("");
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [affidavitText, setAffidavitText] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleGenerate() {
    if (!deceasedName || !heirName || !relation) return;
    setStatus("generating");
    setErrorMsg("");

    try {
      const prompt = `You are a legal document generator copilot for SEBI and IEPF claims in India.
Generate a formal "Affidavit for Transmission of Shares" (or general NOC) based on these facts:
Deceased Shareholder Name: ${deceasedName}
Claimant (Legal Heir) Name: ${heirName}
Relation to Deceased: ${relation}
Other Surviving Family Members: ${survivors || "None"}

Write a professional, standard Indian legal affidavit in plain English. 
Also, generate a customized step-by-step to-do list (checklist) for the user explaining exactly what physical actions they must take next (e.g. obtaining NOCs from specific family members mentioned, notarizing, sending to the RTA).

Return ONLY a raw JSON object with this exact structure (no markdown, no quotes outside JSON):
{
  "affidavitText": "Full text of the affidavit...",
  "checklist": ["Step 1", "Step 2"]
}`;

      const body = {
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      };

      const proxyUrl = `${config.proxyUrl.replace(/\/$/, "")}/llm/chat`;
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
      
      const json = await res.json() as any;
      let text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text) throw new Error("Received empty response");

      text = text.replace(/```[a-z]*\n?/g, "").replace(/```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        // Fallback: extract JSON block if there's trailing text
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          throw new Error("Could not parse LLM response into JSON");
        }
      }

      setAffidavitText(parsed.affidavitText || "");
      setChecklist(parsed.checklist || []);
      setStatus("done");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to generate affidavit");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col p-4 text-[13px]">
      <h2 className="mb-2 text-lg font-bold text-brand-900">Dynamic Affidavit Copilot</h2>
      <p className="mb-4 text-slate-600">
        Automatically generate SEBI-compliant legal affidavits for Transmission of Shares or Name Mismatches.
      </p>

      {status !== "done" ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <label className="mb-1 block font-semibold text-slate-700">Name of Deceased Shareholder</label>
            <input 
              type="text" 
              value={deceasedName}
              onChange={e => setDeceasedName(e.target.value)}
              className="w-full rounded border border-slate-300 p-2 text-[13px]"
              placeholder="e.g. Ramesh Kumar"
            />
          </div>
          <div>
            <label className="mb-1 block font-semibold text-slate-700">Your Name (Claimant)</label>
            <input 
              type="text" 
              value={heirName}
              onChange={e => setHeirName(e.target.value)}
              className="w-full rounded border border-slate-300 p-2 text-[13px]"
              placeholder="e.g. Suresh Kumar"
            />
          </div>
          <div>
            <label className="mb-1 block font-semibold text-slate-700">Your Relation to Deceased</label>
            <input 
              type="text" 
              value={relation}
              onChange={e => setRelation(e.target.value)}
              className="w-full rounded border border-slate-300 p-2 text-[13px]"
              placeholder="e.g. Son, Daughter, Spouse"
            />
          </div>
          <div>
            <label className="mb-1 block font-semibold text-slate-700">Other Surviving Members & Relations</label>
            <textarea 
              value={survivors}
              onChange={e => setSurvivors(e.target.value)}
              className="w-full rounded border border-slate-300 p-2 text-[13px] min-h-[60px]"
              placeholder="e.g. 1 Brother, 1 Mother"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={!deceasedName || !heirName || !relation || status === "generating"}
            className="mt-2 w-full rounded-xl bg-brand-600 py-2.5 font-bold text-white disabled:opacity-50"
          >
            {status === "generating" ? "Generating Legal Draft..." : "Generate Affidavit"}
          </button>

          {status === "error" && <p className="text-red-600 mt-2">{errorMsg}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h3 className="mb-2 font-bold text-blue-900">Dynamic Transmission Checklist</h3>
            <ul className="list-inside list-decimal space-y-1.5 text-[12px] text-blue-800">
              {checklist.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-2 font-bold text-emerald-700">Draft Ready for Notarization</h3>
            <textarea 
              readOnly 
              value={affidavitText}
              className="w-full rounded border border-slate-200 bg-slate-50 p-3 text-[12px] font-mono leading-relaxed outline-none min-h-[300px]"
            />
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => { navigator.clipboard.writeText(affidavitText); alert("Copied to clipboard!"); }}
              className="flex-1 rounded-xl bg-slate-800 py-2 font-bold text-white hover:bg-slate-700"
            >
              Copy Text
            </button>
            <button 
              onClick={() => setStatus("idle")}
              className="flex-1 rounded-xl bg-slate-200 py-2 font-bold text-slate-800 hover:bg-slate-300"
            >
              Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
