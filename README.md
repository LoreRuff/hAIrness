# AI Harness

Personal AI studio — OpenRouter relay, system-prompt override (append/replace),
per-message cost/cached metadata, skills, memory (soul/facts), attachments,
in-browser code run (JS + Pyodide). Single Node process, single port.

## Requirements
- Debian LXC (or any Linux), Node.js >= 20, build tools for better-sqlite3:
  `sudo apt update && sudo apt install -y nodejs npm build-essential python3`

## Install & run (dev)
```bash
git clone <repo> harness && cd harness
cp .env.example .env      # put your OPENROUTER_API_KEY in it
npm install
npm run dev               # web on :5173 (proxy), api on :8787
