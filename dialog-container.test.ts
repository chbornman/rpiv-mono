import { makeTheme } from "@juicesharp/rpiv-test-utils";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, Input } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import {
	buildDialog,
	type DialogConfig,
	type DialogState,
	HINT_MULTI,
	HINT_MULTISELECT_SUFFIX,
	HINT_NOTES_SUFFIX,
	HINT_SINGLE,
	SUBMIT_HINT_INCOMPLETE_PREFIX,
	SUBMIT_HINT_READY,
	SUBMIT_READY,
} from "./dialog-builder.js";
import type { PreviewPane } from "./preview-pane.js";
import type { TabBar } from "./tab-bar.js";
import type { QuestionAnswer, QuestionData } from "./types.js";
import type { WrappingSelect } from "./wrapping-select.js";

const theme = makeTheme() as unknown as Theme;

function stubComponent(lines: string[]): Component {
	return {
		render: () => lines,
		handleInput() {},
		invalidate() {},
	};
}

function makeConfig(over: Partial<DialogConfig> = {}): DialogConfig {
	const questions: QuestionData[] = over.questions
		? [...over.questions]
		: [
				{ question: "Q1?", header: "H1", options: [{ label: "A" }, { label: "B" }] },
				{ question: "Q2?", header: "H2", options: [{ label: "X" }, { label: "Y" }] },
			];
	const state: DialogState = over.state ?? {
		currentTab: 0,
		optionIndex: 0,
		notesVisible: false,
		inputMode: false,
		answers: new Map(),
		multiSelectChecked: new Set(),
	};
	return {
		theme: over.theme ?? theme,
		questions,
		state,
		previewPane: over.previewPane ?? (stubComponent(["<PREVIEW>"]) as unknown as PreviewPane),
		tabBar: over.tabBar ?? (stubComponent(["<TABBAR>", ""]) as unknown as TabBar),
		notesInput: over.notesInput ?? (stubComponent(["<NOTES_INPUT>"]) as unknown as Input),
		chatList: over.chatList ?? (stubComponent(["<CHAT_ROW>"]) as unknown as WrappingSelect),
		isMulti: over.isMulti ?? questions.length > 1,
	};
}

describe("buildDialog — single-question mode", () => {
	it("omits the TabBar entirely", () => {
		const tabBar = stubComponent(["<TABBAR>", ""]) as unknown as TabBar;
		const dlg = buildDialog(
			makeConfig({
				questions: [{ question: "only?", options: [{ label: "yes" }] }],
				isMulti: false,
				tabBar,
			}),
		);
		const joined = dlg.render(80).join("\n");
		expect(joined).not.toContain("<TABBAR>");
		expect(joined).toContain("<PREVIEW>");
		expect(joined).toContain("<CHAT_ROW>");
		expect(joined).toContain(HINT_SINGLE);
	});
});

describe("buildDialog — multi-question (question tab)", () => {
	it("includes TabBar + PreviewPane + chat row + multi hint", () => {
		const dlg = buildDialog(makeConfig());
		const joined = dlg.render(80).join("\n");
		expect(joined).toContain("<TABBAR>");
		expect(joined).toContain("<PREVIEW>");
		expect(joined).toContain("<CHAT_ROW>");
		expect(joined).toContain(HINT_MULTI);
	});

	it("appends 'Space toggle' suffix when current question is multiSelect", () => {
		const dlg = buildDialog(
			makeConfig({
				questions: [
					{ question: "areas?", multiSelect: true, options: [{ label: "FE" }, { label: "BE" }] },
					{ question: "second?", options: [{ label: "x" }] },
				],
			}),
		);
		const joined = dlg.render(120).join("\n");
		expect(joined).toContain(HINT_MULTISELECT_SUFFIX.trim());
	});

	it("appends 'n for notes' when current single-select question is answered", () => {
		const answer: QuestionAnswer = { questionIndex: 0, question: "Q1?", answer: "A" };
		const dlg = buildDialog(
			makeConfig({
				state: {
					currentTab: 0,
					optionIndex: 0,
					notesVisible: false,
					inputMode: false,
					answers: new Map([[0, answer]]),
					multiSelectChecked: new Set(),
				},
			}),
		);
		const joined = dlg.render(80).join("\n");
		expect(joined).toContain(HINT_NOTES_SUFFIX.trim());
	});

	it("notesVisible adds the notes Input below the preview (line count grows)", () => {
		const hidden = buildDialog(makeConfig()).render(80);
		const visibleCfg = makeConfig({
			state: {
				currentTab: 0,
				optionIndex: 0,
				notesVisible: true,
				inputMode: false,
				answers: new Map(),
				multiSelectChecked: new Set(),
			},
		});
		const visible = buildDialog(visibleCfg).render(80);
		expect(visible.length).toBeGreaterThan(hidden.length);
		expect(visible.join("\n")).toContain("<NOTES_INPUT>");
		expect(hidden.join("\n")).not.toContain("<NOTES_INPUT>");
	});

	it("renders multiSelect checkboxes inline (☑ / ☐) in place of PreviewPane", () => {
		const dlg = buildDialog(
			makeConfig({
				questions: [
					{ question: "areas?", multiSelect: true, options: [{ label: "FE" }, { label: "BE" }] },
					{ question: "q?", options: [{ label: "a" }] },
				],
				state: {
					currentTab: 0,
					optionIndex: 1,
					notesVisible: false,
					inputMode: false,
					answers: new Map(),
					multiSelectChecked: new Set([0]),
				},
			}),
		);
		const joined = dlg.render(80).join("\n");
		expect(joined).toContain("☑");
		expect(joined).toContain("☐");
		expect(joined).not.toContain("<PREVIEW>");
	});
});

