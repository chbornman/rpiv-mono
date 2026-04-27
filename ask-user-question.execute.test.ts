import { createMockCtx, createMockPi } from "@juicesharp/rpiv-test-utils";
import { describe, expect, it, vi } from "vitest";
import { registerAskUserQuestionTool } from "./ask-user-question.js";
import { MAX_QUESTIONS, type QuestionnaireResult } from "./types.js";

type CustomFn = (...args: unknown[]) => Promise<unknown>;

function register() {
	const { pi, captured } = createMockPi();
	registerAskUserQuestionTool(pi);
	return captured.tools.get("ask_user_question")!;
}

function ctxWithCustom(result: QuestionnaireResult | null) {
	const custom = vi.fn(async () => result) as unknown as CustomFn;
	return createMockCtx({ hasUI: true, ui: { custom } as never });
}

const BASE_PARAMS = {
	questions: [
		{
			question: "Which?",
			header: "Pick",
			options: [{ label: "A" }, { label: "B" }],
		},
	],
};

describe("ask_user_question.execute — early returns", () => {
	it("returns cancelled result + ERROR_NO_UI when !hasUI", async () => {
		const tool = register();
		const ctx = createMockCtx({ hasUI: false });
		const r = await tool.execute?.("tc", BASE_PARAMS as never, undefined as never, undefined as never, ctx as never);
		expect(r?.details).toMatchObject({ answers: [], cancelled: true, error: "no_ui" });
		expect(r?.content[0]).toMatchObject({ text: expect.stringContaining("UI not available") });
	});

	it("returns cancelled result when any question has empty options", async () => {
		const tool = register();
		const ctx = ctxWithCustom(null);
		const r = await tool.execute?.(
			"tc",
			{ questions: [{ question: "Q?", options: [] }] } as never,
			undefined as never,
			undefined as never,
			ctx as never,
		);
		expect(r?.details).toMatchObject({ cancelled: true, error: "empty_options" });
		expect(r?.content[0]).toMatchObject({ text: expect.stringContaining("no options") });
	});

	it("returns ERROR_NO_QUESTIONS text when questions array is empty", async () => {
		const tool = register();
		const ctx = ctxWithCustom(null);
		const r = await tool.execute?.(
			"tc",
			{ questions: [] } as never,
			undefined as never,
			undefined as never,
			ctx as never,
		);
		expect(r?.details).toMatchObject({ answers: [], cancelled: true, error: "no_questions" });
		expect(r?.content[0]).toMatchObject({ text: expect.stringContaining("At least one question") });
	});

	it("returns error: too_many_questions when questions exceed MAX_QUESTIONS", async () => {
		const tool = register();
		const ctx = ctxWithCustom(null);
		const tooMany = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({
			question: `Q${i}?`,
			options: [{ label: "A" }],
		}));
		const r = await tool.execute?.(
			"tc",
			{ questions: tooMany } as never,
			undefined as never,
			undefined as never,
			ctx as never,
		);
		expect(r?.details).toMatchObject({ cancelled: true, error: "too_many_questions" });
		expect(r?.content[0]).toMatchObject({ text: expect.stringContaining("At most") });
	});
});

describe("ask_user_question.execute — ctx.ui.custom dispatch", () => {
	it("User cancels (cancelled: true) → decline envelope", async () => {
		const tool = register();
		const ctx = ctxWithCustom({ answers: [], cancelled: true });
		const r = await tool.execute?.("tc", BASE_PARAMS as never, undefined as never, undefined as never, ctx as never);
		expect(r?.details).toMatchObject({ cancelled: true });
		expect(r?.content[0]).toMatchObject({ text: expect.stringContaining("declined") });
	});

	it("Normal selection → 'Pick: User selected: A'", async () => {
		const tool = register();
		const ctx = ctxWithCustom({
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Which?", answer: "A", wasCustom: false }],
		});
		const r = await tool.execute?.("tc", BASE_PARAMS as never, undefined as never, undefined as never, ctx as never);
		expect(r?.content[0]).toMatchObject({ text: "Pick: User selected: A" });
	});

	it("Custom typed answer sets wasCustom", async () => {
		const tool = register();
		const ctx = ctxWithCustom({
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Which?", answer: "typed", wasCustom: true }],
		});
		const r = await tool.execute?.("tc", BASE_PARAMS as never, undefined as never, undefined as never, ctx as never);
		expect(r?.content[0]).toMatchObject({ text: expect.stringContaining("User answered: typed") });
	});
});

describe("ask_user_question — registration", () => {
	it("registers a typebox schema with a top-level questions array", () => {
		const tool = register();
		expect(tool.name).toBe("ask_user_question");
		const props = (tool.parameters as unknown as { properties: Record<string, unknown> }).properties;
		expect(props).toHaveProperty("questions");
	});
});
