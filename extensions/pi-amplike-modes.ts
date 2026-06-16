import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CustomEditor,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	CURSOR_MARKER,
	decodeKittyPrintable,
	fuzzyFilter,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type ModeName = string;
type AmpMetric = "tokens" | "cost";

interface AgentMode {
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	label: string;
}

interface AmpUiConfig {
	enabled: boolean;
	greeting: string;
	metric: AmpMetric;
	hideFooter: boolean;
	showHeader: boolean;
	showCwd: boolean;
	showBranch: boolean;
	tokensSuffix: string;
	modeSeparator: string;
	modeColors: Record<string, string>;
	borderColor: string;
	textColor: string;
	editorPaddingX: number;
	minInputRows: number;
	bottomPaddingRows: number;
}

interface ModesConfig {
	version: number;
	currentMode: ModeName;
	modes: Record<ModeName, AgentMode>;
	ampUi: AmpUiConfig;
}

const CONFIG_PATH = join(getAgentDir(), "modes.json");
const STATUS_KEY = "pi-amplike-modes";
const THINKING_LEVEL_COLORS: Record<ThinkingLevel, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};
const DEFAULT_AMP_UI: AmpUiConfig = {
	enabled: false,
	greeting: "Hi! What would you like to work on?",
	metric: "tokens",
	hideFooter: true,
	showHeader: true,
	showCwd: true,
	showBranch: true,
	tokensSuffix: "tok",
	modeSeparator: "—",
	modeColors: {
		deep: "#7dffa2",
		"deep²": "#7dffa2",
		"deep³": "#7dffa2",
		rush: "#f1c85b",
	},
	borderColor: "#a9afbd",
	textColor: "#8f96a3",
	editorPaddingX: 2,
	minInputRows: 2,
	bottomPaddingRows: 1,
};
const DEFAULT_CONFIG: ModesConfig = {
	version: 1,
	currentMode: "deep²",
	ampUi: DEFAULT_AMP_UI,
	modes: {
		rush: {
			provider: "openai-codex",
			modelId: "gpt-5.5",
			thinkingLevel: "off",
			label: "rush",
		},
		"deep²": {
			provider: "openai-codex",
			modelId: "gpt-5.5",
			thinkingLevel: "medium",
			label: "deep²",
		},
		"deep³": {
			provider: "openai-codex",
			modelId: "gpt-5.5",
			thinkingLevel: "xhigh",
			label: "deep³",
		},
	},
};
const PALETTE_TITLE_COLOR = "#e7c879";
const PALETTE_SELECTED_BG = "#dfc37b";
const PALETTE_SELECTED_FG = "#20242f";
const PALETTE_MUTED_FG = "#a9afbd";
const PALETTE_ACTION_FG = "#b9beca";
const PALETTE_SHORTCUT_FG = "#80b7ff";
const PALETTE_MIN_ITEM_ROWS = 12;
const PALETTE_MAX_ITEM_ROWS = 16;
const PI_PALETTE_ITEMS: AutocompleteItem[] = [
	{ value: "settings", label: "settings", description: "Open settings menu" },
	{ value: "model", label: "model", description: "Select model (opens selector UI)" },
	{ value: "scoped-models", label: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ value: "export", label: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ value: "import", label: "import", description: "Import and resume a session from a JSONL file" },
	{ value: "share", label: "share", description: "Share session as a secret GitHub gist" },
	{ value: "copy", label: "copy", description: "Copy last agent message to clipboard" },
	{ value: "name", label: "name", description: "Set session display name" },
	{ value: "session", label: "session", description: "Show session info and stats" },
	{ value: "changelog", label: "changelog", description: "Show changelog entries" },
	{ value: "hotkeys", label: "hotkeys", description: "Show all keyboard shortcuts" },
	{ value: "fork", label: "fork", description: "Create a new fork from a previous user message" },
	{ value: "clone", label: "clone", description: "Duplicate the current session at the current position" },
	{ value: "tree", label: "tree", description: "Navigate session tree (switch branches)" },
	{ value: "trust", label: "trust", description: "Save project trust decision for future sessions" },
	{ value: "login", label: "login", description: "Configure provider authentication" },
	{ value: "logout", label: "logout", description: "Remove provider authentication" },
	{ value: "new", label: "new", description: "Start a new session" },
	{ value: "compact", label: "compact", description: "Manually compact the session context" },
	{ value: "resume", label: "resume", description: "Resume a different session" },
	{ value: "reload", label: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
	{ value: "quit", label: "quit", description: "Quit pi" },
];

function readConfig(): ModesConfig {
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<ModesConfig>;
		const modes: Record<ModeName, AgentMode> = parsed.modes ? { ...parsed.modes } : { ...DEFAULT_CONFIG.modes };
		return {
			...DEFAULT_CONFIG,
			...parsed,
			ampUi: {
				...DEFAULT_AMP_UI,
				...(parsed.ampUi ?? {}),
			},
			modes,
		} as ModesConfig;
	} catch {
		return DEFAULT_CONFIG;
	}
}

