---
name: cdb-debugging
description: Windows-only. Drive WinDbg's command-line frontend `cdb.exe` non-interactively to diagnose crashes, startup failures, hangs, and unexplained behavior in the current development build. Assumes source tree + matching PDBs are available. Use when the user asks to "debug the crash", "run under cdb", "get a stack trace", "why does it crash on startup", "analyze the .dmp", or when reading source alone did not reveal the cause. Do NOT use for post-mortem symbol-less production dumps, remote kernel debugging, or as a general-purpose REPL — the workflow is scripted `-c "...;q"` batches.
---

# cdb-debugging

Run the target program under `cdb.exe` (WinDbg's command-line frontend) in scripted mode to collect evidence about crashes, exceptions, or unexpected behavior: stacks, registers, exception codes, locals, module list. This is **not** an interactive debugger workflow — always feed commands via `-c "cmd1;cmd2;q"` and read the log file afterwards.

## Locating cdb.exe

In priority order:

1. Try PATH first: `command -v cdb.exe` or just `cdb.exe -version`.
2. Fall back to the fixed Windows SDK path: `"%ProgramFiles(x86)%\Windows Kits\10\Debuggers\x64\cdb.exe"`.

In Claude's Bash this is typically:

```bash
CDB="/c/Program Files (x86)/Windows Kits/10/Debuggers/x64/cdb.exe"
```

Or just `cdb.exe` if it's already on PATH.

## Key flags

Mandatory:

- `-y <symbol-path>` — symbol search path. For a development build use `-y "<build dir>;srv*C:\symbols*https://msdl.microsoft.com/download/symbols"`: local PDBs first, Microsoft symbol server second (optional, needed only to resolve system DLL frames).
- `-srcpath <src-path>` — source path, so `lsa` / `.frame` can show source lines.
- `-c "cmd1;cmd2;q"` — commands to run automatically on start. **Must end in `q`**, otherwise cdb blocks at the prompt.
- `-logo <file>` / `-loga <file>` — write the full session to a log (`-logo` overwrites, `-loga` appends).

Situational:

- Launch a new process: `cdb.exe [...] <program.exe> [args]`. cdb breaks at the entry point by default. `-g` skips the initial breakpoint, `-G` skips the final breakpoint on normal exit. **Do not pass `-G` for crash diagnosis** — you want the exception context preserved.
- Attach to a running process: `-p <pid>` or `-pn <name.exe>`.
- Open a minidump: `-z <path.dmp>`.

## Useful command blocks (chain into `-c`)

- Init: `.symfix+; .reload /f; .lines -e` — fix symbol path, force reload, enable line info.
- Crash analysis: `!analyze -v` — the workhorse; auto-locates the faulting instruction and thread.
- Stacks:
  - `kn` current thread with frame numbers, `kv` adds parameter registers, `kp` shows C++ arguments.
  - `~*kn` every thread's stack (essential for deadlock / UI hang).
- Context: `r` (registers), `.exr -1` (last exception record), `.ecxr` (switch to the exception context).
- Locals / source: `.frame <n>` switch frame, `dv /V /t` (locals with type and address), `lsa .` (source around current frame).
- Modules: `lm vm <module>` (timestamp / path / PDB status for one module), `lm` (all).
- Running to the crash / a specific line: `g` to go; break on a symbol with `bu <module>!<func>` or on a source line with ``bp `<module>!<file.cpp>:<line>` ``.

## Typical workflows

### 1) Crashes on launch, want the stack

```bash
"$CDB" -y "cmake-msvc-build\bin;srv*C:\symbols*https://msdl.microsoft.com/download/symbols" \
  -srcpath "src" \
  -logo tmp\cdb-crash.log \
  -c ".symfix+;.reload /f;g;!analyze -v;.ecxr;kv;~*kn;lm;q" \
  cmake-msvc-build\bin\MyApp.exe
```

Commands before `g` execute at the entry-point break, `g` runs until the crash, the rest run at the exception site, then `q` exits. Read `tmp\cdb-crash.log`.

### 2) Won't start / flashes and dies

Same shape, focused on early startup. Optionally add breakpoints like `bu KERNEL32!LoadLibraryExW` or `bu ntdll!LdrpInitializeProcess`. Or keep it minimal: `-c ".symfix+;.reload /f;g;kv;lm;q"` — if the program exits normally, `q` fires immediately; if it crashes, execution stops at the exception and the subsequent commands capture it.

### 3) Hang / unresponsive, need all thread stacks

Reproduce the hang, get the PID, then attach:

```bash
"$CDB" -pn MyApp.exe -y "cmake-msvc-build\bin" -srcpath "src" \
  -logo tmp\cdb-hang.log \
  -c ".symfix+;.reload /f;~*kn;!locks;q"
```

`-pn` breaks the target immediately on attach. Note: plain `q` on an attached process **terminates the target**; use `qd` (detach and quit) to keep it running.

### 4) Analyze an existing dump

```bash
"$CDB" -z tmp\crash.dmp -y "cmake-msvc-build\bin;srv*C:\symbols*https://msdl.microsoft.com/download/symbols" \
  -srcpath "src" \
  -logo tmp\cdb-dmp.log \
  -c ".symfix+;.reload /f;!analyze -v;.ecxr;kv;~*kn;lm;q"
```

## Hard rules

- **`-c` must end with `q`** (or `qd` for attach scenarios). Otherwise cdb sits at the prompt and the Bash call hangs until timeout.
- Always write output with `-logo <file>` under `tmp/`; do not rely on stdout — cdb emits ANSI control sequences that pollute the terminal, whereas the log file is clean text.
- When paths contain spaces, quote the whole `-c` string and use forward slashes or escaped backslashes inside; watch Bash escaping when passing Windows-style paths.
- PDB timestamps must match the exe. `lm vm MyApp` should show `Symbols loaded: ...pdb`; if it says `export symbols` or `deferred`, the PDB did not match — check the `-y` path and the build artifact.
- Even with a PDB, Release builds often report `<value unavailable>` for locals and fold frames due to inlining / optimization. That's a compiler-output limitation, not a cdb bug — rebuild as Debug or RelWithDebInfo to reproduce when you need reliable locals.
- **Do not** use cdb as an interactive REPL by launching it repeatedly. Each invocation is a single scripted shot; analyze from the log afterwards.
