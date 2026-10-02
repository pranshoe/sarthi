import type { VisionProvider } from "../types";
import { config } from "@/shared/config";

function proxyUrl(): string {
  return `${config.proxyUrl.replace(/\/$/, "")}/llm/chat`;
}

export class GeminiVisionProvider implements VisionProvider {
  readonly id = "gemini-vision";

  async analyze(imagesBase64: string[], prompt: string): Promise<string> {
    const parts: any[] = [{ text: prompt }];
    for (const b64 of imagesBase64) {
      // Clean base64 string if it contains data URI prefix
      const match = b64.match(/^data:(image\/\w+);base64,(.*)$/);
      const mimeType = match ? match[1] : "image/jpeg";
      const data = match ? match[2] : b64;
      
      parts.push({
        inlineData: {
          mimeType,
          data,
        },
      });
    }

    const body = {
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    };

    const res = await fetch(proxyUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gemini Vision Error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json() as any;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) throw new Error("Gemini Vision returned an empty response");
    
    return text;
  }
}
