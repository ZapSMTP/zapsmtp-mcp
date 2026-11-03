# ZapSMTP MCP server

The official [Model Context Protocol](https://modelcontextprotocol.io) server for
[ZapSMTP](https://zapsmtp.com): let Claude, Cursor, VS Code, Codex and any other MCP client send,
receive and track email, and manage templates, domains, webhooks and everything else the API does.

- **The whole API**: one tool per API operation (119), generated from the API reference, so a new
  endpoint becomes a tool with the next release. Clear descriptions and JSON Schemas with every
  parameter, required field and allowed value.
- **Safe to hand to an agent**: tool annotations (read-only, destructive, idempotent, open-world) for
  clients that ask before acting, `--read-only`, toolsets, a recipient domain allowlist, and sends that
  never repeat when retried. The API key never reaches the model.
- **Made for agents**: `send_test_email` tries any delivery outcome on simulator addresses that never
  leave ZapSMTP; `verify_webhook_signature` checks webhook requests; lists come back one page at a time
  with a cursor for the next; errors carry the API's code, message and request id.
- **stdio or Streamable HTTP**: run it next to your editor, or serve a team over HTTP where every client
  brings its own API key.
- **The docs as resources**: `llms.txt` and every guide, bundled in the package (nothing is fetched at
  runtime).

Node.js 18.3 or newer. Built on the official [Node.js SDK](https://www.npmjs.com/package/zapsmtp).

## Quick start

Create an API key in the [dashboard](https://zapsmtp.com) (a `zap_test_…` key sends test email and reads
everything without delivering anything; changing the account needs a live key), then add the server to your client.

### Claude Code

```bash
claude mcp add zapsmtp -e ZAP_API_KEY=zap_... -- npx -y zapsmtp-mcp
```

With a default sender and only the tools you need:

```bash
claude mcp add zapsmtp -e ZAP_API_KEY=zap_... -e ZAP_SENDER="Acme <hello@acme.com>" \
  -- npx -y zapsmtp-mcp --toolsets emails,templates,simulator
```

### Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
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

### Cursor

`~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project):

```json
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

### VS Code (GitHub Copilot agent mode)

`.vscode/mcp.json`; VS Code asks for the key once and stores it securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "zapsmtp-key", "description": "ZapSMTP API key", "password": true }
  ],
  "servers": {
    "zapsmtp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "zapsmtp-mcp"],
      "env": { "ZAP_API_KEY": "${input:zapsmtp-key}" }
    }
  }
}
```

### OpenAI Codex

```bash
codex mcp add zapsmtp --env ZAP_API_KEY=zap_... -- npx -y zapsmtp-mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.zapsmtp]
command = "npx"
args = ["-y", "zapsmtp-mcp"]
env = { ZAP_API_KEY = "zap_..." }
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
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

### Zed

`settings.json`:

```json
{
  "context_servers": {
    "zapsmtp": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "zapsmtp-mcp"],
      "env": { "ZAP_API_KEY": "zap_..." }
    }
  }
}
```

### Gemini CLI

`~/.gemini/settings.json` (Gemini CLI expands `$ZAP_API_KEY` from your environment):

```json
{
  "mcpServers": {
    "zapsmtp": {
      "command": "npx",
      "args": ["-y", "zapsmtp-mcp"],
      "env": { "ZAP_API_KEY": "$ZAP_API_KEY" }
    }
  }
}
```

### Any other client

Run `npx -y zapsmtp-mcp` over stdio with `ZAP_API_KEY` in its environment, or connect to the HTTP
server below.

## Streamable HTTP

```bash
npx -y zapsmtp-mcp --http                  # http://127.0.0.1:3000/mcp
npx -y zapsmtp-mcp --http --port 8080 --host 0.0.0.0
```

The HTTP server holds no API key. Every client sends its own as `Authorization: Bearer <key>`, and each
request gets its own SDK client and MCP server (the server is stateless), so one client's key is never
used for another's calls. A request without a key gets `401`.

```bash
claude mcp add --transport http zapsmtp http://127.0.0.1:3000/mcp --header "Authorization: Bearer zap_..."
```

```json
{
  "mcpServers": {
    "zapsmtp": { "url": "http://127.0.0.1:3000/mcp", "headers": { "Authorization": "Bearer zap_..." } }
  }
}
```

- It listens on `127.0.0.1` unless `--host` says otherwise, and while on loopback it refuses requests
  whose `Host` or `Origin` is not local (DNS rebinding).
