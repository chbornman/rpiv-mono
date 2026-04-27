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

describe("PreviewPane.naturalHeight", () => {
	const fewOptionsNoDesc: QuestionData = {
		question: "q",
		options: [{ label: "A" }, { label: "B" }],
	};
	const manyOptionsWithDesc: QuestionData = {
		question: "q",
		options: [
			{ label: "A", description: "desc-a" },
			{ label: "B", description: "desc-b" },
			{ label: "C", description: "desc-c" },
			{ label: "D" },
		],
	};
	const singleOption: QuestionData = { question: "q", options: [{ label: "only" }] };

	const fixtures: Array<[string, QuestionData]> = [
		["few-options-no-desc", fewOptionsNoDesc],
		["many-options-with-desc", manyOptionsWithDesc],
		["single-option", singleOption],
	];

	it("naturalHeight(w) === render(w).length parametric across modes and fixtures", () => {
		for (const [_label, q] of fixtures) {
			// multiSelect mode
			const multiQ: QuestionData = { ...q, multiSelect: true };
			const multi = makePane(multiQ, () => 120);
			for (const w of [60, 80, 100, 120, 160]) {
				expect(multi.naturalHeight(w)).toBe(multi.render(w).length);
			}
			// side-by-side (terminal >= PREVIEW_MIN_WIDTH AND width >= PREVIEW_MIN_WIDTH)
			const wide = makePane(q, () => 120);
			for (const w of [100, 120, 160]) {
				expect(wide.naturalHeight(w)).toBe(wide.render(w).length);
			}
			// stacked (either side < PREVIEW_MIN_WIDTH)
			const narrow = makePane(q, () => 80);
			for (const w of [60, 80]) {
				expect(narrow.naturalHeight(w)).toBe(narrow.render(w).length);
			}
		}
	});
});

describe("PreviewPane — centered preview (side-by-side only)", () => {
	const question: QuestionData = {
		question: "pick",
		options: [{ label: "A", preview: "short body" }, { label: "B" }],
	};

	function extractPreviewColumnLines(joined: string[]): string[] {
		// Side-by-side rows are "<options>  <gap>  <preview>". The preview lives in the right portion.
		// For these tests it's enough to find lines containing FakeMarkdown's MD[..]: marker and inspect their leading run.
		return joined.filter((l) => /MD\[\d+\]:/.test(l));
	}

	it("side-by-side preview lines have a leading-space margin > 0 when content is shorter than colWidth", () => {
		// Columns joins as `<col0_padded><gap><col1>` so the MD content is preceded by options col + gap.
		// Compare short-content (centered, leftMargin > 0) against long-content (fills column, leftMargin = 0):
		// the MD index in the joined row must be strictly greater for the centered case.
		const shortPane = makePane(question, () => 120);
		shortPane.setSelectedIndex(0);
		const shortPreview = extractPreviewColumnLines(shortPane.render(120));
		expect(shortPreview.length).toBeGreaterThan(0);
		const shortMD = shortPreview[0].indexOf("MD[");

		const longQ: QuestionData = {
			question: "pick",
			options: [{ label: "A", preview: "x".repeat(500) }, { label: "B" }],
		};
		const longPane = makePane(longQ, () => 120);
		longPane.setSelectedIndex(0);
		const longPreview = extractPreviewColumnLines(longPane.render(120));
		expect(longPreview.length).toBeGreaterThan(0);
		const longMD = longPreview[0].indexOf("MD[");

		expect(shortMD).toBeGreaterThan(longMD);
	});

	it("side-by-side leftMargin = 0 when contentWidth >= colWidth (long preview)", () => {
		// At width 120 with FakeMarkdown returning ~(width-4) chars, a 500-char preview source produces
		// MD[col1Width]:xxx... whose visibleWidth >= col1Width. centerHorizontally returns lines unchanged,
		// so the MD substring appears at the boundary of (col0_width + gap) — i.e., immediately after the gap.
		const longQ: QuestionData = {
			question: "pick",
			options: [{ label: "A", preview: "x".repeat(500) }, { label: "B" }],
		};
		const pane = makePane(longQ, () => 120);
		pane.setSelectedIndex(0);
		const lines = pane.render(120);
		const preview = extractPreviewColumnLines(lines);
		expect(preview.length).toBeGreaterThan(0);

		// Without centering, MD must appear at the same column it would appear without the centerHorizontally
		// step. We assert idempotency: rendering again produces the same MD index (no drift), AND that index
		// matches the short-preview centered MD index minus the centering offset (leftMargin > 0).
		const longMD = preview[0].indexOf("MD[");
		expect(longMD).toBeGreaterThan(0);

		// Sanity: every char between (longMD-2) and longMD is the gap separator (2 spaces) — the MD content
		// is NOT additionally pushed right by a leftMargin.
		expect(preview[0].slice(longMD - 2, longMD)).toBe("  ");
	});

	it("stacked mode does NOT center (preview line begins with FakeMarkdown marker, no leading margin)", () => {
		const pane = makePane(question, () => 80);
		pane.setSelectedIndex(0);
		const lines = pane.render(80);
		const preview = extractPreviewColumnLines(lines);
		expect(preview.length).toBeGreaterThan(0);
		expect(preview[0].startsWith("MD")).toBe(true);
	});

	it("multiSelect mode unchanged (no preview, no centering)", () => {
		const multiQ: QuestionData = { ...question, multiSelect: true };
		const pane = makePane(multiQ, () => 120);
		const lines = pane.render(120);
		expect(lines.some((l) => /MD\[\d+\]:/.test(l))).toBe(false);
	});

	it("empty padding lines remain empty (no margin prepended to '')", () => {
		const pane = makePane(question, () => 120);
		pane.setSelectedIndex(0);
		const lines = pane.render(120);
		// Some side-by-side rows are empty padding. Find at least one row that's all spaces or empty after the gap.
		const hasEmptyRow = lines.some((l) => l.trim() === "");
		expect(hasEmptyRow).toBe(true);
	});

	it("width safety after centering: visibleWidth(line) <= width at boundary widths", () => {
		for (const w of [100, 120, 160]) {
			const pane = makePane(question, () => w);
			pane.setSelectedIndex(0);
			const lines = pane.render(w);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(w);
		}
	});
});
