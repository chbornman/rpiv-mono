import { DynamicBorder, type ExtensionAPI, type Theme } from "@mariozechner/pi-coding-agent";
import { Container, getKeybindings, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { WrappingSelect, type WrappingSelectItem, type WrappingSelectTheme } from "./wrapping-select.js";

const MAX_VISIBLE_ROWS = 10;

const TYPE_SOMETHING_LABEL = "Type something.";
const CHAT_ABOUT_THIS_LABEL = "Chat about this";
const NAV_HINT = "Enter to select · ↑/↓ to navigate · Esc to cancel";

const DECLINE_MESSAGE = "User declined to answer questions";
const CHAT_CONTINUATION_MESSAGE = "User wants to chat about this. Continue the conversation to help them decide.";
const CHAT_ANSWER_TAG = "User wants to chat about this";
const NO_INPUT_PLACEHOLDER = "(no input)";
const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";
const ERROR_NO_OPTIONS = "Error: No options provided";

const KEYBIND_UP = "tui.select.up";
const KEYBIND_DOWN = "tui.select.down";
const KEYBIND_CONFIRM = "tui.select.confirm";
const KEYBIND_CANCEL = "tui.select.cancel";

const BACKSPACE_CHARS = new Set(["\x7f", "\b"]);
const ESC_SEQUENCE_PREFIX = "\x1b";

interface QuestionOption {
	label: string;
	description?: string;
}

interface QuestionParams {
	question: string;
	header?: string;
	options: QuestionOption[];
}

interface ToolDetails {
	question: string;
	answer: string | null;
	wasCustom?: boolean;
	wasChat?: boolean;
}

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
	const OptionSchema = Type.Object({
		label: Type.String({ description: "Display label for the option" }),
		description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
	});

	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description:
			"Ask the user a structured question with selectable options. Use when you need user input to proceed — choosing between approaches, confirming scope, resolving ambiguities. The user can also type a custom answer.",
		promptSnippet: "Ask the user a structured question when requirements are ambiguous",
		promptGuidelines: [
			"Use the ask_user_question tool whenever the user's request is underspecified and you cannot proceed without a concrete decision.",
			"Prefer ask_user_question over prose 'please tell me X' — the structured selector gives the user concrete options and records their choice in session history.",
			"This replaces the AskUserQuestion tool from Claude Code. The user can always pick 'Other (type your own answer)' for free-text input.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the user" }),
			header: Type.Optional(Type.String({ description: "Section header for the question" })),
			options: Type.Array(OptionSchema, { description: "Options for the user to choose from" }),
			multiSelect: Type.Optional(
				Type.Boolean({ description: "Allow multiple selections. Default: false", default: false }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) return buildToolResult(ERROR_NO_UI, { question: params.question, answer: null });
			if (params.options.length === 0)
				return buildToolResult(ERROR_NO_OPTIONS, { question: params.question, answer: null });

			const mainItems = buildMainItems(params.options);
			const chatItems: WrappingSelectItem[] = [{ label: CHAT_ABOUT_THIS_LABEL, isChat: true }];
			const totalCount = mainItems.length + chatItems.length;

			const choice = await ctx.ui.custom<WrappingSelectItem | null>((tui, theme, _kb, done) => {
				const selectTheme: WrappingSelectTheme = {
					selectedText: (t) => theme.fg("accent", theme.bold(t)),
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
				};

				const mainList = new WrappingSelect(mainItems, Math.min(mainItems.length, MAX_VISIBLE_ROWS), selectTheme, {
					totalItemsForNumbering: totalCount,
				});
				const chatList = new WrappingSelect(chatItems, 1, selectTheme, {
					numberStartOffset: mainItems.length,
					totalItemsForNumbering: totalCount,
				});

				let selectionIndex = 0;
				const applySelection = () => {
					const isInMainList = selectionIndex < mainItems.length;
					mainList.setFocused(isInMainList);
					chatList.setFocused(!isInMainList);
					if (isInMainList) {
						mainList.setSelectedIndex(selectionIndex);
					} else {
						chatList.setSelectedIndex(selectionIndex - mainItems.length);
					}
				};
				applySelection();

				const container = buildDialogContainer(theme, params, mainList, chatList);

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						const currentItem = itemAt(selectionIndex, mainItems, chatItems);
						const isInlineInputActive = !!currentItem?.isOther;
						const action = dispatchQuestionInput(data, {
							selectionIndex,
							totalCount,
							currentItem,
							isInlineInputActive,
							inputBuffer: mainList.getInputBuffer(),
							keybindings: getKeybindings(),
						});
						switch (action.kind) {
							case "nav":
								if (isInlineInputActive) mainList.clearInputBuffer();
								selectionIndex = action.nextIndex;
								applySelection();
								tui.requestRender();
								return;
							case "confirm":
								done(action.choice);
								return;
							case "cancel":
								done(null);
								return;
							case "backspace":
								mainList.backspaceInput();
								tui.requestRender();
								return;
							case "append":
								mainList.appendInput(action.data);
								tui.requestRender();
								return;
							case "ignore":
								return;
						}
					},
				};
			});

			return buildResponse(choice, params);
		},
	});
}

