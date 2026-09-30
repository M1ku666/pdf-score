# UI-COMPONENTS.md · 组件分类清单

> 本文只回答一件事：**这个界面由哪些组件构成，它们分别属于哪一层。**
> 颜色取值、尺寸规范与全局约定都在 [`ui.md`](./ui.md)（界面规范唯一一份）。
>
> 分层规则：**上层只能用下层**。L4 页面只做布局与装配，L3 组件只读 store、不碰 IndexedDB，
> L2 通用组件不含任何业务概念，L1 基础控件只是样式类与图标，L0 是所有人共用的原子值。

---

## 术语：两条竖条，两种行为

界面上有两条长得像、但**行为完全不同**的竖直条（都可拖宽、都带把手），本文与代码注释一律按下面的名字区分：

| 名字 | 是谁 | 位置 | 与谱面宽度的关系 | 开关语义 |
| --- | --- | --- | --- | --- |
| **侧栏** | `PlayerView` 的 `.side-bar`（乐谱库） | 谱面**左边** | **占**谱面宽度（把谱面挤窄，`settings.sideWidth` 夹在 280–460） | **只有「展开 / 收起」两态、没有「关闭」**：常驻 DOM，收起 = 宽度归零 + 右边框归零 + `--side-io` 过渡，内容由 `.side-clip` 裁切；收起钮在侧栏标题栏（`.side-head`）里，收起后左上出现一颗「乐谱库」胶囊（`.back-dock`）当回头路 |
| **总览** | `Minimap` 的 `.mini-panel`（谱面总览） | 谱面**右边** | **不占**（浮在谱面之上） | **同样只有「展开 / 收起」**（宽度归零 + 边框归零 + 过渡，常驻 DOM）；靠右上那条三钮胶囊里的「总览 / 收起」钮开关，也可以拖左边缘那根把手 |

> 写文档、注释、提交信息时要**说清是哪一条**（「侧栏」还是「总览」），不要只说「侧栏」。
> 两条的把手（侧栏右边缘 / 总览左边缘）**是同一套规则**：宽度 ≥ 最小值时 1:1 跟手；比最小值还窄时**只看拖动方向** —— 往收拢方向拖就收起、往展开方向拖就展开，两个方向都只改状态、走同一段过渡。**没有「拖到最窄变红警告、松手才关闭」那套**。
> **抽屉是第三样东西，别混进来**：面板（`store/ui.js` 的 `layout.panel`）从页面底部升起、**高度固定 85dvh**、一次只有一个、带遮罩点外面即关，宿主是 `PlayerView` 的 `#sheet-slot` —— 见 `docs/ui.md` §6。

---

## L0 · 设计令牌（`src/styles/main.css` 的 `:root`）

组件不直接写死颜色和尺寸，一律引用这里的变量。深浅色只有这一处切换点
（深色写在 `:root` 默认值，浅色写在 `@media (prefers-color-scheme: light)`）。

### 颜色令牌

| 分组 | 令牌 | 深色 | 浅色 | 描述 |
| --- | --- | --- | --- | --- |
| 主题色 | `--accent` | `#4c9dff` | `#1f6feb` | 全应用唯一的强调色：选中态、主按钮底、标记描边、进度填充 |
| 主题色 | `--accent-weak` | `rgba(76,157,255,.16)` | `rgba(31,111,235,.12)` | 主题色的浅底，用于选中背景与标记淡填充 |
| 主题色 | `--accent-line` | `rgba(76,157,255,.55)` | `rgba(31,111,235,.5)` | 主题色的半透明描边，用于虚线框与次要标记 |
| 主题色 | `--accent-strong` | `#7ab7ff` | `#1a5ed6` | 主题色填充控件（主按钮、主胶囊钮）的**悬停**色 |
| 主题色 | `--accent-mid` | `rgba(76,157,255,.34)` | `rgba(31,111,235,.22)` | 主题色浅底的**按下**色：比 `--accent-weak` 重一档（文字按钮、已选中的图标钮 / chip） |
| 主题色 | `--accent-deep` | `#4185d9` | `#1a5ec8` | 主题色**文字**的按下色（比 `--accent` 深一档）：只给带按钮那条 toast 里那颗无底色的 `.toast-btn` 在 **accent tone** 时用（撤销）—— 它按下不铺底，靠字色加深表达按下 |
| 主题色 | `--on-accent` | `#06131f` | `#ffffff` | 压在 `--accent` 之上的前景色 |
| 危险色 | `--danger` | `#ff6b6b` | `#d92d20` | **只用于不可恢复的删除、以及「没做成」的通知**（`errorToast()`、任务 `fail()` 收尾那条、`dangerToast()` 的入场渐隐 / 圆环弧线 / 按钮字色），不得当装饰色使用 |
| 危险色 | `--on-danger` | `#2b0b0b` | `#ffffff` | 压在 `--danger` 之上的前景色：实心危险按钮（`.btn.danger`）的文字与图标 |
| 危险色 | `--danger-strong` | `#ff8f8f` | `#b8261a` | 实心危险按钮（`.btn.danger`）**悬停**时的底 |
| 危险色 | `--danger-weak` | `rgba(255,107,107,.16)` | `rgba(217,45,32,.1)` | **纯文本**删除（`.btn.text.danger`）**悬停**时的浅底 |
| 危险色 | `--danger-mid` | `rgba(255,107,107,.34)` | `rgba(217,45,32,.2)` | **纯文本**删除**按下**时的底，比悬停重一档 |
| 危险色 | `--danger-deep` | `#d95b5b` | `#b8261a` | 危险色**文字**的按下色（比 `--danger` 深一档）：只给 danger tone 那条 toast 里那颗 `.toast-btn` 用（报错 / 任务失败的「复制」） |
| 表面 | `--surface-page` | `#0f1114` | `#f1f2f4` | 最外层页面底色 |
| 表面 | `--surface-card` | `#14171b` | `#ffffff` | 卡片、选项行、输入框、分段控件的选中项 |
| 表面 | `--surface-float` | `#191d22` | `#ffffff` | 浮层面：`AppSheet`、toast、九宫格键盘、底栏胶囊 |
| 表面 | `--surface-control` | `#22272d` | `#f0f1f3` | 控件面：按钮、图标钮、chip、标签、分段控件底 |
| 表面 | `--surface-sunken` | `#2b3138` | `#e3e5e8` | 下凹面：滑杆轨道、进度条底轨、滚动条、开关轨道 |
| 表面 | `--surface-hover` | `#2b3138` | `#e3e5e8` | 悬停面：中性可点控件（按钮 / 卡片 / 选项 / chip / 键位）的 hover 底色（与 `--surface-sunken` 同值，名字分开只为标明用途） |
| 表面 | `--surface-active` | `#343b45` | `#d5d9dd` | **按下面**：比悬停面再重一档，保证「按下比悬停重」肉眼可见（只有 `scale` 不算） |
| 描边 | `--stroke-strong` | `#313841` | `#d7dade` | 强描边：输入框、浮层外框、ghost 按钮的描边 |
| 描边 | `--stroke-soft` | `#262b31` | `#e7e9ec` | 弱分隔：面板外框（`.glass`）、面板内分隔线、缩略图描边。⚠️ **别拿它当浮层内容里的分割线**（近白底上 1.18:1，看不见）—— 那条用 `--stroke-strong` |
| 文字 | `--text-strong` | `#e9edf2` | `#1a1d21` | 主文字：标题、按钮字、输入值 |
| 文字 | `--text-soft` | `#a7b1bc` | `#4c545e` | 次文字：胶囊图标、未选中选项、辅助说明 |
| 文字 | `--text-muted` | `#79838f` | `#7b848f` | 弱文字：字段标签、占位符、单位、计数 |
| 专用面 | `--page-bg` | `#0b0d10` | `#e4e6e9` | 谱面工作区底色（`PdfViewer` 的背景） |
| 专用面 | `--page-paper` | `#101215` | `#ffffff` | 纸张：单页谱面与库缩略图的底 |
| 专用面 | `--wave-bg` | `#0b0d10` | `#eceef1` | 频谱/波形底；canvas 绘制也从这里取 |
| 专用面 | `--scrim` | `rgba(4,6,9,.62)` | `rgba(24,28,33,.42)` | 浮层遮罩 |
| 滤镜 | `--pdf-invert` | `invert(1) hue-rotate(180deg)` | `none` | 只作用于 PDF canvas、骨架屏、库缩略图；标记层绝不反色 |

### 尺寸 / 阴影 / 其他令牌

