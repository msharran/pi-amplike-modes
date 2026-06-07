# pi-amplike-modes

A Pi package that adds amp-like quick agent-mode switching for Pi.

## Install

Install directly from GitHub:

```bash
pi install git:github.com/msharran/pi-amplike-modes
```

After npm publication, install from npm with:

```bash
pi install npm:pi-amplike-modes
```

## Modes

- `deep` — GPT-5.5 with medium thinking
- `rush` — GPT-5.5 with thinking off
- `smart` — GPT-5.5 with xhigh thinking

The active mode is shown in the Pi footer/status area.

## Usage

- Press `Alt+M` or `F8` to cycle `deep → rush → smart`.
- Run `/agent-mode deep`, `/agent-mode rush`, `/agent-mode smart`, or `/agent-mode toggle`.

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

## Pi package listing

The Pi package catalog lists extensions, skills, prompts, and themes that are published to npm and tagged with the `pi-package` keyword. This package includes that keyword and a `pi` manifest in `package.json`.

Once the npm package is published, the catalog should be able to discover it. The Pi docs do not state a fixed indexing SLA, so the exact listing time is not documented.

## Contributing

1. Clone the repository:

   ```bash
   git clone https://github.com/msharran/pi-amplike-modes.git
   cd pi-amplike-modes
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
