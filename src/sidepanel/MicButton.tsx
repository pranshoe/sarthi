import { useEffect, useRef, useState } from "react";

/**
 * Microphone capture.
 *
 * MediaRecorder records the clip, then it goes to the worker and on to Sarvam.
 * Nothing is stored. Browsers without SpeechRecognition (Firefox) fall back to
 * the MediaRecorder path, which works everywhere; the Web Speech path is used
 * when available because it streams and needs no credits.
 */
export function useMic(onText: (t: string) => void) {
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      recorder.current?.state === "recording" && recorder.current.stop();
    };
  }, []);

  async function toggle() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];

      mr.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        if (blob.size < 1000) return;
        setNote("Transcribing…");
        try {
          const buf = await blob.arrayBuffer();
          const res = (await chrome.runtime.sendMessage({
            type: "stt/transcribe",
            payload: { audio: Array.from(new Uint8Array(buf)), mockMode: true },
          })) as { ok: boolean; text?: string; error?: string };

          if (res.ok && res.text) {
            onText(res.text);
            setNote(null);
          } else {
            setNote(res.error ?? "Could not transcribe");
            setTimeout(() => setNote(null), 3000);
          }
        } catch {
          setNote("Transcription unavailable (is the proxy running?)");
          setTimeout(() => setNote(null), 3500);
        }
      };

      recorder.current = mr;
      mr.start();
      setRecording(true);
      setNote(null);
    } catch {
      setNote("Microphone permission denied");
      setTimeout(() => setNote(null), 3000);
    }
  }

  return { recording, note, toggle };
}