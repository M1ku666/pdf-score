# 代码规范 · PDF Score

写代码时的风格、分层、i18n 与依赖约定。测试要求见 `testing.md`，数据与算法约定见 `concepts.md`。

---

## 1. 风格

- **注释用中文**，说清「为什么」；文件顶部保留一段块注释说明该模块职责。
- Vue 组件统一 `<script setup>` + Composition API，`<style scoped>`；**组件内部不写业务状态**。
- **状态集中在 `src/store/*.js`**（`player.js` / `library.js` / `ui.js`），组件只读状态、发事件或调用 store 导出的函数。
- **组件不直接访问 IndexedDB**：走 `src/store/*.js` 或 `src/db/idb.js`（全仓库只有 `store/player.js`、`store/library.js` 和 `views/PlayerView.vue` 的 `requestPersistence` 直接引 db 层）。
- 纯逻辑放 `src/domain/*`，保持无 DOM 依赖，这样 `scripts/unit-test.mjs` 能直接在 node 里跑（**唯一允许的例外见下面 i18n 那条**）。
- 变量与命名按现有风格：函数式导出、`export function`、事件 `onXxx`、常量 `UPPER_SNAKE`。
- **模板里不要给 `ref` 写 `.value`**：`<script setup>` 的顶层 ref 在模板里**自动解包**，`sort.value` 拿到的是 `undefined` —— 比较恒为假，选中态 / 勾永远不出现。`reactive` 对象的属性照旧要写全（`info.tags`、`menu.open`）。

## 2. 文案一律走 i18n

- 用户看得见的字符串（界面文字、按钮、`aria-label` / `title` / `placeholder` / `hint` / `suffix`、菜单选项、`toast()` 与任务型通知的文案、抛出去会显示给用户的 `Error.message`）**全部**写进 `src/i18n/zh-CN.yaml`，代码里只写 `t('区域.key')`；**不要**在组件里另留一份中文。改完文案跑一次 `npm run i18n`（dev / build / 单测都会自动跑）。
- 加新文案：先看 `common` / `unit` / `jump` 里有没有能复用的（「取消」「删除」「小节」这类），没有再往对应区域命名空间里加。
- 带变量的文案用 `{名字}` 占位 + `t(key, { 名字: 值 })`，**不要字符串拼接**（拼接的句子在别的语言里语序会错）。
- **选项 / 常量数组不要存显示文字**：存 key（`labelKey` / `hintKey` / `descKey`…），在模板或 computed 里才 `t(...)`。模块加载时求值 `t()` 的话，切语言不会刷新。`EDIT_TOOLS`（`store/ui.js`）就只存 key。
- 注意**别让局部变量遮蔽 `t`**（`const t = ...`、`v-for="t in ..."`）—— 这是改造时最容易埋的坑。
- `src/i18n/index.js` **是允许被 `src/domain/*` 引用的唯一带 Vue 的模块**（`locale` 是一个 ref，模板里调 `t()` 就能跟着切语言重渲染）；`npm run test:unit` 在 node 里能正常加载它。
- 不同语言的复数 / 语序等复杂规则目前**没有**做，语言包里就是一句中文；真要多语言时再按需扩展 `index.js`。

## 3. 状态与持久化的写法

- 标记删除类操作要**先 `noteRemoval()` 再改，最后 `markDirty()`**：那条「撤销」通知和 900ms 防抖自动保存都依赖它。
  **非删除的改动（新加 / 修改）不记录** —— 没有撤销入口，记了也没人能撤。
  `noteRemoval()` 记的是**马上要被删掉的那几项本身**（副本 + 原来挂在哪），
  **不是整份 meta 的快照** —— 撤销窗口开着时用户接着新建 / 修改的东西必须原样留着，
  换快照会把它们一起抹掉（那是数据丢失）。
  **`notify = false` 的批量删除也必须记** —— 它只是不弹通知，不是不记。
