#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="${HOME}/.codex/skills"
if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
    CLAUDE_DIR="${CLAUDE_CONFIG_DIR}/skills"
else
    CLAUDE_DIR="${HOME}/.claude/skills"
fi
GEMINI_DIR="${HOME}/.gemini/antigravity-cli/skills"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) IS_WIN=1 ;;
    *) IS_WIN=0 ;;
esac

to_win_path() {
    if command -v cygpath >/dev/null 2>&1; then
        cygpath -w "$1"
    else
        echo "$1" | sed -e 's|^/\([a-zA-Z]\)/|\1:\\|' -e 's|/|\\|g'
    fi
}

make_link() {
    local src="$1" dst="$2"
    if [ -e "$dst" ] || [ -L "$dst" ]; then
        rm -rf "$dst"
    fi
    if [ "$IS_WIN" = 1 ]; then
        cmd //c mklink /J "$(to_win_path "$dst")" "$(to_win_path "$src")" >/dev/null
    else
        ln -sfn "$src" "$dst"
    fi
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
