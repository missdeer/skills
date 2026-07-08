---
name: jira
description: "Read/write JIRA issues on https://jira.ismisv.com via REST API v2 only. Use ONLY for direct issue CRUD: get an issue by key (SHELFECOMM-1, FOO-123), JQL search, read/add comments, list/apply transitions, create a ticket, (re)assign, link/unlink issues, or list/upload/download/delete attachments. Do NOT use for end-to-end issue resolution workflows (planning, coding, reviewing, committing) — that is the `jira-issue-resolver` skill's job; do NOT use for non-JIRA ticketing (GitHub Issues, Lark Task); do NOT scrape HTML pages or invent endpoints. Authenticates with Basic Auth from `jira-auth.json` (gitignored)."
license: MIT
metadata:
  version: "2.2.0"
---

# JIRA (jira.ismisv.com) REST API

Base URL: `https://jira.ismisv.com/rest/api/2` — JIRA Server / Data Center REST API v2. All endpoints below return JSON.

Auth: HTTP Basic, credentials read from `jira-auth.json`. Resolution order:

1. `--auth-file=PATH` (explicit; empty value rejected)
2. `$HOME/jira-auth.json` (Windows: `%USERPROFILE%\jira-auth.json`) — **canonical location**
3. Walk upward from cwd to the nearest git root (legacy fallback)

File format:

```json
{ "account": "<username>", "password": "<password>" }
```

Prefer `$HOME` so credentials live outside any repo. Never commit it, never echo the password back to the user. Override the base URL with the `JIRA_URL` environment variable.

## When to use

- The user mentions a JIRA issue key (`PROJECT-123` shape) — read the issue with `get`.
- The user wants to list / search tickets — use `jql` with a JQL string.
- The user wants to read or post comments — use `comments` / `comment`.
- The user wants to move an issue between statuses — use `transitions` then `transition`.
- The user wants to **create a new ticket** — use `meta` to discover issue types, then `create`.
- The user wants to **(re)assign a ticket** — use `assign`.
- The user wants to **manage attachments** on an issue (list / upload / download / delete) — use `attachments` / `attach` / `download` / `detach`; use `attachment <ID>` for a single item's metadata.
- The user asks "am I logged in / who am I" against JIRA — use `myself`.

Do NOT use this skill for non-JIRA ticketing (GitHub Issues, Lark Tasks, etc.).

## Quick recipe

The `jira` command is already on the `PATH`. Invoke it directly as `jira ...`
— do NOT search for or prefix a relative/absolute path to the executable.
Output is pretty-printed JSON; non-2xx responses go to stderr with exit 1.

```bash
jira myself                                  # verify auth
jira get SHELFECOMM-1                        # full issue JSON
jira get SHELFECOMM-1 --fields=summary,status,assignee
jira jql 'assignee = currentUser() AND resolution = Unresolved'
jira jql 'project = SHELFECOMM ORDER BY created DESC' --limit=20
jira comments SHELFECOMM-1
jira comment SHELFECOMM-1 'patched in commit abc1234'
jira transitions SHELFECOMM-1                # list available next states
jira transition SHELFECOMM-1 31              # move to transition id 31
jira projects                                # list visible projects
jira meta SHELFECOMM                         # list issue types in a project
jira create SHELFECOMM Task 'Fix login redirect bug' \
    --assignee=missdeer \
    --text-file=tmp/issue-desc.txt           # see "Creating tickets" below
jira assign SHELFECOMM-6 missdeer            # (re)assign; use "-1" for Automatic, "" to unassign
jira --text-file=tmp/comment.txt comment SHELFECOMM-1   # body from file (no shell quoting headaches)
jira attachments SHELFECOMM-1                # list attachments on an issue (JSON array)
jira attach SHELFECOMM-1 ./tmp/plan.md ./tmp/screenshot.png   # upload one or more files
jira attachment 10010                        # single attachment metadata
jira download 10010 --output=./local.bin     # download attachment bytes (truncates existing file)
jira download 10010 --output=- > local.bin   # stream raw bytes to stdout
jira detach 10010                            # delete an attachment
```

Run `jira --help` for the full command and flag reference.

## Commands

