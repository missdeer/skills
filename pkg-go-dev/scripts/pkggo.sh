#!/usr/bin/env bash
# pkggo.sh — thin curl wrapper around https://pkg.go.dev/v1beta
# Spec: https://pkg.go.dev/v1beta/openapi.yaml
#
# Usage:
#   pkggo.sh <command> <path> [extra query args ...]
#
# Commands map 1:1 to API endpoints:
#   package <path>          GET /package/{path}
#   module <path>           GET /module/{path}
#   packages <path>         GET /packages/{path}
#   versions <path>         GET /versions/{path}
#   symbols <path>          GET /symbols/{path}
#   imported-by <path>      GET /imported-by/{path}
#   vulns <path>            GET /vulns/{path}
#   search <query>          GET /search?q=<query>
#   docs <path>             GET /package/{path}?doc=md   (shortcut)
#
# Extra args after <path> are appended as query parameters in either form:
#   key=value   (literal, no URL-encoding done — keep values URL-safe)
#   --readme    (sugar for readme=true)
#   --licenses  (sugar for licenses=true)
#   --imports   (sugar for imports=true)
#   --examples  (sugar for examples=true)
#   --version=X (sugar for version=X)
#   --module=X  (sugar for module=X)
#   --limit=N   (sugar for limit=N)
#   --filter=R  (sugar for filter=R, regex)
#   --token=T   (sugar for token=T, pagination)
#
# Output: pretty-printed JSON via jq (falls back to raw if jq missing).
# Exit: non-zero on HTTP error; prints body to stderr.

set -euo pipefail

BASE="https://pkg.go.dev/v1beta"

die() { printf 'pkggo: %s\n' "$*" >&2; exit 2; }

[[ $# -lt 1 ]] && die "usage: pkggo.sh <command> <path|query> [args...]"

cmd=$1; shift
[[ $# -lt 1 ]] && die "command '$cmd' requires a path or query"
target=$1; shift

# Translate sugar flags into key=value args.
qs_parts=()
for arg in "$@"; do
  case "$arg" in
    --readme)        qs_parts+=("readme=true") ;;
    --licenses)      qs_parts+=("licenses=true") ;;
    --imports)       qs_parts+=("imports=true") ;;
    --examples)      qs_parts+=("examples=true") ;;
    --version=*)     qs_parts+=("version=${arg#--version=}") ;;
    --module=*)      qs_parts+=("module=${arg#--module=}") ;;
    --limit=*)       qs_parts+=("limit=${arg#--limit=}") ;;
    --filter=*)      qs_parts+=("filter=${arg#--filter=}") ;;
    --token=*)       qs_parts+=("token=${arg#--token=}") ;;
    --goos=*)        qs_parts+=("goos=${arg#--goos=}") ;;
    --goarch=*)      qs_parts+=("goarch=${arg#--goarch=}") ;;
    --doc=*)         qs_parts+=("doc=${arg#--doc=}") ;;
    --symbol=*)      qs_parts+=("symbol=${arg#--symbol=}") ;;
    *=*)             qs_parts+=("$arg") ;;
    *)               die "unrecognized arg: $arg" ;;
  esac
done

case "$cmd" in
  package)      path="/package/$target" ;;
  module)       path="/module/$target" ;;
  packages)     path="/packages/$target" ;;
  versions)     path="/versions/$target" ;;
  symbols)      path="/symbols/$target" ;;
  imported-by)  path="/imported-by/$target" ;;
  vulns)        path="/vulns/$target" ;;
  search)
    # Treat $target as the q value; let user override with explicit q=...
    has_q=0
    for kv in "${qs_parts[@]:-}"; do [[ "$kv" == q=* ]] && has_q=1; done
    [[ $has_q -eq 0 ]] && qs_parts=("q=$target" "${qs_parts[@]:-}")
    path="/search"
    ;;
  docs)
    # Shortcut: package docs as markdown
    has_doc=0
    for kv in "${qs_parts[@]:-}"; do [[ "$kv" == doc=* ]] && has_doc=1; done
    [[ $has_doc -eq 0 ]] && qs_parts+=("doc=md")
    path="/package/$target"
    ;;
  *) die "unknown command: $cmd" ;;
esac

# Build URL. Use printf to join with & without leaving a trailing separator.
url="$BASE$path"
if [[ ${#qs_parts[@]} -gt 0 ]]; then
  qs=$(IFS='&'; printf '%s' "${qs_parts[*]}")
  url="$url?$qs"
fi

# Fetch and surface HTTP errors loudly (Rule 12 — fail loud).
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
http_code=$(curl -sS -o "$tmp" -w '%{http_code}' "$url")

if [[ "$http_code" != 2* ]]; then
  printf 'pkggo: HTTP %s for %s\n' "$http_code" "$url" >&2
  cat "$tmp" >&2
  echo >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  jq . < "$tmp"
else
  cat "$tmp"
fi
