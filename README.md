# ⚡ Webpilot

**The web, through the eyes of a machine.**

A semantic terminal browser that renders web pages as structured, numbered, interactive text. Built for LLM agents and CLI-native developers.

```
$ webpilot https://github.com

  GitHub: Let's build from here
  https://github.com
  ────────────────────────────────────────────

  [1] 🔗 link         Sign in
  [2] 🔗 link         Sign up
  [3] 🔍 searchbox    Search GitHub
  [4] 📌 h1           Build and ship software on a single platform
  [5] ✏️  textbox      Enter your email address
  [6] ⏺  button       [ Sign up for GitHub ]

webpilot > click [1]

  ↪ Navigated: https://github.com → https://github.com/login

  Sign in to GitHub
  https://github.com/login
  ────────────────────────────────────────────

  [1] 📌 h1           Sign in to GitHub
  [2] ✏️  textbox      Username or email address: (empty)
  [3] ✏️  textbox      Password: (empty)
  [4] ⏺  button       [ Sign in ]
  [5] 🔗 link         Forgot password?
  [6] 🔗 link         Create an account

webpilot > type [2] "myuser"
webpilot > type [3] "mypass"
webpilot > click [4]
```

## Why?

LLMs today can read code and edit code, but they **can't see or interact with the running website**. Existing terminal browsers either:
- Render pixels as characters (useless for LLMs)
- Don't support JavaScript (useless for modern web)
- Require scripting, not interactive browsing

Webpilot is different: it uses the **accessibility tree** — the same semantic structure screen readers use — to represent any website as numbered, interactive text that both humans and machines can understand.

## Install

```bash
npm install -g webpilot
npx playwright install chromium   # one-time browser setup
```

## Usage

```bash
# Interactive REPL
webpilot https://google.com

# JSON output for LLM agents
webpilot --agent https://google.com

# Pipe mode for scripting
echo 'goto https://example.com
extract --links' | webpilot --pipe

# Quick shortcuts
webpilot :3000              # → http://localhost:3000
webpilot google.com         # → https://google.com
```

## Commands

| Command | Description |
|---------|-------------|
| `goto <url>` | Navigate to URL |
| `click [n]` | Click element n |
| `type [n] "text"` | Type into element n |
| `select [n] "opt"` | Select dropdown option |
| `back` / `forward` | Browser history |
| `scroll down/up` | Scroll the page |
| `find "text"` | Search elements |
| `extract --links` | Extract all links |
| `extract --tables` | Extract tables |
| `eval "js"` | Execute JavaScript |
| `screenshot` | Save screenshot |
| `tabs` / `newtab` | Tab management |
| `help` | Show all commands |

## Three Output Modes

**Human** (default) — Colored, formatted for terminal reading
**Agent** (`--agent`) — JSON structured for LLM consumption  
**Pipe** (auto when piped) — Plain text for `grep`, `awk`, scripting

## How It Works

1. **Playwright** launches a headless Chromium browser (full JS, cookies, SPAs — everything works)
2. **Accessibility Tree** is extracted — the semantic structure of the page, not pixels
3. **Elements get numbered** — `[1]`, `[2]`, `[3]`... for easy targeting
4. **State diffs** show what changed after each action, not the entire page
5. **You interact** via simple commands: `click [3]`, `type [5] "hello"`

## Works Everywhere

- ✅ `localhost:3000` (your dev server)
- ✅ `google.com` (public websites)
- ✅ React / Next.js / Vue / Angular (full JS execution)
- ✅ SPAs with client-side routing
- ✅ Sites behind login (cookies persist in session)
- ✅ Dynamic content (JS executes before snapshot)

## License

MIT
