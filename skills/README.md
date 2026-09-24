# JB-Router — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use JB-Router for you.

> Tip: start with the **jb-router** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router-video/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/EmamShahrooz-JB/JB-Router/refs/heads/master/skills/jb-router/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export JB_ROUTER_URL="http://localhost:20128"   # local default, or your VPS / tunnel URL
export JB_ROUTER_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $JB_ROUTER_URL/api/health` → `{"ok":true}`.

## Links

- Source: github.com/EmamShahrooz-JB/JB-Router
- Dashboard: https://github.com/EmamShahrooz-JB/JB-Router
