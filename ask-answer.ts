/**
 * ask-answer — the inbound answer channel for `ask_user_question`.
 *
 * The questionnaire is drawn by `ctx.ui.custom`, and the `done` callback that
 * resolves it is trapped inside the factory closure (`ask-user-question.ts`).
 * A client outside the terminal (a phone app bridging Pi, a pane supervisor, a
 * test harness) therefore sees `rpiv:ask-user:prompt` but has no way to answer:
 * its only remaining option would be synthesizing arrow keys against a rendered
 * overlay. This module is the missing half of that contract. It keeps a stack of
 * the questionnaires that are actually waiting and routes an externally supplied
 * result to the one a caller targets.
 *
 * ## Why a stack
 *
 * Pi runs tool calls in parallel, so two questionnaires can be open at once: the
 * second opens as an overlay while the first sits inline. A single "active
 * session" slot would let the second question hide the first, and the first
 * call's teardown would clear a registration it does not own. So:
 *
 * - every mount pushes its own entry (first line of the `ctx.ui.custom`
 *   factory, the earliest point the `done` callback exists);
 * - an answer with no `promptId` targets the NEWEST entry, the one the user sees
 *   on top;
 * - each entry is removed by its own mount's `finally`, matched by identity, so
 *   an overlapping teardown can only ever drop its own registration and the
 *   entry underneath becomes the target again.
 *
 * ## Why the registry is process-global
 *
 * State lives on `globalThis` under `Symbol.for(...)` rather than in a module
 * local, for the same reason as `rpiv-advisor`'s inventory and
 * `rpiv-workflow`'s execution host: a consumer that installs this package beside
 * the host's copy of the extension can resolve its own module instance, and a
 * module-local slot would put `registerActiveAsk` and `submitAskUserAnswer` on
 * two different stacks, where the answer would miss silently. The slot is read
 * on every access (never memoized), so a test reset that empties it is enough.
 *
 * ## Where answers are NOT accepted
 *
 * The RPC dialog walker (`rpc-fallback.ts`) never registers: it drives the
 * host's own native `select`/`input` dialogs one question at a time, and those
 * prompts belong to the host, not to this package. An inbound answer that
 * arrives while only an RPC questionnaire is waiting is rejected with
 * `reason: "no questionnaire is awaiting input"`, exactly like one that arrives
 * when nothing is open. The terminal path is the only answer target today; the
 * gap is documented in `docs/tool-schema.md` and `docs/hosts.md`.
 */

import { randomUUID } from "node:crypto";
import {
	ASK_USER_ANSWER_EVENT,
	ASK_USER_ANSWER_RESULT_EVENT,
	type AskUserAnswerResult,
	type AskUserAnswerResultEventPayload,
} from "./events.js";
import type { QuestionAnswer, QuestionnaireResult, QuestionParams } from "./tool/types.js";

/** The trapped `ctx.ui.custom` resolve callback. */
type Done = (result: QuestionnaireResult) => void;

/**
 * Handle returned by `registerActiveAsk`. Opaque by design: the holder keeps it
 * and hands it back to `clearActiveAsk`, and only object identity matters.
 */
export interface ActiveAsk {
	/** Identity token. Never inspected, only compared. */
	readonly token: symbol;
}

interface RegisteredAsk extends ActiveAsk {
	readonly promptId: string;
	readonly params: QuestionParams;
	readonly done: Done;
}

/** Verdict for one submitted answer. A rejection carries a human-readable reason. */
export type AskAnswerOutcome = { ok: true; promptId: string } | { ok: false; reason: string; promptId?: string };

/**
 * The bus slice this module needs. Structural, and identical to Pi's
 * `EventBus`, so a caller hands it `pi.events` without importing the type.
 */
export interface AskAnswerBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

const ASKS_SLOT = Symbol.for("@juicesharp/rpiv-ask-user-question:activeAsks");

interface AskStack {
	asks: RegisteredAsk[];
}

/** Read the single process-global stack, creating it on first access. Never memoized. */
function stack(): AskStack {
	const g = globalThis as Record<symbol, unknown>;
	let slot = g[ASKS_SLOT] as AskStack | undefined;
	if (slot === undefined || !Array.isArray(slot.asks)) {
		slot = { asks: [] };
		g[ASKS_SLOT] = slot;
	}
	return slot;
}

