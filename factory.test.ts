import { createMockPi } from "@juicesharp/rpiv-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAskUserQuestionTool } from "./ask-user-question.js";

interface RenderableComponent {
	render: (w: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
}

const identityTheme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
	strikethrough: (s: string) => s,
};

function register() {
	const { pi, captured } = createMockPi();
	registerAskUserQuestionTool(pi);
	return captured.tools.get("ask_user_question")!;
}

function driveCustom(script: (c: RenderableComponent, done: (v: unknown) => void) => void) {
	const requestRender = vi.fn();
	const custom = vi.fn((factory: unknown) => {
		return new Promise((resolve) => {
			const f = factory as (
				tui: { requestRender: () => void; terminal: { columns: number } },
				theme: typeof identityTheme,
				kb: undefined,
				done: (v: unknown) => void,
			) => RenderableComponent;
			const component = f({ requestRender, terminal: { columns: 80 } }, identityTheme, undefined, resolve);
			script(component, resolve);
		});
	});
	return { custom, requestRender };
}

const params = {
	questions: [
		{
			question: "Pick one",
			header: "HDR",
			options: [{ label: "A" }, { label: "B" }],
		},
	],
};

beforeEach(() => {});
afterEach(() => {
	vi.restoreAllMocks();
});

describe("ask_user_question — factory driver (real pi-tui keybindings)", () => {
	it("renders a non-empty view at width 80", async () => {
		const tool = register();
		const { custom } = driveCustom((c, done) => {
			const lines = c.render(80);
			expect(lines.length).toBeGreaterThan(0);
			done({ answers: [], cancelled: true });
		});
		const ctx = { hasUI: true, ui: { custom } } as never;
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});

	it("Esc cancels → returns decline envelope with cancelled=true", async () => {
		const tool = register();
		const { custom } = driveCustom((c) => {
			c.handleInput("\u001b");
		});
		const ctx = { hasUI: true, ui: { custom } } as never;
		const r = await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
		expect(r?.details).toMatchObject({ cancelled: true });
	});

	it("Enter on first item → single-question auto-submits", async () => {
		const tool = register();
		const { custom } = driveCustom((c) => {
			c.handleInput("\r");
		});
		const ctx = { hasUI: true, ui: { custom } } as never;
		const r = await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
		const details = r?.details as { cancelled: boolean; answers: Array<Record<string, unknown>> };
		expect(details).toMatchObject({ cancelled: false });
		expect(details.answers[0]).toMatchObject({ answer: "A", wasCustom: false });
	});

	it("DOWN navigates without completing; Esc cancels", async () => {
		const tool = register();
		const { custom, requestRender } = driveCustom((c) => {
			c.handleInput("\u001b[B");
			c.handleInput("\u001b");
		});
		const ctx = { hasUI: true, ui: { custom } } as never;
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
		expect(requestRender).toHaveBeenCalled();
	});

	it("invalidate() is callable without throwing", async () => {
		const tool = register();
		const { custom } = driveCustom((c, done) => {
			c.invalidate();
			done({ answers: [], cancelled: true });
		});
		const ctx = { hasUI: true, ui: { custom } } as never;
		await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
	});
});