- 删除行 / 小节线要用 `cascadeRemoveBars` 级联清理挂在这些线上的段落，**级联拿掉的那些也要一起记**
  （`removeSystem` / `removeBar` 里是行 → 它的小节线 → 那些线上的段落，按这个顺序记；
  撤销时**正着插回去**，容器先回来、里面的东西才挂得上）。
  **跳转记号按小节编号存、不挂在线上**，所以它不在这份级联里（删一条记号时级联删的是**依赖它的那些记号**，见 `concepts.md` §2）。
- 数组渲染 / 排序假设：`systems` 按 `y0` 降序、`bars` 按 `x` 升序、`segments` 按小节号再按拍号升序（`comparePosition`）—— **任何插入路径都要保持有序**。
- 时间轴的派生数据都在 `src/store/player.js` 的 `computed` 里（`structure` / `timeline` / `currentPos`…），改 meta 后不要手动缓存时间轴。

## 4. i18n 工作流

- 界面文案只有一个家：`src/i18n/zh-CN.yaml`（一个语言一个文件）；代码里只写 key，运行时 `t(key, params)` / `setLocale()` / `locale` 在 `src/i18n/index.js`。
- 语言包是 YAML，但浏览器与 Node 都不认 `.yaml`，所以由 `npm run i18n` 编译成 `src/i18n/locales.generated.js`（已 gitignore，**别手改**）。`predev` / `prebuild` / `pretest:unit` 会自动跑；开发时改 `.yaml` 会自动重新生成并刷新页面。
- **语言包里不写注释**（`#` 一条都不留）—— 写法规则就记在下面这几条里：
  - 键的层级就是 `t()` 的点号路径（`library: search: placeholder` → `t('library.search.placeholder')`）；缩进用两个空格，不用 Tab。
  - 只放**用户看得见的字符串**（界面文字、按钮、`aria-label` / `placeholder`、`toast()` 文案、抛给用户看的 `Error.message`、下拉选项…）；代码注释、`console.warn`、`panel-key` / 排序 value / localStorage key 这类标识符都不进来。
  - 带变量的文案用 `{名字}` 占位 + `t(key, { 名字: 值 })`，不要字符串拼接。
  - 只有符号、没有语义的转义文本（如 `#{n}` 这种序号前缀）也是文案，照样放进来 —— 不同语言未必用同一套记号。
  - 值一律按纯文本写；只有真会被当成别的类型时才加引号（以 `{` 开头、纯数字、`1.` 这种、含 `:` 或 `#` 的）。
- **yaml 与代码两边不许漂移**：yaml 里有、代码里没人用的 key（死文案）要删掉；代码里引用了 yaml 里没有的 key，就得**补进 yaml 或者把引用它的那段代码删掉**，别留着。
- **要加一门语言**：复制一份 `zh-CN.yaml` 改名成语言 code（如 `en.yaml`），换掉开头的 `_name` 与里面的文案，跑 `npm run i18n` —— 语言列表会自动带上它，组件与 store 一行都不用改。
- 缺 key 不会静默变空白：开发模式会在控制台 warn 一条 `[i18n] 缺少文案：…`，编译时也会提示各语言之间差哪些 key。
- 代码这一侧怎么用 `t()`（不拼接、只存 key、别遮蔽 `t`、domain 层例外）见第 2 节。
- **动过 yaml 文案，回复末尾必须附「改前 / 改后」对照表**：这一轮只要在 `src/i18n/*.yaml` 里**新增、修改或删除**了文本（新增 key 也算），回复的最后就要用表格逐条列出**是哪条 key、改前是什么、改后是什么**；新增的「改前」写「（无）」，删除的「改后」写「（已删除）」。不能只在正文里写一句「改了某处文案」带过。

## 5. 工具与依赖

- **绝对不要用 PowerShell 改文本文件**（`Set-Content` / `Get-Content -Raw` / `-replace` 写回）：Windows PowerShell 5.1 默认按 ANSI(GBK) 读写，会把中文变成乱码、吃掉行尾字符与换行、把行尾变成 CRLF，甚至吞掉一个 `}` 让整个文件语法错乱。**一律用编辑 / 写入工具**。
  - 已经有文件被这样弄坏：按行补回丢失的字符，最后 `node --check` 验证。