/** Opaque identity for one questionnaire, minted per tool call and shipped in `rpiv:ask-user:prompt`. */
export function newPromptId(): string {
	return randomUUID();
}

/**
 * Push a waiting questionnaire onto the stack. Called from the first line of the
 * `ctx.ui.custom` factory, the earliest point `done` exists, and paired with
 * `clearActiveAsk` in that mount's `finally`. The returned handle is the
 * caller's own receipt: clearing it can only ever remove this entry.
 */
export function registerActiveAsk(params: QuestionParams, promptId: string, done: Done): ActiveAsk {
	const ask: RegisteredAsk = { token: Symbol("ask"), promptId, params, done };
	stack().asks.push(ask);
	return ask;
}

/**
 * Remove exactly one registration, matched by token identity, and only while it
 * is still on the stack. An overlapping ask that registered afterwards is
 * untouched; an undefined handle (a mount whose factory never ran) clears
 * nothing.
 */
export function clearActiveAsk(ask: ActiveAsk | undefined): void {
	if (ask === undefined) return;
	const asks = stack().asks;
	const index = asks.findIndex((candidate) => candidate.token === ask.token);
	if (index !== -1) asks.splice(index, 1);
}

/** How many questionnaires are waiting. Exported for diagnostics and tests. */
export function activeAskCount(): number {
	return stack().asks.length;
}