| Command | Endpoint | Purpose |
|---------|----------|---------|
| `myself` | `GET /myself` | Current authenticated user (sanity check) |
| `get <KEY>` | `GET /issue/{KEY}` | Single issue. Supports `--fields=a,b,c` and `--expand=renderedFields,changelog` |
| `jql <jql>` | `GET /search` | JQL search. Supports `--limit=N`, `--start=N`, `--fields=...`. Body alt: `--text-file=PATH` replaces the positional JQL string |
| `comments <KEY>` | `GET /issue/{KEY}/comment` | List comments |
| `comment <KEY> <body>` | `POST /issue/{KEY}/comment` | Add a comment (body is plain text, JIRA wiki markup supported). Body alt: `--text-file=PATH` replaces `<body>` |
| `transitions <KEY>` | `GET /issue/{KEY}/transitions` | List allowed transitions for the issue |
| `transition <KEY> <id>` | `POST /issue/{KEY}/transitions` | Apply transition id (get id from `transitions`) |
| `projects` | `GET /project` | Visible projects |
| `meta <PROJECT_KEY>` | `GET /issue/createmeta?projectKeys=…&expand=projects.issuetypes` | List issue types (id + name) for a project — call before `create` |
| `create <PROJECT> <ISSUETYPE> <SUMMARY>` | `POST /issue` | Create a new issue. `ISSUETYPE` accepts either numeric id (e.g. `10002`) or name (`Task`). Optional flags: `--assignee=<name>`, `--description=<short>`, `--text-file=<path>` (UTF-8 description, recommended for CJK), `--priority=<name>`, `--labels=a,b,c`, `--parent=<KEY>`. `--description-file=<path>` is a deprecated alias of `--text-file` |
| `assign <KEY> <USERNAME>` | `PUT /issue/{KEY}/assignee` | (Re)assign. Pass `-1` for "Automatic"; empty string to unassign |
| `linktypes` | `GET /issueLinkType` | List link type names (`Blocks`, `Duplicate`, …) — call before `link` |
| `link <FROM> <TYPE> <TO>` | `POST /issueLink` | Link two issues. Optional `--comment=<text>` (or `--text-file=PATH`) attaches a note |
| `unlink <linkId>` | `DELETE /issueLink/{linkId}` | Remove an issue link |
| `attachments <KEY>` | `GET /issue/{KEY}?fields=attachment` | Array of attachment metadata for the issue. Null / missing attachment field is normalised to `[]` so `jq '.[]'` pipelines don't break. |
| `attachment <ID>` | `GET /attachment/{ID}` | Single attachment metadata (author, filename, size, mimeType, content URL) |
| `attach <KEY> <FILE>...` | `POST /issue/{KEY}/attachments` | Upload one or more local files as attachments. Multipart form, `X-Atlassian-Token: no-check`. All paths are stat-checked before the request — if any file is missing / a directory, nothing is uploaded |
| `download <ID> [--output=PATH]` | `GET /attachment/{ID}` then `GET <content URL>` | Download attachment bytes. `--output=PATH` writes to that path (truncating an existing file). `--output=-` streams raw bytes to stdout. Default (no `--output`) writes to the metadata filename in cwd, refusing unsafe names (path separators, Windows reserved names, ADS, trailing dot/space). Basic Auth is only sent when the content URL shares hostname+port with the JIRA base; a stale `http://` scheme in the metadata is normalised to the base scheme on same-host, so a correctly HTTPS-fronted JIRA still authenticates |
| `detach <ID>` | `DELETE /attachment/{ID}` | Delete an attachment. JIRA has no update-attachment endpoint; editing an attachment = `detach` + `attach` |
| `raw <method> <path> [body]` | passthrough | Escape hatch for endpoints not wrapped above. `body` may be a literal JSON string OR `--text-file=PATH`. Legacy `@path/to/file.json` still works (deprecated) |

## Flags

- `--auth-file=PATH` — global; override the `jira-auth.json` location (empty value rejected).
- `--text-file=PATH` — global; supply the command's main free-text payload from a UTF-8 file. Accepted by `jql` (the JQL string), `comment` (`<body>`), `link` (`--comment`), `raw` (body), and `create` (description). Any other command rejects it. Mutually exclusive with the positional/flag form it replaces — combining them is a usage error, not a precedence rule. Use this whenever the body would otherwise need awkward shell quoting (multi-line, CJK, JSON, JIRA wiki markup).
- `--fields=a,b,c` — comma-separated field list (passed verbatim to `fields=`).
- `--expand=x,y` — expand parameter.
- `--limit=N` — for `jql`, sets `maxResults`.
- `--start=N` — for `jql`, sets `startAt` (pagination offset).
- Any unrecognized `--key=value` is URL-encoded and appended to the query string. Bare `key=value` (without `--`) is **not** treated as a flag — it stays as a positional arg, so JQL like `project = SHELFECOMM` is safe to pass unquoted-internally.

