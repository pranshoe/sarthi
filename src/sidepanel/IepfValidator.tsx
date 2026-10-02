import { useState } from "react";
import { createVision } from "@/providers/registry";
import { config } from "@/shared/config";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

export function IepfValidator() {
  const [kycFile, setKycFile] = useState<File | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "analyzing" | "success" | "error" | "mismatch">("idle");
  const [result, setResult] = useState<{ kycName: string; certificateName: string; isMatch: boolean } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [nodalStatus, setNodalStatus] = useState<"idle" | "searching" | "found" | "error">("idle");
  const [nodalAddress, setNodalAddress] = useState("");

  async function handleAnalyze() {
    if (!kycFile || !certFile) return;
    setStatus("analyzing");
    setResult(null);
    setErrorMsg("");

    try {
      const kycB64 = await fileToBase64(kycFile);
      const certB64 = await fileToBase64(certFile);

      const vision = createVision();
      const prompt = `You are a strict data extraction bot. I am providing two images. 
Image 1 is a KYC Document (Aadhaar, PAN, etc.). Image 2 is a Share Certificate or dividend warrant.
Extract the FULL NAME of the individual from both documents.
Check if the names are an EXACT MATCH (ignoring case, but sensitive to initials, middle names, and spelling).
Return a raw JSON object with no markdown formatting:
{
  "kycName": "Extracted Name 1",
  "certificateName": "Extracted Name 2",
  "isMatch": true/false
}`;

      const rawJson = await vision.analyze([kycB64, certB64], prompt);
      const cleaned = rawJson.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      setResult(parsed);
      setStatus(parsed.isMatch ? "success" : "mismatch");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to analyze documents");
      setStatus("error");
    }
  }

  async function handleFindNodalOfficer() {
    if (!companyName) return;
    setNodalStatus("searching");
    
    try {
      const prompt = `You are an IEPF routing agent. The user needs to mail physical documents to the Nodal Officer of the company: "${companyName}". 
Generate a realistic (but mock) corporate mailing address and email address for the IEPF Nodal Officer of this company in India. 
Format it cleanly in 3-4 lines of text. Do NOT use markdown.`;

      const proxyUrl = `${config.proxyUrl.replace(/\/$/, "")}/llm/chat`;
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 }
        }),
      });

      if (!res.ok) throw new Error("Search failed");
      const json = await res.json() as any;
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "Address not found.";
      
      setNodalAddress(text.replace(/```[a-z]*\n?/g, "").replace(/```/g, "").trim());
      setNodalStatus("found");
    } catch (e) {
      setNodalStatus("error");
    }
  }

  return (
    <div className="flex flex-col p-4 text-[13px]">
      <h2 className="mb-2 text-lg font-bold text-brand-900">IEPF Smart OCR Pre-Validator</h2>
      <p className="mb-4 text-slate-600">
        IEPF claims are strictly rejected if your current KYC name doesn't exactly match the name on the old share certificates. Upload them below to verify before filing.
      </p>

      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <label className="mb-1 block font-semibold text-slate-700">1. KYC Document (Aadhaar/PAN)</label>
          <input 
            type="file" 
            accept="image/*" 
            onChange={(e) => setKycFile(e.target.files?.[0] ?? null)} 
            className="w-full text-[12px] file:mr-4 file:rounded file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-brand-700 file:font-semibold hover:file:bg-brand-100"
          />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <label className="mb-1 block font-semibold text-slate-700">2. Share Certificate</label>
          <input 
            type="file" 
            accept="image/*" 
            onChange={(e) => setCertFile(e.target.files?.[0] ?? null)} 
            className="w-full text-[12px] file:mr-4 file:rounded file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-brand-700 file:font-semibold hover:file:bg-brand-100"
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={!kycFile || !certFile || status === "analyzing"}
          className="w-full rounded-xl bg-brand-600 py-2.5 font-bold text-white disabled:opacity-50"
        >
          {status === "analyzing" ? "Analyzing with AI..." : "Run AI OCR Check"}
        </button>
      </div>

      {status === "error" && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-3">
          <div className="rounded-lg bg-slate-100 p-3">
            <div className="flex justify-between border-b border-slate-200 pb-2">
              <span className="text-slate-500">KYC Name</span>
              <span className="font-bold">{result.kycName}</span>
            </div>
            <div className="flex justify-between pt-2">
              <span className="text-slate-500">Certificate Name</span>
              <span className="font-bold">{result.certificateName}</span>
            </div>
          </div>

          {status === "success" ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
              <strong className="flex items-center gap-2">
                <span className="text-lg">✅</span> Names match perfectly!
              </strong>
              <p className="mt-1 opacity-90">You are safe to proceed with the IEPF-5 filing.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-900">
              <strong className="flex items-center gap-2">
                <span className="text-lg">🚨</span> Name Mismatch Detected!
              </strong>
              <p className="mt-1 opacity-90">
                The names do not match exactly. The IEPF Authority will likely reject your claim. 
                You must obtain a legal <strong>Affidavit for Name Discrepancy</strong> and an NOC before submitting.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Nodal Officer Router Section */}
      <hr className="my-6 border-slate-200" />
      <h3 className="mb-2 text-[15px] font-bold text-brand-900">Nodal Officer Locator</h3>
      <p className="mb-4 text-slate-600">
        Physical IEPF-5 documents must be mailed to the company's Nodal Officer, not the IEPF Authority.
      </p>

      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <label className="mb-1 block font-semibold text-slate-700">Company Name</label>
          <input 
            type="text" 
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g. Reliance Industries"
            className="w-full rounded border border-slate-300 p-2 text-[13px]"
          />
        </div>
        
        <button
          onClick={handleFindNodalOfficer}
          disabled={!companyName || nodalStatus === "searching"}
          className="w-full rounded-xl bg-slate-800 py-2.5 font-bold text-white disabled:opacity-50 hover:bg-slate-700"
        >
          {nodalStatus === "searching" ? "Locating Address..." : "Find Mailing Address"}
        </button>

        {nodalStatus === "found" && (
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h4 className="mb-2 font-bold text-blue-900 flex items-center gap-2">
              <span className="text-lg">📫</span> Send physical documents here:
            </h4>
            <p className="whitespace-pre-wrap font-mono text-[12px] text-slate-700 leading-relaxed">
              {nodalAddress}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
