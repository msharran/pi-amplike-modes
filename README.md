# pi-agent-modes

A Pi package that adds quick agent-mode switching for Pi.

## Install

Install directly from GitHub:

```bash
pi install git:github.com/msharran/pi-agent-mode
```

After npm publication, install from npm with:

```bash
pi install npm:pi-agent-modes
```

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

Create or edit `~/.pi/agent/modes.json` to customize providers, models, thinking levels, and labels:

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

## Contributing

1. Clone the repository:

   ```bash
   git clone https://github.com/msharran/pi-agent-mode.git
   cd pi-agent-mode
   ```

2. Test the package without installing it permanently:

   ```bash
   pi -e .
   ```

3. Or install your local checkout while developing:

   ```bash
   pi install "$PWD"
   ```

4. Reload Pi after changes with `/reload`, or restart Pi if needed.

5. Validate packaging before opening a pull request:

   ```bash
   npm pack --dry-run
   git diff --check
   ```