describe("buildDialog — Submit tab", () => {
	const answers = new Map<number, QuestionAnswer>([
		[0, { questionIndex: 0, question: "Q1?", answer: "A" }],
		[1, { questionIndex: 1, question: "Q2?", answer: null, selected: ["X", "Y"] }],
	]);

	it("shows Q→A summary when all answered + ready hint", () => {
		const dlg = buildDialog(
			makeConfig({
				state: {
					currentTab: 2,
					optionIndex: 0,
					notesVisible: false,
					inputMode: false,
					answers,
					multiSelectChecked: new Set(),
				},
			}),
		);
		const joined = dlg.render(80).join("\n");
		expect(joined).toContain(SUBMIT_READY);
		expect(joined).toContain("H1");
		expect(joined).toContain("A");
		expect(joined).toContain("X, Y");
		expect(joined).toContain(SUBMIT_HINT_READY);
	});

	it("warns + names missing questions when not all answered", () => {
		const partial = new Map<number, QuestionAnswer>([[0, { questionIndex: 0, question: "Q1?", answer: "A" }]]);
		const dlg = buildDialog(
			makeConfig({
				state: {
					currentTab: 2,
					optionIndex: 0,
					notesVisible: false,
					inputMode: false,
					answers: partial,
					multiSelectChecked: new Set(),
				},
			}),
		);
		const joined = dlg.render(80).join("\n");
		expect(joined).toContain(SUBMIT_HINT_INCOMPLETE_PREFIX);
		expect(joined).toContain("H2");
	});
});

describe("buildDialog — setPreviewPane swap", () => {
	it("setPreviewPane replaces the rendered pane on subsequent render() calls", () => {
		const paneA = stubComponent(["<PANE_A>"]) as unknown as PreviewPane;
		const paneB = stubComponent(["<PANE_B>"]) as unknown as PreviewPane;
		const dlg = buildDialog(makeConfig({ previewPane: paneA }));
		expect(dlg.render(80).join("\n")).toContain("<PANE_A>");
		dlg.setPreviewPane(paneB);
		expect(dlg.render(80).join("\n")).toContain("<PANE_B>");
		expect(dlg.render(80).join("\n")).not.toContain("<PANE_A>");
	});
});

describe("buildDialog — width safety", () => {
	it("every emitted line satisfies visibleWidth(line) <= width across all modes", () => {
		for (const w of [60, 80, 120]) {
			for (const ct of [0, 1, 2]) {
				const dlg = buildDialog(
					makeConfig({
						state: {
							currentTab: ct,
							optionIndex: 0,
							notesVisible: ct === 0,
							inputMode: false,
							answers: new Map([[0, { questionIndex: 0, question: "q", answer: "A" }]]),
							multiSelectChecked: new Set(),
						},
					}),
				);
				for (const line of dlg.render(w)) expect(visibleWidth(line)).toBeLessThanOrEqual(w);
			}
		}
	});
});
