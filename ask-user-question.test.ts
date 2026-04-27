import { describe, expect, it } from "vitest";
import { buildItemsForQuestion, buildQuestionnaireResponse, buildToolResult } from "./ask-user-question.js";
import type { QuestionnaireResult, QuestionParams } from "./types.js";

describe("buildItemsForQuestion", () => {
	it("appends the Type-something sentinel", () => {
		const items = buildItemsForQuestion({
			question: "q",
			options: [{ label: "A" }, { label: "B", description: "b-desc" }],
		});
		expect(items).toEqual([
			{ label: "A", description: undefined },
			{ label: "B", description: "b-desc" },
			{ label: "Type something.", isOther: true },
		]);
	});

	it("skips the sentinel when multiSelect is true", () => {
		const items = buildItemsForQuestion({
			question: "Pick areas",
			multiSelect: true,
			options: [{ label: "FE" }, { label: "BE" }, { label: "Tests" }],
		});
		expect(items).toEqual([
			{ label: "FE", description: undefined },
			{ label: "BE", description: undefined },
			{ label: "Tests", description: undefined },
		]);
		expect(items.some((i) => i.isOther)).toBe(false);
	});

	it("appends the sentinel when multiSelect is false", () => {
		const items = buildItemsForQuestion({
			question: "Pick one",
			multiSelect: false,
			options: [{ label: "Yes" }],
		});
		expect(items).toEqual([
			{ label: "Yes", description: undefined },
			{ label: "Type something.", isOther: true },
		]);
	});

	it("appends the sentinel when multiSelect is undefined (default single-select)", () => {
		const items = buildItemsForQuestion({
			question: "Pick one",
			options: [{ label: "No" }],
		});
		expect(items).toHaveLength(2);
		expect(items[1]).toEqual({ label: "Type something.", isOther: true });
	});
});

describe("buildQuestionnaireResponse — cancelled", () => {
	const params: QuestionParams = { questions: [{ question: "Q?", options: [{ label: "A" }] }] };

	it("null result → decline envelope + empty answers + cancelled true", () => {
		const r = buildQuestionnaireResponse(null, params);
		expect(r.content[0]).toEqual({ type: "text", text: "User declined to answer questions" });
		expect(r.details.cancelled).toBe(true);
		expect(r.details.answers).toEqual([]);
	});

	it("cancelled result preserves partial answers in details (not in content)", () => {
		const result: QuestionnaireResult = {
			cancelled: true,
			answers: [{ questionIndex: 0, question: "Q?", answer: "A", wasCustom: false }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0]).toMatchObject({ text: "User declined to answer questions" });
		expect(r.details.cancelled).toBe(true);
		expect(r.details.answers).toEqual(result.answers);
	});
});

