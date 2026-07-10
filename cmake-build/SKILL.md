---
name: cmake-build
description: Windows-only CMake wrappers for the GarmentStyleMatch project — build, clean, and reconfigure the `cmake-msvc-build/` tree via login-shell wrappers (`cmake-build`, `cmake-clean`, `cmake-reconfigure`). Use whenever the user asks to compile / build / rebuild the project, wipe the build directory, or reconfigure after editing `CMakeLists.txt`. Do NOT invoke `cmake` / `cmake --build` / `ninja` directly — always go through these wrappers.
---

# cmake-build

Windows 专用命令，都通过 `bash -lc` 触发 login shell 里的 wrapper。**不要**直接调 `cmake` / `cmake --build` / `ninja`。

固定构建目录：`cmake-msvc-build/`（不要新建 `build/`）。

## 编译

```bash
bash -lc "cmake-build cmake-msvc-build"
```

## 清理构建目录

```bash
bash -lc "cmake-clean cmake-msvc-build"
```

## 重新配置 CMake 项目

`CMakeLists.txt` 有修改时**必须**先跑：

```bash
bash -lc "cmake-reconfigure cmake-msvc-build"
```

典型顺序：改了 `CMakeLists.txt` → `cmake-reconfigure` → `cmake-build`；想彻底重来 → `cmake-clean` → `cmake-reconfigure` → `cmake-build`。
