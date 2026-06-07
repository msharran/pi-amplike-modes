# pi-agent-modes

A Pi package that adds quick agent-mode switching for Pi.

## Modes

- `deep` — GPT-5.5 with medium thinking
- `rush` — GPT-5.5 with thinking off
- `smart` — GPT-5.5 with xhigh thinking

The active mode is shown in the Pi footer/status area.

## Usage

- Press `Alt+M` or `F8` to cycle `deep → rush → smart`.
- Run `/agent-mode deep`, `/agent-mode rush`, `/agent-mode smart`, or `/agent-mode toggle`.
- `/coding-mode` is kept as a legacy alias.

Mode settings are read from `~/.pi/agent/modes.json`; if the file does not exist, defaults are used.

## Sample `modes.json`

```json
{
  "version": 1,
  "currentMode": "deep",
  "modes": {
    "deep": {
      "provider": "openai-codex",
      "modelId": "gpt-5.5",
      "thinkingLevel": "medium",
      "label": "deep"
    },
    "rush": {
      "provider": "openai-codex",
      "modelId": "gpt-5.5",
      "thinkingLevel": "off",
      "label": "rush"
    },
    "smart": {
      "provider": "openai-codex",
      "modelId": "gpt-5.5",
      "thinkingLevel": "xhigh",
      "label": "smart"
    }
  }
}
```

## Install locally

```bash
pi install /Users/msharran/root/play/pi-agent-mode
```

## Try without installing

```bash
pi -e /Users/msharran/root/play/pi-agent-mode
```
