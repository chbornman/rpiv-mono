/**
 * Public event contract for @juicesharp/rpiv-ask-user-question.
 *
 * STABILITY POLICY — applies to every event in the `rpiv:*` namespace.
 *
 *   1. Channel names are immutable. Once shipped, never rename.
 *   2. Payload changes are append-only. Listeners MUST tolerate unknown
 *      fields. New fields ship as optional (`?:`).
 *   3. Breaking changes (rename, retype, remove a field; change emission
 *      semantics) require a NEW channel, e.g. `rpiv:ask-user:prompt.v2`,
 *      with dual-emit during a deprecation window.
 *   4. No `version` field inside payloads. Version via channel name only.
 *   5. Payloads must be JSON-safe: primitives, arrays, plain objects.
 *      No Set/Map/Date/class instances — payloads must survive JSON
 *      serialization when listeners forward them across process or
 *      network boundaries.
 *
 * Naming: `rpiv:<package-or-tool>:<phase>`, lowercase, hyphen-separated.
 * Aligns with Pi's `"my-extension:status"` example and UniPi's `unipi:*`.
 */

import type { QuestionnaireResult } from "./tool/types.js";

export const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt" as const;

export interface AskUserPromptEventPayload {
	questions: ReadonlyArray<AskUserPromptQuestion>;
	/**
	 * Opaque identity of this questionnaire (a UUID), minted per tool call. Every
	 * live questionnaire has one, and it is the handle an inbound
	 * `ASK_USER_ANSWER_EVENT` targets. Absent when the questionnaire renders
	 * through the RPC dialog walker, which registers no answer target; see
	 * `ASK_USER_ANSWER_EVENT`.
	 */
	promptId?: string;
}

/**
 * Emitted while the questionnaire is awaiting user input (TUI `ui.custom` and
 * RPC dialog walker). Cleared with `{ active: false }` in `finally` so listeners
 * can distinguish blocked-on-human from working.
 */
export const ASK_USER_BLOCKED_EVENT = "rpiv:ask-user:blocked" as const;

export interface AskUserBlockedEventPayload {
	/** True while input is awaited; false when the wait ends (answer, cancel, or error). */
	active: boolean;
	/**
	 * The `ASK_USER_PROMPT_EVENT.promptId` this bracket belongs to, so a listener
	 * can keep per-questionnaire state while two asks overlap (Pi runs tool calls
	 * in parallel, so the brackets interleave). Absent on the RPC dialog path.
	 * Append-only and optional, per the stability policy above.
	 */
	promptId?: string;
}

export interface AskUserPromptQuestion {
	/**
	 * The full question text as the agent authored it, with line terminators
	 * normalized at tool entry (`\r\n` → `\n`, lone `\r` removed — #192). The
	 * same normalization applies to `header` and every option field below.
	 */
	question: string;
	/** The short chip/tag shown next to the question. */
	header: string;
	/** True iff the user may pick multiple options. Normalized from optional. */
	multiSelect: boolean;
	options: ReadonlyArray<AskUserPromptOption>;
}

export interface AskUserPromptOption {
	label: string;
	description: string;
	/** True iff the option carries rich preview content (content not shipped). */
	hasPreview: boolean;
}

/**
 * INBOUND. The one event in this contract the package listens for rather than
 * emits: it resolves a waiting questionnaire without synthesizing keystrokes,
 * for programs that drive Pi from outside the terminal (a phone app bridging
 * Pi, a pane supervisor, a test harness).
 *
 * Answers are validated against the params the targeted questionnaire opened
 * with, and every attempt is acknowledged on `ASK_USER_ANSWER_RESULT_EVENT`.
 * Rejections never throw: an answer from across the network is data, not code.
 *
 * Two questionnaires can be open at once (Pi runs tool calls in parallel), so
 * the live asks form a stack: `promptId` targets one entry, and an answer with
 * no `promptId` goes to the NEWEST one, which is the question the user sees on
 * top. An unknown or already-answered `promptId` is `ok: false` with a reason.
 *
 * The terminal questionnaire is the only answer target. On RPC/ACP hosts the
 * sequential dialog walker (`rpc-fallback.ts`) drives the host's own native
 * dialogs, registers no answer target, and emits no `promptId`; an inbound
 * answer there is rejected as `no questionnaire is awaiting input`.
 */
export const ASK_USER_ANSWER_EVENT = "rpiv:ask-user:answer" as const;

/**
 * The subset of the package's own `QuestionnaireResult` a client may submit:
 * the answer list, the cancel flag, and an optional global note. The
 * envelope-computed fields (`unanswered`, `error`) are outputs, not inputs.
 */
export type AskUserAnswerResult = Pick<QuestionnaireResult, "answers" | "cancelled" | "globalNote">;

export interface AskUserAnswerEventPayload {
	/** The answer to deliver, in the same shape the terminal path produces. */
	result: AskUserAnswerResult;
	/** Which questionnaire to answer. Absent: the newest open one. */
	promptId?: string;
	/** Echoed back on the result event so a caller can pair verdict to request. */
	requestId?: string;
}

/** Verdict for one `ASK_USER_ANSWER_EVENT`. Emitted for every attempt, accepted or not. */
export const ASK_USER_ANSWER_RESULT_EVENT = "rpiv:ask-user:answer-result" as const;

export interface AskUserAnswerResultEventPayload {
	/** True when the questionnaire took the answer and closed. */
	ok: boolean;
	/** Why the answer was refused. Absent when `ok` is true. */
	reason?: string;
	/** The questionnaire this verdict applies to, including the one an untargeted answer chose. */
	promptId?: string;
	requestId?: string;
}
