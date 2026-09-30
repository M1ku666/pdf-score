# 数据格式 · PDF Score

一张乐谱的数据形状：内存里的 `meta`、落库的记录、导出的包。**几何量都是 PDF 原始点坐标 pt**，坐标与段落位置的硬约定见 `invariants.md`。

---

## 1. 一张乐谱 = PDF + 音频 + 标记

```
IndexedDB: pdf-score
├── scores  { id, title, editDone, openedAt, meta(JSON), thumb, coverCustom, pageCount, measureCount, ... }
└── files   `<id>/pdf`、`<id>/audio`、`<id>/peaks`
```

- `editDone` 是**这份谱的编辑完成了没有**：新建 / 导入时是 `false`，**第一次点底栏那颗「完成」时置真**
  （`store/player.js` 的 `finishEdit` → `store/library.js` 的 `markEditDone`）——
  **那颗钮是编辑模式唯一的出口**，Esc 与手机返回手势都不退编辑模式（见 `docs/ui.md` §18.40 / §18.66）。
  **它不进包**，所以导出再导入回来的谱一律是「未完成编辑」。两个用处：
  乐谱库把「未完成编辑」的单独列在列表最上面一栏（`docs/ui.md` §18.66），
  `open()` 据此决定要不要自动进编辑模式。
- `openedAt` 是**最近一次打开的时间**：新建时按「刚打开过」算，之后**只有 `store/player.js` 的 `open()`
  会刷新它**（`store/library.js` 的 `markOpened`）。**记录里没有创建时间 / 更新时间**，
  改标记 / 标签 / 封面都不动 `editDone` / `openedAt`；乐谱库「最近打开 / 最早打开」那一档排序用的就是它 ——
  **「编辑完成没完成」不看它、只看 `editDone`**。
- `thumb` 是封面 JPEG dataURL；`coverCustom = true` 表示它是用户自己选的图（否则是 PDF 首页渲染出来的，深色模式要反色）。
- **记录里没有「占用大小」这个字段**：它是 `files` 那三个键的字节数之和，由 `store/library.js`
  的 `scoreFileInfo()` 现量。列表 / 排序 / 信息面板读的是 `sizes`（`Map<id, 字节>`，量完缓存在内存里，
  `sizesReady` 是「量完了没」），乐谱库那颗「备份」圆钮与它的抽屉读的是它们的合计 `sizesTotal`。
  **这份合计和 `navigator.storage.estimate()` 报的 `usage` 不是一回事**：后者还包含同一个 origin
  下别的存储，两者不要互相顶替。
- 音频与波形峰值可以缺失：没有音频也能播放（见 `concepts.md` 的播放时钟）。
- 峰值数组是 `Float32Array`，**每 `1/peaksPerSecond` 秒一个 `[min, max]` 对、交错存放**（`peaks[2i] = min`、`peaks[2i+1] = max`，长度 = 桶数 × 2），写入前按峰值归一化；`peaksPerSecond` 存在 `meta.audio.peaksPerSecond`，缺缓存时自动重算。

## 2. `score.json` 结构

```jsonc
{
  "version": 1,
  "title": "示例练习曲",
  "tags": ["练习曲", "自用"],            // 乐谱库里的标签，可在「信息」里编辑
  "audio": {
    "name": "demo.wav",
    "startOffset": 0,      // 第 startPosition 小节对应的音频时间（秒），可为负（音频开始前）
    "startPosition": 1,    // 音频起点对齐哪一小节：1 = 第 1 小节；2 = 第 2 小节（第 1 小节是弱起）
    "peaksPerSecond": 150
  },
  "pages": [
    {
      "width": 595.28, "height": 841.89,
      "systems": [                       // 行（谱表）。PDF 的 y 轴向上，y0 越大越靠上
        {
          "id": "sy_x", "y0": 658, "y1": 710,
          "bars": [{ "id": "br_x", "x": 72 }]   // 小节线。一行 n 条线 = n-1 个小节
        }
      ]
    }
  ],
  "segments": [                          // 段落 = 调速点
    {
      "id": "sg_x", "barId": "br_x",     // 挂靠的小节线（不是行末线）——小节号由它现推
      "name": "A 段",
      "bpm": 120,
      "beatsPerBar": 4, "beatUnit": 4,   // 拍号 4/4
      "beat": 3,                         // 小节位置：这一小节里的第 3 拍（拍号夹在这一段落自己的 beatsPerBar 内）
      "time": null                       // 可选时间锚点（秒），用于精确对齐
    }
  ],
  "jumps": [                             // 跳转记号：起点 / 终点各是一条小节线 id，前置可以是另一条记号的 id
    { "id": "jp_x", "startBarId": "br_a", "endBarId": "br_b", "prereq": null },
    { "id": "jp_y", "startBarId": "br_c", "endBarId": "br_b", "prereq": "jp_x" }
  ]
}
```

