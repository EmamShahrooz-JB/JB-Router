# JB-Router - FREE AI Router & Token Saver

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**

[![npm](https://img.shields.io/github/v/release/EmamShahrooz-JB/JB-Router)](https://github.com/EmamShahrooz-JB/JB-Router#cli)
[![Downloads](https://img.shields.io/github/downloads/EmamShahrooz-JB/JB-Router/total)](https://github.com/EmamShahrooz-JB/JB-Router#cli)
[![Docker Pulls](https://img.shields.io/github/v/release/EmamShahrooz-JB/JB-Router?logo=docker&label=Docker%20pulls)](https://github.com/EmamShahrooz-JB/JB-Router)
[![GHCR](https://img.shields.io/badge/GHCR-EmamShahrooz-JB%2FJB-Router-blue?logo=github)](github.com/EmamShahrooz-JB/JB-Router/pkgs/container/jb-router)
[![License](https://img.shields.io/github/license/EmamShahrooz-JB/JB-Router)](github.com/EmamShahrooz-JB/JB-Router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="EmamShahrooz-JB%2FJB-Router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[🌐 Website](https://github.com/EmamShahrooz-JB/JB-Router) • [📖 Full Docs](github.com/EmamShahrooz-JB/JB-Router)

---

## 🤔 Why JB-Router?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**JB-Router solves this:**

- ✅ **RTK Token Saver** - Auto-compress tool_result, save 20-40% tokens
- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin between accounts per provider
- ✅ **Universal** - Works with any OpenAI/Claude-compatible CLI

---

## ⚡ Quick Start

**Option 1 — npm (recommended for desktop):**

```bash
npm install -g jb-router-cli
jb-router

# Or run directly with npx
npx jb-router
```

**Option 2 — Docker (server/VPS):**

```bash
docker run -d --name jb-router -p 20128:20128 \
  -v "$HOME/.jb-router:/app/data" -e DATA_DIR=/app/data \
  EmamShahrooz-JB/JB-Router:latest
```

Published images: [Docker Hub](https://github.com/EmamShahrooz-JB/JB-Router) • [GHCR](github.com/EmamShahrooz-JB/JB-Router/pkgs/container/jb-router) (multi-platform amd64/arm64).

🎉 Dashboard opens at `http://localhost:20128`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## 🚀 CLI Options

```bash
jb-router                    # Start with default settings
jb-router --port 8080        # Custom port
jb-router --no-browser       # Don't open browser
jb-router --skip-update      # Skip auto-update check
jb-router --help             # Show all options
```

**Dashboard**: `http://localhost:20128/dashboard`

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.jb-router/db/data.sqlite`
- **Windows**: `%APPDATA%/jb-router/db/data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.jb-router` to persist)

---

## 📚 Documentation

Full docs, advanced setup, video tutorials & development guide:

- **GitHub**: github.com/EmamShahrooz-JB/JB-Router
- **Full README**: github.com/EmamShahrooz-JB/JB-Router/blob/master/README.md
- **Website**: https://github.com/EmamShahrooz-JB/JB-Router

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
