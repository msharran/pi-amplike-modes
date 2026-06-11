import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Key } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type ModeName = "deep" | "rush" | "smart";

interface AgentMode {
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	label: string;
}

interface ModesConfig {
	version: number;
	currentMode: ModeName;
	modes: Record<ModeName, AgentMode>;
}

const CONFIG_PATH = join(getAgentDir(), "modes.json");
const STATUS_KEY = "pi-amplike-modes";
const DEFAULT_CONFIG: ModesConfig = {
	version: 1,
	currentMode: "deep",
	modes: {
		deep: {
			provider: "openai-codex",
			modelId: "gpt-5.5",
			thinkingLevel: "medium",
			label: "deep",
		},
		rush: {
			provider: "openai-codex",
			modelId: "gpt-5.5",
			thinkingLevel: "off",
			label: "rush",
		},
		smart: {
			provider: "openai-codex",
			modelId: "gpt-5.5",
			thinkingLevel: "xhigh",
			label: "smart",
		},
	},
};

function readConfig(): ModesConfig {
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<ModesConfig>;
		return {
			...DEFAULT_CONFIG,
			...parsed,
			modes: {
				...DEFAULT_CONFIG.modes,
				...(parsed.modes ?? {}),
			},
		} as ModesConfig;
	} catch {
		return DEFAULT_CONFIG;
	}
}

function writeConfig(config: ModesConfig) {
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function modeForCurrentState(ctx: ExtensionContext, pi: ExtensionAPI, config: ModesConfig): ModeName | undefined {
	const provider = ctx.model?.provider;
	const modelId = ctx.model?.id;
	const thinkingLevel = pi.getThinkingLevel();

	return (Object.keys(config.modes) as ModeName[]).find((name) => {
		const mode = config.modes[name];
		return mode.provider === provider && mode.modelId === modelId && mode.thinkingLevel === thinkingLevel;
	});
}

function setStatus(ctx: ExtensionContext, pi: ExtensionAPI, config: ModesConfig, activeMode?: ModeName) {
	const name = activeMode ?? modeForCurrentState(ctx, pi, config);
	if (!name) {
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", "custom"));
		return;
	}

	const mode = config.modes[name];
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", mode.label ?? name));
}

async function applyMode(name: ModeName, ctx: ExtensionContext, pi: ExtensionAPI, config: ModesConfig): Promise<boolean> {
	const mode = config.modes[name];
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

	async function cycle(ctx: ExtensionContext) {
		config = readConfig();
		const order: ModeName[] = ["deep", "rush", "smart"];
		const current = modeForCurrentState(ctx, pi, config) ?? config.currentMode;
		const currentIndex = order.indexOf(current);
		const next = order[(currentIndex + 1) % order.length] ?? "deep";
		await applyMode(next, ctx, pi, config);
	}

	async function switchMode(args: string | undefined, ctx: ExtensionContext) {
		config = readConfig();
		const requested = args?.trim() || "toggle";
		if (requested === "toggle") {
			await cycle(ctx);
			return;
		}
		if (requested !== "deep" && requested !== "rush" && requested !== "smart") {
			ctx.ui.notify("Usage: /agent-mode [deep|rush|smart|toggle]", "warning");
			return;
		}
		await applyMode(requested, ctx, pi, config);
	}

	pi.registerShortcut(Key.alt("m"), {
		description: "Cycle Pi agent mode (deep/rush/smart)",
		handler: cycle,
	});

	pi.registerShortcut(Key.f8, {
		description: "Cycle Pi agent mode (deep/rush/smart)",
		handler: cycle,
	});

	pi.registerCommand("agent-mode", {
		description: "Switch Pi agent mode: deep | rush | smart | toggle",
		handler: switchMode,
	});


	pi.on("session_start", async (_event, ctx) => {
		config = readConfig();
		setStatus(ctx, pi, config);
	});

	pi.on("model_select", async (_event, ctx) => {
		setStatus(ctx, pi, config);
	});

	pi.on("thinking_level_select", async (_event, ctx) => {
		setStatus(ctx, pi, config);
	});
}
