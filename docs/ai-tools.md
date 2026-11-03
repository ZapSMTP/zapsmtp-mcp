# AI tools

> Use ZapSMTP from AI coding assistants: the MCP server for Claude, Cursor and VS Code, Agent Skills, llms.txt with every page as Markdown, and the CLI.

Source: https://zapsmtp.com/docs/ai-tools/

Your coding assistant can work with ZapSMTP directly: send and inspect email through the MCP server, learn the API from Agent Skills and `llms.txt`, or drive everything from the command line.

> The MCP server, the CLI and the skills are being published. [llms.txt](https://zapsmtp.com/llms.txt) and the Markdown pages are available now.

- [MCP server](#mcp): Every API operation as a tool for Claude, Cursor, VS Code, Codex and any MCP client.
- [Agent Skills](#skills): Instructions that teach coding agents to send, verify webhooks, use templates and migrate correctly.
- [llms.txt](#llms): The docs for language models: an index, every page as Markdown and all of it in one file.
- [CLI](#cli): The whole API from your terminal or a script, with tables for people and JSON for tools.

## MCP server

`zapsmtp-mcp` gives an assistant one tool per API operation, generated from the same description as these pages, plus `send_test_email` (any delivery outcome on the simulator) and `verify_webhook_signature`. Create a key in the dashboard (a `zap_test_…` key delivers nothing) and add the server to your client:

**Add the MCP server**

Claude Code:

```
claude mcp add zapsmtp -e ZAP_API_KEY=zap_... -- npx -y zapsmtp-mcp
```

Claude Desktop:

```
// Settings → Developer → Edit Config (claude_desktop_config.json)
{
  "mcpServers": {
    "zapsmtp": {
      "command": "npx",
      "args": ["-y", "zapsmtp-mcp"],
      "env": { "ZAP_API_KEY": "zap_..." }
    }
  }
}
```

Cursor:

```
// ~/.cursor/mcp.json (every project) or .cursor/mcp.json (one project)
{
  "mcpServers": {
    "zapsmtp": {
      "command": "npx",
      "args": ["-y", "zapsmtp-mcp"],
      "env": { "ZAP_API_KEY": "zap_..." }
    }
  }
}
```

VS Code:

```
// .vscode/mcp.json: VS Code asks for the key once and keeps it
{
  "inputs": [
    { "type": "promptString", "id": "zapsmtp-key", "description": "ZapSMTP API key", "password": true }
  ],
  "servers": {
    "zapsmtp": {
      "command": "npx",
      "args": ["-y", "zapsmtp-mcp"],
      "env": { "ZAP_API_KEY": "${input:zapsmtp-key}" }
    }
  }
}
```

- **Choose what it can do.** `--toolsets emails,templates,simulator` keeps only those groups; `--read-only` keeps only reads. Tools carry read-only and destructive hints for clients that ask before acting.
- **Keep sends in bounds.** `--sender` sets the default From, and `--allowed-recipient-domains` refuses mail to any other domain. Retries inside one send reuse its idempotency key. To repeat a tool call safely, pass the same `idempotency_key` again: the second call returns the first result instead of sending (24 hours).
- **Serve a team.** `--http` runs Streamable HTTP at `/mcp`, where every client brings its own `Authorization: Bearer` key and the server holds none.
- **The docs come along.** `llms.txt` and every guide are bundled as MCP resources; nothing is fetched at runtime.

## Agent Skills

Skills are folders an agent loads when a task needs them. The `zapsmtp` skill routes to six others: sending email, webhooks, templates, receiving email, email best practices, and migrating from Resend, SendGrid, Mailgun, Postmark or Amazon SES. Every code sample in them is checked against the API before release.

**Install the skills**

Claude Code:

```
# in a checkout of the skills repository
DEST=.claude/skills            # or ~/.claude/skills for every project
mkdir -p "$DEST/zapsmtp"
cp -R SKILL.md LICENSE references "$DEST/zapsmtp/"
for s in zapsmtp-*/; do cp -R "$s" "$DEST/"; done
```

Cursor, Copilot, Codex:

```
# .agents/skills is read by Cursor, GitHub Copilot and OpenAI Codex alike
DEST=.agents/skills
mkdir -p "$DEST/zapsmtp"
cp -R SKILL.md LICENSE references "$DEST/zapsmtp/"
for s in zapsmtp-*/; do cp -R "$s" "$DEST/"; done
```

For a tool without skills support, put the relevant `SKILL.md` in its instruction file, such as `AGENTS.md` or `.github/copilot-instructions.md`.

## llms.txt and Markdown pages

- [`/llms.txt`](https://zapsmtp.com/llms.txt): what ZapSMTP is, how to authenticate and test, then every docs page with a one-line description ([llmstxt.org](https://llmstxt.org)).
- [`/llms-full.txt`](https://zapsmtp.com/llms-full.txt): every page in one file, for tools that load the whole context at once.
- Every docs page as Markdown: add `.md` to its path, for example [`/docs/sending.md`](https://zapsmtp.com/docs/sending.md) or [`/docs/emails/send-email.md`](https://zapsmtp.com/docs/emails/send-email.md).
- [`/openapi.json`](https://zapsmtp.com/openapi.json): the whole API in OpenAPI 3.1 with request and response schemas.

All of them are rebuilt with the docs, so they never fall behind the pages you read here.

## CLI

`zapsmtp` has a command for every API operation, with typed flags and `--help` for each. It prints tables in a terminal and JSON when piped, walks every page with `--all`, and exits non-zero on an API error with its code and request id.

**Use the CLI**

```
npm install -g zapsmtp-cli
zapsmtp login                       # checks the key, keeps it readable by you only
zapsmtp test --from hello@acme.com  # an email to the simulator and the event it will raise
zapsmtp send --from "Acme <hello@acme.com>" --to jane@example.org \
  --subject "Your receipt" --html-file receipt.html --attach ./invoice.pdf
zapsmtp emails list --status bounced --all --json | jq '.data[].to'
zapsmtp domains verify <domain-id>
```