- **读中文注释也别用 `Get-Content` / `Select-String` 直接看**（这台机器上是 PowerShell 5.1，默认按 ANSI 读，中文会显示成乱码、容易误判「文件已损坏」）；要看内容用**读取文件的工具**，或 `node -e` 按 UTF-8 读。
- **必须用 `npm run dev` / `npm run build`，不要直接 `vite build`**：pdf.js 的 cmap / 标准字体 / wasm 资源只在 `predev` / `prebuild`（即 `npm run assets`）里从 `node_modules` 复制到 `public/pdfjs/`，直接 build 会漏掉，PDF 兼容性下降。
- pdf.js worker **通过 `?url` 引入**：`import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`，再赋给 `GlobalWorkerOptions.workerSrc`。改这里会导致退化为主线程 fake worker。
- **Vite HMR 会给模块加 `?t=`**：在开发模式下 `import('/src/domain/timeline.js')` 会拿到**另一个模块实例**，与页面正在用的状态不是同一个。所以 DEV 下由 `main.js` 统一暴露 `window.__app = { player, library, idb, timeline }`，调试与自动化都从这里取（生产构建已剔除）。
- **图标一律用 `@lucide/vue` 的图标组件**（按需具名 import，规矩见 `ui.md` §16.1）：**不要再引第二个图标库、不要再往仓库里加本地 `.svg` 图标**，也不要 `import * as` 把整包拉进来。
- **提交只动显式清单里的路径**：`git add -- <路径>` + `git commit --only -m "<message>" -- <路径>`，不碰别人已暂存的内容；只说了 `commit` 时**提交前先给用户看预览与指纹**。命令与流程见 `git.md`。

## 6. 文档维护

**文档只记规则 —— 不记历史，不记单轮，不自己猜原因。**

- **只记规则**：文档描述的是**现在是什么样、必须怎么做**，不是它怎么变成这样的。
- **不记历史**：不写「原来是 X，现在是 Y」「以前/曾经怎样」「改动前/改动后」「上一轮/本轮」这类变更叙述。要看历史去翻 git。
- **不记单轮**：不写「用户这轮报了什么」「谁在什么时候用什么脚本复现过」「这一次量出来的读数是多少」这类只对某一轮有效的过程记录。**一次性脚本、临时探针的结论属于过程**：它证明出来的那条规则要留下，**它自己是谁、当时跑出什么数字，不要留下**。临时脚本（`artifacts/` 下那些）随时会被清掉，文档引用它们必然过期。
- **不自己猜原因**：**绝不要自己编写 / 推断 / 补全「为什么这么定」** —— 不写「理由是…」「原因是…」「之所以…是因为…」「这么定是为了…」，也不要替规则脑补设计理由。
  - 原因**只能来自用户手打的原文**。要留就必须**原样引用用户的话**（标明是用户原话），**不要转述、不要润色、不要扩写**。
  - **拿不到用户原话就不留原因。** 没有原因远好过编一个原因 —— 编出来的原因是**假信息**，比缺失更有害。
- **判据**：一句话删掉之后，**未来的 agent 会不会因此做错事**？会 → 它是规则，留下；不会 → 它是历史，删掉。
- 注意区分：**规则本身自带的、可直接观察的后果**（例：「两件混成一件就会漏出预闪」「改错就是算错位置」）是规则的一部分，照写；**对「当初为什么这么设计」的解释**才是原因，受上面那条约束。

- **组件级 / 模块级的约定写在对应文件的头部块注释里**（Vue 在 `<script setup>` 开头，JS 在文件顶部）—— `docs/` 不复制它们。改代码时**顺手把那段注释改对**：注释与代码不一致比没有注释更害人。
- **全局约定**（坐标、时间轴、存储、包格式、设计令牌、布局模型、命令）才写进 `docs/`。改了全局行为就同步改对应文档；改了不变量就**先改文档再改代码**（见 `AGENTS.md`）。
- 与文档冲突的请求：不要闷头照做、也不要拿文档当挡箭牌 —— 先指出冲突的是哪一条、说清代价，问用户确认。
