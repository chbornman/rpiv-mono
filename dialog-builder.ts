import { DynamicBorder, type Theme } from "@mariozechner/pi-coding-agent";
import { type Component, Container, type Input, Spacer, Text } from "@mariozechner/pi-tui";
import { FixedHeightBox } from "./fixed-height-box.js";
import type { MultiSelectOptions } from "./multi-select-options.js";
import type { PreviewPane } from "./preview-pane.js";
import type { TabBar } from "./tab-bar.js";
import type { QuestionAnswer, QuestionData } from "./types.js";
import type { WrappingSelect } from "./wrapping-select.js";

export const HINT_SINGLE = "↑↓ navigate · Enter select · Esc cancel";
export const HINT_MULTI = "Tab/←→ navigate · ↑↓ select · Enter confirm · Esc cancel";
export const HINT_MULTISELECT_SUFFIX = " · Space toggle · Enter confirm";
export const HINT_NOTES_SUFFIX = " · n for notes";
export const SUBMIT_READY = "Ready to submit";
export const SUBMIT_HINT_READY = "Enter submit · Esc cancel";
export const SUBMIT_HINT_INCOMPLETE_PREFIX = "Answer remaining questions before submitting:";

export interface DialogState {
	currentTab: number;
	optionIndex: number;
	notesVisible: boolean;
	inputMode: boolean;
	answers: ReadonlyMap<number, QuestionAnswer>;
	multiSelectChecked: ReadonlySet<number>;
}

export interface DialogConfig {
	theme: Theme;
	questions: readonly QuestionData[];
	state: DialogState;
	previewPane: PreviewPane;
	tabBar: TabBar | undefined;
	notesInput: Input;
	chatList: WrappingSelect;
	isMulti: boolean;
	multiSelectOptionsByTab: ReadonlyArray<MultiSelectOptions | undefined>;
	getBodyHeight: (width: number) => number;
}

export interface DialogComponent extends Component {
	setState(state: DialogState): void;
	setPreviewPane(previewPane: PreviewPane): void;
}

export function buildDialog(config: DialogConfig): DialogComponent {
	let liveConfig: DialogConfig = config;

	const component: DialogComponent = {
		setState(state: DialogState) {
			liveConfig = { ...liveConfig, state };
		},
		setPreviewPane(previewPane: PreviewPane) {
			liveConfig = { ...liveConfig, previewPane };
		},
		handleInput() {},
		invalidate() {
			liveConfig.previewPane.invalidate();
			liveConfig.tabBar?.invalidate();
			liveConfig.notesInput.invalidate();
			liveConfig.chatList.invalidate();
		},
		render(width: number): string[] {
			return renderDialog(liveConfig, width);
		},
	};
	return component;
}

function renderDialog(config: DialogConfig, width: number): string[] {
	const { state, questions, isMulti } = config;
	const onSubmit = isMulti && state.currentTab === questions.length;
	if (onSubmit) {
		return buildSubmitContainer(config).render(width);
	}
	return buildQuestionContainer(config).render(width);
}

function buildSubmitContainer(config: DialogConfig): Container {
	const { theme, questions, state, tabBar } = config;
	const container = new Container();
	const border = () => new DynamicBorder((s) => theme.fg("accent", s));

	container.addChild(border());
	if (tabBar) container.addChild(tabBar);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.bold(theme.fg("accent", SUBMIT_READY)), 1, 0));
	container.addChild(new Spacer(1));

	const missing: string[] = [];
	for (let i = 0; i < questions.length; i++) {
		const q = questions[i];
		const label = q.header && q.header.length > 0 ? q.header : `Q${i + 1}`;
		const a = state.answers.get(i);
		if (!a) {
			missing.push(label);
			container.addChild(new Text(theme.fg("warning", `✖ ${label}: — unanswered`), 1, 0));
			continue;
		}
		const answerText = formatAnswerForSummary(a);
		const line = `${theme.fg("muted", `${label}: `)}${theme.fg("text", answerText)}`;
		container.addChild(new Text(line, 1, 0));
		if (a.notes && a.notes.length > 0) {
			container.addChild(new Text(theme.fg("dim", `    notes: ${a.notes}`), 1, 0));
		}
	}

	container.addChild(new Spacer(1));
	container.addChild(border());
	container.addChild(new Spacer(1));
	const hint =
		missing.length === 0
			? theme.fg("dim", SUBMIT_HINT_READY)
			: theme.fg("warning", `${SUBMIT_HINT_INCOMPLETE_PREFIX} ${missing.join(", ")}`);
	container.addChild(new Text(hint, 1, 0));
	return container;
}

function buildQuestionContainer(config: DialogConfig): Container {
	const { theme, questions, state, previewPane, tabBar, notesInput, chatList, isMulti } = config;
	const question = questions[state.currentTab];
	const container = new Container();
	const border = () => new DynamicBorder((s) => theme.fg("accent", s));

	container.addChild(border());
	if (isMulti && tabBar) container.addChild(tabBar);
	container.addChild(new Spacer(1));

	if (question?.header && question.header.length > 0) {
		container.addChild(new Text(theme.bg("selectedBg", ` ${question.header} `), 1, 0));
		container.addChild(new Spacer(1));
	}
	if (question) {
		container.addChild(new Text(theme.bold(question.question), 1, 0));
		container.addChild(new Spacer(1));
	}

	const mso = config.multiSelectOptionsByTab[state.currentTab];
	if (question?.multiSelect === true && mso) {
		mso.setState(state);
		container.addChild(new FixedHeightBox(mso, config.getBodyHeight));
	} else {
		container.addChild(new FixedHeightBox(previewPane, config.getBodyHeight));
	}
	container.addChild(new Spacer(1));

	if (state.notesVisible) {
		container.addChild(new Text(theme.fg("muted", "Notes:"), 1, 0));
		container.addChild(notesInput);
		container.addChild(new Spacer(1));
	}

	container.addChild(border());
	container.addChild(chatList);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("dim", buildHintText(question, isMulti, state)), 1, 0));
	return container;
}

function buildHintText(question: QuestionData | undefined, isMulti: boolean, state: DialogState): string {
	const base = isMulti ? HINT_MULTI : HINT_SINGLE;
	let hint = base;
	if (question?.multiSelect === true) hint += HINT_MULTISELECT_SUFFIX;
	if (question?.multiSelect !== true && state.answers.has(state.currentTab) && !state.notesVisible) {
		hint += HINT_NOTES_SUFFIX;
	}
	return hint;
}

function formatAnswerForSummary(a: QuestionAnswer): string {
	if (a.wasChat) return "User wants to chat about this";
	if (a.selected && a.selected.length > 0) return a.selected.join(", ");
	if (a.wasCustom) return a.answer ?? "(no input)";
	return a.answer ?? "(no answer)";
}
