import { type Static, Type } from "@sinclair/typebox";

export const MAX_QUESTIONS = 4;

export const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
	preview: Type.Optional(
		Type.String({ description: "Optional markdown preview shown side-by-side with the option list" }),
	),
});

export const QuestionSchema = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	header: Type.Optional(Type.String({ description: "Section header for the question" })),
	options: Type.Array(OptionSchema, { minItems: 1, description: "Options for the user to choose from" }),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Allow multiple selections. Default: false", default: false }),
	),
});

export const QuestionsSchema = Type.Array(QuestionSchema, {
	minItems: 1,
	maxItems: MAX_QUESTIONS,
	description: "List of questions to ask the user (1–4 questions per invocation)",
});

export const QuestionParamsSchema = Type.Object({
	questions: QuestionsSchema,
});

export type OptionData = Static<typeof OptionSchema>;
export type QuestionData = Static<typeof QuestionSchema>;
export type QuestionParams = Static<typeof QuestionParamsSchema>;

export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	answer: string | null;
	selected?: string[];
	wasCustom?: boolean;
	wasChat?: boolean;
	notes?: string;
}

export type QuestionnaireError = "no_ui" | "no_questions" | "empty_options" | "too_many_questions";

export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	error?: QuestionnaireError;
}

export function isQuestionnaireResult(value: unknown): value is QuestionnaireResult {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return Array.isArray(v.answers) && typeof v.cancelled === "boolean";
}
