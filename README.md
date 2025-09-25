# 黑白棋：极智对决

一个零依赖、即开即用的 Web 版黑白棋（Reversi/Othello）。支持人机/AI 对战、多强度、多线程、提示/坐标、悔棋/重开、实时棋谱、专注模式，并内置轻量又柔和的合成音效。

> 在线部署无需构建：直接把仓库内容推到 GitHub Pages 即可。

> 支持 PWA 安装：在 Chrome/Edge/Safari(桌面/移动) 访问时，可“安装应用/添加到主屏幕”，离线也能打开。

## 特性亮点
- AI 对战：多强度预设（快/平衡/强/特强）。
- 并行搜索：在支持 Web Workers 的环境下并行根搜；不可用时自动单线程回退。
- 即开即用：HTTP(S) 下使用 ES 模块源码（`src/`）；`file://` 下自动回退到打包版（`dist/app.js`）。
- 辅助信息：可选落子提示与坐标、最后落子高亮、比分条动画。
- 交互完善：悔棋、重开、专注对局（隐藏多余信息）、键盘快捷键。
- 柔和音效：基于 WebAudio 的无资源合成音，支持开关与音量调节。

## 快速开始（本地）
- 方式 A：直接双击 `index.html`
  - 走 `file://` 路径，页面会自动加载 `dist/app.js`（无需服务器，Web Workers 受限时会自动回退）。
- 方式 B：任意静态服务器（推荐现代浏览器）
  - Python: `python3 -m http.server 5173`
  - Node（示例）: `npx serve -l 5173`
  - 打开浏览器访问 `http://localhost:5173/`
  - 在 HTTP(S) 下会加载模块源码 `src/main.js` 与 `src/ai.worker.js`。

## GitHub Pages 部署
1) 新建公开仓库（或使用现有仓库），将本项目所有文件上传到仓库根（包括 `index.html`、`assets/`、`src/`、`dist/`）。

2) Settings → Pages：
- Build and deployment 选择 “Deploy from a branch”。
- Branch 选 `main`，Folder 选 `/ (root)`，保存。

3) 等待几分钟，访问地址形如：
- `https://<你的用户名>.github.io/<仓库名>/`

PWA 注意事项：
- Pages 默认支持 HTTPS，已包含 `assets/manifest.webmanifest` 与根目录 `sw.js`，页面会自动注册 Service Worker。
- 首次打开后刷新一次，确保资源 precache 完成；随后可断网打开页面验证离线是否可用。
 - 仅在安全上下文(HTTPS 或本机 `localhost`/`127.0.0.1`)下才可“安装为应用”；通过 `file://` 直接打开无法安装，仅能使用网页功能。
 - 桌面/安卓 Chrome/Edge 下会出现“安装应用”按钮（或浏览器菜单中的“安装应用”）。

可选：在仓库根添加空文件 `.nojekyll`，避免 Jekyll 干预（通常不需要）。

## 目录结构
```
.
├─ index.html           # 入口页（HTTP 下走 src，file 下走 dist）
├─ assets/styles.css    # 样式表
├─ src/                 # 模块源码（HTTP(S) 下直接加载）
│  ├─ main.js           # 启动与页面绑定
│  ├─ ui.js             # UI、动画、音效与交互
│  ├─ othello.js        # 棋规与棋盘逻辑
│  ├─ ai.parallel.js    # 并行 AI 调度（Web Workers）
│  ├─ ai.worker.js      # Worker 侧搜索
│  └─ ai.bitboard.js    # 单线程回退搜索
├─ assets/manifest.webmanifest  # PWA manifest
├─ assets/icons/               # PWA 图标（SVG）
└─ dist/app.js          # 打包版（file:// 时使用）
```

## 使用说明
- 模式：人类 vs 人类 / 人类(黑) vs AI(白) / AI(黑) vs 人类(白) / AI vs AI。
- 强度：快/平衡/强/特强（控制搜索时长与深度）。
- 线程：自动/2/4/8/全部（浏览器允许时并行搜索）。
- 显示：提示开关、坐标开关、最后落子高亮。
- 操作：悔棋、重新开始、专注对局（按钮或按键 F）。
- 快捷键：U 悔棋，R 重开，H 切换提示，C 切换坐标，F 专注对局。
- 音效：开关与音量滑块；音色为低噪、短尾、不过曝的合成音。

## 兼容性与性能
- 现代桌面浏览器（Chrome/Edge/Safari/Firefox）均可运行。
- `file://` 打开时：浏览器通常限制 Workers 与模块导入，页面会自动使用 `dist/app.js` 并在必要时回退到单线程搜索。
- GitHub Pages：可正常加载 ES 模块与 Workers；由于 `SharedArrayBuffer` 需要跨源隔离（COOP/COEP），默认不会启用共享 TT，但不影响使用。
- PWA：Service Worker 采用缓存优先策略，核心资源会预缓存；图标使用 SVG（带 maskable），跨平台显示效果更统一。

## 开发与定制
- 无需构建链：直接改 `src/` 下源码并在 HTTP(S) 下刷新即可。
- 如果希望只离线双击使用，请保持 `dist/app.js` 同步（当前仓库已包含可用版本）。
- 音效位于 `src/ui.js` 的 `class SoundFX`，可微调滤波、包络与混响参数。

---
如需我帮你准备一个最小的 GitHub Pages 发布 checklist 或添加 `.nojekyll` 与简短徽章区块，请告诉我。