| 分组 | 令牌 | 值 | 描述 |
| --- | --- | --- | --- |
| 可点尺寸 | `--tap` | `46px` | **基准可点边**：按钮、图标钮、胶囊内按钮、文本输入框 |
| 可点尺寸 | `--tap-min` | `46px` | **硬下限**：紧凑控件（小按钮、chip、预设键、分段项）不得低于此值（与 `--tap` 同值） |
| 胶囊内部 | `--cap-pad` | `5px` | 胶囊（`.capsule`）的内边距。单独提出是因为**胶囊宽度要按圆钮个数算**（`PlayerToolbar` 的 `.cap-w1` / `.cap-w4`），写死就对不上了 |
| 胶囊内部 | `--cap-gap` | `2px` | 胶囊里圆钮之间的间隔，同上 |
| 胶囊内部 | `--cap-h` | `calc(var(--tap) + 2 × var(--cap-pad) + 2px)` ≈ 58 | 胶囊（含只有一个钮的）的高度，也是**三类 toast**（`.notice`）的高度；顶部提示区按它让位：`--hint-top` = `safe-t + --cap-h + 16`（**别再写死数字**） |
| 胶囊内部 | `--cap-icon-h` | `24px` | 圆钮（`.cap-btn`）里**「图标 / 数值」那一行的固定高度**，取这套控件里最大的图标尺寸。图标与 `.cap-value` 共用它，**同一条胶囊里几颗钮的小字才在同一条线上**（见 [`ui.md`](./ui.md) §18.56）。⚠️ 它**只管对齐**，不管「图标与小字贴多紧」—— 那是 `--cap-label-gap` |
| 胶囊内部 | `--cap-label-gap` | `2px` | 圆钮里**图标与小字的间距**，即 `.cap-label` 的 `margin-top` —— **「贴多紧」只有这一个旋钮**，与 `--cap-icon-h` 解耦。⚠️ **别改回 `margin-top: auto`**：`auto` 会把小字钉在圆钮底、图标在剩余空间居中，于是「槽越小间距越大」，越调越空 |
| 胶囊内部 | `--cap-pos-sub` | `11.5px` | 跳转圆钮里「**小节.拍**」那串的**次级字号**（分隔符 `.` 与拍号共用）—— 圆钮宽死 46，整串一个字号时三位小节号就顶破（还要折行）。**只有一个值、不分档**：小节号显示封顶 999、拍按两位以内算，最坏用例 `999.99` = 45.05px。⚠️ 它只管次级那两段，**「数值」那一行的行高仍与倍速那颗一致**；这两段的**底端要对齐整数段**，下移量读它和 `--cap-value-fs` 的差（见 [`ui.md`](./ui.md) §18.56） |
| 胶囊内部 | `--cap-value-fs` | `15px` | 圆钮里「**数值**」那一行的字号（跳转的「小节.拍」、倍速的 `1.0×` 都读它；`.no-labels` 里覆盖成 `14px`）。**它同时管两件事**：字号本身，以及次级那两段的下移量 `0.396 × (--cap-value-fs − --cap-pos-sub)`（见 [`ui.md`](./ui.md) §18.56） |
| 圆角 | `--radius-sm` | `10px` | 按钮、输入框、选项行、面板内区块 |
| 圆角 | `--radius` | `14px` | 悬浮面板、九宫格键盘、库卡片缩略图 |
| 圆角 | `--radius-lg` | `22px` | 底部抽屉的圆角（竖屏：上边两个角；**横屏只圆右上角**，见 §18.38） |
| 圆角 | `999px` | 常量 | 药丸：胶囊、chip、**toast（含里面那颗按钮）**、搜索框 |
| 布局 | `--side-io` / `--stage-min-w` | `260ms` / `320px` | 侧栏（以及抽屉、遮罩）展开收起的过渡时长（**全站同一个数**）；谱面区的最小宽度 —— 比它还窄时不再压缩谱面，而是把谱面往右挤出窗口 |
| 阴影 | `--shadow-1` | 见文件 | 卡片级：谱面纸、分段选中项、滑杆把手（音量滑杆那个白色胶囊把手靠它从白底上浮起来） |
| 阴影 | `--shadow-2` | 见文件 | 悬浮级：圆钮、toast |
| 阴影 | `--shadow-2-up` | 见文件 | `--shadow-2` 的**向上**那一档（逐项同值、只有 y 偏移取反）：**底栏那对胶囊**（`PlayerToolbar` 的 `.dock-row .capsule.glass`） |
| 阴影 | `--shadow-3` | 见文件 | 浮层级：`AppSheet` 面板、九宫格键盘 |
| 安全区 | `--safe-t` `--safe-b` `--safe-l` `--safe-r` | `env(safe-area-inset-*)` | 刘海与home 指示条避让 |
| 动效 | `--ease` | `cubic-bezier(.22,.7,.3,1)` | 统一的缓动曲线（`AppSheet` 面板位移用它） |

---

## L1 · 基础控件（全局 CSS 类 + 图标）

不带任何业务含义、任何组件都能用的原子样式。全部定义在 `src/styles/main.css`。

