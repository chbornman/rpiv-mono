import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import { type ColumnConfig, Columns } from "./columns.js";

function stub(lines: string[]): Component & { rendered: number[] } {
	const out = {
		rendered: [] as number[],
		render(w: number) {
			out.rendered.push(w);
			return lines;
		},
		handleInput() {},
		invalidate() {},
	};
	return out;
}

describe("Columns.render — layout + interleaving", () => {
	it("interleaves two children line-by-line with a gap", () => {
		const left = stub(["Lefty 1", "Lefty 2"]);
		const right = stub(["R1"]);
		const c = new Columns(
			[
				{ ratio: 1, component: left },
				{ ratio: 1, component: right },
			],
			2,
		);
		const lines = c.render(80);
		expect(lines.length).toBe(2);
		expect(lines[0]).toContain("Lefty 1");
		expect(lines[0]).toContain("R1");
	});

	it("pads shorter child to match taller child's height", () => {
		const left = stub(["a", "b", "c", "d", "e"]);
		const right = stub(["x", "y"]);
		const c = new Columns(
			[
				{ ratio: 1, component: left },
				{ ratio: 1, component: right },
			],
			1,
		);
		const lines = c.render(40);
		expect(lines.length).toBe(5);
		expect(lines[2]).toContain("c");
		expect(lines[3]).toContain("d");
	});

	it("every emitted line satisfies visibleWidth(line) <= width (Pi crash guard)", () => {
		const wide = stub(["x".repeat(200), "y".repeat(150)]);
		const c = new Columns([{ ratio: 1, component: wide }], 0);
		for (const w of [60, 80, 100, 120]) {
			const lines = c.render(w);
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(w);
		}
	});

	it("strips/handles ANSI-styled content via visibleWidth", () => {
		const styled = stub(["[31mred[0m"]);
		const plain = stub(["plain"]);
		const c = new Columns(
			[
				{ ratio: 1, component: styled },
				{ ratio: 1, component: plain },
			],
			2,
		);
		const lines = c.render(40);
		expect(lines[0]).toContain("red");
		expect(lines[0]).toContain("plain");
		expect(visibleWidth(lines[0])).toBeLessThanOrEqual(40);
	});

	it("single-column passthrough (gap ignored)", () => {
		const child = stub(["only"]);
		const c = new Columns([{ ratio: 1, component: child }], 4);
		const lines = c.render(20);
		expect(lines.length).toBe(1);
		expect(lines[0]).toContain("only");
	});

	it("width=0 returns empty array", () => {
		const c = new Columns([{ ratio: 1, component: stub(["x"]) }], 0);
		expect(c.render(0)).toEqual([]);
	});

	it("empty configs array returns empty", () => {
		const c: Columns = new Columns([] as readonly ColumnConfig[], 2);
		expect(c.render(80)).toEqual([]);
	});

	it("allocates widths by ratio, gap deducted before split", () => {
		const left = stub(["L"]);
		const right = stub(["R"]);
		const c = new Columns(
			[
				{ ratio: 3, component: left },
				{ ratio: 2, component: right },
			],
			2,
		);
		c.render(50);
		expect(left.rendered[left.rendered.length - 1]).toBe(28);
		expect(right.rendered[right.rendered.length - 1]).toBe(20);
	});

	it("invalidate() delegates to every child", () => {
		let a = 0;
		let b = 0;
		const left: Component = {
			render: () => ["L"],
			handleInput() {},
			invalidate: () => {
				a++;
			},
		};
		const right: Component = {
			render: () => ["R"],
			handleInput() {},
			invalidate: () => {
				b++;
			},
		};
		const c = new Columns(
			[
				{ ratio: 1, component: left },
				{ ratio: 1, component: right },
			],
			2,
		);
		c.invalidate();
		expect(a).toBe(1);
		expect(b).toBe(1);
	});
});