- Beyond your machine, put it behind HTTPS (a reverse proxy): the key travels in a header.
- `GET /health` answers `{"status": "ok"}` for load balancers. Request bodies are limited to 64 MiB.

## Options

| Flag | Environment | Default | |
|---|---|---|---|
| `--key <key>` | `ZAP_API_KEY` | | API key (stdio). Not used with `--http`. |
| `--http` | | off | Serve Streamable HTTP at `/mcp` instead of stdio |
| `--port <port>` | `ZAP_MCP_PORT` | `3000` | HTTP port |
| `--host <host>` | `ZAP_MCP_HOST` | `127.0.0.1` | HTTP address |
| `--toolsets <a,b>` | `ZAP_TOOLSETS` | the defaults below | Toolsets to expose, or `all` |
| `--read-only` | `ZAP_READ_ONLY=1` | off | Only tools that change nothing |
| `--sender <address>` | `ZAP_SENDER` | | From for sends that omit it; without one, sends require `from` |
| `--reply-to <address>` | `ZAP_REPLY_TO` | | Reply-To for sends that omit it |
| `--allowed-recipient-domains <a,b>` | `ZAP_ALLOWED_RECIPIENT_DOMAINS` | | Refuse sends to any other domain |
| `--base-url <url>` | `ZAP_BASE_URL` | `https://api.zapsmtp.com/v1` | API base URL |
| `--list-tools` | | | Print the tools these options expose, and exit |
| `-h`, `--help` / `-v`, `--version` | | | |

Flags win over the environment.

## Toolsets

The default toolsets give 80 tools; `--read-only` leaves 44 of them. Clients that slow down with many
tools do best with just the toolsets they need: `--toolsets emails,simulator` is 14 tools.

| Toolset | Default | Tools | |
|---|---|---|---|
| `emails` | yes | 12 | `emails_send`, `emails_send_batch`, `emails_list`, `emails_get`, `emails_update`, `emails_cancel`, `emails_get_content`, `emails_spam_check`, `emails_spam_check_sent`, `emails_attachments_list`, `emails_attachments_get`, `emails_share` |
| `receiving` | yes | 8 | `emails_receiving_list`, `emails_receiving_get`, `emails_receiving_delete`, `emails_receiving_attachments_list`, `emails_receiving_attachments_get`, `emails_receiving_redeliver`, `emails_receiving_report_spam`, `emails_receiving_reply` |
| `threads` | yes | 3 | `threads_list`, `threads_get`, `threads_update` |
| `templates` | yes | 12 | `templates_list`, `templates_create`, `templates_get`, `templates_update`, `templates_delete`, `templates_render`, `templates_render_source`, `templates_publish`, `templates_duplicate`, `templates_versions_list`, `templates_versions_get`, `templates_versions_restore` |
| `variables` | yes | 3 | `variables_list`, `variables_set_global`, `variables_delete_global` |
| `domains` | yes | 11 | `domains_list`, `domains_create`, `domains_get`, `domains_update`, `domains_verify`, `domains_delete`, `domains_get_dmarc`, `domains_get_reputation`, `domains_check_reputation`, `domains_get_brand`, `domains_update_brand` |
| `webhooks` | yes | 12 | `webhooks_list`, `webhooks_create`, `webhooks_get`, `webhooks_update`, `webhooks_delete`, `webhooks_test`, `webhooks_list_deliveries`, `webhooks_rotate_secret`, `webhooks_events_replay`, `webhooks_events_list`, `webhooks_events_get`, `verify_webhook_signature` |
| `suppressions` | yes | 6 | `suppressions_list`, `suppressions_create`, `suppressions_delete`, `suppressions_get`, `suppressions_create_batch`, `suppressions_delete_batch` |
| `logs` | yes | 2 | `logs_list`, `logs_get` |
| `stats` | yes | 4 | `stats_get`, `stats_timeseries`, `stats_breakdown`, `stats_metrics` |
| `usage` | yes | 1 | `usage_get` |
| `account` | yes | 2 | `account_get`, `account_update` |
| `simulator` | yes | 2 | `simulator_get`, `send_test_email` |
| `email_validations` | yes | 2 | `email_validations_create`, `email_validations_create_batch` |
| `inbound` | | 16 | inbound domains, routes and forward destinations |
| `placement_tests` | | 3 | inbox placement tests: start, list, get |
| `actions` | | 5 | click actions |
| `template_modules` | | 5 | reusable template modules |
| `template_assets` | | 3 | images hosted for templates |
| `template_timers` | | 1 | countdown timer images |
| `api_keys` | | 4 | create, update and revoke API keys |
| `smtp_credentials` | | 3 | SMTP relay credentials |
| `dedicated_ips` | | 1 | dedicated sending IPs |

