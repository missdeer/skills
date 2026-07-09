#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        if command -v pwsh >/dev/null 2>&1; then
            PS=pwsh
        else
            PS=powershell
        fi
        exec "$PS" -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$SCRIPT_DIR/link.ps1" 2>/dev/null || echo "$SCRIPT_DIR/link.ps1")"
        ;;
esac

SRC_DIR="${HOME}/.codex/skills"
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
    CLAUDE_DIR="${CLAUDE_CONFIG_DIR}/skills"
else
    CLAUDE_DIR="${HOME}/.claude/skills"
fi
GEMINI_DIR="${HOME}/.gemini/antigravity-cli/skills"

make_link() {
    local src="$1" dst="$2"
    if [ -e "$dst" ] || [ -L "$dst" ]; then
        rm -rf "$dst"
    fi
    ln -sfn "$src" "$dst"
    echo "linked: $dst -> $src"
}

mkdir -p "$CLAUDE_DIR" "$GEMINI_DIR"

for skill in "$SRC_DIR"/*/; do
    [ -d "$skill" ] || continue
    name="$(basename "$skill")"
    src="${skill%/}"
    make_link "$src" "$CLAUDE_DIR/$name"
    make_link "$src" "$GEMINI_DIR/$name"
done