function writeConfig(config: ModesConfig) {
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function modeNames(config: ModesConfig): ModeName[] {
	return Object.keys(config.modes);
}

function modeMatchesCurrentState(mode: AgentMode | undefined, ctx: ExtensionContext, pi: ExtensionAPI): boolean {
	return mode?.provider === ctx.model?.provider && mode.modelId === ctx.model?.id && mode.thinkingLevel === pi.getThinkingLevel();
}

function modeForCurrentState(ctx: ExtensionContext, pi: ExtensionAPI, config: ModesConfig): ModeName | undefined {
	if (modeMatchesCurrentState(config.modes[config.currentMode], ctx, pi)) {
		return config.currentMode;
	}

	return modeNames(config).find((name) => modeMatchesCurrentState(config.modes[name], ctx, pi));
}

function colorForThinkingLevel(level: ThinkingLevel): ThemeColor {
	return THINKING_LEVEL_COLORS[level] ?? "accent";
}

function labelForMode(ctx: ExtensionContext, pi: ExtensionAPI, config: ModesConfig): { name: string; label: string; level: ThinkingLevel } {
	const name = modeForCurrentState(ctx, pi, config) ?? config.currentMode;
	const mode = config.modes[name];
	if (mode) return { name, label: mode.label ?? name, level: mode.thinkingLevel };
	return { name: "custom", label: "custom", level: pi.getThinkingLevel() };
}

function rgbFromHex(value: string): [number, number, number] | undefined {
	const match = value.match(/^#?([0-9a-f]{6})$/i);
	if (!match) return undefined;
	const hex = match[1]!;
	return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function hexColor(text: string, value: string): string | undefined {
	const rgb = rgbFromHex(value);
	if (!rgb) return undefined;
	const [red, green, blue] = rgb;
	return `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;
}

function hexBg(text: string, value: string): string | undefined {
	const rgb = rgbFromHex(value);
	if (!rgb) return undefined;
	const [red, green, blue] = rgb;
	return `\x1b[48;2;${red};${green};${blue}m${text}\x1b[49m`;
}

function hexFgBg(text: string, fg: string, bg: string): string | undefined {
	const fgRgb = rgbFromHex(fg);
	const bgRgb = rgbFromHex(bg);
	if (!fgRgb || !bgRgb) return undefined;
	return `\x1b[38;2;${fgRgb[0]};${fgRgb[1]};${fgRgb[2]}m\x1b[48;2;${bgRgb[0]};${bgRgb[1]};${bgRgb[2]}m${text}\x1b[39m\x1b[49m`;
}

function bold(text: string): string {
	return `\x1b[1m${text}\x1b[22m`;
}

function colorModeLabel(
	ctx: ExtensionContext,
	config: ModesConfig,
	mode: { name: string; label: string; level: ThinkingLevel },
	text: string,
): string {
	const configured =
		config.ampUi.modeColors[mode.name] ??
		config.ampUi.modeColors[mode.label] ??
		(mode.label.startsWith("deep") ? config.ampUi.modeColors.deep : undefined);
	if (configured) {
		const hex = hexColor(text, configured);
		if (hex) return hex;
		if (configured in THINKING_LEVEL_COLORS) return ctx.ui.theme.fg(colorForThinkingLevel(configured as ThinkingLevel), text);
		return ctx.ui.theme.fg(configured as ThemeColor, text);
	}
	return ctx.ui.theme.fg(colorForThinkingLevel(mode.level), text);
}

function setStatus(ctx: ExtensionContext, pi: ExtensionAPI, config: ModesConfig, activeMode?: ModeName) {
	const name = activeMode ?? modeForCurrentState(ctx, pi, config);
	if (!name) {
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(colorForThinkingLevel(pi.getThinkingLevel()), "mode[custom]"));
		return;
	}

	const mode = config.modes[name];
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(colorForThinkingLevel(mode.thinkingLevel), `mode[${mode.label ?? name}]`));
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd === home) return "~";
	if (home && cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function fitBorder(
	left: string,
	right: string,
	width: number,
	parts: { leftCorner: string; rightCorner: string; line: string },
	color: (text: string) => string,
): string {
	if (width <= 0) return "";
	if (width === 1) return color(parts.line);

	let leftText = left;
	let rightText = right;
	const fixedWidth = 2;
	const minimumGap = 1;

	while (fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width && visibleWidth(rightText) > 0) {
		rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
	}
	while (fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width && visibleWidth(leftText) > 0) {
		leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
	}

	const gapWidth = Math.max(0, width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText));
	return `${color(parts.leftCorner)}${leftText}${color(parts.line.repeat(gapWidth))}${rightText}${color(parts.rightCorner)}`;
}

function sessionCost(ctx: ExtensionContext): number {
	let cost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message as { role?: string; usage?: { cost?: { total?: number } } };
		if (message.role === "assistant") cost += message.usage?.cost?.total ?? 0;
	}
	return cost;
}

function formatTokens(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	const tokens = usage?.tokens ?? 0;
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
	return `${tokens}`;
}

function formatCost(ctx: ExtensionContext): string {
	return `$${sessionCost(ctx).toFixed(3)}`;
}

function isMouseInput(data: string): boolean {
	return /^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data) || /^\x1b\[M/.test(data);
}

interface AutocompleteListLike {
	filteredItems?: AutocompleteItem[];
	items?: AutocompleteItem[];
	selectedIndex?: number;
	render?: (width: number) => string[];
}

interface PaletteRowParts {
	group: string;
	action: string;
	right: string;
}

interface PaletteRowLayout extends PaletteRowParts {
	gap: string;
	padding: string;
}

type PaletteAction = "execute" | "complete";

interface PaletteResult {
	action: PaletteAction;
	item: AutocompleteItem;
}

function padToWidth(text: string, width: number): string {
	const truncated = truncateToWidth(text, Math.max(0, width), "");
	return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function clampIndex(value: number, max: number): number {
	if (max <= 0) return 0;
	return Math.max(0, Math.min(value, max - 1));
}

function getAutocompleteList(editor: unknown): AutocompleteListLike | undefined {
	return (editor as { autocompleteList?: AutocompleteListLike }).autocompleteList;
}

function getAutocompleteItems(editor: unknown): AutocompleteItem[] {
	const list = getAutocompleteList(editor);
	return list?.filteredItems ?? list?.items ?? [];
}

function getAutocompleteSelectedIndex(editor: unknown, itemCount: number): number {
	return clampIndex(getAutocompleteList(editor)?.selectedIndex ?? 0, itemCount);
}

function getAutocompleteLineCount(editor: { isShowingAutocomplete?: () => boolean }, contentWidth: number): number {
	if (!editor.isShowingAutocomplete?.()) return 0;
	const list = getAutocompleteList(editor);
	if (!list?.render) return 0;
	try {
		return list.render(contentWidth).length;
	} catch {
		return 0;
	}
}

function slashPaletteQuery(editor: { getCursor?: () => { line: number; col: number }; getLines?: () => string[] }): string | undefined {
	const cursor = editor.getCursor?.();
	const lines = editor.getLines?.() ?? [];
	if (!cursor || cursor.line !== 0) return undefined;
	const beforeCursor = (lines[cursor.line] ?? "").slice(0, cursor.col);
	const trimmed = beforeCursor.trimStart();
	if (!trimmed.startsWith("/")) return undefined;
	const query = trimmed.slice(1);
	if (query.includes(" ")) return undefined;
	return query;
}

function splitPaletteItem(item: AutocompleteItem): PaletteRowParts {
	const label = (item.label || item.value).replace(/\s+/g, " ").trim();
	const [group = "", ...rest] = label.split(" ");
	if (rest.length === 0) {
		return { group: "", action: group, right: item.description ?? "" };
	}
	return { group, action: rest.join(" "), right: item.description ?? "" };
}

function paletteRowLayout(parts: PaletteRowParts, groupWidth: number, rowWidth: number): PaletteRowLayout {
	const safeRowWidth = Math.max(1, rowWidth);
	const safeGroupWidth = Math.max(0, Math.min(groupWidth, Math.max(0, safeRowWidth - 3)));
	const group = truncateToWidth(parts.group, safeGroupWidth, "").padStart(safeGroupWidth);
	let right = parts.right ? truncateToWidth(parts.right, Math.min(24, Math.max(0, Math.floor(safeRowWidth * 0.35))), "") : "";
	let actionWidth = safeRowWidth - safeGroupWidth - 2 - (right ? visibleWidth(right) + 2 : 0);
	if (right && actionWidth < 8) {
		right = "";
		actionWidth = safeRowWidth - safeGroupWidth - 2;
	}
	const action = truncateToWidth(parts.action, Math.max(1, actionWidth), "");
	const leftWidth = safeGroupWidth + 2 + visibleWidth(action);
	const rightWidth = visibleWidth(right);
	const gap = right ? " ".repeat(Math.max(2, safeRowWidth - leftWidth - rightWidth)) : "";
	const usedWidth = leftWidth + visibleWidth(gap) + rightWidth;
	return { group, action, right, gap, padding: " ".repeat(Math.max(0, safeRowWidth - usedWidth)) };
}

function isShortcutText(text: string): boolean {
	return /^(Ctrl|Opt|Alt|Shift|Cmd|⌘|F\d+)/i.test(text.trim());
}

function renderPaletteRow(item: AutocompleteItem, groupWidth: number, rowWidth: number, selected: boolean): string {
	const layout = paletteRowLayout(splitPaletteItem(item), groupWidth, rowWidth);
	const plain = padToWidth(`${layout.group}  ${layout.action}${layout.gap}${layout.right}`, rowWidth);
	if (selected) {
		return hexFgBg(plain, PALETTE_SELECTED_FG, PALETTE_SELECTED_BG) ?? plain;
	}

	const group = layout.group.trim().length > 0 ? (hexColor(layout.group, PALETTE_MUTED_FG) ?? layout.group) : layout.group;
	const action = hexColor(bold(layout.action), PALETTE_ACTION_FG) ?? bold(layout.action);
	const rightColor = isShortcutText(layout.right) ? PALETTE_SHORTCUT_FG : PALETTE_MUTED_FG;
	const right = layout.right ? (hexColor(bold(layout.right), rightColor) ?? bold(layout.right)) : "";
	return `${group}  ${action}${layout.gap}${right}${layout.padding}`;
}

function renderPaletteTop(width: number, border: (text: string) => string): string {
	if (width <= 1) return border("─".repeat(Math.max(0, width)));
	const titleText = " Command Palette ";
	const title = hexColor(bold(titleText), PALETTE_TITLE_COLOR) ?? bold(titleText);
	const left = `${border("╭─")}${title}`;
	const remaining = Math.max(0, width - visibleWidth(`╭─${titleText}`) - 1);
	return `${left}${border("─".repeat(remaining))}${border("╮")}`;
}

function renderPaletteLine(content: string, width: number, border: (text: string) => string): string {
	const innerWidth = Math.max(0, width - 2);
	return `${border("│")}${padToWidth(content, innerWidth)}${border("│")}`;
}

function renderAmpCommandPalette(
	width: number,
	terminalRows: number,
	query: string,
	items: AutocompleteItem[],
	selectedIndex: number,
	focused: boolean,
	config: ModesConfig,
): string[] {
	const border = (text: string) => hexColor(text, config.ampUi.borderColor) ?? text;
	const innerWidth = Math.max(0, width - 2);
	const rowMargin = innerWidth >= 6 ? 2 : 0;
	const rowWidth = Math.max(1, innerWidth - rowMargin * 2);
	const availableRows = Math.min(PALETTE_MAX_ITEM_ROWS, Math.max(1, terminalRows - 7));
	const desiredRows = query.length === 0 ? Math.max(1, Math.min(items.length || 1, availableRows)) : PALETTE_MIN_ITEM_ROWS;
	const itemSlots = Math.max(1, Math.min(availableRows, desiredRows));
	const selected = clampIndex(selectedIndex, items.length);
	const startIndex = Math.max(0, Math.min(selected - Math.floor(itemSlots / 2), Math.max(0, items.length - itemSlots)));
	const visibleItems = items.slice(startIndex, startIndex + itemSlots);
	const groupWidth = Math.max(
		5,
		Math.min(
			10,
			visibleItems.reduce((widest, item) => Math.max(widest, visibleWidth(splitPaletteItem(item).group)), 0),
		),
	);
	const cursor = focused ? `${CURSOR_MARKER}${hexBg(" ", PALETTE_MUTED_FG) ?? "\x1b[7m \x1b[0m"}` : (hexBg(" ", PALETTE_MUTED_FG) ?? "█");
	const prompt = hexColor("> ", PALETTE_MUTED_FG) ?? "> ";
	const queryText = hexColor(query, PALETTE_ACTION_FG) ?? query;
	const lines = [renderPaletteTop(width, border)];
	lines.push(renderPaletteLine(`  ${prompt}${queryText}${cursor}`, width, border));
	lines.push(renderPaletteLine("", width, border));

	if (items.length === 0) {
		const noMatch = hexColor("  No matching commands", PALETTE_MUTED_FG) ?? "  No matching commands";
		lines.push(renderPaletteLine(noMatch, width, border));
		for (let index = 1; index < itemSlots; index++) lines.push(renderPaletteLine("", width, border));
	} else {
		for (let slot = 0; slot < itemSlots; slot++) {
			const item = visibleItems[slot];
			if (!item) {
				lines.push(renderPaletteLine("", width, border));
				continue;
			}
			const absoluteIndex = startIndex + slot;
			const row = renderPaletteRow(item, groupWidth, rowWidth, absoluteIndex === selected);
			lines.push(renderPaletteLine(`${" ".repeat(rowMargin)}${row}${" ".repeat(rowMargin)}`, width, border));
		}
		if (items.length > itemSlots) {
			const scrollText = hexColor(`  (${selected + 1}/${items.length})`, PALETTE_MUTED_FG) ?? `  (${selected + 1}/${items.length})`;
			lines.splice(lines.length - 1, 1, renderPaletteLine(scrollText, width, border));
		}
	}

	lines.push(`${border("╰")}${border("─".repeat(Math.max(0, width - 2)))}${border("╯")}`);
	return lines;
}

function agentModePaletteItems(sourceConfig: ModesConfig): AutocompleteItem[] {
	const items = modeNames(sourceConfig).map((name) => {
		const mode = sourceConfig.modes[name];
		const label = mode?.label ?? name;
		return { value: `agent-mode ${name}`, label: `agent-mode ${label}`, description: `Switch to ${label}` };
	});
	items.push({ value: "agent-mode toggle", label: "agent-mode toggle", description: "Cycle Pi agent mode (Alt+M/F8)" });
	return items;
}

function paletteItems(sourceConfig: ModesConfig, query: string): AutocompleteItem[] {
	const baseItems = [...PI_PALETTE_ITEMS, ...agentModePaletteItems(sourceConfig)];
	const seen = new Set<string>();
	const uniqueItems = baseItems.filter((item) => {
		const key = `${item.value}\u0000${item.label}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return query
		? fuzzyFilter(uniqueItems, query, (item) => `${item.label} ${item.value} ${item.description ?? ""}`)
		: uniqueItems;
}

class AmpCommandPaletteComponent {
	focused = false;
	private query = "";
	private selectedIndex = 0;

	constructor(
		private readonly tui: TUI,
		private readonly keybindings: KeybindingsManager,
		private readonly getConfig: () => ModesConfig,
		private readonly done: (result: PaletteResult | null) => void,
	) {}

	private items(): AutocompleteItem[] {
		return paletteItems(this.getConfig(), this.query);
	}

	handleInput(data: string): void {
		const items = this.items();
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done(null);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.selectedIndex = items.length === 0 ? 0 : (this.selectedIndex + items.length - 1) % items.length;
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			this.selectedIndex = items.length === 0 ? 0 : (this.selectedIndex + 1) % items.length;
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			const item = items[clampIndex(this.selectedIndex, items.length)] ?? null;
			this.done(item ? { action: "execute", item } : null);
			return;
		}
		if (this.keybindings.matches(data, "tui.input.tab")) {
			const item = items[clampIndex(this.selectedIndex, items.length)] ?? null;
			this.done(item ? { action: "complete", item } : null);
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, "shift+backspace")) {
			this.query = this.query.slice(0, -1);
			this.selectedIndex = 0;
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.editor.deleteToLineStart") || matchesKey(data, Key.ctrl("u"))) {
			this.query = "";
			this.selectedIndex = 0;
			this.tui.requestRender();
			return;
		}

		const printable = decodeKittyPrintable(data) ?? (data.length === 1 && data.charCodeAt(0) >= 32 ? data : undefined);
		if (printable !== undefined && !printable.includes("\x1b")) {
			this.query += printable;
			this.selectedIndex = 0;
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const items = this.items();
		this.selectedIndex = clampIndex(this.selectedIndex, items.length);
		return renderAmpCommandPalette(width, this.tui.terminal.rows, this.query, items, this.selectedIndex, this.focused, this.getConfig());
	}

	invalidate(): void {}
}

class EmptyComponent {
	render(): string[] {
		return [];
	}

	invalidate(): void {}
}

async function applyMode(name: ModeName, ctx: ExtensionContext, pi: ExtensionAPI, config: ModesConfig): Promise<boolean> {
	const mode = config.modes[name];
	if (!mode) {
		ctx.ui.notify(`Mode not found: ${name}`, "error");
		return false;
	}

	const model = ctx.modelRegistry.find(mode.provider, mode.modelId);
	if (!model) {
		ctx.ui.notify(`Mode "${name}": model not found: ${mode.provider}/${mode.modelId}`, "error");
		return false;
	}

	const modelOk = await pi.setModel(model);
	if (!modelOk) {
		ctx.ui.notify(`Mode "${name}": no API key for ${mode.provider}/${mode.modelId}`, "error");
		return false;
	}

	pi.setThinkingLevel(mode.thinkingLevel);
	config.currentMode = name;
	writeConfig(config);
	setStatus(ctx, pi, config, name);
	ctx.ui.notify(`Switched to ${mode.label ?? name}: ${mode.modelId}, thinking ${mode.thinkingLevel}`, "info");
	return true;
}

export default function piAmplikeModes(pi: ExtensionAPI) {
	let config = readConfig();
	let activeTui: TUI | undefined;
	let activeEditor: CustomEditor | undefined;
	let branch: string | undefined;
	let paletteOpen = false;

	const requestRender = () => activeTui?.requestRender();

	async function refreshBranch(ctx: ExtensionContext) {
		const result = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd }).catch(() => undefined);
		const stdout = result?.stdout.trim();
		branch = stdout && stdout.length > 0 ? stdout : undefined;
		requestRender();
	}

	function toggleAmpMetric(ctx?: ExtensionContext) {
		config = readConfig();
		config.ampUi.metric = config.ampUi.metric === "tokens" ? "cost" : "tokens";
		writeConfig(config);
		ctx?.ui.notify(`Amp UI metric: ${config.ampUi.metric}`, "info");
		requestRender();
	}

	function resolveModeName(input: string, sourceConfig: ModesConfig): ModeName | undefined {
		const normalized = input.trim();
		return modeNames(sourceConfig).find((name) => name === normalized || sourceConfig.modes[name]?.label === normalized);
	}

	function installAmpAutocomplete(ctx: ExtensionContext) {
		ctx.ui.addAutocompleteProvider((current: AutocompleteProvider): AutocompleteProvider => ({
			triggerCharacters: current.triggerCharacters,
			async getSuggestions(lines, cursorLine, cursorCol, options) {
				const line = lines[cursorLine] ?? "";
				const beforeCursor = line.slice(0, cursorCol);
				const trimmed = beforeCursor.trimStart();
				if (cursorLine === 0 && trimmed.startsWith("/") && !trimmed.slice(1).includes(" ")) {
					const query = trimmed.slice(1);
					const sourceConfig = readConfig();
					const currentSuggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
					const hiddenCommands = new Set(["agent-mode", "amp-ui-metric"]);
					const currentItems = query
						? (currentSuggestions?.items ?? []).filter((item) => !hiddenCommands.has(item.value))
						: [];
					const seen = new Set<string>();
					const combined = [...PI_PALETTE_ITEMS, ...agentModePaletteItems(sourceConfig), ...currentItems].filter((item) => {
						const key = `${item.value}\u0000${item.label}`;
						if (seen.has(key)) return false;
						seen.add(key);
						return true;
					});
					const filtered = query
						? fuzzyFilter(combined, query, (item) => `${item.label} ${item.value} ${item.description ?? ""}`)
						: combined;
					return filtered.length > 0 ? { prefix: beforeCursor, items: filtered } : null;
				}
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			},
			shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
				return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
			},
		}));
	}

	function shouldOpenPalette(editor: { getText?: () => string; getCursor?: () => { line: number; col: number } }): boolean {
		const cursor = editor.getCursor?.();
		return Boolean(cursor && cursor.line === 0 && cursor.col === 0 && (editor.getText?.() ?? "").trim() === "");
	}

	function paletteCommandValue(item: AutocompleteItem): string {
		return item.value.trim().replace(/^\/+/, "");
	}

	function paletteCommandText(item: AutocompleteItem): string {
		const command = paletteCommandValue(item);
		return command ? `/${command} ` : "/";
	}

	function executePaletteItem(item: AutocompleteItem, ctx: ExtensionContext) {
		const command = paletteCommandText(item).trimEnd();
		ctx.ui.setEditorText(command);
		if (activeEditor) {
			activeEditor.handleInput("\r");
			return;
		}
		pi.sendUserMessage(command);
	}

	function completePaletteItem(item: AutocompleteItem, ctx: ExtensionContext) {
		ctx.ui.setEditorText(paletteCommandText(item));
		requestRender();
	}

	function showCommandPalette(ctx: ExtensionContext) {
		if (paletteOpen) return;
		paletteOpen = true;
		void ctx.ui
			.custom<PaletteResult | null>(
				(tui, _theme, keybindings, done) => new AmpCommandPaletteComponent(tui, keybindings, readConfig, done),
				{
					overlay: true,
					overlayOptions: {
						width: "96%",
						minWidth: 64,
						anchor: "center",
						margin: 1,
					},
				},
			)
			.then((result) => {
				paletteOpen = false;
				if (result?.action === "execute") executePaletteItem(result.item, ctx);
				else if (result?.action === "complete") completePaletteItem(result.item, ctx);
				requestRender();
			})
			.catch((error: unknown) => {
				paletteOpen = false;
				ctx.ui.notify(`Command palette failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			});
	}

	function installAmpUi(ctx: ExtensionContext) {
		if (ctx.mode !== "tui" || !config.ampUi.enabled) {
			ctx.ui.setHeader(undefined);
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
			activeEditor = undefined;
			return;
		}

		if (config.ampUi.hideFooter) ctx.ui.setFooter(() => new EmptyComponent());
		else ctx.ui.setFooter(undefined);

		if (config.ampUi.showHeader) {
			ctx.ui.setHeader((_tui, theme) => ({
				render(width: number): string[] {
					return [truncateToWidth(theme.fg("muted", config.ampUi.greeting), width)];
				},
				invalidate() {},
			}));
		} else {
			ctx.ui.setHeader(() => new EmptyComponent());
		}

		void refreshBranch(ctx);
		installAmpAutocomplete(ctx);

		class AmpEditor extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { paddingX: config.ampUi.editorPaddingX });
				activeTui = tui;
				activeEditor = this;
			}

			handleInput(data: string): void {
				if (isMouseInput(data)) {
					toggleAmpMetric();
					return;
				}
				const printable = decodeKittyPrintable(data) ?? (data.length === 1 ? data : undefined);
				if (printable === "/" && shouldOpenPalette(this)) {
					showCommandPalette(ctx);
					return;
				}
				super.handleInput(data);
			}

			render(width: number): string[] {
				const innerWidth = Math.max(1, width - 2);
				const rendered = super.render(innerWidth);
				if (rendered.length < 2) return rendered;

				const query = slashPaletteQuery(this);
				if (query !== undefined && this.isShowingAutocomplete()) {
					const items = getAutocompleteItems(this);
					return renderAmpCommandPalette(
						width,
						this.tui.terminal.rows,
						query,
						items,
						getAutocompleteSelectedIndex(this, items.length),
						this.focused,
						config,
					);
				}

				const paddingX = Math.min(this.getPaddingX(), Math.max(0, Math.floor((innerWidth - 1) / 2)));
				const autocompleteLineCount = getAutocompleteLineCount(this, Math.max(1, innerWidth - paddingX * 2));
				const autocompleteLines = autocompleteLineCount > 0 ? rendered.slice(-autocompleteLineCount) : [];
				const lines = autocompleteLineCount > 0 ? rendered.slice(0, -autocompleteLineCount) : [...rendered];

				const amp = config.ampUi;
				const border = (text: string) => hexColor(text, amp.borderColor) ?? ctx.ui.theme.fg("border", text);
				while (lines.length - 2 < amp.minInputRows) {
					lines.splice(lines.length - 1, 0, " ".repeat(innerWidth));
				}
				for (let index = 0; index < amp.bottomPaddingRows; index++) {
					lines.splice(lines.length - 1, 0, " ".repeat(innerWidth));
				}
				for (let index = 1; index < lines.length - 1; index++) {
					const content = truncateToWidth(lines[index] ?? "", innerWidth, "");
					const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
					lines[index] = `${border("│")}${content}${padding}${border("│")}`;
				}

				const mode = labelForMode(ctx, pi, config);
				const subtleText = (text: string) => hexColor(text, amp.textColor) ?? ctx.ui.theme.fg("muted", text);
				const metricsText = `${formatCost(ctx)} ${amp.modeSeparator} ${formatTokens(ctx)} ${amp.tokensSuffix} ${amp.modeSeparator} `;
				const topRight = `${subtleText(` ${metricsText}`)}${colorModeLabel(
					ctx,
					config,
					mode,
					mode.label,
				)}${colorModeLabel(ctx, config, mode, " ")}`;

				const cwd = amp.showCwd ? formatCwd(ctx.cwd) : "";
				const branchText = amp.showBranch && branch ? ` (${branch})` : "";
				const bottomRight = subtleText(` ${cwd}${branchText} `);

				lines[0] = fitBorder("", topRight, width, { leftCorner: "╭", rightCorner: "╮", line: "─" }, border);
				lines[lines.length - 1] = fitBorder(
					"",
					bottomRight,
					width,
					{ leftCorner: "╰", rightCorner: "╯", line: "─" },
					border,
				);
				return [...lines, ...autocompleteLines.map((line) => padToWidth(line, width))];
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => new AmpEditor(tui, theme, keybindings));
	}

	async function cycle(ctx: ExtensionContext) {
		config = readConfig();
		const order = modeNames(config);
		const current = modeForCurrentState(ctx, pi, config) ?? config.currentMode;
		const currentIndex = Math.max(0, order.indexOf(current));
		const next = order[(currentIndex + 1) % order.length] ?? order[0] ?? "deep";
		await applyMode(next, ctx, pi, config);
		requestRender();
	}

	async function switchMode(args: string | undefined, ctx: ExtensionContext) {
		config = readConfig();
		const requested = args?.trim() || "toggle";
		if (requested === "toggle" || requested === "switch") {
			await cycle(ctx);
			return;
		}
		const resolved = resolveModeName(requested, config);
		if (!resolved) {
			ctx.ui.notify(`Usage: /agent-mode [${modeNames(config).join("|")}|toggle]`, "warning");
			return;
		}
		await applyMode(resolved, ctx, pi, config);
		requestRender();
	}

	pi.registerShortcut(Key.alt("m"), {
		description: "Cycle Pi agent mode",
		handler: cycle,
	});

	pi.registerShortcut(Key.f8, {
		description: "Cycle Pi agent mode",
		handler: cycle,
	});

	pi.registerShortcut(Key.f9, {
		description: "Toggle Amp UI tokens/cost metric",
		handler: (ctx) => toggleAmpMetric(ctx),
	});

	pi.registerCommand("agent-mode", {
		description: "Switch Pi agent mode: <mode> | toggle",
		getArgumentCompletions: (prefix) => {
			const sourceConfig = readConfig();
			const items: AutocompleteItem[] = [
				...modeNames(sourceConfig).map((name) => ({
					value: name,
					label: sourceConfig.modes[name]?.label ?? name,
					description: sourceConfig.modes[name]?.thinkingLevel,
				})),
				{ value: "toggle", label: "toggle", description: "Cycle to the next configured mode" },
			];
			const filtered = prefix ? fuzzyFilter(items, prefix, (item) => `${item.label} ${item.value}`) : items;
			return filtered.length > 0 ? filtered : null;
		},
		handler: switchMode,
	});

	pi.registerCommand("amp-ui-metric", {
		description: "Toggle Amp-style editor metric between tokens and cost",
		handler: async (_args, ctx) => toggleAmpMetric(ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		config = readConfig();
		setStatus(ctx, pi, config);
		installAmpUi(ctx);
	});

	pi.on("session_shutdown", () => {
		activeTui = undefined;
		activeEditor = undefined;
	});

	pi.on("model_select", async (_event, ctx) => {
		setStatus(ctx, pi, config);
		requestRender();
	});

	pi.on("thinking_level_select", async (_event, ctx) => {
		setStatus(ctx, pi, config);
		requestRender();
	});

	pi.on("agent_end", async (_event, ctx) => {
		config = readConfig();
		void refreshBranch(ctx);
		requestRender();
	});
}