- 跳转记号**只有这三个字段**（`src/domain/schema.js` 的 `defaultJump`）：
  - `startBarId` —— 起点小节线：**进入它起头的那一小节的那一刻跳走**，这一小节自己不演奏；
  - `endBarId` —— 终点小节线：跳到它起头的那一小节；
  - `prereq` —— 前置：另一条跳转记号的 `id`（`null` = 没有前置）。**前置跳成功过这条才允许跳**；
    没满足时这次到达**不算消费**（之后再走到起点、前置满足了照跳）。语义与展开见 `concepts.md` §2。
- **两端存的都是小节线 id**：小节号是现推的、只用来显示与算时间轴。三条落线限制（写入口拒绝，见 `invariants.md` §4）：
  起点不落在**行首线**上、终点不落在**行末线**上、两端不能是**同一个小节**。
- **删掉一条小节线 / 一行，挂在那些线上的段落与跳转记号一起删**（与段落同一套级联）：撤销把线插回来时它们也一起回来。
- 端点取不到小节号（挂在曲末那条线上）、或两端是同一个小节的记号**无效**：不画在谱面上、也不参与展开，
  但照旧在数据里、照旧占一个序号（`concepts.md` §2 的 `resolveJumps`）。
- 规整（`createMeta`）：没写起点 / 终点的条目**丢掉**；`prereq` 指向不存在的 id、或指向自己时**当没有前置**
  （留着它那条记号永远不跳，界面上却看不出为什么）。
- 删一条记号时**依赖它的记号一起删**（`removeJump` 的级联），所以数据里不会出现悬空前置。
- 段落是**调速点**：从它挂靠的那条小节线起头的那一小节、第 `beat` 拍起生效的 BPM 与拍号；`time` 是第一遍经过时用来强制对齐的时间锚点。
- 结构由 `src/domain/schema.js` 的 `createMeta` 规整 / 校验（外来 JSON 也走它），`syncPages` / `metaStats` 负责页与统计。
- **同一页的行不许重叠、也不许比「一档点击尺寸」更扁**（`ROW_MIN_PX` = 46 CSS px 折算成的 pt，
  见 `src/domain/rows.js`），但这是**交互写入的约束、不是数据的不变量**：行标记工具划出来的一笔
  与某条已有行重叠、或划出来的区间在屏幕上不够 46px 高时，整笔都不落（判定在 `src/domain/rows.js`，
  预览带换成灰色 + 一条 toast 说明是哪一种），而 schema 照样接受外来 JSON / OMR 里重叠的行、
  比 46px 更扁的行。
- **没有例外**：新行整个套在某条已有行内部、或者把一条已有行整个罩住，都算重叠、都落不下来 ——
  行工具只做两件事（**点已有行 = 删**，**拖动 = 新建一行**），不会去拆开或改动已有的行。
- **新行的小节线自动标**：行一落下来就自己跑一遍**这一页的谱面识别**（`domain/omr.js` 的
  `detectPdfPage`，与导入时同一套整页链路），把落在这一行 y 范围内的识别结果的小节线填进去
  （接线在 `src/store/player.js` 的 `detectRowBars`，识别结果按页缓存）。认不出来就什么都不加，
  失败只 `console.warn` —— 新建行这件事不依赖它，手工补线照旧。

## 3. 导出 / 导入的包

一张乐谱 = 一个 **`.psz`**（改了后缀的 zip），内容**直接在根目录**：

```
score.json   元数据（小节线、段落、跳转记号、音频起点…），缩进 2 空格
score.pdf    PDF 乐谱
audio.mp3    音频（原扩展名，缺省 mp3）
peaks.f32    波形峰值缓存（可选，缺失时自动重算）
cover.jpg    自定义封面（可选，只有用户换过封面时才写）
```

- **导出一张就是这单个 `.psz`；导出多张打一个外层 `.zip`**，里面每张乐谱各是一个以标题命名的 `.psz`（重名自动加 `-2`）。外层 zip 的文件名带**本地时间戳** `乐谱库-{n}张-yyyymmdd-hhmmss.zip`，所以连续导出几次不会互相覆盖。
- 导入时把嵌套的 zip / psz 递归摊平（展开到「以该条目文件名命名的子目录」里，所以外层 zip 里的每张 psz 各成一组、不会串味）；旧版「每张乐谱一个子目录」的 zip 也照样读。同目录内按扩展名识别（JSON 优先认 `score/meta/sheet/index`，封面认 `cover.*`），**同一个目录里的 pdf / 音频 / `score.json` 合成一张乐谱**（一张谱一组）。
- 包内容的读写实现在 `src/domain/zip.js`，库侧编排在 `src/store/library.js`。