## Notes

- **Surfacing only what's asked.** For `get`, default returns the full issue. When the user only needs a summary or a few fields, pass `--fields=...` so the output stays small.
- **JQL needs quoting.** Wrap the whole JQL expression in single quotes when invoking the script; the wrapper URL-encodes it.
- **Comments are plain text + JIRA wiki markup.** No Markdown rendering. `{{code}}`, `*bold*`, `[link|url]` etc. work.
- **Transitions are project-specific.** Always call `transitions` first to discover the id — never hard-code one across projects.
- **Failures are loud.** The tool exits non-zero and prints the response body to stderr on any non-2xx — do not silently retry. Exit 1 = HTTP error; exit 2 = bad usage / missing auth file.
- Set environment variable `MSYS_NO_PATHCONV=1` when launch `jira` and only when launch `jira` on Windows.
- For endpoints not in the table above, use `raw`, e.g. `jira raw GET /issue/SHELFECOMM-1/worklog`.

## Creating tickets

Recipe:

1. `meta <PROJECT>` to see the project's issue types (id + name). On `SHELFECOMM` they are Task / Bug / Story / Sub-task / Epic.
2. Put the **description** in a UTF-8 file and pass `--text-file=<path>` — this is the one and only safe path for CJK content (see "UTF-8 / Windows gotcha" below). For pure ASCII bodies, `--description='…'` inline is fine. `--description-file=<path>` still works as a deprecated alias.
3. Call `create`. The response is the standard `{id, key, self}` triple — surface the `key` (e.g. `SHELFECOMM-6`) back to the user along with the browse URL `https://jira.ismisv.com/browse/<KEY>`.

Description bodies are interpreted as **JIRA wiki markup**, not Markdown. Common patterns:

- Headings: `h2. Foo` / `h3. Bar`
- Bullet list: `* item`
- Numbered list: `# step`
- Code: `{{inline}}` / `{code}block{code}`
- Links: `[label|https://…]`

## UTF-8 / CJK

The Go binary sends request bodies as raw bytes via `net/http`, so CJK works
identically on Windows, macOS, and Linux for `comment`, `create`, `transition`,
and `assign` — no shell-codepage workaround needed.

For `raw POST/PUT` with CJK payloads, both forms work:

- `jira raw POST /issue '{"fields":{"summary":"Fix bug",…}}'` — literal string.
- `jira --text-file=tmp/payload.json raw POST /issue` — file bytes verbatim (preferred for non-trivial payloads). The legacy `raw POST /issue @tmp/payload.json` form still works but is deprecated.

## Attachments

- **No update endpoint.** JIRA REST v2 does not expose "update attachment". To edit an attachment, `detach` the old one and `attach` a new one.
- **Upload is multipart.** `attach` builds a `multipart/form-data` body with one `file` field per input path and sets `X-Atlassian-Token: no-check` (JIRA rejects XSRF-unsafe uploads without it). All input paths are `stat`-checked up-front; if any file is missing or a directory, the request is not sent.
- **Download is a two-hop request.** `download` first `GET`s the attachment metadata to resolve the `content` URL, then `GET`s the content bytes. The content URL can point to a CDN — redirects are followed, and Go's stdlib strips the `Authorization` header on cross-origin redirects.
- **Same-host normalisation.** JIRA Server often emits stale `http://` URLs in attachment metadata even when the reverse proxy runs HTTPS. When the metadata content URL matches the base's hostname and port, `download` rewrites the scheme to the base's scheme before hitting the network. Cross-host URLs (S3, CDN) are fetched verbatim, anonymously.
- **Default filename is validated.** With no `--output`, `download` writes to the metadata filename in `cwd`. If that name contains path separators, a NUL, a Windows reserved base (`CON`, `NUL`, `COM1`…), an ADS colon, or a trailing dot / space, the download is refused — pass an explicit `--output=PATH` to override.
- **Overwrite is like `curl -o`.** An explicit `--output=PATH` truncates any existing file at that path. `--output=-` streams the raw bytes to stdout (useful for piping into `sha256sum`, `bat`, etc.).
