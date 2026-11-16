# AGENTS.md · 给 AI 编程助手的说明

这份文件是给 Claude / GPT / Copilot / Cursor 这类助手看的。人类读者可以直接跳到 [README](README.md)。

目标：**让助手在不读完全部源码的情况下，5 分钟内能改对地方**。

---

## 1. 项目定位

Windows 本地素材浏览器。Tauri 2（Rust 后端）+ React + TypeScript（前端）。

- 只读浏览本地文件，**绝不修改用户文件**
- 性能是第一优先级：上万文件、60fps、缓存命中 3ms
- 没有服务器、没有账号、不联网（除 GitHub 更新外无网络调用）

## 2. 目录与职责

| 路径 | 职责 | 改这里通常是为了 |
| --- | --- | --- |
| `src/App.tsx` | 应用状态与编排：导航栈、筛选、排序、右键菜单、拖放 | 加全局功能、改筛选逻辑 |
| `src/components/Grid.tsx` | 虚拟滚动、单元格、缩略图触发时机 | 改滚动/加载行为 |
| `src/components/Settings.tsx` | 设置面板（缓存、预生成、托盘、PS、隐藏后缀） | 加设置项 |
| `src/components/Toolbar.tsx` | 顶栏：面包屑、搜索、字号、时间筛选 | 加顶栏按钮 |
| `src/components/Sidebar.tsx` | 收藏夹 + 文件夹树 | 改导航树 |
| `src/lib/thumb.ts` | 前端缩略图缓存、并发队列、优先级、剪枝 | 改加载优先级/卡顿 |
| `src/lib/backend.ts` | 所有 `invoke` 的封装，Electron/Web 兼容层 | 加后端命令（**先加这里**） |
| `src-tauri/src/commands.rs` | 所有 `#[tauri::command]`、路径打开、PS 启动、.lnk 解析 | 加后端能力 |
| `src-tauri/src/thumb.rs` | 图片解码、PSD 解析与合成图解码 | 支持新格式 |
| `src-tauri/src/cache.rs` | SQLite 缓存、内存层、LRU 淘汰、容量统计 | 缓存策略 |
| `src-tauri/src/prewarm.rs` | 批量预生成、定时自动刷新 | 预生成/调度 |
| `src-tauri/src/lib.rs` | 应用启动、托盘、窗口事件、命令注册 | 窗口/托盘行为 |

新增一个后端命令的完整链路：
`commands.rs` 写函数 → `lib.rs` 的 `generate_handler!` 注册 → `backend.ts` 包一层 → 组件调用。

## 3. 常用命令

```bat
npm install                :: 装依赖
npm run tauri dev          :: 开发模式（热更新前端，Rust 改动会重编译）
npm run tauri build        :: 出安装包 + 免安装 exe
npx tsc --noEmit           :: 只做类型检查，比构建快
```

产物：
- `src-tauri/target/release/asset-browser.exe`
- `src-tauri/target/release/bundle/nsis/AssetBrowser_x.y.z_x64-setup.exe`

## 4. 必须知道的约束（违反会出 bug）

### 4.1 前端产物是编译期嵌入 exe 的
改完 `src/` 只跑 `npm run build` 不够——**必须重新 `cargo build`/`tauri build`**，否则 exe 里还是旧界面。这个坑最容易浪费时间：界面没变化时先怀疑这条。

### 4.2 缓存 key 包含版本号
`cache::key_for(path, mtime, size)` 里混入了 `THUMB_SIZE` 和 `PIPELINE_VER`。
**改动缩略图输出逻辑（尺寸、质量、解码方式）时必须 `PIPELINE_VER += 1`**，否则老缓存不会失效，用户看到的是旧图。

### 4.3 淘汰不能每次写入都做全表 SUM
`evict_if_needed()` 用 `TOTAL_BYTES: AtomicI64` 做快速判断，只有超过 90% 才真的查库。
历史教训：早期每写一张都 `SELECT SUM(bytes)`，把预生成从 112 张/秒压到 11 张/秒。

### 4.4 缩略图队列：作废必须能被排空
`src/lib/thumb.ts` 的规则：

- `pruneThumbQueue(keep)` 按**当前渲染范围**剪枝，不在范围内的排队请求立即作废
- 被作废的等待者 `grant(false)` 返回，**不占并发额度**，否则队列会被废弃请求堵死
- 已拿到额度的（`started`）不参与剪枝
- 单元格被作废后 120ms 自动重试，否则滚停后 `zone` 不再变化就永远不重试

