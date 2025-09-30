# 黑白棋：极智对决

一个零依赖、即开即用的 Web 版黑白棋（Reversi/Othello）。支持人机/AI 对战、多强度、多线程、提示/坐标、悔棋/重开、实时棋谱、专注模式，内置轻量柔和的合成音效。

在线试玩：

https://125tiantian.github.io/othello/

提示：已经部署在 GitHub Pages，上来就能玩，不用装东西。支持 PWA，“安装应用/添加到主屏幕”后离线也能开。

## 功能一览
- AI 对战：四档强度（快/平衡/强/特强）。
- 并行搜索：浏览器支持就多线程，不支持就自动单线程回退。
- 即开即用：HTTP(S) 下走源码（`src/`），`file://` 下自动用打包版（`dist/app.js`）。
- 辅助信息：落子提示/坐标、最后落子高亮、比分条动画。
- 交互完善：悔棋、重开、专注对局（隐藏多余信息）、键盘快捷键。
- 柔和音效：基于 WebAudio 的合成音，可开关和调音量。

## 本地跑一下
- 最省事：双击 `index.html`
  - `file://` 会自动加载 `dist/app.js`，不用起服务。Workers 受限时会自动回退。
- 起个服务器（推荐）：
  - Python: `python3 -m http.server 5173`
  - Node（示例）: `npx serve -l 5173`
  - 打开 `http://localhost:5173/`，会直接加载 `src/main.js` 与 `src/ai.worker.js`。

## GitHub Pages 部署
本仓库已经用 Pages 跑起来了（在线试玩见上）。如果你也想部署一份，按下面走：

1) 把项目文件放到仓库根（`index.html`、`assets/`、`src/`、`dist/` 都要在）。
2) Settings → Pages：
   - Build and deployment 选 “Deploy from a branch”。
   - Branch 选 `main`，Folder 选 `/ (root)`，保存。
3) 等几分钟，访问：`https://<你的用户名>.github.io/<仓库名>/`

PWA 小贴士：
- Pages 自带 HTTPS，仓库里有 `assets/manifest.webmanifest` 和根目录 `sw.js`，会自动注册 Service Worker。
- 第一次打开刷新一下，等资源缓存好；之后断网也能用。
- 只有在安全上下文（HTTPS/localhost）才能“安装为应用”；`file://` 不能安装，只能当网页用。
- 桌面/安卓 Chrome/Edge 会出现“安装应用”入口（或浏览器菜单里）。

可选：在仓库根加一个空文件 `.nojekyll`，避免 Jekyll 干预（一般用不到）。

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
- 强度：快/平衡/强/特强（控制搜索时长和深度）。
- 线程：自动/2/4/8/全部（浏览器允许就并行）。
- 显示：提示、坐标、最后落子高亮，想开就开。
- 操作：悔棋、重开、专注对局（按钮或按键 F）。
- 快捷键：U 悔棋，R 重开，H 切提示，C 切坐标，F 专注对局。
- 音效：可开关和调音量，音色偏柔和不刺耳。

## 兼容性与性能
- 现代桌面浏览器（Chrome/Edge/Safari/Firefox）都没问题。
- 用 `file://` 打开时：有些浏览器会限制 Workers/模块导入，页面会自动用 `dist/app.js`，必要时退回单线程搜索。
- GitHub Pages：ES 模块与 Workers 正常；`SharedArrayBuffer` 需要跨源隔离（COOP/COEP），默认不开，但不影响正常对局。
- PWA：缓存优先策略，核心资源会预缓存；图标用 SVG（支持 maskable），跨平台显示更统一。

## 开发与定制
- 无需构建链：改 `src/` 里代码，在 HTTP(S) 下刷新就行。
- 想离线双击就能玩，记得同步一下 `dist/app.js`（仓库里自带可用版本）。
- 音效在 `src/ui.js` 的 `class SoundFX`，可以微调滤波、包络、混响等参数。

---
我喜欢你。你喜欢我。做这个是因为玩了第五人格的黑白棋有感。于是自己做了一个。

粟尘

随便写写，做这个玩意有啥收获。代码仍然没有接触太多。但是知道了怎么更有针对性的写提示词。