export function buildMainItems(options: QuestionOption[]): WrappingSelectItem[] {
	return [
		...options.map((o) => ({ label: o.label, description: o.description })),
		{ label: TYPE_SOMETHING_LABEL, isOther: true },
	];
}

export function itemAt(
	index: number,
	mainItems: WrappingSelectItem[],
	chatItems: WrappingSelectItem[],
): WrappingSelectItem | undefined {
	return index < mainItems.length ? mainItems[index] : chatItems[index - mainItems.length];
}

export function wrapIndex(index: number, total: number): number {
	return ((index % total) + total) % total;
}

export type QuestionInputAction =
	| { kind: "nav"; nextIndex: number }
	| { kind: "confirm"; choice: WrappingSelectItem }
	| { kind: "cancel" }
	| { kind: "backspace" }
	| { kind: "append"; data: string }
	| { kind: "ignore" };

export interface DispatchState {
	selectionIndex: number;
	totalCount: number;
	currentItem: WrappingSelectItem | undefined;
	isInlineInputActive: boolean;
	inputBuffer: string;
	keybindings: { matches(data: string, name: string): boolean };
}

export function dispatchQuestionInput(data: string, state: DispatchState): QuestionInputAction {
	const { keybindings: kb } = state;
	if (kb.matches(data, KEYBIND_UP)) {
		return { kind: "nav", nextIndex: wrapIndex(state.selectionIndex - 1, state.totalCount) };
	}
	if (kb.matches(data, KEYBIND_DOWN)) {
		return { kind: "nav", nextIndex: wrapIndex(state.selectionIndex + 1, state.totalCount) };
	}
	if (kb.matches(data, KEYBIND_CONFIRM)) {
		if (state.isInlineInputActive) {
			return { kind: "confirm", choice: { label: state.inputBuffer, isOther: true } };
		}
		if (state.currentItem) {
			return { kind: "confirm", choice: state.currentItem };
		}
		return { kind: "ignore" };
	}
	if (kb.matches(data, KEYBIND_CANCEL)) {
		return { kind: "cancel" };
	}
	if (state.isInlineInputActive) {
		if (BACKSPACE_CHARS.has(data)) {
			return { kind: "backspace" };
		}
		if (data && !data.startsWith(ESC_SEQUENCE_PREFIX)) {
			return { kind: "append", data };
		}
	}
	return { kind: "ignore" };
}

export function buildDialogContainer(
	theme: Theme,
	params: QuestionParams,
	mainList: WrappingSelect,
	chatList: WrappingSelect,
): Container {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));

	container.addChild(border());
	container.addChild(new Spacer(1));
	if (params.header) {
		container.addChild(new Text(theme.bg("selectedBg", ` ${params.header} `), 1, 0));
		container.addChild(new Spacer(1));
	}
	container.addChild(new Text(theme.bold(params.question), 1, 0));
	container.addChild(new Spacer(1));
	container.addChild(mainList);
	container.addChild(new Spacer(1));
	container.addChild(border());
	container.addChild(chatList);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("dim", NAV_HINT), 1, 0));
	return container;
}

export function buildResponse(choice: WrappingSelectItem | null, params: QuestionParams) {
	if (!choice) {
		return buildToolResult(DECLINE_MESSAGE, { question: params.question, answer: null });
	}
	if (choice.isOther) {
		const customAnswer = choice.label.length > 0 ? choice.label : null;
		return buildToolResult(`User answered: ${customAnswer ?? NO_INPUT_PLACEHOLDER}`, {
			question: params.question,
			answer: customAnswer,
			wasCustom: true,
		});
	}
	if (choice.isChat) {
		return buildToolResult(CHAT_CONTINUATION_MESSAGE, {
			question: params.question,
			answer: CHAT_ANSWER_TAG,
			wasChat: true,
		});
	}
	return buildToolResult(`User selected: ${choice.label}`, {
		question: params.question,
		answer: choice.label,
		wasCustom: false,
	});
}

export function buildToolResult(text: string, details: ToolDetails) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}