describe("buildQuestionnaireResponse — completed", () => {
	it("single answered question → 'header: User selected: <label>'", () => {
		const params: QuestionParams = {
			questions: [{ question: "Pick one", header: "Architecture", options: [{ label: "Option A" }] }],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Pick one", answer: "Option A", wasCustom: false }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0]).toEqual({ type: "text", text: "Architecture: User selected: Option A" });
		expect(r.details).toBe(result);
	});

	it("missing header falls back to 'Q{n+1}:' label", () => {
		const params: QuestionParams = {
			questions: [{ question: "Pick", options: [{ label: "Yes" }] }],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Pick", answer: "Yes" }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0]).toMatchObject({ text: "Q1: User selected: Yes" });
	});

	it("empty string header falls back to 'Q{n+1}:' label", () => {
		const params: QuestionParams = {
			questions: [
				{ question: "Q1?", header: "", options: [{ label: "Yes" }] },
				{ question: "Q2?", header: "Real", options: [{ label: "No" }] },
			],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [
				{ questionIndex: 0, question: "Q1?", answer: "Yes" },
				{ questionIndex: 1, question: "Q2?", answer: "No" },
			],
		};
		const r = buildQuestionnaireResponse(result, params);
		const lines = r.content[0].text.split("\n");
		expect(lines[0]).toBe("Q1: User selected: Yes");
		expect(lines[1]).toBe("Real: User selected: No");
	});

	it("multiSelect answer → 'User selected: A, B, C' (selected[].join)", () => {
		const params: QuestionParams = {
			questions: [
				{ question: "Areas", header: "Areas", multiSelect: true, options: [{ label: "FE" }, { label: "BE" }] },
			],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Areas", answer: null, selected: ["FE", "BE"] }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0]).toMatchObject({ text: "Areas: User selected: FE, BE" });
	});

	it("custom typed answer → 'User answered: <text>'", () => {
		const params: QuestionParams = {
			questions: [{ question: "Free?", header: "Free", options: [{ label: "Yes" }] }],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Free?", answer: "my custom", wasCustom: true }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0]).toMatchObject({ text: "Free: User answered: my custom" });
	});

	it("empty custom answer → 'User answered: (no input)'", () => {
		const params: QuestionParams = {
			questions: [{ question: "Free?", header: "H", options: [{ label: "Yes" }] }],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Free?", answer: null, wasCustom: true }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0]).toMatchObject({ text: "H: User answered: (no input)" });
	});

	it("chat answer → 'User wants to chat...' continuation message", () => {
		const params: QuestionParams = {
			questions: [{ question: "Help", header: "Help", options: [{ label: "Yes" }] }],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Help", answer: "Chat about this", wasChat: true }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0].text).toContain("Continue the conversation");
	});

	it("notes are kept in details but excluded from content text", () => {
		const params: QuestionParams = {
			questions: [{ question: "Pick", header: "H", options: [{ label: "Yes" }] }],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Pick", answer: "Yes", notes: "because of X" }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0].text).not.toContain("because of X");
		expect(r.details.answers[0].notes).toBe("because of X");
	});

	it("cancelled: false with no matching answers never returns DECLINE_MESSAGE text", () => {
		const params: QuestionParams = {
			questions: [{ question: "Q?", options: [{ label: "A" }] }],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.details.cancelled).toBe(true);
		expect(r.content[0]).toEqual({ type: "text", text: "User declined to answer questions" });
	});
});

describe("buildQuestionnaireResponse — multi-question mixed types", () => {
	it("formats 2 answered questions with headers on separate lines", () => {
		const params: QuestionParams = {
			questions: [
				{ question: "Framework?", header: "Framework", options: [{ label: "React" }, { label: "Vue" }] },
				{ question: "Areas?", header: "Areas", multiSelect: true, options: [{ label: "FE" }, { label: "BE" }] },
			],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [
				{ questionIndex: 0, question: "Framework?", answer: "React", wasCustom: false },
				{ questionIndex: 1, question: "Areas?", answer: null, selected: ["FE", "BE"] },
			],
		};
		const r = buildQuestionnaireResponse(result, params);
		const text = r.content[0].text;
		expect(text).toContain("Framework: User selected: React");
		expect(text).toContain("Areas: User selected: FE, BE");
		expect(text.split("\n").length).toBe(2);
	});

	it("formats 3 questions with mixed answer types: regular, custom, chat", () => {
		const params: QuestionParams = {
			questions: [
				{ question: "Q1?", header: "Scope", options: [{ label: "A" }] },
				{ question: "Q2?", header: "Custom", options: [{ label: "X" }] },
				{ question: "Q3?", header: "Help", options: [{ label: "Y" }] },
			],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [
				{ questionIndex: 0, question: "Q1?", answer: "A", wasCustom: false },
				{ questionIndex: 1, question: "Q2?", answer: "my own thing", wasCustom: true },
				{ questionIndex: 2, question: "Q3?", answer: "Chat about this", wasChat: true },
			],
		};
		const r = buildQuestionnaireResponse(result, params);
		const lines = r.content[0].text.split("\n");
		expect(lines[0]).toBe("Scope: User selected: A");
		expect(lines[1]).toBe("Custom: User answered: my own thing");
		expect(lines[2]).toContain("Continue the conversation");
	});

	it("skips unanswered questions (missing answer in array)", () => {
		const params: QuestionParams = {
			questions: [
				{ question: "Q1?", header: "First", options: [{ label: "A" }] },
				{ question: "Q2?", header: "Second", options: [{ label: "B" }] },
			],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [{ questionIndex: 1, question: "Q2?", answer: "B", wasCustom: false }],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0].text).toBe("Second: User selected: B");
		expect(r.content[0].text).not.toContain("First");
	});

	it("preserves notes in details across multiple questions but never in content text", () => {
		const params: QuestionParams = {
			questions: [
				{ question: "Q1?", header: "H1", options: [{ label: "A" }] },
				{ question: "Q2?", header: "H2", options: [{ label: "B" }] },
			],
		};
		const result: QuestionnaireResult = {
			cancelled: false,
			answers: [
				{ questionIndex: 0, question: "Q1?", answer: "A", notes: "secret note 1" },
				{ questionIndex: 1, question: "Q2?", answer: "B", notes: "secret note 2" },
			],
		};
		const r = buildQuestionnaireResponse(result, params);
		expect(r.content[0].text).not.toContain("secret note");
		expect(r.details.answers[0].notes).toBe("secret note 1");
		expect(r.details.answers[1].notes).toBe("secret note 2");
	});
});

describe("buildToolResult", () => {
	it("locks the envelope shape", () => {
		const details: QuestionnaireResult = { answers: [], cancelled: false };
		const r = buildToolResult("msg", details);
		expect(r).toEqual({
			content: [{ type: "text", text: "msg" }],
			details: { answers: [], cancelled: false },
		});
	});

	it("passes details by reference (no clone)", () => {
		const details: QuestionnaireResult = { answers: [], cancelled: true };
		const r = buildToolResult("msg", details);
		expect(r.details).toBe(details);
	});

	it("accepts error field in envelope", () => {
		const details: QuestionnaireResult = { answers: [], cancelled: true, error: "no_questions" };
		const r = buildToolResult("msg", details);
		expect(r).toEqual({
			content: [{ type: "text", text: "msg" }],
			details: { answers: [], cancelled: true, error: "no_questions" },
		});
	});
});
