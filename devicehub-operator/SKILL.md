---
name: devicehub-operator
description: 在 macOS 上通过 AppleScript 辅助功能操作 Xcode Device Hub，定位设备控件、切换 iPhone Duo 形态、操作模拟器内 App 并截取内外屏证据。用户要求操作 Device Hub、验证模拟器 UI、展开或折叠 Duo，或排查相关自动化权限时使用。适用于已构建或已安装 App 的运行验证，不负责实现折叠屏适配或发布 App。
---

# Device Hub 操作

根据 Xcode 27.2 的实操整理。先发现当前版本的窗口、控件和显示屏，不把下面的英文按钮名、显示屏 ID 或窗口索引当成固定接口。

## 启动和权限探测

从技能目录执行示例；在其他目录执行时，使用脚本的实际绝对路径。

```bash
xcodebuild -version
xcode-select -p
xcrun simctl list devices available
osascript scripts/devicehub.applescript probe
```

- Xcode 27.2 使用 `DeviceHub.app`，可能没有名为 `Simulator` 的应用。打开选中的 Xcode 所带 Device Hub：`open "$(xcode-select -p)/../Applications/DeviceHub.app"`。路径不存在时先在该 Xcode bundle 内定位。
- `probe` 返回窗口索引和标题。没有窗口时打开目标设备；多窗口时按标题选择，不默认操作第一个窗口。
- 遇到 `osascript 不允许辅助访问` / `-1728`，先读 [权限排查](references/permissions.md)。不要反复重试控件操作。
- CoreSimulator 连接失效、日志目录拒绝访问或 Xcode 缓存写入失败，可能来自执行沙箱。按宿主工具机制请求相关命令在沙箱外执行；这不会自动授予 macOS 辅助功能权限。

## 定位和点击

```bash
osascript scripts/devicehub.applescript inspect 1
osascript scripts/devicehub.applescript locate help Open 1
osascript scripts/devicehub.applescript press help Open 1
```

`inspect` 列出可操作控件及 QML 导航项的 description、help、identifier、enabled、position、size。`name` 经常为空，不能只依赖它。`locate` 只读取；`press` 对精确匹配的目标发送 `AXPress`。

本次 Xcode 27.2 的设备按钮以 `help` 定位：

| help | 动作 |
| --- | --- |
| `Open` | 展开 Duo |
| `Partially Open` | 半折叠 |
| `Closed` | 合上 |
| `Rotate Right` | 向右旋转 |
| `Home` | 设备主屏，区别于 App 内首页 |
| `Screenshot`、`Record Screen` | 截图、录屏入口 |

App 内控件可以用 `description` 或 `identifier`，以当前读到的值为准。FMC 的“首页”属于 `AXGenericElement`，按 `description` 可定位。

双屏或预览可能让相同 App 控件在树中出现多份。脚本拒绝点击不唯一的匹配，并显示候选位置。确认目标所在显示面后，最后一个参数可指定从 1 开始的匹配序号：

```bash
osascript scripts/devicehub.applescript locate description 首页 1
osascript scripts/devicehub.applescript press description 首页 1 2
```

只有确认第二个候选是目标时才使用 `2`。不要盲选第一项。设备形态按钮通常唯一，优先使用 `help`。

`Pressed` 只表示发送动作成功。随后观察截图或控件状态，确认目标页面和姿态确实变化。若控件不支持 `AXPress`，检查支持的动作并按结果处理，不能吞掉错误。

## 双屏截图

从设备列表确定当前 UDID，设置任务变量 `DEVICEHUB_UDID`；不要复用历史会话 UUID。

```bash
xcrun simctl io "$DEVICEHUB_UDID" enumerate
xcrun simctl io "$DEVICEHUB_UDID" screenshot --display=3 /private/tmp/devicehub-inner.png
sips -g pixelWidth -g pixelHeight /private/tmp/devicehub-inner.png
```

- 本次 Duo 实例外屏为 `1`、内屏为 `3`。每次先用 `enumerate` 或缺少 `--display` 时的歧义错误核对映射。
- 不指定显示面可能失败或截到非当前屏幕，不能据此判断 App 消失。
- 查看实际图像和尺寸后再标注横竖方向。文件名并不能证明方向，本次曾出现命名为 portrait 的横向截图。
- 平面截图不足以证明曲面触摸和所有折叠避让都正确。区分“发送形态操作”“观察布局变化”和“完成交互验证”。
- 长期交付的证据保存在项目产物目录；临时目录只用于当前调查。

## 验证与收尾

已有模拟器 App 可通过 `simctl install`、`simctl launch` 安装启动。先核对 bundle ID、UDID、产物平台和架构；真机包不能安装到模拟器。`xcrun vtool -show-build` 和 `xcrun lipo -info` 可核对二进制。

按任务选择外屏、展开内屏、旋转、半折叠、合回外屏和左右分屏。记录前后页面、选择项、输入及业务状态。进程未退出不等于功能和状态通过验收。

App 控件优先复用 Device Hub 的辅助功能树。AXe 是可选的独立模拟器工具，但本次曾出现 `Timed out creating the simulator remote automation session`；不要把它的超时等同于 Device Hub 不可用，也不要反复等待同类超时。

计数、删除、分享、支付等业务动作遵守用户授权范围。不要为 UI 验证覆盖用户记录、生成样例数据或实际发送内容。需要测试业务状态时使用适当隔离的测试数据。

结束时说明设备、实际执行的场景、观察结果、证据和未验证项。无特别要求时尽量恢复操作前姿态和页面，注意用户可能在测试期间主动操作，不覆盖用户的新选择。

## AppleScript 注意事项

- 先 `set elementList to get entire contents of targetWindow`，再迭代，并用 `contents of entryRef` 解引用。直接迭代未求值的 `entire contents` 会产生属性转换错误。
- `AXHelp`、`AXIdentifier`、`AXValue` 可能不存在。分别处理缺失值，不能把整个控件记录放进一个静默丢弃的大 `try`。
- 不固化长串 `group 3 of splitter group 1 …`，侧栏和窗口模式会改变层级。
- 控件树可能很大，完整遍历需要数十秒。先 `probe`，有需要再 `inspect`；避免并发发送多项 GUI 动作。

本技能指导操作，不替代产品适配规范。QML 自绘导航不会因为用了 iOS 外观而获得 UIKit 容器的全部自动布局行为。