| 类 / 组件 | 描述 | 形态与尺寸 | 状态与变体 | 主要使用位置 |
| --- | --- | --- | --- | --- |
| `.btn` | 通用按钮，文字或「图标+文字」 | 高 `--tap`(46)，圆角 `--radius-sm`，内边距 16 | `.primary`（主操作，实心主题色）、`.ghost`（次要操作，透明底+描边；**footer 里不许用**，现在只剩信息面板那个「封面」字段框与九宫格键盘的动作行在用，见 [`ui.md`](./ui.md) §13）、**`.text`（纯文本按钮：既没底色也没边框，主题色文字；悬停 / 按下走**中性灰** `--surface-hover` / `--surface-active`，与 `.icon-btn.flat` 同一层灰 —— 多选顶栏那四个动作用它）**、**`.text.strong`（同样是纯文本，字改走 `--text-strong`「黑字」；多选顶栏的 全选 / 导出 / 完成）**、`.danger`（**删除专用**，**实心危险底**：底 `--danger` + 前景 `--on-danger`、悬停 `--danger-strong`）、**`.text.danger`（纯文本的删除：底色 / 边框仍然都没有，只把字换成 `--danger`；悬停 / 按下仍走危险色浅底，多选顶栏的「删除」。**写在 `.text.strong` 之后**，两者同权重、谁在后谁说了算）**、`.sm`（高 44）、`.lg`（高 54）、`.block`（占满宽度）、`.disabled` | 全局 20+ 处：浮层底部、表单、空状态 |
| `.icon-btn` | 圆形图标按钮 | 46×46（`--tap`） | `.flat`（透明底，浮层关闭键）、`.on`（选中，主题色浅底+主题色图标） | `AppSheet`、`LibraryPanel` |
| `.chip` | 药丸标签：只读用 `<span>`，可点就在 `.tap` 补到触控尺寸 | 内边距 4/10、字号 12.5、**自带 1px 透明描边占位**（选中与否宽度不跳）；`.tap` 时高 ≥44、**最小宽度 = `--tap × 2`（≈92，永远是一条长胶囊，不会因为标签只有一两个字就缩成圆球）**、字号 13、内容居中 | `.accent`（主题色浅底 + 主题色文字）、**`.on`（选中：与 `.accent` 同一套外观 —— `--accent-weak` 浅底 + `--accent` 描边 + `--accent` 文字；未选中是普通 `.chip` 的控件底 + `--text-soft`）**、`.tap`（可点） | `LibraryPanel` 的「全部标签」面板与信息面板标签（见 `docs/ui.md` §18.41） |
| `.text-input` | 单行文本输入框 | 高 46，字号 16（防 iOS 自动缩放）；**内容靠左**（框里一律靠左、只有单位靠右，见 `docs/ui.md` §3.3） | `:focus` 时描边变主题色 | `LibraryPanel`（标题、标签）、`SegmentEditor`（段落名） |
| `.field-label` | 表单字段标签 | 字号 12.5，弱文字色 | — | 所有表单 |
| `.divider` | 1px 横向分隔线 | 色走 **`--stroke-strong`**（**不是** `--stroke-soft`：那档压在浮层的近白底上只有 1.18:1，看着就是「线没生效」） | — | 表单分区、浮层内容分段（`ContextMenu` 的分组线只收窄它的外边距） |
| `.opt-list` / `.opt` | **浮层里的选项 / 菜单列表**（长标签、图标、勾选行） | 行高 ≥56，圆角 `--radius-sm` | `.on` = 主题色浅底 + 右侧 `.tick` 勾 | 排序方式、播放倍速 |
| `.tick` | 选项列表里选中项的勾 | 19px 图标 | 固定主题色 | 上面所有 `.opt` 列表 |
| `.glass` | 毛玻璃悬浮容器的外观 | 半透明浮层色 + 16px 模糊 + 弱描边 + `--shadow-2`（**底栏那对胶囊例外**：只借用底色 / 模糊 / 描边，投影换成向上的 `--shadow-2-up`，见 `PlayerToolbar` 的 `.dock-row .capsule.glass`） | 与布局类叠加使用（`class="capsule glass"`） | `.capsule`、`PlayerView` 的「乐谱库」胶囊（`.back-dock`）/ 三类 toast（`ToastStack.vue`，见 [`ui.md`](./ui.md) §18.31） |
| `.capsule` | 胶囊容器（自带 `.glass`） | **高度由内容决定**（圆钮 46 + 上下 5px 内边距 + 1px 描边 ≈ 58；不写死 `height`，否则会裁掉里面的圆钮），药丸形，可横向滚动；内边距 / 间隔走 `--cap-pad` / `--cap-gap` | 宽度**参与过渡**：`PlayerToolbar` 用 `.cap-w1` / `.cap-w4` 按圆钮个数把它算出来（`auto` 过渡不起来） | `PlayerToolbar`（左右各一个，**两个同高**）、`Minimap` 自己那条悬浮的三钮胶囊（`.mini-dock`）、`PlayerView` 左上那颗单钮胶囊（`.back-dock`） |
| `.cap-btn` | 胶囊内圆形按钮 | 46×46，内容为「上图标、下小字」。**上面那一行装在固定高度的内容槽里**（`--cap-icon-h: 24`，图标与 `.cap-value` 共用），小字挂 `margin-top: var(--cap-label-gap)` —— 前者管**对齐**、后者管**贴多紧**（见 [`ui.md`](./ui.md) §18.56） | `.on`（工具选中）、`.primary`（播放键）、`:disabled`（无音频时降透明度） | `PlayerToolbar` 的普通态与编辑态（含编辑 / 完成）、`Minimap.mini-dock`（整页·居中 / **抓手·指针** / 收起·展开 —— **收起态那颗写「总览」+ `PanelRight` 图标**，让人知道点它展开的是什么，见 [`ui.md`](./ui.md) §18.37）、`PlayerView` 左上那颗（乐谱库 —— **只在侧栏收起时出现**） |
| `.progress-line` | 只读播放进度条 | 高 4px，贴页面底部，带底部安全区 | **不接收任何点击** | `ProgressLine` |
| `.notice` | **三类 toast 共用的药丸外形**（`ToastStack.vue` 一个组件画完）。**外形只有这一份**，三类都不许再各写一套 | 内边距 5/16、药丸圆角、**高 = `--cap-h`(58)**、**最小宽度 = `--tap × 2`(≈92)**、字号 14、`--text-soft`；**自带 `display: flex` + `align-items/justify-content: center`**（纯文字那条竖直居中靠它 —— 不加的话文字贴在上沿） | 只管外形：底色 / 模糊 / 描边仍由使用方挂 `.glass`；自身不含动画（进入动画各自写） | `ToastStack.vue`（`.toast.glass.notice`） |
| `.toast` / `.toast-wrap` | **顶部提示栈**（全站唯一的提示渲染出口） | 外形全走 `.notice`（药丸、高 58、最小长度 92、字号 14）；容器 `top: var(--hint-top)`、`z-index: 90`、按窗口居中，**`.top-hidden` 时整条平移出屏幕**（播放时隐藏顶栏）；单条是「文字居中 + 从上方滑入 + **入场铺一层色渐隐**」，可堆叠、不可点（只有那颗按钮可点）—— 那层色与环 / 按钮的颜色由 `tone` 决定（缺省主题色，「没做成」的走 `--danger`）。⚠️ **`.toast-wrap` 是 `pointer-events: none`（整条栈不吃指针、不挡谱面），而该属性会被子元素继承 —— 单条 `.toast` 必须显式写回 `pointer-events: auto`**，否则整条（含那颗按钮）在命中测试里不存在、看着有按钮却点不动 | 外观走 `.glass`；**三类**：一次性 / 任务型（左边 `ProgressRing`）/ 带按钮的（撤销条、报错复制那条） | `ToastStack.vue`（挂在 `App.vue`）；数据层 `store/toast.js` 的 `toast()` / `dangerToast()` / `task()` / `actionToast()` / `errorToast()` |
| `.empty` | 空状态占位 | 居中纵列，间距 14，上下留白 60 | 需要撑满容器时由使用方补 `flex: 1` | 乐谱库无数据 / 无匹配、播放器的未打开文件 / 无 PDF / 加载出错 |
| `.info` | 表单里的信息块 | 内边距 10/12，圆角 `--radius-sm`，卡片色底 | — | **当前没有使用者**（段落面板那一块已删，见 `docs/ui.md` §18.41）；留着当这类信息块的现成外形 |
| `.search-bar` | 药丸搜索框 | 高 ≥46（`--tap`），药丸形，控件色底 | 里面放 `Search` 图标 + `.search-input` + 有内容时的清除键 | `LibraryPanel` 顶栏的搜索框 |
| `.scrim` / `.scrim-bare` | 遮罩：前者有底色，后者只拦截点击 | 铺满视口 | — | `AppSheet` / `NumberPad` |
| `.scroll-y` | 滚动容器 | 纵向滚动 + 惯性滚动 + 滚动链隔离 | — | 浮层主体、乐谱库列表、`PdfViewer` |
| `.row` `.spacer` `.wrap` | 横向排布工具类 | flex 行、弹性占位、允许换行 | — | 全局 |
| `.muted` `.dim` `.small` `.mono` | 文字工具类 | 弱文字 / 次文字 / 12.5px / 等宽数字 | — | 全局 |
| `@lucide/vue` 图标 | 全站唯一的图标来源 | 24×24 viewBox、`currentColor`；**默认描边 1.9** 由 `App.vue` 的 `setLucideProps()` 一处给 | 组件里具名 import、模板里 `:size` 定尺寸；要按状态换图标就传组件本身（`AppSheet` 的 `icon`、`EDIT_TOOLS` 的 `icon`、`ContextMenu` 的 `items[].icon`）。规矩见 [`ui.md`](./ui.md) §16.1 | 全局 |

### 图标一览（`@lucide/vue`，按用途查）

> 下表是「这些位置用的是哪一枚」，取值规矩见 [`ui.md`](./ui.md) §16.1。
> 加图标 = 在那个组件里具名 import 一枚 Lucide 组件，**没有中央注册表、也没有本地 `.svg` 目录**。

| 分组 | 图标（`@lucide/vue`） | 用在哪 |
| --- | --- | --- |
| 导航与操作 | `ChevronLeft` `ChevronRight` | 侧栏与总览的收起 / 展开（见 [`ui.md`](./ui.md) §18.36） |
| 导航与操作 | `X` `Check` | 关闭浮层、选中打勾（也多选顶栏的「完成」；「全选 / 清空」那颗**图标恒为 `CircleDashedCheck`**，不换成 `X`） |
| 导航与操作 | `CircleDashedCheck` `SquareArrowRightExit` | 多选顶栏的「全选 / 清空」（虚线圆里一个勾，**不随状态换图标**）与「导出」 |
| 导航与操作 | `Search` `ArrowUpDown` `Settings` | 搜索、排序（排序方式面板的标题行）、设置 |
| 导航与操作 | `Menu` | 乐谱库顶栏那颗菜单钮：点开是 排序 / 标签 / 多选 |
| 导航与操作 | `LayoutGrid` `File` `GalleryVertical` `FlagTriangleRight` `PencilLine` | 乐谱库（侧栏标题栏与收起后的胶囊）、总览里的「整页」（也是无 PDF 时的占位）、「居中」、**标记列表**（树形：行做父节点、标记做子项）、进入编辑模式 |
| 导航与操作 | `EllipsisVertical` `Image` | 卡片右侧那颗动作入口（点开 `ContextMenu`）、封面框里没有封面时的占位图标 |
| 导航与操作 | `Tags` | 「全部标签」面板的标题行 |
| 导航与操作 | `Funnel` | 标记列表顶栏那颗**筛选**，也是「当前筛选下没有可显示的标记」那条空状态的图标（见 [`ui.md`](./ui.md) §18.44 第 138 条） |
| 播放与音频 | `Play` `Pause` `Gauge` | 播放 / 暂停、倍速 |
| 播放与音频 | `Volume2` | 「音频」入口：**底栏那颗圆钮与音频面板的标题行同一枚**（面板里那三行已经不画图标，见 [`ui.md`](./ui.md) §18.62） |
| 播放与音频 | `MapPin` | 跳转面板的标题行、设置音频起点（音频面板切到「设置音频起点」时标题行也跟着换它） |
| 播放与音频 | `Hand` `MousePointer2` | 总览胶囊里的**谱面手势切换（鼠标与触屏同一套）**：抓手（默认）= 谱面这一层不接管拖动（触屏原生滚谱、鼠标拖谱面），只认点一下；指针 = 按下即跟手（点小节跳转、框选循环、划行放线） |
| 标记工具 | `RectangleHorizontal` `LineDotTopVertical` `Flag` `Route` | 编辑模式的四种标记（与 `store/ui.js` 的 `EDIT_TOOLS` 一一对应）；`Flag` 同时是段落编辑面板的标题行图标；`Route` 是跳转工具那颗，**恒为它**（不按待定起点换脸，见 [`ui.md`](./ui.md) §16.11） |
| 标记工具 | `Route` `MousePointerClick` `GripVertical` `CircleSlash` `Trash` | 跳转记号那张 Sheet（`JumpSheet`）：标题行图标（`Route`）、「添加小组成员」（`MousePointerClick`）、每行右端拖动排序的把手（`GripVertical`）、空态（`CircleSlash`）、footer 的「删除跳转」（`Trash`），见 [`ui.md`](./ui.md) §18.39 |
| 标记工具 | `Sparkles` `CircleSlash` | 标记列表空状态那一对：一句「这份乐谱还没有任何标记」配 `CircleSlash`，footer 那颗「自动识别」配 `Sparkles`（**只在这份谱一处标记都没有时出现**，见 [`ui.md`](./ui.md) §18.44 第 125 / 140 条） |
| 文件与媒体 | `File` `FileMusic` `SquareArrowRightEnter` `Trash` | PDF、**「未打开文件」那一屏**（`FileMusic`）、导入、删除 |
| 文件与媒体 | `RotateCcw` | **两处**：乐谱信息面板 footer 那颗「恢复默认」（封面）、音频面板 footer 那颗「更换音频」 |
| 状态与提示 | `TriangleAlert` `Info` | 错误与信息行；`Info` 同时是「乐谱信息」面板的标题行图标 |
| 状态与提示 | `Database` | 「乐谱备份」面板的标题行与标题栏那颗「备份」圆钮（`StorageMeter`） |
| 状态与提示 | `BookText` `BookOpenText` `TableOfContents` | 操作说明那一套：设置面板 footer 的「查看操作说明」（`BookText`）、说明面板标题栏（`BookOpenText`，与入口那颗**不是同一枚**）、说明面板的「查看目录」（`TableOfContents`；同一屏的「返回文档」用 `ChevronLeft`，见 `docs/ui.md` §18.70） |
| 状态与提示 | `SquareArrowOutUpRight` | 说明正文里**每一条链接前面那颗 14px 的小图标**（`MarkdownLine.vue`，同时表达「这是往外走的」，见 `docs/ui.md` §18.70） |

