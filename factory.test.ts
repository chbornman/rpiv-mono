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

const mixedParams = {
	questions: [
		{ question: "Q1", header: "H1", options: [{ label: "A" }, { label: "B" }] },
		{
			question: "Q2",
			header: "H2",
			multiSelect: true,
			options: [{ label: "FE" }, { label: "BE" }, { label: "DB" }, { label: "QA" }, { label: "Ops" }],
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

describe("ask_user_question — chat focus integration", () => {
	it("DOWN past last option focuses chat row; ENTER returns wasChat:true", async () => {
		const tool = register();
		const { custom } = driveCustom((c) => {
			// items = [A, B, "Type something."] (3 items, last index = 2)
			c.handleInput("\u001b[B"); // optionIndex 0 → 1 (B)
			c.handleInput("\u001b[B"); // optionIndex 1 → 2 (Type something, inputMode=true)
			c.handleInput("\u001b[B"); // DOWN-on-last + inputMode → focus_chat
			c.handleInput("\r"); // ENTER while chatFocused → confirm with wasChat:true
		});
		const ctx = { hasUI: true, ui: { custom } } as never;
		const r = await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
		const details = r?.details as {
			cancelled: boolean;
			answers: Array<{ wasChat?: boolean; answer?: string | null }>;
		};
		expect(details.cancelled).toBe(false);
		expect(details.answers[0]?.wasChat).toBe(true);
		expect(details.answers[0]?.answer).toBe("Chat about this");
	});

	it("UP-from-chat clears chatFocused; subsequent ENTER returns options answer (not wasChat)", async () => {
		const tool = register();
		const { custom } = driveCustom((c) => {
			c.handleInput("\u001b[B"); // → 1 (B)
			c.handleInput("\u001b[B"); // → 2 (Type something, inputMode=true)
			c.handleInput("\u001b[B"); // → focus_chat
			c.handleInput("\u001b[A"); // UP → focus_options (chatFocused=false; optionIndex/inputMode unchanged)
			c.handleInput("\r"); // ENTER → confirm via inputMode branch with empty buffer
		});
		const ctx = { hasUI: true, ui: { custom } } as never;
		const r = await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx);
		const details = r?.details as {
			cancelled: boolean;
			answers: Array<{ wasChat?: boolean; wasCustom?: boolean; answer?: string | null }>;
		};
		expect(details.cancelled).toBe(false);
		expect(details.answers[0]?.wasChat).not.toBe(true);
		expect(details.answers[0]?.wasCustom).toBe(true);
		expect(details.answers[0]?.answer).toBeNull();
	});

	it("dialog total line count is identical across tab switches (mixed single+multi fixture)", async () => {
		const tool = register();
		let lengthTab0 = 0;
		let lengthTab1 = 0;
		// Render at 120 so the multiSelect hint suffix doesn't wrap — the FixedHeightBox body
		// stabilization is the property under test, not hint-wrap symmetry.
		const { custom } = driveCustom((c, done) => {
			lengthTab0 = c.render(120).length;
			c.handleInput("\t"); // Tab → next question tab
			lengthTab1 = c.render(120).length;
			done({ answers: [], cancelled: true });
		});
		const ctx = { hasUI: true, ui: { custom } } as never;
		await tool.execute?.("tc", mixedParams as never, undefined as never, undefined as never, ctx);
		expect(lengthTab0).toBe(lengthTab1);
	});
});
