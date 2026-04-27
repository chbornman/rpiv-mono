import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
	isQuestionnaireResult,
	MAX_QUESTIONS,
	type QuestionAnswer,
	type QuestionData,
	type QuestionnaireResult,
	QuestionParamsSchema,
	QuestionsSchema,
} from "./types.js";

function makeQuestion(override: Partial<QuestionData> = {}): QuestionData {
	return {
		question: override.question ?? "What's your name?",
		header: override.header,
		options: override.options ?? [{ label: "A" }, { label: "B" }],
		multiSelect: override.multiSelect,
	};
}

describe("QuestionsSchema — array constraints", () => {
	it("accepts a single question", () => {
		expect(Value.Check(QuestionsSchema, [makeQuestion()])).toBe(true);
	});

	it("accepts MAX_QUESTIONS (4) questions", () => {
		const four = [makeQuestion(), makeQuestion(), makeQuestion(), makeQuestion()];
		expect(Value.Check(QuestionsSchema, four)).toBe(true);
	});

	it("rejects empty array (minItems=1)", () => {
		expect(Value.Check(QuestionsSchema, [])).toBe(false);
	});

	it("rejects > MAX_QUESTIONS items (maxItems=4)", () => {
		const five = [makeQuestion(), makeQuestion(), makeQuestion(), makeQuestion(), makeQuestion()];
		expect(Value.Check(QuestionsSchema, five)).toBe(false);
		expect(MAX_QUESTIONS).toBe(4);
	});
});

describe("QuestionSchema — option/preview/multiSelect/header shape", () => {
	it("accepts options with optional preview field", () => {
		const q = makeQuestion({
			options: [{ label: "A", description: "alpha", preview: "## A\n\nbody" }, { label: "B" }],
		});
		expect(Value.Check(QuestionsSchema, [q])).toBe(true);
	});

	it("accepts a question with all optional fields populated", () => {
		const q: QuestionData = {
			question: "Pick architecture",
			header: "Architecture",
			options: [
				{ label: "Monolith", description: "Single deployable unit", preview: "## Monolith\n\nSimple" },
				{ label: "Microservices", description: "Distributed services", preview: "## Micro\n\nScalable" },
			],
			multiSelect: false,
		};
		expect(Value.Check(QuestionsSchema, [q])).toBe(true);
	});

	it("accepts multiSelect: true", () => {
		expect(Value.Check(QuestionsSchema, [makeQuestion({ multiSelect: true })])).toBe(true);
	});

	it("accepts header field", () => {
		expect(Value.Check(QuestionsSchema, [makeQuestion({ header: "Architecture" })])).toBe(true);
	});

	it("accepts a single-option question", () => {
		expect(Value.Check(QuestionsSchema, [makeQuestion({ options: [{ label: "OK" }] })])).toBe(true);
	});

	it("rejects empty options array (minItems=1 on options)", () => {
		expect(Value.Check(QuestionsSchema, [makeQuestion({ options: [] })])).toBe(false);
	});

	it("rejects question with missing 'question' text", () => {
		const broken = { options: [{ label: "A" }] } as unknown;
		expect(Value.Check(QuestionsSchema, [broken])).toBe(false);
	});
});

describe("QuestionParamsSchema — top-level shape", () => {
	it("accepts { questions: [...] }", () => {
		expect(Value.Check(QuestionParamsSchema, { questions: [makeQuestion()] })).toBe(true);
	});

	it("accepts full valid payload with preview + multiSelect", () => {
		const payload = {
			questions: [
				{
					question: "Choose",
					header: "Pick",
					multiSelect: true,
					options: [{ label: "A", description: "First", preview: "# A" }, { label: "B" }],
				},
			],
		};
		expect(Value.Check(QuestionParamsSchema, payload)).toBe(true);
	});

	it("rejects missing 'questions' field", () => {
		expect(Value.Check(QuestionParamsSchema, {})).toBe(false);
	});

	it("rejects non-array questions field", () => {
		expect(Value.Check(QuestionParamsSchema, { questions: "not array" })).toBe(false);
	});
});

describe("QuestionAnswer — notes field optionality", () => {
	it("accepts an answer with notes populated", () => {
		const a: QuestionAnswer = {
			questionIndex: 0,
			question: "Q?",
			answer: "A",
			wasCustom: false,
			notes: "preview looked good",
		};
		expect(a.notes).toBe("preview looked good");
	});

	it("accepts an answer with selected[] (multi-select) and no answer scalar", () => {
		const a: QuestionAnswer = {
			questionIndex: 1,
			question: "Areas?",
			answer: null,
			selected: ["Frontend", "Backend"],
		};
		expect(a.selected).toEqual(["Frontend", "Backend"]);
		expect(a.answer).toBeNull();
	});
});

describe("isQuestionnaireResult — type guard", () => {
	it("accepts a valid result", () => {
		const r: QuestionnaireResult = { answers: [], cancelled: false };
		expect(isQuestionnaireResult(r)).toBe(true);
	});

	it("accepts a result with error field", () => {
		expect(isQuestionnaireResult({ answers: [], cancelled: true, error: "no_ui" })).toBe(true);
	});

	it("accepts a result with populated answers", () => {
		expect(
			isQuestionnaireResult({
				answers: [{ questionIndex: 0, question: "Q?", answer: "A" }],
				cancelled: false,
			}),
		).toBe(true);
	});

	it("rejects null / undefined", () => {
		expect(isQuestionnaireResult(null)).toBe(false);
		expect(isQuestionnaireResult(undefined)).toBe(false);
	});

	it("rejects primitives", () => {
		expect(isQuestionnaireResult(42)).toBe(false);
		expect(isQuestionnaireResult("oops")).toBe(false);
	});

	it("rejects an array", () => {
		expect(isQuestionnaireResult([])).toBe(false);
	});

	it("rejects missing fields", () => {
		expect(isQuestionnaireResult({ answers: [] })).toBe(false);
		expect(isQuestionnaireResult({ cancelled: true })).toBe(false);
	});
});
