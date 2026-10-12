import { createMockCtx, createMockPi } from "@juicesharp/rpiv-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetActiveAsks, activeAskCount } from "./ask-answer.js";
import { registerAskUserQuestionTool } from "./ask-user-question.js";
import {
	ASK_USER_ANSWER_EVENT,
	ASK_USER_ANSWER_RESULT_EVENT,
	ASK_USER_BLOCKED_EVENT,
	ASK_USER_PROMPT_EVENT,
	type AskUserAnswerEventPayload,
	type AskUserAnswerResultEventPayload,
	type AskUserPromptEventPayload,
} from "./events.js";
import { type Presentation, resolvePresentation } from "./presentation.js";
import type { QuestionParams } from "./tool/types.js";

/**
 * End-to-end tests for the `rpiv:ask-user:answer` channel: the tool is
 * registered on a mock pi carrying a real event bus (the default mock's
 * `events.on` never dispatches), a questionnaire is opened through the real
 * `ctx.ui.custom` factory, and the answer arrives the way a remote bridge sends
 * it. Running the production factory means these cases also prove the
 * registration sits where the production code puts it: an answer only reaches a
 * questionnaire whose mount actually ran.
 */

const identityTheme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
	strikethrough: (s: string) => s,
};

const SINGLE: QuestionParams = {
	questions: [
		{
			question: "Which library?",
			header: "Lib",
			options: [
				{ label: "React", description: "UI library" },
				{ label: "Vue", description: "Another UI library" },
			],
		},
	],
};

const MULTI: QuestionParams = {
	questions: [
		{
			question: "Which features?",
			header: "Features",
			options: [
				{ label: "Auth", description: "Add auth" },
				{ label: "Tests", description: "Add tests" },
			],
			multiSelect: true,
		},
	],
};

interface ToolResult {
	content: Array<{ text: string }>;
	details: Record<string, unknown>;
}

type BusHandler = (data: unknown) => void;

function makeBus() {
	const handlers = new Map<string, BusHandler[]>();
	const emitted: Array<{ channel: string; data: unknown }> = [];
	const emit = vi.fn((channel: string, data: unknown) => {
		emitted.push({ channel, data });
		for (const handler of handlers.get(channel) ?? []) handler(data);
	});
	/** Payloads emitted on one channel, in order. */
	const sent = (channel: string) => emitted.filter((entry) => entry.channel === channel).map((entry) => entry.data);
	return {
		emit,
		on: vi.fn((channel: string, handler: BusHandler) => {
			handlers.set(channel, [...(handlers.get(channel) ?? []), handler]);
			return () =>
				handlers.set(
					channel,
					(handlers.get(channel) ?? []).filter((h) => h !== handler),
				);
		}),
		sent,
		/** Every ack the answer channel sent, in order. */
		acks: () => sent(ASK_USER_ANSWER_RESULT_EVENT) as AskUserAnswerResultEventPayload[],
		/** Every prompt event the tool sent, in order. */
		prompts: () => sent(ASK_USER_PROMPT_EVENT) as AskUserPromptEventPayload[],
		/** Send an answer the way a remote client does: on the bus, by name. */
		send: (payload: Partial<AskUserAnswerEventPayload>) => emit(ASK_USER_ANSWER_EVENT, payload),
	};
}

function register(bus: ReturnType<typeof makeBus>) {
	const { pi, captured } = createMockPi({ events: bus as never });
	registerAskUserQuestionTool(pi);
	return captured.tools.get("ask_user_question")!;
}

/**
 * Poll until an assertion holds. The tool awaits the lazy render-graph import
 * before it mounts, so "the prompt event fired" is NOT yet "the questionnaire is
 * waiting"; callers wait on the registration itself.
 */
async function until(assertion: () => void, timeout = 10_000): Promise<void> {
	await vi.waitFor(assertion, { timeout, interval: 5 });
}

interface OpenAsk {
	/** Resolves when the questionnaire closes, with the tool's envelope. */
	settled: Promise<ToolResult>;
	/** The promptId this questionnaire advertised. */
	promptId: string;
}

/**
 * Open a questionnaire and leave it waiting: `ui.custom` runs the real factory
 * and returns a promise only the trapped `done` can settle, which is exactly the
 * state an inbound answer needs. Returns once the registration is live.
 */
