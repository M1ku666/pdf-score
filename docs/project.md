# 项目概述 · 技术栈 · 目录地图 · 常用命令 · PDF Score

---

## 1. 一句话与技术栈

纯前端的乐谱查看 / 练习工具 —— 一张乐谱 = 一个 PDF + 一段音频 + 一份 JSON 标记，全部存在浏览器 IndexedDB，没有后端，部署在 Netlify。

技术栈：Vite 8 + Vue 3（`<script setup>` + Composition API）+ vue-router 5 + pdfjs-dist 6 + fflate；无 UI 框架、无 CSS 框架、无测试框架（测试是手写 node 脚本）。

## 2. 目录与模块地图

```
src/
├── main.js          入口：兜底 Promise.withResolvers；DEV 下挂 window.__app = { player, library, idb, timeline }
├── router.js        只有两个路由：/（未打开文件）与 /score/:id，都用 PlayerView
├── App.vue          路由出口 + 全局提示栈（ToastStack：三类 toast，动作名在这里派发）
├── views/
│   └── PlayerView.vue      唯一页面：侧栏 + 抽屉宿主 + 单页 PDF + 底栏 + 细进度条
├── components/             见下表，逐个组件的约定写在各自文件头部
├── domain/                 纯逻辑，无 DOM 依赖，node 单测可直跑
│   ├── schema.js           数据模型：createMeta 规整 / 校验、uid、默认值、syncPages、metaStats
│   ├── timeline.js         核心算法：deriveStructure、resolveSegments、resolveJumps / expandJumps、buildTimeline
│   ├── marks.js            标记列表（treeview）的数据：buildMarkTree —— 行做父节点，挂小节线 / 段落 / 跳转
│   ├── markdown.js         操作说明那份 md 的极简解析：标题 / 目录 / 正文节点树（含「key」引用语言包，见 ui.md §18.70）
│   ├── rows.js             行不许重叠 / 不许太扁的判定 + 拖出来的区间夹进页面
│   ├── omr.js              谱面自动识别（找行、找小节线），只吃位图、不碰 DOM / pdf.js / i18n
│   ├── pdf.js              pdf.js 封装：PdfRenderer 渲染 canvas、pageSizes、makeThumbnail、注册 worker
│   ├── audio-engine.js     AudioEngine（播放 / 跳转 / 倍速 / 循环 + 试听专用的第二只 <audio>）、MediaClock、OutputClock、Metronome
│   ├── audio-peaks.js      峰值提取 computePeaks、encodeWav（示例乐谱用）
│   └── zip.js              包导入导出（fflate）、文件类型识别与拖放分类、音频 MIME
├── db/idb.js               IndexedDB 唯一入口：scores + files 两个 store
├── store/
│   ├── player.js           播放器状态唯一真源：加载 / 自动保存 / 撤销 / 四种标记操作（行 / 小节线 / 段落 / 跳转） / 新建行后自动识别小节线 / 音频控制 / 节拍器 / 自动翻页（撤销 = 删除那条通知挂一叠「删除记录」，一步一条、点一次退一项、记的是被删的那几项而不是整份快照，**没有全局撤销栈**）
│   ├── library.js          乐谱库状态：创建、导入、导出、删除、封面、标签、占用与容量统计
│   ├── ui.js               布局状态 + EDIT_TOOLS（图标是 `@lucide/vue` 的组件）+ readPalette
│   └── settings.js         偏好设置（localStorage 持久化）+ 各种尺寸上下限常量
├── i18n/                   文案唯一的家：zh-CN.yaml + index.js（t / setLocale / locale）
├── styles/main.css         全局 CSS 变量 + 通用控件类
└── dev/demo.js             仅 DEV：程序生成的示例乐谱（PDF + WAV + 标记）
```