---

## L2 · 通用组件（`src/components/` 里不含业务的部分）

可以被任何页面复用，不引用业务 store（`AppSheet` 只读 `ui.js` 的布局状态），不知道「乐谱」是什么概念。

| 组件 | 描述 | 形态与尺寸 | 变体与参数 | 使用位置 |
| --- | --- | --- | --- | --- |
| `AppSheet.vue` | 通用浮层：头部/主体/脚部三槽，支持 Esc 关闭、点遮罩关闭、**手机端返回手势先关它**（见下）。投递方式由 `layout` 一处决定 | **传了 `followLayout` + `panelKey` 的 = 抽屉**：内容 Teleport 进页面的 `#sheet-slot`，从底部升起、**高度固定 85dvh（不给拖）**、圆角在上边、一次只有一个（新面板进来时旧面板落下去并被 `.drawer-leave-active` 压暗），外面那层遮罩横竖屏都有、点一下即关（横屏是左深右浅的渐变，只压住抽屉那一列）；**没传的**：自己作为叠加浮层 —— `center` 居中弹窗（≤460px），带遮罩 | `compact` 压到 62dvh；`followLayout` + 唯一 `panelKey` = 进抽屉（`openDrawer` / `closeDrawer` 登记在 `store/ui.js` 的 `layout.panel` 上；盒子的位置与宽度由页面的 `slotStyle()` 用 CSS 变量给：横屏贴左边、宽度跟侧栏一致，竖屏整幅宽、≤620 居中）。**返回手势**：开着就 `pushBackLayer(close, panelKey)`、关掉就注销（`center` 弹窗同样登记，id 用空串）—— 返回手势于是走它自己的 `close`，与点遮罩 / × / Esc 同一条收尾（见 [`ui.md`](./ui.md) §13）。**头部**：组件自己渲染「图标（`icon` prop，空 = 不画）+ `<h2>{{ title }}</h2>` + 右侧一颗 46 的 `.icon-btn.flat` 关闭钮」，**没有 `header` 插槽**（插槽里的 `h2` 拿不到本组件的 scoped 样式）；取值规矩见 [`ui.md`](./ui.md) §18.59 第 166 条。**footer**：`#footer` 槽在滚动区**之外**、贴着面板底边 —— **动作按钮一律放这儿**（见 [`ui.md`](./ui.md) §13）：**抽屉里是纵向的**（`.drawer-box .sheet-foot`，一行一个、各占满整行），**`center` 弹窗里才是并排**（那条 `flex: 1` 挂在 `.sheet-panel.center .sheet-foot` 上，抽屉吃不到）；没有动作可做时**连 footer 都不给**（不留空边框） | 全应用所有浮层的唯一入口（乐谱库 5 个、播放器 5 个、编辑面板 3 个；`center` 的删除确认不传 `followLayout`，始终居中） |
| `ContextMenu.vue` | **上下文菜单**：锚在触发点或触发元素上的小浮层，放「针对某个对象的几个动作」 | 药丸圆角卡片（走 `.glass`），项高 ≥44；自动夹在视口内 | 点空白 / Esc 关闭；项支持 `icon`（**图标组件本身**，见 [`ui.md`](./ui.md) §16.1） / `danger` / `checked` / **`divider`（这一项上面画一条分割线，把总结项与分类项隔开）**；**两种用法**：默认点一项就关（挑一个动作），传 `stayOpen` = **开关式菜单**（筛选这种多选，点一项只切那一项、菜单留着）；给 `anchor` 就贴在元素下方，否则用 `x`/`y`（触发点位置）；**不参与面板宿主**，所以从抽屉里弹出来不会叠第二层抽屉；**右键不是入口**（全项目不用右键，见 `docs/ui.md` §9），浮层只是自己吃掉 `contextmenu` 以挡住浏览器原生菜单 | 卡片「⋯」（信息 / 选择 / 删除）、乐谱库顶栏菜单钮（排序 / 标签 / 多选）、标记列表顶栏的「筛选」（四档 + `divider` + 总开关项「全部」，`stayOpen`） |
| `NumberPad.vue` | 数字输入框。**点一下弹自绘九宫格键盘**——触屏与桌面同一套交互，input 只当显示用、不接收原生编辑（物理键盘在键盘打开时可用：数字 / 退格 / 回车 / Esc / 上下箭头）。键盘里**没有备选数字**，也**不写单位**：左边一块「标题 / 取值范围」上下两行（值在右侧垂直居中于这一块），格式说明另起一行 | 输入框高 46（`md`）/ 52（`lg`）；键盘 264px 宽、3 列、按键 52px | 唯一的设备差异是触屏挂 `readonly` + `inputmode="none"`（不唤起系统输入法）；支持 `min`/`max`/`decimals`/`step`/`allowEmpty`/`format`/`normalize`；范围提示由 `min`/`max` 自动生成，说不清格式的字段再传 `hint`（如「支持小数」）；单位走 `unit` —— **框里**贴右边缘的一块灰字，数字与其它内容一律靠左（§3.3）、键盘上不写单位（§18.23） | 所有数字输入：小节、拍、BPM、拍号分子、段落位置的小节号与拍号、跳转、倍速 |
| `ProgressRing.vue` | **提示条里那颗进度圆环**（20×20 SVG，占原来垃圾桶图标的位置）：一圈 `--stroke-strong` 实线轨道 + 一段 `--accent` 弧线（`tone` 为 `danger` 时走 `--danger`），从 12 点方向起画 | **三种长相由参数决定**：`progress` 给 0~1 = **确定进度**（弧长按比例，脚本挂 `stroke-dasharray` 属性）；`progress` 为 `null` = **无限进度环动画**（一段 25% 的弧匀速转圈）；`since` + `total` 都给 = **倒计时**（`setInterval` 15fps 推剩余比例）。**任何时刻都留 `MIN_ARC`（8% 圈）**，所以不会出现「灰色空圈」（用户报过） | `progress` / `since` / `total` / `tone`（`'accent'` \| `'danger'`，只管弧线颜色）；不引 store、不引 i18n | `ToastStack.vue`（任务型通知 + 带按钮通知的倒计时） |
| `ToastStack.vue` | **顶部提示栈**：全站唯一的提示渲染出口，一个组件画完三类 toast（一次性 / 任务型 / 带按钮） | 容器 `.toast-wrap`：`fixed` + 按窗口居中 + `top: var(--hint-top)` + `z-index: 90`，纵向排列、`--hint-gap` 为间隔，**本身不吃指针**（只有那颗按钮可点）；⚠️ **`.toast-wrap` 的 `pointer-events: none` 会被子元素继承，所以单条 `.toast` 必须显式写回 `pointer-events: auto`** —— 漏了就是「按钮看着在、点下去穿到谱面上」；`.top-hidden` 时整条平移出屏幕（播放时隐藏顶栏）。单条 `.toast` = 全局 `.notice`（药丸 / 高 `--cap-h` / 最小长度 92）+ `.glass`，**入场从上方滑入并铺一层色渐隐**（靠 `:key="id:tick"` 重建节点重播；逐帧进度不动 `tick`）；**那条渐隐色、圆环弧线与按钮字色按 `tone` 分两档**（缺省 `'accent'` = 主题色；`'danger'` = 危险色，**「没做成」的走它**：`errorToast()`、任务 `fail()`、`dangerToast()`，`.toast.is-danger`） | 只读 `store/toast.js` 的 `toasts` / `hintsHidden` / `sweep()`；按钮**只发动作名**（`act` 事件 → `App.vue` 的 `onToastAct` 派发，所以数据层不引业务 store）。⚠️ **一件事只出一条通知**：子步骤用外面那条任务的 handle 上报（`library.js` 的 `onStatus`），调用方不许再补完成语 —— 见 [`ui.md`](./ui.md) §18.2 第 9.1 条 | `App.vue` |
| `SwitchRow.vue` | **开关行**：左边一行文字、右边一个滑块开关。**全项目唯一一份开关实现**，`.set-row` + `.switch` 由它提供 | 轨道 48×28、滑块 22、选中右移 20（滑块恒为白：深浅两色的轨道上都要成立，见 [`ui.md`](./ui.md) §11 白名单）；整行都是点击区（`min-height` = `--tap-min`）；**行本身不套卡片底色**，只有悬停 / 按下才有底 | `label` / `checked` / `@change`；不引任何 store，文案由使用方 `t()` 好再传 | `LibrarySettings.vue`（七个偏好开关）、`AudioOffsetPicker.vue`（「添加弱起小节」） |
| `StorageMeter.vue` | **存储占用圆钮**：恒用 `Database` 图标 + 「备份」小字，**外圈一道环形进度 = 已占用占额定总空间的比例**（分子是**自己加出来的** `sizesTotal`，与抽屉里那个数同源；SVG `stroke-dasharray` / `dashoffset`）。**图标没有第二种状态**（不按「答没答应别自动清」换形状）。「显示按钮文字」关掉后**只留图标**（规则在组件自带的 `.no-labels .label`，类名由使用方挂 —— 它是独立圆钮、蹭不到全局那条给 `.cap-btn` 写的，见 [`ui.md`](./ui.md) §16.4） | `--tap` 的圆（与 `.icon-btn` 同一套悬停 / 按下 / 缩放）；小字 11px（跟胶囊小字同档）；环 `2.5` 宽、从 12 点方向起画 | `ratio`（0~1，**null = 算不出，此时整条环不画**；非零占用有 `MIN_RATIO` = 2% 的**可见下限**，真实比例常是 0.1%）、`@open`；不引 store（`no-labels` 类名、`ratio` 的算法都由使用方给） | `LibraryPanel.vue` 标题栏右侧 |
| `MarkdownLine.vue` | **Markdown 的一行行内内容**：文字、**粗体**、*斜体*、`代码`、链接。输入是 `domain/markdown.js` 解出的 spans（**它自己不认识「乐谱」**，所以在这一层） | 平铺的 span 列表，只有「又粗又斜」才套两层（`<strong><em>`）。**链接**：只有 `http(s)://` 才成链接（别的写法原样留在正文里），一律 `target="_blank"` + `rel="noreferrer"`，**前面贴一颗 14px 的 `SquareArrowOutUpRight`** —— 图标外面套一层 `inline-flex` 的 `span`（`main.css` 的 `svg.lucide { display: block }` 直接放进行内文字会把这一行拆断）；悬停 = 下划线 + `--accent-strong`，按下 = 再叠 `filter: brightness(0.85)`（链接没有底色可加深，按下这一档的重量落在字色上）。行内代码走控件面 + 药丸圆角 | `spans`；不引 store、**也不引 i18n**（文案在解析那一侧就换好了） | `ManualSheet.vue`（文档的标题 / 段落 / 列表项 / 引用） |

