import { makeTheme } from "@juicesharp/rpiv-test-utils";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import type { DialogState } from "./dialog-builder.js";
import { MultiSelectOptions } from "./multi-select-options.js";
import type { QuestionData } from "./types.js";

const theme = makeTheme() as unknown as Theme;

function state(over: Partial<DialogState> = {}): DialogState {
	return {
		currentTab: over.currentTab ?? 0,
		optionIndex: over.optionIndex ?? 0,
		notesVisible: over.notesVisible ?? false,
		inputMode: over.inputMode ?? false,
		answers: over.answers ?? new Map(),
		multiSelectChecked: over.multiSelectChecked ?? new Set(),
	};
}

function question(over: Partial<QuestionData> = {}): QuestionData {
	return {
		question: over.question ?? "areas?",
		header: over.header,
		options: over.options ?? [{ label: "FE" }, { label: "BE" }, { label: "DB" }],
		multiSelect: over.multiSelect ?? true,
	};
}

describe("MultiSelectOptions.render", () => {
	it("renders one row per option with pointer + checkbox + label", () => {
		const m = new MultiSelectOptions(theme, question(), state());
		const lines = m.render(80);
		expect(lines.length).toBe(3);
		expect(lines[0]).toContain("FE");
		expect(lines[1]).toContain("BE");
		expect(lines[2]).toContain("DB");
	});

	it("renders description on continuation line when present", () => {
		const q = question({
			options: [{ label: "FE", description: "front-end" }, { label: "BE" }],
		});
		const m = new MultiSelectOptions(theme, q, state());
		const lines = m.render(80);
		expect(lines.length).toBe(3); // FE row + 1 description + BE row
		expect(lines[1]).toContain("front-end");
	});

	it("active option uses ACTIVE_POINTER and accent styling", () => {
		const m = new MultiSelectOptions(theme, question(), state({ optionIndex: 1 }));
		const lines = m.render(80);
		expect(lines[1]).toContain("❯ "); // ACTIVE_POINTER on the active row
		expect(lines[0].startsWith("❯ ")).toBe(false); // inactive rows do not start with active pointer
	});

	it("checked options show ☑ glyph; unchecked show ☐", () => {
		const m = new MultiSelectOptions(theme, question(), state({ multiSelectChecked: new Set([0, 2]) }));
		const lines = m.render(80);
		expect(lines[0]).toContain("☑");
		expect(lines[1]).toContain("☐");
		expect(lines[2]).toContain("☑");
	});

	it("setState mutates state visible to next render (active row moves)", () => {
		const m = new MultiSelectOptions(theme, question(), state({ optionIndex: 0 }));
		expect(m.render(80)[0]).toContain("❯ ");
		m.setState(state({ optionIndex: 2 }));
		const lines = m.render(80);
		expect(lines[0].startsWith("❯ ")).toBe(false);
		expect(lines[2]).toContain("❯ ");
	});
});

describe("MultiSelectOptions.naturalHeight", () => {
	const fixtures: Array<[string, QuestionData]> = [
		["no-desc 3 options", question()],
		[
			"with-1-line-desc",
			question({
				options: [
					{ label: "FE", description: "front-end" },
					{ label: "BE", description: "back-end" },
					{ label: "DB" },
				],
			}),
		],
		[
			"with-multi-line-wrap-desc",
			question({
				options: [
					{
						label: "FE",
						description:
							"this is an extremely long description that should wrap across multiple lines when rendered at narrow widths to verify line counting",
					},
					{ label: "BE" },
				],
			}),
		],
		[
			"long-label-truncates-not-wraps",
			question({
				options: [{ label: "x".repeat(200) }, { label: "BE" }],
			}),
		],
	];

	it("naturalHeight(w) === render(w).length across widths and fixtures", () => {
		for (const [_label, q] of fixtures) {
			const m = new MultiSelectOptions(theme, q, state());
			for (const w of [20, 40, 80, 120]) {
				expect(m.naturalHeight(w)).toBe(m.render(w).length);
			}
		}
	});

	it("is state-independent (theme/question/width only)", () => {
		const q = question({
			options: [
				{ label: "FE", description: "front-end work" },
				{ label: "BE" },
				{ label: "DB", description: "database tasks" },
			],
		});
		const a = new MultiSelectOptions(theme, q, state({ optionIndex: 0, multiSelectChecked: new Set() }));
		const b = new MultiSelectOptions(theme, q, state({ optionIndex: 2, multiSelectChecked: new Set([0, 1]) }));
		for (const w of [20, 40, 80, 120]) {
			expect(a.naturalHeight(w)).toBe(b.naturalHeight(w));
		}
	});
});

describe("MultiSelectOptions width safety", () => {
	it("every emitted line satisfies visibleWidth(line) <= width", () => {
		const q = question({
			options: [
				{ label: "x".repeat(200), description: "y".repeat(200) },
				{ label: "BE", description: "back-end" },
			],
		});
		const m = new MultiSelectOptions(theme, q, state());
		for (const w of [20, 40, 80, 120]) {
			const lines = m.render(w);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(w);
			}
		}
	});
});
