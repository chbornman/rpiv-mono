import { makeTheme } from "@juicesharp/rpiv-test-utils";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";

let markdownConstructed = 0;
vi.mock("@mariozechner/pi-tui", async (orig) => {
	const actual = (await orig()) as Record<string, unknown>;
	class FakeMarkdown {
		constructor(public text: string) {
			markdownConstructed++;
		}
		render(width: number): string[] {
			return [`MD[${width}]:${this.text.slice(0, Math.max(0, width - 4))}`];
		}
		invalidate(): void {}
		setText(t: string): void {
			this.text = t;
		}
	}
	return { ...actual, Markdown: FakeMarkdown };
});

import { MAX_PREVIEW_HEIGHT, NO_PREVIEW_TEXT, PREVIEW_MIN_WIDTH, PreviewPane } from "./preview-pane.js";
import type { QuestionData } from "./types.js";

const theme = makeTheme() as unknown as Theme;
const markdownTheme = {
	heading: (t: string) => t,
	link: (t: string) => t,
	linkUrl: (t: string) => t,
	code: (t: string) => t,
	codeBlock: (t: string) => t,
	codeBlockBorder: (t: string) => t,
	quote: (t: string) => t,
	quoteBorder: (t: string) => t,
	hr: (t: string) => t,
	listBullet: (t: string) => t,
	bold: (t: string) => t,
	italic: (t: string) => t,
	strikethrough: (t: string) => t,
	underline: (t: string) => t,
} as never;

function makePane(question: QuestionData, getWidth: () => number = () => 120) {
	const items = question.options.map((o) => ({ label: o.label, description: o.description }));
	return new PreviewPane({
		items,
		question,
		theme,
		markdownTheme,
		getTerminalWidth: getWidth,
	});
}

beforeEach(() => {
	markdownConstructed = 0;
});

describe("PreviewPane.render — layout switching", () => {
	const question: QuestionData = {
		question: "pick",
		options: [
			{ label: "A", preview: "## A\n\nbody A content" },
			{ label: "B", preview: "## B\n\nbody B content" },
			{ label: "C" },
		],
	};

	it("side-by-side at width 120 (>= PREVIEW_MIN_WIDTH)", () => {
		const pane = makePane(question, () => 120);
		pane.setSelectedIndex(0);
		const lines = pane.render(120);
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.some((l) => /MD\[\d+\]:/.test(l))).toBe(true);
	});

	it("stacked at width 80 (< PREVIEW_MIN_WIDTH)", () => {
		const pane = makePane(question, () => 80);
		pane.setSelectedIndex(0);
		const lines = pane.render(80);
		const mdLineIndex = lines.findIndex((l) => /MD\[\d+\]:/.test(l));
		expect(mdLineIndex).toBeGreaterThan(0);
		expect(lines.slice(mdLineIndex).length).toBe(MAX_PREVIEW_HEIGHT);
	});

	it("width 99 → stacked, width 100 → side-by-side (threshold boundary)", () => {
		const paneNarrow = makePane(question, () => 99);
		paneNarrow.setSelectedIndex(0);
		const narrowLines = paneNarrow.render(99);
		expect(narrowLines.findIndex((l) => /MD\[\d+\]:/.test(l))).toBeGreaterThan(0);

		const paneWide = makePane(question, () => PREVIEW_MIN_WIDTH);
		paneWide.setSelectedIndex(0);
		const wideLines = paneWide.render(PREVIEW_MIN_WIDTH);
		expect(wideLines.some((l) => /MD\[\d+\]:/.test(l))).toBe(true);
	});
});

describe("PreviewPane — cache + invalidate", () => {
	const question: QuestionData = {
		question: "pick",
		options: [
			{ label: "A", preview: "alpha preview" },
			{ label: "B", preview: "beta preview" },
		],
	};

	it("creates one Markdown per option lazily; revisit hits cache", () => {
		const pane = makePane(question, () => 120);
		pane.setSelectedIndex(0);
		pane.render(120);
		expect(markdownConstructed).toBe(1);
		pane.setSelectedIndex(1);
		pane.render(120);
		expect(markdownConstructed).toBe(2);
		pane.setSelectedIndex(0);
		pane.render(120);
		expect(markdownConstructed).toBe(2);
	});

	it("invalidateCache() does NOT delete instances; subsequent renders still re-use cache", () => {
		const pane = makePane(question, () => 120);
		pane.setSelectedIndex(0);
		pane.render(120);
		expect(markdownConstructed).toBe(1);
		pane.invalidateCache();
		pane.render(120);
		expect(markdownConstructed).toBe(1);
	});
});

describe("PreviewPane — empty preview placeholder", () => {
	const question: QuestionData = {
		question: "pick",
		options: [{ label: "only" }],
	};

	it("renders the 'No preview available' placeholder padded to MAX_PREVIEW_HEIGHT", () => {
		const pane = makePane(question, () => 80);
		pane.setSelectedIndex(0);
		const lines = pane.render(80);
		const mdIndex = lines.findIndex((l) => l.includes(NO_PREVIEW_TEXT));
		expect(mdIndex).toBeGreaterThan(-1);
		expect(lines.slice(mdIndex).length).toBe(MAX_PREVIEW_HEIGHT);
	});
});

describe("PreviewPane — multiSelect suppresses preview", () => {
	it("renders ONLY the options list when question.multiSelect === true", () => {
		const question: QuestionData = {
			question: "areas",
			multiSelect: true,
			options: [{ label: "FE", preview: "would not show" }, { label: "BE" }],
		};
		const pane = makePane(question, () => 120);
		const lines = pane.render(120);
		expect(lines.some((l) => /MD\[\d+\]:/.test(l))).toBe(false);
		expect(lines.some((l) => l.includes(NO_PREVIEW_TEXT))).toBe(false);
	});
});

describe("PreviewPane — width safety (Pi crash guard)", () => {
	const question: QuestionData = {
		question: "pick",
		options: [{ label: "A", preview: "x".repeat(500) }, { label: "B" }],
	};

	it("every emitted line satisfies visibleWidth(line) <= width", () => {
		for (const w of [60, 80, 100, 120]) {
			const pane = makePane(question, () => w);
			pane.setSelectedIndex(0);
			const lines = pane.render(w);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(w);
		}
	});
});
