#!/usr/bin/env pwsh
$ErrorActionPreference = 'Stop'

$SrcDir = Join-Path $HOME '.codex\skills'
if ($env:CLAUDE_CONFIG_DIR) {
    $ClaudeDir = Join-Path $env:CLAUDE_CONFIG_DIR 'skills'
} else {
    $ClaudeDir = Join-Path $HOME '.claude\skills'
}
$GeminiDir = Join-Path $HOME '.gemini\antigravity-cli\skills'

function Make-Link {
    param([string]$Src, [string]$Dst)
    if (Test-Path -LiteralPath $Dst) {
        Remove-Item -LiteralPath $Dst -Recurse -Force
    }
    & cmd /c mklink /J "$Dst" "$Src" | Out-Null
    Write-Host "linked: $Dst -> $Src"
}

New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null
New-Item -ItemType Directory -Force -Path $GeminiDir | Out-Null

Get-ChildItem -LiteralPath $SrcDir -Directory | ForEach-Object {
    $name = $_.Name
    $src = $_.FullName
    Make-Link -Src $src -Dst (Join-Path $ClaudeDir $name)
    Make-Link -Src $src -Dst (Join-Path $GeminiDir $name)
}