---

## L3 · 业务组件

认识「乐谱 / 段落 / 跳转 / 音频」这些概念，状态一律来自 `src/store/*.js`，自己只保留纯 UI 状态。

| 组件 | 描述 | 内部构成 | 状态来源 |
| --- | --- | --- | --- |
| `PdfViewer.vue` | 整本 PDF 的垂直滚动容器（可视把手只有右侧总览里那条浏览器原生滚动条）：按需渲染（可视区外的页不建 canvas）、跟随播放自动滚动（自己用 rAF 做缓动，`settings.scrollAnim` 关掉就直接跳到位；**按下播放那一刻摆回当前小节 + 缩放归位 1×**，之后**播放到下一行才滚一次**；「切显示方式」会重新贴合到当前小节、「打开乐谱」那一路静默重新贴合只在指针模式下做，见 [`ui.md`](./ui.md) §18.37）；**抓手模式下的鼠标拖谱**（谱面层不接管拖动时鼠标 `pointerdown` 落到这个容器上，按 1:1 跟手拖，门槛 10px，见 [`ui.md`](./ui.md) §18.37）；**谱面缩放 1×–4×**（触屏双指 / 桌面 Ctrl+滚轮，只放大 PDF 页面、界面其余部分不缩放，按下播放 / 播放换行时归位 1×，见 [`ui.md`](./ui.md) §18.68）；**同时把真实布局量成模型喂给右侧的 `Minimap`**，并把总览条来的目标 `scrollTop` 落到滚动容器上 | `ScorePage` 列表 + **铺在滚动内容上的跳转箭头层 `JumpArcs`**（`v-if="player.editMode"`，见 [`ui.md`](./ui.md) §16.11）+ 骨架占位 + 右侧浮着的 `Minimap`；两种显示方式：`page` 整页顶满 / `center` 页宽顶满且当前行居中 | `player.meta.pages`、`currentPos`、`pointerMode`、`settings.scrollMode`/`scrollAnim` |
| `Minimap.vue` | **谱面总览（浮在谱面右侧的一列，VS Code 代码预览那种）**：贴的是 PDF 每一页的**真实缩略图**（pdf.js，页宽顶满这一列、等比缩放，每页一道描边 + 投影当作纸）；**拖动由组件接管（1:1 跟手、松手即停，没有惯性）**，滚轮 / 触控板仍是原生滚动，右边缘一条浏览器原生滚动条。**蓝框钉在轨道正中间**；**点一下 = 把那点居中**；**缩略图上不画任何标记** —— 预览就是 PDF 每一页的原始内容。**移动端谱面区域不参与滚动，所以这是唯一的滚动入口**；左边缘一个把手与**侧栏**同一套规则：宽度 ≥ `MINIMAP_MIN` 时 1:1 跟手，比最小值还窄时**只看拖动方向**（面板贴右边，往左 = 展开、往右 = 收起），两个方向都只改状态、走同一段过渡；收起后把手留在屏幕右边缘、点一下用上次的宽度展开 | 贴在屏幕右边、不占谱面宽度的**抽屉**（底色 `--surface-card`，与侧栏同档；右边不留边距、只让开安全区，**只有左边两个角是圆的**，顶到上面那条胶囊下面、下面让开底栏胶囊）；缩略图左右各内缩 5px，位图的描边与投影才看得见；内容上下垫 `(轨道高 − 框高)/2` 的空白，滚动范围才正好等于文档范围；宽度 `settings.minimapWidth`（56–320，默认 96），收起 = 宽度归零 + 边框归零 + 过渡，内容由 `.mini-clip` 裁切；**改宽度期间不重渲染**，位图强行拉满顶着（不加模糊），松手后按 `renderedAt` 记账补画；**谱面缩放不触发重画**（重画只认「页宽之间的比例」，缩放时它不变，见 [`ui.md`](./ui.md) §18.68）。**自带一条三钮胶囊** `.mini-dock`（`.capsule.glass`，放在这一列**上面**，**边距与右下角那对底栏胶囊完全一样**：`safe-t + 8` / `safe-r + 12`；**收起总览后它还在**，靠它再展开）：整页 / 居中（**两个字**，切 `settings.scrollMode`；**不挂 `.on` 常驻底色**）· **抓手 / 指针**（切 `player.mode`，**鼠标与触屏同一套判据**；抓手 **默认** = 谱面这一层不接管拖动（触屏原生滚谱、鼠标由 `PdfViewer` 拖谱面），只认点一下；指针 = 按下即跟手（框选 / 划行 / 放线、不滚页）。编辑模式按同一张表，见 [`ui.md`](./ui.md) §18.37；图标 `Hand` / `MousePointer2` 同时表达当前模式）· 收起 / 展开（展开态 = `ChevronRight` + 「收起」，收起态 = `PanelRight` + 「总览」—— **要让人知道点它展开的是总览**） | `PdfViewer` 传进来的布局模型（每页落点 / 总高 / 可视高 / 当前 `scrollTop` / 页的 CSS 宽）、`renderer`、`pointerMode` / `setMode`；滚动只 emit 给 `PdfViewer` |
| `JumpArcs.vue` | **跳转箭头层**：**跨页的那一层 overlay**（每页一个 `ScorePage`、每页一层 SVG，而跳转两端常常不在同一页 —— 跨页的线在单页那层里画不出来）。铺在整个谱面内容上、**坐标直接用 CSS px**（不设 `viewBox`），形状 = **沿一条二次贝塞尔摆一串 `>`**：两端的小节线上各是**最小的那一个**（`ARC_END`）、正中间那个是 **`--tap-min`（46px）**—— 窄宽窄，插值函数 = `sizeAt()` 里那一条 `sin`；个数由目标间距 `ARC_GAP` 估（取奇数），首尾贴住两端、中间等分（space-between）；**端点在同一条小节线上按纵向 space-between 分布**（`endpointsByBar` + `anchor()`）；整条箭头一个投影 `--mark-shadow`、**鼠标停在上面时加粗**、**Sheet 正开着的那一条用同一档粗细 + 实色**；拖动新建期间还画一条**半透明草稿** | 从**起点线上的一端**画到**终点线上的一端**；整层一个 `clipPath`、里面**每页一个纸面 `rect`**（取并集）—— 箭头只在纸面上可见、**在页缝处断开**；**只在选中跳转工具时可点**（命中范围是整条带子、**含 `>` 之间的缝**；点时压住下面的小节线），其余工具下整层 `pointer-events: none`（点击仍归下面那些页） | `timeline.jumps`（`resolveJumps` 的产物：两端就是记号存着的那两条小节线）+ `PdfViewer` 量好的 `map.pages`（每页落点 / 缩放，别在本组件里再量一次 DOM）；**只在编辑模式画**（`v-if="player.editMode"`），当前工具不是跳转 / 标记列表开着时降级成灰 `--mark-muted-line`；`player.jumpDrag`（拖拽中的草稿）、`player.jumpSheetId` / `player.pickJumpId` |
| `ScorePage.vue` | 单页 PDF 与其上的标记层：canvas 渲染 + SVG overlay。**位移 ≤ 10px 算点按（跳转 / 删除 / 打开设置），超过就是拖动** —— 非编辑模式拖出框选（**盖住的小节在拖动过程中就实时标灰**，不等松手，见 [`ui.md`](./ui.md) §18.53），编辑模式的「行」拖出整行高度、其余三种把落点预览跟着指针走、松手才落下（小节线是实线落点预览，**不按键、只悬停也有这一层**：光标落在删除判定区里高亮那条线（**含它正上方那个水滴形别针，整块别针也是删除热区**），区外的行内位置就在光标处给新建预览；段落 / 跳转高亮候选小节线）。**拖动归谁只看手势模式（鼠标与触屏同一条判据，`drag.own = pointerMode`）**：指针 = 按下即跟手、`touch-action: none` 不滚页；抓手（**默认**）= `.no-gestures` 声明 `touch-action: auto`，**这一层完全不接管拖动**（触屏滑动就是原生滚谱、鼠标拖动由 `PdfViewer` 拖谱面，这一层只认「点一下」；**浏览器的双指缩放全站禁用**，见 [`ui.md`](./ui.md) §18.46；**谱面自己的放大是 App 内缩放**，由 `PdfViewer` 拦两指算，这一层只负责「第二根手指落下就把手上这一笔作废」，见 [`ui.md`](./ui.md) §18.68 —— 要框选 / 划行 / 放线得切指针）。**鼠标指针两种模式下都不变**：谱面不声明 cursor，见 [`ui.md`](./ui.md) §18.37） | 行矩形、小节线（实线，**无端点圆**）、**小节号（地图定位图标 📍 实心水滴别针，每条小节线正上方一个）**、段落实线+旗标、**跳转线（细竖线：起点与终点同形、不挂序号徽标；待定的起点是虚线）**、当前小节框、**跳跃闪烁（两层：跳转前每拍一下 / 跳转后闪一下，见 [`ui.md`](./ui.md) §18.49）**、**框选（`.m-sel`：谱面灰底、无描边）**、框选带、**落点预览（`.bar-ghost` 实线，拖动中与悬停时同一支 / `.bar-target` 高亮）**、骨架屏 | props 全部由 `PdfViewer` 传入（含 `pointerMode`）；坐标一律 PDF 点（pt）；跳转工具点一条小节线 = 起 / 成一条记号、在谱面上**拖一下**也能成一条（`jump-tap` / `jump-drag` / `jump-create`；**点小节线不再打开 Sheet** —— 那是点箭头的事，见 [`ui.md`](./ui.md) §18.39）；段落那条路抛段落 id（`segment-open`），**谱面上不弹面板** |
| `PlayerToolbar.vue` | 播放器底栏：两个同高的胶囊/圆钮组合 | 普通态＝胶囊（播放 / 小节·拍 / 倍速 / 音频）+「编辑」圆钮；编辑态＝「完成」圆钮 + 胶囊（行 / 小节线 / 段落 / 跳转）；内含倍速浮层（**顶端一个自己填的倍速框**（`NumberPad`，单位 `×` 取自 `unit.rate`、钉在框的右边缘；**只有这个单位走语言包**，列表四档与胶囊那颗的读数仍写死）+ 下面四档常用档列表，见 [`ui.md`](./ui.md) §18.65）与音频浮层（导入音频**按钮**、三路音量滑杆；面板里的动作按钮**一律在 footer（面板最底端）、一行一个**（全部实心底色 + 18px 图标，见 [`ui.md`](./ui.md) §18.61 第 168 条），导入 / 设置起点 / 更换音频各占整行，见 `docs/ui.md` §13 / §18.42 / §18.61）。**再点一次已经选中的标记工具 = 开 / 关「标记列表」**（`marks` 事件往上传，面板状态在页面那一层；点另一个工具仍然只是切工具并关掉列表，工具本身的 `on` 高亮不受列表影响）。**「跳转」那颗图标恒为 `Route`**（不跟着待定起点换脸，见 [`ui.md`](./ui.md) §16.11） | `player`（播放、倍速、音量、编辑模式、工具）、`settings.showButtonLabels`、`marksOpen` |
| `MarksPanel.vue` | **标记列表（treeview）**：行做父节点（含没有小节线、推不出小节的行）、子节点是挂在这一行上的小节线 / 段落 / 跳转（树由 `domain/marks.js` 的 `buildMarkTree` 造，**「开头」段落不进列表**；**跳转归它起点那条小节线所在的行**）。**头部用 `AppSheet` 默认那个**（标题「标记列表」+ 右侧 ×，标题不跟工具变）；顶部一行是**四颗纯文本按钮**（`.btn.sm.text`：展开·收起 / 全选·清空 / 筛选 / 删除，各占等分，**没有「完成」**；取值与乐谱库多选顶栏那四颗**逐条同值**；**前两颗与「筛选」都是 `.strong` 黑字**（「筛选」筛没筛都不变色），只有「删除」走危险色）；**行可折叠、默认全收起**（一进来只有「第N页第M行 + 小字摘要」，没有满屏子项），上行「第N页第M行」、下行小字摘要「N 小节 N 段落 N 跳转」，**子项只有一行字**（第N小节 / 段落名 / 「#3 第 9 小节 → 第 1 小节」）；**行没有常驻底色**（悬停 / 按下与子节点同一套）；**勾选圈在每行右端**；**底部没有 footer**（顶部那排是**对着列表干活的批量工具行**，不是 §13 说的动作按钮，所以不进 footer）；**删除前先弹一个 `center` 的确认**（不传 `follow-layout`，标题「删除标记」、正文报**真正会被删掉的项数**，取消（`X`）/ 删除（`Trash`，实心危险底）两颗）。**筛选**是那颗「筛选」上弹出的 `ContextMenu`（`stayOpen`，**四类标记 + 底下一项「全部」**，两者之间由 `divider` 画一条分割线；四类 = 行 / 小节线 / 段落 / 跳转，名字与图标复用 `EDIT_TOOLS`；`全部` 是 `CircleDashedCheck` 图标的**总开关**：四档全亮时再点 = 四档全关、否则 = 四档全开，标签恒为「全部」）：关掉哪一档就不显示哪一类，**「行」那一档关掉时剩下的子标记摊平成一条条**（那行字前面补上「第 N 页 第 M 行」）；筛选只影响列表、**不碰 meta** | `AppSheet` + `follow-layout` + `panel-key="marks"` = 抽屉（**列表自己是滚动容器**：外面 `.fill` 撑满 `.sheet-body` 的高度，否则 `flex: 1` 在块级容器里不生效、列表滚不动）；点击项发 `locate`（页面转给 `PdfViewer.scrollToMark`），删除走 `store/player.js` 的四个删除函数（`notify = false` 批量调，**每项各记一条撤销记录**，见 `noteRemoval`）；`domain/marks.js` 的树 + `EDIT_TOOLS`（筛选四档） | `player.meta`、`structure`（喂给 `buildMarkTree`，`line` 的文案在本组件里 `t()` 好再传进去）；`open` 由页面给 |
| `LibraryPanel.vue` | 乐谱库面板：**只放在左侧侧栏里（横竖屏同一份）**，行式列表（缩略图 + 标题 + 右侧「⋯」，没有网格 / 紧凑两套） | 顶栏（**一行**：真搜索框 `.search-bar` + 一颗 `Menu` 图标钮；它的下边框就是**分割线**，分割线下面直接是列表。**设置钮不在这儿** —— 它在左上那条胶囊里，面板本体见 `LibrarySettings.vue`）。菜单钮点开的是贴着按钮的 `ContextMenu`，**三项**：**排序**（打开 `panel-key="sort"` 的「排序方式」面板：`.opt-list` + `.opt`，六项、当前项带勾，点一项就改排序并关掉面板）、**标签**（打开 `panel-key="tags"` 的「全部标签」面板）、**多选**（直接进多选顶栏）。**多选时**顶栏整条换成：全选/清空、导出、删除、完成 —— 四个都是 `.btn.sm.text`（**无底色、无边框**），每个都是「18px 图标 + 文字」（`CircleDashedCheck`/`X`、`SquareArrowRightExit`、`Trash`、`Check`）；前三个挂 `.strong` 走 `--text-strong` 黑字，删除挂 `.danger` 走危险色；四条平分整条顶栏。**「全部标签」面板**：顶部一个占满整行的 `.btn.block` 全选/清空（**一个可筛项都没有时这颗不画**），下面是**可换行**的胶囊（与信息面板同一套 `.chip.tap`，第一项是「**无标签**」这个虚拟标签，只在真有这种乐谱时出现；**默认全部勾上** = 不筛、新出现的标签自动勾上），勾选即筛选；一个可筛项都没有时改显示一句「去乐谱信息里加标签」的提示，**标签不是全选时顶栏搜索框下面挂一行小字「已按标签筛选」**（`.lib-filter-hint`；多选时不画）。搜索在顶栏、**即时过滤**（匹配标题 / 标签，「无标签」也能搜）。行式卡片（**44×44 尺寸框里的封面**：图等比缩放完整放进、不裁切，**框本身不铺底不描边**（所以不是「补成正方形的图」）+ 单行标题 + `Ellipsis` 图标钮 / 多选圈；**当前打开的那张有底色**）、**底部固定一个整宽的导入按钮**（`.lib-foot` 这个 footer：上边框一条分割线 + `flex: none`，里面是 `.btn.primary` 的图标 + 「导入文件」，不写支持的格式；**不加 `.block`** —— 靠纵向 flex 的拉伸撑满「容器宽 − 左右 8px 内边距」，加 `width: 100%` 会连同内边距一起溢出；点了选文件（对话框里只有 pdf / psz / zip / 音频，**`.json` 不列**），**选完把文件交给页面**、走与整页拖放同一条分流（自己不调 `importFiles`）；多选时**整条 footer 一起不画**。形态与 `AppSheet` 的 `.sheet-foot` 同一套，只是乐谱库不是 `AppSheet`、这条线它自己画，见 [`ui.md`](./ui.md) §13 / §18.15）；排序方式 / 「全部标签」/ 信息三个 `AppSheet`（**没有独立的筛选浮层、也没有「新增乐谱」面板**）；信息面板：标题、标签（**输入框在上、回车添加、列表在下**）、封面（**整行宽的 `.btn.ghost.cover-pick` 按钮**：左对齐，里面是 68×68 预览 + 「点击上传替换封面」，**只能点，不收拖入**；它是「封面」这个**字段**、留在内容区；「恢复默认」是动作按钮，在**面板 footer**（`.btn` 中性实心底 + `RotateCcw` 图标；换过自定义封面时才出现，没换过就没有 footer，见 `docs/ui.md` §13））、详细信息（**每样一行、全无分割线**：页数 / 小节数 / 音频时长 / 占用大小 / 最近打开）；1 个 `center` 删除确认，以及 2 个 `ContextMenu`（顶栏菜单钮、卡片「⋯」的动作） | `store/library.js`、`toast`；**选文件归它、分流不归它**（整页拖入与从这颗按钮选进来的文件都由 `PlayerView` 那一个分流函数处理） |
| `LibrarySettings.vue` | 设置面板：七个偏好开关（显示按钮文字 / 滚动动画 / 预备拍与跳转那四个） | 一律 `SwitchRow`（**一行一项、不套卡片**），本组件只管 `.settings` 的纵向排布；即改即生效、**没有保存按钮**；`AppSheet` + `follow-layout` + `panel-key="settings"` = 底部抽屉；**入口在 `PlayerView` 左上那条胶囊里**（`settingsOpen` 是页面的状态） | `settings`、`t` |
| `StorageSheet.vue` | **备份抽屉**（标题栏那颗圆钮打开的）：占用读数 + 说明 + 导出全部。**说明文案刻意不含专有名词**（用大白话讲「存在哪、什么时候会没」） | 三块，块间**只用间距、不画分割线**：① 「本地存储」在左 + **居右的**「已占用 [/ 总额度]」（**两边字号相同**，`font-size` 只写在 `.amount` 上）+ 进度条（**已占用还在统计时、或总额度拿不到时不画** —— 不画空条、也不显示 `0 B`）；② 说明（`library.storage.note` **一条 key 装整段、`\n` 分段 + `white-space: pre-line`**）；内容区**只有这两块**，「导出全部乐谱」`.btn.primary`（`SquareArrowRightExit` 图标 + 文字，**没有乐谱时禁用**）在**面板 footer**（最底端、不跟内容滚，见 `docs/ui.md` §13）。`AppSheet` + `follow-layout` + `panel-key="storage"`；标题行图标 `Database`（`icon` prop 传组件本身，与那颗圆钮同一个） | `usedBytes`（**自己加出来的**，`LibraryPanel` 传 `sizesReady ? sizesTotal : null`）/ `quotaBytes` / `hasScores` / `exportAll` 全由 `LibraryPanel` 传；**自己不做导出、不算占用**（导出复用 `exportScores`，且**导的是整库、不是当前筛选**）；**也不自己报进度**（进度是 `exportScores` 那条**任务型 toast**，见 `store/toast.js` / `store/library.js` 与 `docs/ui.md` §16.2） |
| `ManualSheet.vue` | **操作说明面板**：`src/assets/manual.md`（`?raw`）解成文档 + 目录两屏。**入口在设置面板 footer 那颗「查看操作说明」**（开合状态是 `PlayerView` 的 `manualOpen`） | `AppSheet` + `follow-layout` + `panel-key="manual"` = 抽屉（一次只有一个）。标题行 = **md 第一行那个一级标题**、图标恒为 `BookOpenText`（一级标题不在正文里重复画）；**目录屏只有二级标题**，点一项切回文档并滚到那一段；footer 一颗按钮跟着屏换 —— 文档屏「查看目录」(`TableOfContents`) / 目录屏「返回文档」(`ChevronLeft`)，都是中性实心底 `.btn` + 18px 图标。正文是 `domain/markdown.js` 解出的**节点树**：块级自己画、行内交给 `MarkdownLine.vue`（**没有 `v-html`**，所以正文样式不写 `:deep()`）；滚动只改 `AppSheet` 的 `.sheet-body` 的 `scrollTop`（见 `docs/ui.md` §18.70） | `doc` = `computed(() => renderMarkdown(manualSource))` —— `t()` 读 `locale`，切语言时标题 / 目录 / 正文一起换（md 里用 `「key」` 直接引用语言包）；`t`；**不碰任何 store** |
| `MarkdownLine.vue` | **Markdown 的一行行内内容**（文档的标题 / 段落 / 列表项 / 引用都走它） | 见 L2 表 | 见 L2 表 |
| `JumpSheet.vue` | **跳转记号的 Sheet**：**点谱面上的箭头才打开它**（`player.jumpSheetId` = 那一条记号），**一条记号一张**。**正文只有「跳转顺序」列表** —— 这条记号**所在的那一组**按先后排（`jumpChain`）；行是「排序方式」那张菜单里 `.ctx-item` 的长相（46px、悬停灰底），一行三块：**点左块**换成那一条记号（**当前那条整行铺 `--accent-weak`、右端写「当前」**而不是勾）、**「移出组」的 ×**（`X`）、**拖动排序的把手**（`GripVertical`）—— 右端那两颗的长相是乐谱库顶栏那颗菜单钮那一套 `.icon-btn.flat`（常态透明、悬停 / 按下才铺一档灰）；组里只有它自己时换成空态 `CircleSlash` +「还没有小组成员」，水平竖直居中。**拖动排序**：原行盖一层 `--scrim` 遮罩当占位格（带过渡滑到落点）、复制一份 `.order-ghost` 跟着指针（**与原行逐字一模一样** —— 套同一批 class，连两颗钮与「当前」那层浅底都照抄；另外只加浮层该有的底 `--surface-float` / 描边 `--stroke-strong` / 投影 `--shadow-2`；**x 与原行相同、y = 指针 + `GHOST_DY`**、Teleport 到 body）、拖到列表上下边缘时列表自己滚、其余行让位也带过渡；松手才 `moveJumpInGroup` | `AppSheet` + `follow-layout` + `panel-key="jump"` = 底部抽屉；**设置全在 footer**：起点 / 终点两个 `NumberPad`（改的是落点，走 `setJumpMeasure`）、**「添加小组成员」**（`MousePointerClick`）→ 走 `AppSheet` 的 `collapsed` 把抽屉降到只剩标题、标题改成同一句话，点 × 或谱面上任何非箭头的地方 = 取消、点中的记号接在组末尾、以及**「删除跳转」**（`Trash` + danger 实心底，只删它自己、后面的成员接上去） | `player.jumpSheetId` / `player.pendingJumpBarId` / `player.pickJumpId`、`timeline.jumps`（序号与现推的小节号）、`jumpChain` / `setJumpMeasure` / `addJumpMember` / `removeJumpMember` / `moveJumpInGroup` / `removeJump` / `closeJumpSheet` / `startJumpPick` / `cancelJumpPick` |
| `GotoDialog.vue` | 跳转浮层：按小节+拍跳，或点段落列表跳。两种跳转**都走 `seekToPosition`**（手动跳转的唯一入口：位置、跳转自动播放、跳转预备拍与落点闪烁、跳转后闪烁全在里面；自己拼 `posToTime` + `seek` 就不会打预备拍、一点不闪，见 [`ui.md`](./ui.md) §18.49） | 两个 `NumberPad`（单位「小节」「拍」写在框里，**框外没有 label**）+ **段落列表行**（圆点 + 名称 + 小节 + BPM；**只列出有名字的段落 + 固定的「开头」段落** —— 「开头」删不掉、位置钉死在 1，名字被清空时也要能跳回去，所以它不管有没有名字都在列表里，没名字就显示「开头」）；**没有「跳转」按钮**：键盘上点「确定」（`NumberPad` 的 `confirm`）就直接跳，所以面板没有 footer（见 `docs/ui.md` §13 / §18.61） | `seekToPosition`、`tempoAt`、`timeline`、`measureCount`、`currentPos` |
| `EditorPanel.vue` | **编辑面板外壳**：用 `player.drawer` 判断开合、表单纵排间距、**只有一颗「删除」的 footer**（`.btn.danger` 实心危险底 + `Trash` 图标；没有「完成」，删除因此独占整行；目前只有段落编辑器在用）。**「动作按钮进 footer（最底端）」这条规范最早的样板就是它**（见 `docs/ui.md` §13 / §18.61） | 默认插槽放字段；props `drawer` / `title` / `canDelete` / `deleteLabel`，事件 `delete`；`drawer` 同时当 AppSheet 的 `panelKey`；**`canDelete` 为假时连 footer 都不给** | `player.drawer` |
| `SegmentEditor.vue` | 段落编辑器：**只有名称、BPM、拍号、位置四个字段**，字段下面没有任何说明文字 | 外壳来自 `EditorPanel`；内容为文本输入 + 4 个 `NumberPad`（BPM / 拍号分子 / 位置那一行的小节号与拍号）+ 拍号分母的 `ContextMenu` 短单选钮（**按钮上只有数字**，见 `docs/ui.md` §18.41）；位置那一栏是**一个 label + 两个并排平分该行的框**（与跳转面板的小节 / 拍同一个写法），单位写在框里数字的右侧（数字靠左、单位靠右）、label 只写栏名；拍号那一栏的分子与分母钮**一样宽、框里的数字都靠左**（`docs/ui.md` §18.23 第 70 条），拍号框的上限是这一段落自己的 `beatsPerBar`；`hint` 只留给说不清格式的字段（BPM） | `activeSegment`、`updateSegment`、`removeSegment` |
| `AudioOffsetPicker.vue` | 音频起点选择器：固定 5 秒视野的频谱图，不能缩放，只能拖动 / 滚轮微调，**双击回到 0 秒**（自己从 pointer 事件里数，不是 `@dblclick`，见 `docs/ui.md` §18.43），中心竖线即起点 | canvas 频谱（峰值、0 秒参考线、**整秒刻度**（1s / 2s / 3s…，不标 1.5s / 2.5s）、试听播放头）+ **起点数值一行（居中、只用文字色 `--text-strong`，没有左右微调箭头）** + **「添加弱起小节」`SwitchRow`**（关 = 第 1 小节对齐起点；开 = 第 2 小节对齐、第 1 小节是弱起）（**改动即时写 `meta.audio.startOffset` / `startPosition`，没有保存按钮**）；**动作按钮不在本组件里** ——「试听」「返回音频设置」由 `PlayerToolbar` 的 footer 渲染（组件只 `defineExpose` 出 `previewing` / `togglePreview` / `done`），见 `docs/ui.md` §13 / §18.42；**试听是单独放那个音频文件**（`AudioEngine` 的第二只 `<audio>`），不跟谱面走同一个播放流程，见 `docs/concepts.md` §3.1 | `peaksRef`、`player.previewing` / `player.previewTime`（试听播放头）、`duration`；颜色经 `readPalette()` 从 CSS 变量读取 |
| `ProgressLine.vue` | 页面最底部的细进度条 | 单条 4px 进度条 | `player.currentTime`、`duration`；**纯展示，无任何交互** |