改动这里请先读 `Grid.tsx` 里 `useEffect(..., [visible])` 的调用点。

### 4.5 Windows 二进制格式：不要手搓测试文件
`resolve_shortcut` 解析 `.lnk`，真实结构是：

```
0x00 HeaderSize(0x4C)
0x04 LinkCLSID(16B)
0x14 LinkFlags        bit0=HasLinkTargetIDList  bit1=HasLinkInfo  bit7=IsUnicode
0x4C LinkTargetIDList [可选] 2 字节长度 + 数据 —— 有它时 LinkInfo 位置要往后挪
???? LinkInfo         字段偏移相对本块开头：
       +0x04 HeaderSize（>= 0x24 才有 Unicode 偏移）
       +0x08 Flags（bit0 = 有本地路径）
       +0x10 LocalBasePathOffset   +0x18 CommonPathSuffixOffset
       +0x1C LocalBasePathOffsetUnicode  +0x20 CommonPathSuffixOffsetUnicode
```

ANSI 路径是 **系统代码页（中文系统 GBK）**，必须用 `MultiByteToWideChar(CP_ACP)` 转，不能当 UTF-8。

### 4.6 打开资源管理器用 opener 插件
`cmd /C start` 和裸 `explorer /select` 从这个进程调用都不可靠（参数转义 / 无窗口标志干扰）。现在走 `tauri_plugin_opener`，定位到的是**父目录**而不是选中文件（Windows 上选中需要 `SHOpenFolderAndSelectItems`，尚未实现）。

### 4.7 Rust 源码是 CRLF
用脚本批量改 Rust 文件时，`str.index('\n')` 会失败；用 `re` + `\r?\n`，或者直接用 Edit 工具。

## 5. 怎么验证改动

### 5.1 类型检查
```bat
npx tsc --noEmit
```

### 5.2 用 Playwright 驱动真实窗口
exe 启动时带上远程调试端口：

```bat
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
asset-browser.exe "F:\some-folder"
```

然后连 CDP 的 **WebSocket** 地址（`http://127.0.0.1:9223/json/version` 里拿 `webSocketDebuggerUrl`，用 `chromium.connectOverCDP`）。

可以直接在页面里调后端命令：

```js
await window.__TAURI_INTERNALS__.invoke('cache_stats')
await window.__TAURI_INTERNALS__.invoke('list_recursive', { path: 'F:\\x', limit: 50000, showHidden: false, exts: [] })
```

**基准测试技巧**：`get_thumb(path, 399)`（size ≠ `THUMB_SIZE`）会**绕过缓存**，既不读也不写，适合量真实解码耗时而不污染用户缓存。测完别忘记这点——不要用 `cache_clear` 清用户缓存。

### 5.3 模拟滚动要发真实事件
`element.scrollTop = N` 只触发一次 scroll 事件，等价于按 End 键，测不出连续滚动的问题。用 `page.mouse.wheel(0, dy)` 才是真实输入管线。

## 6. 常见需求改法

**加一个设置项**：`Settings.tsx` 加 UI → 需要持久化就用 `localStorage`（如 `asset-browser.hiddenExts`）→ 若后端需要知道，加命令并在 `App.tsx` 的 effect 里同步。

**支持一种新图片格式**：`thumb.rs` 的 `render_image` 里加扩展名映射；`src/lib/types.ts` 的 `IMAGE_EXTS` 同步；记得 `PIPELINE_VER += 1`。

**改缩略图尺寸**：`cache::THUMB_SIZE` 和前端 `loadThumb(entry, 400)` 两处都要改，且 `PIPELINE_VER += 1`。

**加右键菜单项**：`App.tsx` 的 `menuItems` 数组，用 `useMemo`，依赖里补上用到的状态。

**改窗口行为**（托盘、最大化、标题）：`src-tauri/tauri.conf.json` + `lib.rs` 的 `setup`。

## 7. 代码风格

- TypeScript：函数组件 + hooks，不用 class；状态尽量放 `App.tsx`，组件保持无副作用
- Rust：命令函数保持薄，逻辑放模块；错误用 `Result<_, String>` 返回给前端显示
- CSS：单文件 `src/styles.css`，用 CSS 变量（`--fs` 控制字号缩放、`--text` 系列控制配色）
- 注释写「为什么」，不写「做了什么」