/**
 * Open a questionnaire and leave it waiting: `ui.custom` runs the real factory
 * and returns a promise only the trapped `done` can settle, which is exactly the
 * state an inbound answer needs. Returns once this ask's registration is live
 * (`expectedAsks` is how many should be waiting afterwards, counting an ask left
 * open by an earlier call).
 */
async function openAndWait(
	bus: ReturnType<typeof makeBus>,
	tool: ReturnType<typeof register>,
	params: QuestionParams,
	expectedAsks = 1,
): Promise<OpenAsk> {
	const custom = vi.fn(
		(factory: (tui: unknown, theme: unknown, kb: unknown, done: (r: unknown) => void) => unknown) =>
			new Promise((resolve) => {
				factory(
					{ requestRender: vi.fn(), terminal: { columns: 120, rows: 24 } },
					identityTheme,
					undefined,
					resolve,
				);
			}),
	);
	const ctx = createMockCtx({ hasUI: true, ui: { custom } as never });
	const settled = tool.execute!(
		"tc",
		params as never,
		undefined as never,
		undefined as never,
		ctx as never,
	) as unknown as Promise<ToolResult>;
	await until(() => expect(activeAskCount()).toBe(expectedAsks));
	const promptId = bus.prompts()[bus.prompts().length - 1]!.promptId!;
	return { settled, promptId };
}

function pick(label: string) {
	return { answers: [{ questionIndex: 0, kind: "option" as const, answer: label }], cancelled: false };
}

