---
name: pkg-go-dev
description: Query Go package and module documentation from pkg.go.dev's official v1beta REST API. ALWAYS prefer this skill over `go doc`, `go list -m -versions`, `go list -m`, or scraping pkg.go.dev HTML when the target is a published module on pkg.go.dev (`go doc` is only correct for code in the local working tree or local module cache). Use when the user asks to look up a Go package's docs, synopsis, exported symbols, available versions, latest version, imports, importers, vulnerabilities/CVEs, or to search pkg.go.dev. Triggers on requests like "find the latest version of X", "what versions of github.com/... exist", "show the symbols in package Y", "show docs / godoc / godoc.org / pkg.go.dev for Z", "search Go packages for Z", "what vulnerabilities affect module M", "who imports package P". Covers all of github.com/*, golang.org/x/*, standard library, and any other module indexed by pkg.go.dev.
license: MIT
metadata:
  version: "1.0.0"
---

# pkg.go.dev REST API

Official spec: <https://pkg.go.dev/v1beta/openapi.yaml> · Blog: <https://go.dev/blog/pkgsite-api>

Base URL: `https://pkg.go.dev/v1beta` — all endpoints are stateless `GET`s and return JSON. Backward compatibility is maintained.

## When to use

Use this skill whenever you need authoritative information about a Go module/package from pkg.go.dev: docs, synopsis, latest/historical versions, exported symbols, imports, importers, vulnerabilities, or full-text search. Do NOT scrape the HTML pages — call the API.

## Quick recipe

Always pipe through `jq` for readable output. Use the helper at `scripts/pkggo.sh` for common queries, or call `curl` directly.

```bash
# helper (relative to repo root or use absolute path)
scripts/pkggo.sh package github.com/google/go-cmp/cmp
scripts/pkggo.sh search uuid
scripts/pkggo.sh versions github.com/google/go-cmp
scripts/pkggo.sh symbols github.com/google/go-cmp/cmp
scripts/pkggo.sh module github.com/google/go-cmp --readme
scripts/pkggo.sh vulns golang.org/x/net
scripts/pkggo.sh imported-by github.com/google/go-cmp/cmp
scripts/pkggo.sh docs github.com/google/go-cmp/cmp        # docs as markdown
```

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /package/{path}` | Package metadata, optionally docs/imports/licenses |
| `GET /module/{path}` | Module metadata, optionally go.mod/README/licenses |
| `GET /packages/{path}` | List packages in a module |
| `GET /versions/{path}` | Versions of a module (descending) |
| `GET /symbols/{path}` | Exported symbols of a package |
| `GET /imported-by/{path}` | External packages that import this one |
| `GET /vulns/{path}` | Vulnerabilities from the Go vuln DB |
| `GET /search?q={q}` | Full-text search; add `symbol=` for symbol search |

### Common query parameters

- `version=` — semver (`v1.2.3`), or branch (`master`/`main`), or `latest`. Default: latest tagged.
- `module=` — required when a package path is ambiguous across modules; the API returns a candidates list rather than guessing.
- `goos=`, `goarch=` — build context for symbols/docs.
- `doc=text|html|md` — format for package docs.
- `examples=true`, `imports=true`, `licenses=true`, `readme=true` — opt-in fields.
- Pagination: `limit=`, `token=` (use `nextPageToken` from previous response), `filter=` (regex).

## Curl examples

```bash
# Latest package metadata + docs in markdown, with examples and imports
curl -s "https://pkg.go.dev/v1beta/package/github.com/google/go-cmp/cmp?doc=md&examples=true&imports=true" | jq .

# Module README and go.mod for a specific version
curl -s "https://pkg.go.dev/v1beta/module/github.com/google/go-cmp?version=v0.7.0&readme=true" | jq .

# Symbol search across pkg.go.dev
curl -s "https://pkg.go.dev/v1beta/search?q=context&symbol=WithCancel&limit=10" | jq '.items'

# All known vulnerabilities for a module
curl -s "https://pkg.go.dev/v1beta/vulns/golang.org/x/net" | jq '.items[] | {id, summary, fixedVersion}'

# Ambiguous package path → API returns candidates
curl -s "https://pkg.go.dev/v1beta/package/example.com/a/b/c" | jq '.candidates'
```

## Response shapes (key fields)

- **Package**: `modulePath`, `version`, `path`, `name`, `synopsis`, `isLatest`, `isStandardLibrary`, `goos`, `goarch`, `docs`, `imports[]`, `licenses[]`.
- **Module**: `path`, `version`, `commitTime`, `repoUrl`, `hasGoMod`, `goModContents`, `isLatest`, `licenses[]`, `readme{filepath,contents}`.
- **PaginatedResponse**: `items[]`, `total`, `nextPageToken`.
- **Symbol** (in symbols endpoint items): `name`, `kind`, `parent`, `synopsis`.
- **ModuleVersion** (in versions endpoint items): `modulePath`, `version`, `commitTime`, `deprecated`, `deprecationReason`, `retracted`, `retractionReason`, `latestVersion`.
- **Vulnerability**: `id`, `summary`, `details`, `fixedVersion`.
- **Error**: `code`, `message`, `candidates[]` (when path is ambiguous), `fixes[]`.

## Notes

- The API is **precision-first**: when a path could belong to multiple modules, it returns an error with `candidates`. Re-issue the request with the explicit `module=` query param.
- Branch versions (`?version=master`) auto-resolve to a pseudo-version string in the response.
- Pagination: keep calling with `token=<nextPageToken>` until the field is absent/empty.
- For non-200 responses, parse the `Error` schema rather than treating the body as the success shape.
- Do not invent endpoints — only the eight above are supported.