| 组件 | 职责（细节见该文件头部注释） |
| --- | --- |
| `PlayerView.vue` | 唯一页面：侧栏容器、抽屉宿主与遮罩、文件导入分流（整页拖入 + 乐谱库那颗按钮选进来的文件）、未打开文件这一屏 |
| `PdfViewer.vue` | 整本 PDF 垂直滚动 + 按需渲染 + 跟随播放滚动 + 浮层扣高（`reserved` / `reservedTop`）+ 谱面缩放 1×–4× |
| `ScorePage.vue` | 单页 PDF + 标记层 + 命中判定 + 框选 / 手势 / hover |
| `JumpArcs.vue` | 跳转箭头层：跨页的那一层 overlay（每页一层 SVG 画不出跨页的线），页缝处断开；箭头是一串 `>`，选中跳转工具时可点 |
| `JumpSheet.vue` | 跳转记号的 Sheet：一条记号一张，正文是它所在那一组的「跳转顺序」列表（可拖动排序 / 移出组），footer 是起点终点、添加小组成员、删除 |
| `Minimap.vue` | 谱面总览（浮在谱面右侧的一列真实缩略图 + 蓝框 + 标记线 + 自己的胶囊） |
| `PlayerToolbar.vue` | 底栏一对胶囊 + 倍速 / 音频浮层（含音频起点选择器入口）+ 标记列表入口（同一个工具再点一次） |
| `MarksPanel.vue` | **标记列表**（treeview 抽屉）：再点一次已选中的标记工具时弹出；行做父节点（「第N页第M行」+ 小字摘要「N 小节 N 段落 N 跳转」），子项只有一行字（第N小节 / 段落名 / 跳转那一条的「#3 第 9 小节 → 第 1 小节」）；顶部一行是乐谱库多选那两颗纯文本按钮（全选 / 删除，没有「完成」）、勾选圈在行右端、没有 footer；点一项则谱面滚过去并闪一下。树的数据来自 `domain/marks.js` |
| `LibraryPanel.vue` | 乐谱库面板：搜索 + 菜单钮（排序 / 标签 / 多选）、卡片列表、排序方式与「全部标签」面板、信息面板、贴底导入按钮 |
| `LibrarySettings.vue` | 设置面板（七个偏好开关），入口在左上那条「乐谱库 / 收起 + 设置」胶囊里；footer 里是「查看操作说明」+「前往项目仓库」（外链，新标签页）+ 版本号 |
| `ManualSheet.vue` | 操作说明面板：`src/assets/manual.md` 解成文档 + 目录两屏（标题 = md 第一行的一级标题），入口在设置面板 footer |
| `MarkdownLine.vue` | 说明正文的一行行内内容（文字 / 粗体 / 斜体 / 代码 / 链接，链接前贴一颗外链图标） |
| `SegmentEditor.vue` | 段落编辑面板（外壳用 `EditorPanel`） |
| `AudioOffsetPicker.vue` | 音频起点选择器（固定 5 秒视野频谱 + 中心线；动作按钮「试听 / 返回音频设置」在音频面板的 footer，见 `ui.md` §13） |
| `GotoDialog.vue` | 跳转：输入小节与拍，或直接选段落 |
| `ProgressLine.vue` | 页面最底部的细进度条（纯展示，无交互） |
| `NumberPad.vue` | 纯数字输入：自绘九宫格悬浮键盘 |
| `AppSheet.vue` | 浮层唯一宿主（底部抽屉 / 居中确认弹窗 + 遮罩） |
| `ContextMenu.vue` | 锚在触发点上的短菜单与短单选 |
| `EditorPanel.vue` | 编辑面板外壳（开合、标题、footer）；目前只有段落编辑器在用 |

其它路径：

| 路径 | 职责 |
| --- | --- |
| `scripts/` | `copy-pdfjs-assets`（predev / prebuild 复制 pdf.js 资源）、`build-locales`（`npm run i18n`）、`unit-test`（`npm run test:unit`），以及 OMR / PDF 那批手工调试道具（`omr-node`、`probe-omr` / `omr-probe` / `omr-fixture`，见 `testing.md`） |
| `public/` | `_redirects`（SPA 回退）、`favicon.svg`；`public/pdfjs/` 由 `npm run assets` 生成，已 gitignore |
| `artifacts/` | 临时产物：脚本截图、日志等（已 gitignore） |
| `src/assets/manual.md` | 面向用户的**操作说明**正文（说明面板 `?raw` 打进包，见 `docs/ui.md` §18.70 与 `code.md` §2 的例外一条） |
| `docs/` | 本套文档（见 `AGENTS.md` 的导读表） |
| `docs/` 里的 `ui.md` / `UI-COMPONENTS.md` | 界面规范（唯一一份）/ 组件分层清单 |
| `netlify.toml` | 部署配置 |

## 3. 常用命令

```bash
npm install
npm run dev        # Vite dev server（--host，:5173）；predev 会先跑 assets 复制 pdf.js 资源
npm run build      # 产物 dist/；prebuild 同样先跑 assets
npm run preview    # vite preview --host（默认 :4173），预览 dist
npm run assets     # 仅复制 pdf.js 的 cmaps/standard_fonts/wasm/image_decoders 到 public/pdfjs
npm run i18n       # 把 src/i18n/*.yaml 编译成 locales.generated.js（predev/prebuild/pretest:unit 自动跑）
npm run test:unit  # 纯逻辑单测，不需要浏览器、不需要服务器
```

- **自动化测试默认不主动跑**（`test:unit` 算；**要跑先问用户**）。唯一例外：碰了 `src/domain/*` 就提醒一句「建议跑 `test:unit`」，跑不跑由用户定。详见 `testing.md` §1。
- **没有端到端测试**（别再引一套 headless 浏览器 + CDP 的端到端脚本回来）：UI / 交互改动交用户手工验证，见 `testing.md`。
- **端口被占用时不要另起一个**：Vite 会自动 +1（5173 → 5174、4173 → 4174），但上面这些命令与文档里的地址全是固定端口。先确认占用者是不是本项目自己的 dev/preview，是就**直接复用**，别并存两个 —— 详见 `deployment.md` §2.1。
- 手机真机访问（防火墙、持久化存储限制）见 `deployment.md`。
