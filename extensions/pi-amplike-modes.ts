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
import type { AutocompleteItem, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { fuzzyFilter, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

interface AmpUsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	latestCacheHitRate?: number;
}

function formatTokenCount(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function sessionUsageStats(ctx: ExtensionContext): AmpUsageStats {
	const stats: AmpUsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message") continue;
		const message = entry.message as {
			role?: string;
			usage?: {
				input?: number;
				output?: number;
				cacheRead?: number;
				cacheWrite?: number;
				cost?: { total?: number };
			};
		};
		if (message.role !== "assistant" || !message.usage) continue;
		const input = message.usage.input ?? 0;
		const output = message.usage.output ?? 0;
		const cacheRead = message.usage.cacheRead ?? 0;
		const cacheWrite = message.usage.cacheWrite ?? 0;
		stats.input += input;
		stats.output += output;
		stats.cacheRead += cacheRead;
		stats.cacheWrite += cacheWrite;
		stats.cost += message.usage.cost?.total ?? 0;

		const latestPromptTokens = input + cacheRead + cacheWrite;
		stats.latestCacheHitRate = latestPromptTokens > 0 ? (cacheRead / latestPromptTokens) * 100 : undefined;
	}
	return stats;
}

function formatContextPercent(ctx: ExtensionContext): string {
	const percent = ctx.getContextUsage()?.percent;
	return percent === null || percent === undefined ? "?" : `${percent.toFixed(1)}%`;
}

function topMetricParts(ctx: ExtensionContext): string[] {
	const stats = sessionUsageStats(ctx);
	const parts: string[] = [];
	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
	if (stats.cost || usingSubscription) parts.push(`$${stats.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	parts.push(`${formatTokenCount(stats.input + stats.output + stats.cacheRead + stats.cacheWrite)} tok`);
	parts.push(formatContextPercent(ctx));
	return parts;
}

function isMouseInput(data: string): boolean {
	return /^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data) || /^\x1b\[M/.test(data);
}

interface AutocompleteListLike {
	render?: (width: number) => string[];
}

function padToWidth(text: string, width: number): string {
	const truncated = truncateToWidth(text, Math.max(0, width), "");
	return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function getAutocompleteList(editor: unknown): AutocompleteListLike | undefined {
	return (editor as { autocompleteList?: AutocompleteListLike }).autocompleteList;
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
	let branch: string | undefined;

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

	function installAmpUi(ctx: ExtensionContext) {
		if (ctx.mode !== "tui" || !config.ampUi.enabled) {
			ctx.ui.setHeader(undefined);
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
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

		class AmpEditor extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { paddingX: config.ampUi.editorPaddingX });
				activeTui = tui;
			}

			handleInput(data: string): void {
				if (isMouseInput(data)) {
					toggleAmpMetric();
					return;
				}
				super.handleInput(data);
			}

			render(width: number): string[] {
				const innerWidth = Math.max(1, width - 2);
				const rendered = super.render(innerWidth);
				if (rendered.length < 2) return rendered;

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
				const metricParts = topMetricParts(ctx);
				const metricsText = `${metricParts.join(" - ")} - `;
				const topRight = `${subtleText(` ${metricsText}`)}${colorModeLabel(
					ctx,
					config,
					mode,
					mode.label,
				)}${subtleText(" - ")}`;

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