---

## L4 · 页面骨架

只负责布局、路由与全局容器，不实现具体交互。

| 文件 | 描述 | 内容 |
| --- | --- | --- |
| `src/App.vue` | 应用根组件 | 路由出口 + **全局提示栈 `ToastStack`**（并把 toast 的动作名派发给对应 store，见 [`ui.md`](./ui.md) §18.31） |
| `src/views/PlayerView.vue` | 全应用唯一的页面，也是**抽屉宿主 `#sheet-slot` 的所在**，以及**文件导入分流的唯一落点**（整页拖入 + 乐谱库那颗按钮选进来的文件都走它） | **左侧是常驻的乐谱库侧栏**：占谱面宽度（`settings.sideWidth`，夹在 280–460），**只有「展开 / 收起」两态**（收起 = 宽度归零 + 右边框归零 + `--side-io` 过渡，内容由 `.side-clip` 裁切，所以搜索词 / 排序 / 多选都留着），收起钮在侧栏标题栏里、收起后左上出现一颗「乐谱库」单钮胶囊（`LayoutGrid` + 「乐谱库」，`v-if="!libraryOpen"`）。侧栏右边缘那根把手与总览那根**同一套规则**：≥ 最小值跟手，比最小值还窄时**只看拖动方向**（往收起方向 → 收起、往展开方向 → 展开，两个方向都只改状态、走同一段过渡）—— **没有「拖到最窄变红警告、松手才关闭」那套**。**抽屉宿主也在这一页**：`#sheet-slot`（`height: 85dvh`）+ 遮罩 —— 面板从底部升起、一次只有一个、点遮罩即关（横屏是左深右浅的渐变），位置宽度由页面的 `slotStyle()` 给。另含底栏胶囊、进度条、「未打开文件」等空状态（**提示栈不在这页** —— 带按钮的撤销 / 报错复制那两条、以及另外两类 toast 都在 `App.vue` 的 `ToastStack` 里，这页只在「播放时隐藏顶栏」时转达 `setHintsHidden()`）。**页面自己持有的状态也登记进手机端返回手势**（居中确认框 / 循环框选 / 编辑模式，顺序与 `onKey` 的 Esc 落点一致；**编辑模式那一层只把返回手势吃掉**、什么都不关，见 [`ui.md`](./ui.md) §13）。**文件拖到窗口任意位置**都会显示 `.drop-veil` 提示层，松手后按 `classifyFiles` 分流：pdf / psz / zip 建新谱并**打开乐谱库**，音频 → 「设置音频起点」，图片 → 「乐谱信息」；**没打开乐谱时音频 / 图片 / 其它类型都不收**（各一条 danger，只有 pdf / psz / zip 建新谱，**散装的 `.json` 归在「不支持的文件」里**）（`infoRequest` prop 请求，会先展开侧栏并等挂载再发）；需要确认的走页面里那个 `center` 的 `AppSheet`（不传 `followLayout`，始终居中；footer 两颗 = 「取消」`X` 中性底 + 确认那颗用该动作自己的图标 `RotateCcw` / `File` / `Image` + primary / danger 实心底） |
| `src/router.js` | 路由表 | 打开乐谱的地址是 **`/:id`（单段全捕获，地址栏里不带 `/score` 前缀）**，加 `/`（未打开文件）共两条指向 `PlayerView`；多段路径（`/score/xxx`、`/foo/bar`）由兜底那条 redirect 回 `/` |