`zapsmtp-mcp --list-tools --toolsets all` prints every tool. Tool names follow the
[Node.js SDK](https://www.npmjs.com/package/zapsmtp): `zap.templates.versions.get` is
`templates_versions_get`.

## What the tools do

- **Arguments** are the API's parameters by their API names (`reply_to`, `scheduled_at`), path
  parameters included (`templates_versions_get` takes `id` and `vid`). Unknown or missing arguments are
  refused before anything is sent.
- **Results** are the API's JSON. A list returns one page: `{data, has_more, next_cursor}`; pass
  `next_cursor` back as `cursor` for the next page with the same filters. An operation without a body
  returns `{"ok": true}`.
- **Errors** are tool errors (`isError`) with `{"error": {status, code, type, message, request_id}}`,
  so the model can correct itself; quote the `request_id` to support.
- **Sends** (`emails_send`, `emails_send_batch`, `emails_receiving_reply`) take an `idempotency_key`; the
  server makes one when it is omitted, so the SDK's automatic retries never send twice.
- **`send_test_email`** sends to the simulator address of a scenario (`delivered`, `bounced`, `full`,
  `blocked`, `delayed`, `complained`, `suppressed`, or any SMTP reply as `bounce+<code>…`) and returns
  the email id with the event to expect.
- **`verify_webhook_signature`** checks a webhook request's `Zap-Signature` against its raw body and
  the endpoint's secret, locally, and returns its events (several for a batch webhook).

Annotations: tools for `GET` requests, renders and spam checks are `readOnlyHint`. Deletes, cancelling a
scheduled email, rotating a webhook secret, removing suppressions and restoring a template version are
`destructiveHint`. Sends, test webhooks and replays are `openWorldHint`. Updates, deletes and
verifications are `idempotentHint`.

## Resources

When the package was built with the docs site, `resources/list` offers
`https://zapsmtp.com/llms.txt` (an index of the docs) and every guide as Markdown, for example
`https://zapsmtp.com/docs/sending.md`. They are read from the package; nothing is fetched.

## Safety

- **The key stays out of the conversation.** It is read from the environment or a flag and sent only to
  the API. Tool results and errors are scrubbed of it, and the server writes nothing about it to its
  logs. Prefer the environment (or VS Code's `promptString` input) over `--key`, which shows in process
  lists.
- **Scope the key.** Give the agent a `zap_test_…` key while you try things, and a key restricted to
  sending, one domain or one stream (`api_keys_create`) for production use.
- **Limit what the agent can do**: `--read-only`, `--toolsets`, and
  `--allowed-recipient-domains acme.com,example.org`, which refuses sends to any other domain (and its
  subdomains) before any request is made. Under the allowlist, `emails_receiving_reply` must name its
  recipients in `to` and cannot use `reply_all`, since the original sender's domain is unknown until
  the API answers. `send_test_email` always sends to the simulator.
- **Review before approving**: destructive tools are annotated, so clients that ask before running a tool
  (Claude Code, Claude Desktop, VS Code, Cursor) show which calls change or delete things.
- **HTTP**: loopback by default with `Host`/`Origin` checks; use HTTPS beyond your machine.

## Embedding

```ts
import { API, buildTools, createServer, makeClient } from 'zapsmtp-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const tools = buildTools(API, { toolsets: ['emails', 'simulator'], sender: 'hello@acme.com' });
const server = createServer({ client: makeClient({ apiKey: process.env.ZAP_API_KEY! }), tools });
await server.connect(new StdioServerTransport());
```

## Development

```bash
cd sdks/node && npm ci && npm run build   # the SDK this package uses
cd ../mcp && npm ci
npm run generate    # src/generated/ by sdks/codegen (emit/mcp.mjs); the build fails when it is stale
npm test            # every tool against the conformance server, HTTP auth, safety options
npm run coverage    # 100% of the hand-written code
npm run build       # the codegen check, dist/, and docs/ from landing/zapsmtp-site/dist when it is built
../live/run.sh mcp  # against the dev API
```

`src/generated/` is generated by `sdks/codegen` (`emit/mcp.mjs`; the code calling the SDK comes from
`codegen/templates/tools-model.ts`, shared with the CLI); `src/catalog.ts` holds the hand-written choices (toolsets,
annotations, descriptions).
