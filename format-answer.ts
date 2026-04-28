import type { QuestionAnswer } from "./types.js";

/**
 * Continuation message used in the LLM-facing envelope. Two-sentence imperative form
 * — the model needs the "Continue the conversation…" directive to know what to do next
 * after the user picks chat instead of answering.
 */
export const CHAT_CONTINUATION_MESSAGE =
	"User wants to chat about this. Continue the conversation to help them decide.";

/**
 * One-sentence summary form shown in the on-screen Submit-tab review pane. The dialog
 * already shows the question; the imperative continuation directive belongs in the
 * envelope, not in the user-facing summary box.
 */
export const CHAT_SUMMARY_MESSAGE = "User wants to chat about this";

/**
 * Placeholder for empty / null answer text. Used uniformly across both variants — the
 * earlier `(no answer)` fallback in the dialog summary was accidental drift; tests pin
 * `(no input)` only.
 */
export const NO_INPUT_PLACEHOLDER = "(no input)";

export type FormatAnswerVariant = "summary" | "envelope";

/**
 * Format a `QuestionAnswer` to its scalar string form. Variant controls only the
 * `wasChat` branch — the envelope's two-sentence imperative is needed by the LLM, the
 * dialog summary's one-sentence reminder is not. All other branches return identical
 * strings; the `wasCustom` empty-string handling and the default-fallback both unify
 * on `NO_INPUT_PLACEHOLDER`.
 */
export function formatAnswerScalar(a: QuestionAnswer, variant: FormatAnswerVariant): string {
	if (a.wasChat) return variant === "envelope" ? CHAT_CONTINUATION_MESSAGE : CHAT_SUMMARY_MESSAGE;
	if (a.selected && a.selected.length > 0) return a.selected.join(", ");
	if (a.wasCustom) return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
	return a.answer ?? NO_INPUT_PLACEHOLDER;
}