describe("ask_user_question: the rpiv:ask-user:answer channel", () => {
	let bus: ReturnType<typeof makeBus>;
	let tool: ReturnType<typeof register>;

	beforeEach(() => {
		__resetActiveAsks();
		bus = makeBus();
		tool = register(bus);
	});

	it("answers a waiting questionnaire and resolves the tool with the structured envelope", async () => {
		const opened = await openAndWait(bus, tool, SINGLE);

		bus.send({ promptId: opened.promptId, result: pick("Vue") });
		const result = await opened.settled;

		expect(result.content[0]!.text).toContain("Vue");
		expect(result.details).toMatchObject({ cancelled: false });
		expect(bus.acks()).toEqual([{ ok: true, promptId: opened.promptId }]);
		// The mount's teardown drains its own registration; nothing leaks to the next call.
		expect(activeAskCount()).toBe(0);
	});

	it("refuses a promptId that is not waiting and leaves the open questionnaire alone", async () => {
		const opened = await openAndWait(bus, tool, SINGLE);

		bus.send({ promptId: "stale-id", result: { answers: [], cancelled: true } });
		expect(bus.acks()).toEqual([
			{ ok: false, promptId: "stale-id", reason: 'no questionnaire is waiting with promptId "stale-id"' },
		]);

		bus.send({ promptId: opened.promptId, result: { answers: [], cancelled: true } });
		expect((await opened.settled).details).toMatchObject({ cancelled: true });
	});

	it("refuses an answer that does not belong to the questionnaire, keeping it open", async () => {
		const opened = await openAndWait(bus, tool, SINGLE);

		bus.send({ requestId: "r-1", promptId: opened.promptId, result: pick("Svelte") });
		expect(bus.acks()).toEqual([
			{
				ok: false,
				promptId: opened.promptId,
				requestId: "r-1",
				reason: 'question 0: "Svelte" is not one of its options (React, Vue)',
			},
		]);
		expect(activeAskCount()).toBe(1);

		// Still answerable normally afterwards.
		bus.send({ promptId: opened.promptId, result: pick("React") });
		expect((await opened.settled).content[0]!.text).toContain("React");
	});

	it("treats a cancelled answer as a decline", async () => {
		const opened = await openAndWait(bus, tool, SINGLE);

		bus.send({ promptId: opened.promptId, result: { answers: [], cancelled: true, globalNote: "later" } });
		const result = await opened.settled;

		expect(result.details).toMatchObject({ cancelled: true, globalNote: "later" });
		expect(bus.acks()).toEqual([{ ok: true, promptId: opened.promptId }]);
	});

	it("a duplicate answer for an already-answered questionnaire is a miss", async () => {
		const opened = await openAndWait(bus, tool, SINGLE);

		bus.send({ promptId: opened.promptId, result: pick("Vue") });
		await opened.settled;
		bus.send({ promptId: opened.promptId, result: pick("Vue") });

		expect(bus.acks()).toEqual([
			{ ok: true, promptId: opened.promptId },
			{
				ok: false,
				promptId: opened.promptId,
				reason: `no questionnaire is waiting with promptId "${opened.promptId}"`,
			},
		]);
	});

	it("answers nothing while no questionnaire is open", () => {
		bus.send({ requestId: "r-0", result: { answers: [], cancelled: true } });
		expect(bus.acks()).toEqual([{ ok: false, requestId: "r-0", reason: "no questionnaire is awaiting input" }]);
	});

	it("leaves no phantom ask when the host can neither render nor take dialogs", async () => {
		// `custom` resolving undefined is the "host cannot render" signal, and with
		// no dialog primitives there is no walker either. The factory never ran, so
		// nothing ever registered.
		const ctx = createMockCtx({
			hasUI: true,
			ui: { custom: vi.fn(async () => undefined), select: undefined, input: undefined } as never,
		});
		const result = (await tool.execute!(
			"tc",
			SINGLE as never,
			undefined as never,
			undefined as never,
			ctx as never,
		)) as ToolResult;

		expect(result.details).toMatchObject({ error: "no_custom_ui" });
		expect(activeAskCount()).toBe(0);
		bus.send({ result: { answers: [], cancelled: true } });
		expect(bus.acks()).toEqual([{ ok: false, reason: "no questionnaire is awaiting input" }]);
	});

	it("the pre-mode RPC backstop advertises a promptId it can never answer to", async () => {
		// A host that predates `ctx.mode` cannot render but does have dialogs, so
		// the walker runs after `custom` resolved undefined. The prompt event was
		// already out with a promptId by then; the walker's own prompts belong to
		// the host, so that identity stays unanswerable.
		let resolveSelect: ((value: string) => void) | undefined;
		const select = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveSelect = resolve;
				}),
		);
		const ctx = createMockCtx({
			hasUI: true,
			ui: { custom: vi.fn(async () => undefined), select, input: vi.fn(async () => "") } as never,
		});
		const settled = tool.execute!(
			"tc",
			SINGLE as never,
			undefined as never,
			undefined as never,
			ctx as never,
		) as unknown as Promise<ToolResult>;
		await until(() => expect(select).toHaveBeenCalledTimes(1));

		const promptId = bus.prompts()[0]!.promptId!;
		expect(promptId).toEqual(expect.any(String));
		bus.send({ promptId, result: pick("React") });
		expect(bus.acks()).toEqual([
			{ ok: false, promptId, reason: `no questionnaire is waiting with promptId "${promptId}"` },
		]);

		resolveSelect!("1. React — UI library");
		expect((await settled).content[0]!.text).toContain("React");
	});

	it("drains the registration when the mount throws", async () => {
		const ctx = createMockCtx({
			hasUI: true,
			ui: {
				custom: vi.fn(
					(factory: (tui: unknown, theme: unknown, kb: unknown, done: (r: unknown) => void) => unknown) => {
						factory(
							{ requestRender: vi.fn(), terminal: { columns: 120, rows: 24 } },
							identityTheme,
							undefined,
							() => {},
						);
						throw new Error("UI failed");
					},
				),
			} as never,
		});
		await expect(
			tool.execute!("tc", SINGLE as never, undefined as never, undefined as never, ctx as never),
		).rejects.toThrow("UI failed");

		expect(activeAskCount()).toBe(0);
		bus.send({ result: { answers: [], cancelled: true } });
		expect(bus.acks()).toEqual([{ ok: false, reason: "no questionnaire is awaiting input" }]);
	});

	it("names the questionnaire on the prompt event and on both halves of the blocked bracket", async () => {
		const opened = await openAndWait(bus, tool, SINGLE);
		bus.send({ promptId: opened.promptId, result: { answers: [], cancelled: true } });
		await opened.settled;

		expect(bus.prompts()).toHaveLength(1);
		const bracket = bus.sent(ASK_USER_BLOCKED_EVENT) as Array<{ active: boolean; promptId: string }>;
		expect(bracket.map(({ active }) => active)).toEqual([true, false]);
		expect(bracket[0]!.promptId).toBe(opened.promptId);
		expect(bracket[1]!.promptId).toBe(opened.promptId);
	});
});

