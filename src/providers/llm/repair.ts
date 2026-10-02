import type { ChatMessage, LLMProvider } from "../types";

/**
 * Schema-repair pass (spec 2b): if the model's output does not validate, ask it
 * once to fix its own JSON rather than discarding the turn.
 *
 * Kept in its own module so it has no provider-specific imports; this is generic
 * behaviour and must not tie the turn runner to one vendor.
 */
export async function repairOnce(
  provider: LLMProvider,
  badOutput: string,
  parseError: string,
  messages: ChatMessage[],
): Promise<string | null> {
  try {
    return await provider.chat([
      ...messages,
      { role: "assistant", content: badOutput },
      {
        role: "user",
        content:
          `That output was invalid: ${parseError}. Return the same information as ` +
          `strict JSON matching the schema. No prose, no markdown fences.`,
      },
    ]);
  } catch (e) {
    console.warn("[saathi] repair pass failed", e);
    return null;
  }
}