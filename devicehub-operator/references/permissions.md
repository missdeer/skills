# 权限与签名排查

## 区分两层权限

沙箱外执行可以解决工具对系统服务和缓存的访问限制，但不会自动授予 macOS 辅助功能权限。`osascript 不允许辅助访问`（`-1728`）需要用户在系统设置授权实际负责此次执行的应用。

```bash
open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
```

位置是“系统设置 → 隐私与安全性 → 辅助功能”，不是侧栏单独的“辅助功能”。Apple Events 的“自动化”授权也是另一项，根据实际报错处理。

错误提到 `osascript`，不代表应该直接授权 `/usr/bin/osascript`。先确认 TCC 的 responsible 宿主，通常是终端应用。

## 确认进程与身份

只打印进程名称和 PID，不打印参数、环境变量或整机进程列表：

```bash
devicehub_pid=$$
for devicehub_step in 1 2 3 4 5 6 7 8; do
    ps -p "$devicehub_pid" -o pid=,ppid=,comm=
    devicehub_pid=$(ps -p "$devicehub_pid" -o ppid= | tr -d ' ')
    if [ -z "$devicehub_pid" ] || [ "$devicehub_pid" = 0 ]; then break; fi
done
```

找到实际 `.app` 路径，分别检查它与系统设置中选中的副本：

```bash
plutil -extract CFBundleIdentifier raw -o - /path/to/Terminal.app/Contents/Info.plist
codesign -dvv -r- /path/to/Terminal.app
```

对比 bundle ID、签名标识符、TeamIdentifier、designated requirement 和路径。临时签名可能绑定具体 CDHash，相同 bundle ID 不足以确认授权匹配。

## 本次 Mostty 案例

- 运行进程来自开发目录中的 `zig-out/Mostty.app`，系统还有 `/Applications/Mostty.app`。
- 两份 bundle ID 都为 `com.dfordsoft.mostty.terminal`，用“＋”添加没有出现第二条同名记录。
- 安装版有团队签名，开发版为 linker ad-hoc 签名，没有 TeamIdentifier。
- TCC 记录了授权更新，但访问时仍出现 `Failed to match existing code requirement ... kTCCServiceAccessibility`，并列出两个不同 CDHash。
- 改从已授权的 Ghostty 启动 Codex 后，读取 Device Hub 和发送 `AXPress` 均成功。

不要据此断言所有 Mostty 都不可用。重编译、签名变化、仍运行的旧进程或缓存都可能影响匹配。重启后仍需执行 `probe` 实测，不能直接宣称修复。

## 需要时读日志

将例子中的 `mostty` 换为实际宿主标识，只查当前失败附近的时间范围：

```bash
/usr/bin/log show --last 5m --style compact --info --debug \
  --predicate 'subsystem == "com.apple.TCC" AND (eventMessage CONTAINS[c] "mostty" OR eventMessage CONTAINS[c] "osascript")'
```

关注 `AttributionChain`、`responsible_path`、`Update Access Record`、`CodeReq` 和 `Failed to match existing code requirement`。如需保存，用任务临时文件，最终只引用有关行，避免转述其他应用的隐私信息。

TCC 数据库在沙箱外也可能因完全磁盘访问限制而拒绝只读查询。本次数据库读取失败，但统一日志足以定位问题。不要直接编辑数据库、全局重置权限、重签终端或终止宿主会话来绕过授权。

仍无法访问时，报告具体错误和证据，请用户授权实际宿主或选择已授权的终端。继续可独立执行的截图检查，把未操作的姿态标为未验证。