describe("ask_user_question: two questionnaires open at once", () => {
	// Pi runs tool calls in parallel. With the inline slot held by another
	// component (as a concurrent questionnaire would), both mounts render as
	// overlays, so both factories run and both registrations are live at once.
	let slotHolder: Presentation | undefined;
	let bus: ReturnType<typeof makeBus>;
	let tool: ReturnType<typeof register>;

	beforeEach(() => {
		__resetActiveAsks();
		slotHolder = resolvePresentation();
		bus = makeBus();
		tool = register(bus);
	});

	afterEach(() => {
		slotHolder?.release?.();
	});

	it("routes an untargeted answer to the newest ask and the older one by promptId", async () => {
		const older = await openAndWait(bus, tool, SINGLE);
		const newer = await openAndWait(bus, tool, MULTI, 2);
		expect(activeAskCount()).toBe(2);
		expect(older.promptId).not.toBe(newer.promptId);

		// No promptId: the question the user sees on top takes it.
		bus.send({ result: { answers: [{ questionIndex: 0, kind: "multi", selected: ["Auth"] }], cancelled: false } });
		expect(bus.acks()).toEqual([{ ok: true, promptId: newer.promptId }]);
		expect((await newer.settled).content[0]!.text).toContain("Auth");
		expect(activeAskCount()).toBe(1);

		// The older ask is still waiting, and is now the newest.
		bus.send({ result: pick("React") });
		expect((await older.settled).content[0]!.text).toContain("React");
		expect(activeAskCount()).toBe(0);
	});

	it("the older ask's teardown cannot drop the newer ask's registration", async () => {
		const older = await openAndWait(bus, tool, SINGLE);
		const newer = await openAndWait(bus, tool, MULTI, 2);

		// Decline the older one first: its mount's `finally` runs while the newer
		// one is still open, and must leave the newer registration intact.
		bus.send({ promptId: older.promptId, result: { answers: [], cancelled: true } });
		expect((await older.settled).details).toMatchObject({ cancelled: true });
		expect(activeAskCount()).toBe(1);

		bus.send({ result: { answers: [{ questionIndex: 0, kind: "multi", selected: ["Tests"] }], cancelled: false } });
		expect((await newer.settled).content[0]!.text).toContain("Tests");
		expect(activeAskCount()).toBe(0);
	});

	it("a validation miss on one ask is reported against that ask only", async () => {
		const older = await openAndWait(bus, tool, SINGLE);
		const newer = await openAndWait(bus, tool, MULTI, 2);

		bus.send({ requestId: "r-x", promptId: newer.promptId, result: pick("React") });
		// "React" is an option of the OLDER question, not the newer one.
		expect(bus.acks()).toEqual([
			{
				ok: false,
				promptId: newer.promptId,
				requestId: "r-x",
				reason: 'question 0: "React" is not one of its options (Auth, Tests)',
			},
		]);
		expect(activeAskCount()).toBe(2);

		bus.send({ promptId: older.promptId, result: pick("React") });
		expect((await older.settled).content[0]!.text).toContain("React");
	});
});

describe("ask_user_question: the RPC dialog path registers no answer target", () => {
	it("sends no promptId and refuses an inbound answer while a native dialog is open", async () => {
		const bus = makeBus();
		const tool = register(bus);

		let resolveSelect: ((value: string) => void) | undefined;
		const select = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveSelect = resolve;
				}),
		);
		const ctx = createMockCtx({ hasUI: true, mode: "rpc", ui: { select, input: vi.fn(async () => "") } as never });

		const settled = tool.execute!(
			"tc",
			SINGLE as never,
			undefined as never,
			undefined as never,
			ctx as never,
		) as unknown as Promise<ToolResult>;
		await until(() => expect(select).toHaveBeenCalledTimes(1));

		expect(bus.prompts()[0]).not.toHaveProperty("promptId");
		expect(activeAskCount()).toBe(0);

		bus.send({ requestId: "r-rpc", result: pick("Vue") });
		expect(bus.acks()).toEqual([{ ok: false, requestId: "r-rpc", reason: "no questionnaire is awaiting input" }]);

		resolveSelect!("React");
		expect((await settled).content[0]!.text).toContain("React");
	});
});