/** Test reset. Drops every registration. Not part of the public surface. */
export function __resetActiveAsks(): void {
	stack().asks.length = 0;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function reject(reason: string, promptId?: string): AskAnswerOutcome {
	return { ok: false, reason, ...(promptId !== undefined ? { promptId } : {}) };
}

function describeValue(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return "an array";
	if (value === null) return "null";
	return typeof value;
}

/** An index is worth quoting by value (`12`, `-1`, `1.5`); anything else by type. */
function describeIndex(value: unknown): string {
	return typeof value === "number" ? String(value) : describeValue(value);
}

/**
 * Resolve the entry an answer targets: the one carrying `promptId`, or the
 * newest when no id was supplied. The newest is what the user sees on top, so an
 * untargeted answer from a single-question client lands where a keystroke would
 * have.
 */
function targetAsk(promptId: string | undefined): RegisteredAsk | AskAnswerOutcome {
	const asks = stack().asks;
	if (promptId === undefined) {
		return asks[asks.length - 1] ?? reject("no questionnaire is awaiting input");
	}
	const matched = asks.filter((ask) => ask.promptId === promptId).pop();
	return matched ?? reject(`no questionnaire is waiting with promptId ${JSON.stringify(promptId)}`, promptId);
}

/**
 * Rebuild one answer entry from the submitted value plus the registered params.
 *
 * The submitted `question` text, the option `preview`, and any unknown field are
 * NOT trusted: both are re-read from the params the questionnaire opened with,
 * so a remote client cannot put words (or a fabricated preview) into the
 * LLM-facing envelope beyond the choice it is actually making. Returns a reason
 * string for anything that does not belong to this questionnaire.
 */
function buildAnswer(
	entry: unknown,
	position: number,
	params: QuestionParams,
): { answer: QuestionAnswer } | { reason: string } {
	if (!entry || typeof entry !== "object") {
		return { reason: `answer ${position} must be an object, got ${describeValue(entry)}` };
	}
	const submitted = entry as Partial<QuestionAnswer>;
	const questionIndex = submitted.questionIndex;
	if (
		typeof questionIndex !== "number" ||
		!Number.isInteger(questionIndex) ||
		questionIndex < 0 ||
		questionIndex >= params.questions.length
	) {
		return {
			reason: `answer ${position}: questionIndex ${describeIndex(questionIndex)} is out of range (0..${params.questions.length - 1})`,
		};
	}
	const question = params.questions[questionIndex]!;
	const where = `question ${questionIndex}`;

	const kind = submitted.kind;
	if (kind !== "option" && kind !== "custom" && kind !== "multi") {
		return { reason: `${where}: kind must be "option", "custom" or "multi", got ${describeValue(kind)}` };
	}
	if (submitted.notes !== undefined && typeof submitted.notes !== "string") {
		return { reason: `${where}: notes must be a string, got ${describeValue(submitted.notes)}` };
	}
	const notes = typeof submitted.notes === "string" && submitted.notes.length > 0 ? submitted.notes : undefined;
	const noteFields = notes !== undefined ? { notes } : {};

	if (kind === "custom") {
		const text = submitted.answer;
		if (text !== undefined && text !== null && typeof text !== "string") {
			return { reason: `${where}: a custom answer must be a string, got ${describeValue(text)}` };
		}
		return {
			answer: {
				questionIndex,
				question: question.question,
				kind: "custom",
				answer: typeof text === "string" ? text : null,
				...noteFields,
			},
		};
	}

	const labels = question.options.map((option) => option.label);
	if (kind === "multi") {
		const chosen = submitted.selected;
		if (chosen === undefined) {
			// The terminal's Next row with nothing toggled: an empty commit, not a blank.
			return {
				answer: {
					questionIndex,
					question: question.question,
					kind: "multi",
					answer: null,
					selected: [],
					...noteFields,
				},
			};
		}
		if (!Array.isArray(chosen)) {
			return { reason: `${where}: selected must be an array of option labels, got ${describeValue(chosen)}` };
		}
		const selected: string[] = [];
		for (const label of chosen) {
			if (typeof label !== "string" || !labels.includes(label)) {
				return { reason: `${where}: ${describeValue(label)} is not one of its options (${labels.join(", ")})` };
			}
			if (!selected.includes(label)) selected.push(label);
		}
		return {
			answer: { questionIndex, question: question.question, kind: "multi", answer: null, selected, ...noteFields },
		};
	}

	const label = submitted.answer;
	if (typeof label !== "string") {
		return { reason: `${where}: an option answer must be one of its option labels, got ${describeValue(label)}` };
	}
	const matched = question.options.find((option) => option.label === label);
	if (!matched) {
		return { reason: `${where}: ${JSON.stringify(label)} is not one of its options (${labels.join(", ")})` };
	}
	return {
		answer: {
			questionIndex,
			question: question.question,
			kind: "option",
			answer: matched.label,
			...(matched.preview && matched.preview.length > 0 ? { preview: matched.preview } : {}),
			...noteFields,
		},
	};
}

/**
 * Validate a submitted answer against the params the questionnaire opened with,
 * and rebuild it into the shape the terminal path would have produced.
 *
 * Rules, in order: the result must be an object with a boolean `cancelled` and
 * an `answers` array; a cancelled result is accepted as authored (the envelope
 * emits the canonical decline either way, so its entries have nothing to lie
 * about); every other entry must be an object whose `kind`, `questionIndex` and
 * label(s) belong to this questionnaire, with no question answered twice; and an
 * answered result must carry at least one answer or a global note. Nothing here
 * throws.
 */
function validateAnswer(ask: RegisteredAsk, result: unknown): { result: QuestionnaireResult } | { reason: string } {
	if (!result || typeof result !== "object") {
		return { reason: `result must be an object with "answers" and "cancelled", got ${describeValue(result)}` };
	}
	const submitted = result as Partial<AskUserAnswerResult>;
	if (typeof submitted.cancelled !== "boolean") {
		return { reason: `result.cancelled must be a boolean, got ${describeValue(submitted.cancelled)}` };
	}
	if (submitted.globalNote !== undefined && typeof submitted.globalNote !== "string") {
		return { reason: `result.globalNote must be a string, got ${describeValue(submitted.globalNote)}` };
	}
	const globalNote =
		typeof submitted.globalNote === "string" && submitted.globalNote.length > 0 ? submitted.globalNote : undefined;

	// A decline carries no answer the model could be lied to with: forward it as
	// authored, mirroring the terminal's Esc (whose partial answers survive only
	// in the persisted `details`).
	if (submitted.cancelled) return { result: { ...(result as QuestionnaireResult) } };

	const entries = submitted.answers;
	if (!Array.isArray(entries)) {
		return { reason: `result.answers must be an array, got ${describeValue(entries)}` };
	}

	const answers: QuestionAnswer[] = [];
	const seen = new Set<number>();
	for (let position = 0; position < entries.length; position++) {
		const built = buildAnswer(entries[position], position, ask.params);
		if ("reason" in built) return built;
		if (seen.has(built.answer.questionIndex)) {
			return { reason: `question ${built.answer.questionIndex} was answered twice` };
		}
		seen.add(built.answer.questionIndex);
		answers.push(built.answer);
	}
	if (answers.length === 0 && globalNote === undefined) {
		return { reason: "an answered result needs at least one answer, or set cancelled: true" };
	}
	answers.sort((a, b) => a.questionIndex - b.questionIndex);
	return { result: { answers, cancelled: false, ...(globalNote !== undefined ? { globalNote } : {}) } };
}

/**
 * Route a submitted answer to the questionnaire it targets.
 *
 * `promptId` selects the ask; without one, the newest (topmost) ask takes it.
 * The entry is removed BEFORE its `done` runs, so a duplicate arriving after the
 * questionnaire has resolved finds nothing and is reported as a miss rather than
 * reaching a settled promise. On success the target's `done` is called exactly
 * as a keyboard answer would be: the dialog closes and the tool resolves with
 * the same structured envelope.
 */
export function deliverAskAnswer(result: unknown, promptId?: string): AskAnswerOutcome {
	const target = targetAsk(promptId);
	if ("ok" in target) return target;

	const validated = validateAnswer(target, result);
	if ("reason" in validated) return reject(validated.reason, target.promptId);

	clearActiveAsk(target);
	// A throwing `done` means the host's own machinery failed mid-delivery. The
	// entry is already off the stack, so say so rather than letting the exception
	// escape into the bus (which would strand the caller without any ack) or
	// claiming a success the questionnaire never saw.
	try {
		target.done(validated.result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return reject(`the questionnaire could not accept the answer: ${message}`, target.promptId);
	}
	return { ok: true, promptId: target.promptId };
}

/**
 * Answer a waiting questionnaire from programmatic code. Runs the same
 * validation and delivery the `rpiv:ask-user:answer` event runs, without the
 * bus. Returns `true` when the questionnaire took the answer and closed;
 * `false`, with no side effects, when nothing is waiting, the targeted
 * `promptId` is unknown or already answered, or the answer does not belong to
 * that questionnaire.
 */
export function submitAskUserAnswer(result: AskUserAnswerResult, promptId?: string): boolean {
	return deliverAskAnswer(result, promptId).ok;
}

/**
 * Install the inbound `rpiv:ask-user:answer` listener and acknowledge every
 * attempt on `rpiv:ask-user:answer-result`. Call once, at extension
 * registration.
 *
 * The ack echoes `requestId` back to the caller, names the `promptId` the
 * verdict applies to, and carries a `reason` for every rejection, so a remote
 * client gets an answer about its answer instead of silence.
 *
 * One registration installs one listener. A process that registered the tool
 * twice would answer through the first listener and report a miss through the
 * second, which is the same shape of trouble as registering the tool twice; the
 * shared stack is what keeps `submitAskUserAnswer` working from either module
 * instance.
 */
export function installAskAnswerChannel(events: AskAnswerBus): void {
	events.on(ASK_USER_ANSWER_EVENT, (data: unknown) => {
		const payload = (data ?? {}) as { result?: unknown; promptId?: unknown; requestId?: unknown };
		const promptId = typeof payload.promptId === "string" ? payload.promptId : undefined;
		const requestId = typeof payload.requestId === "string" ? payload.requestId : undefined;
		const outcome = deliverAskAnswer(payload.result, promptId);
		const ack: AskUserAnswerResultEventPayload = {
			ok: outcome.ok,
			...(!outcome.ok ? { reason: outcome.reason } : {}),
			...(outcome.promptId !== undefined ? { promptId: outcome.promptId } : {}),
			...(requestId !== undefined ? { requestId } : {}),
		};
		events.emit(ASK_USER_ANSWER_RESULT_EVENT, ack);
	});
}
