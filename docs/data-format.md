# 数据格式 · PDF Score

一张乐谱的数据形状：内存里的 `meta`、落库的记录、导出的包。**几何量都是 PDF 原始点坐标 pt**，坐标与段落位置的硬约定见 `invariants.md`。

---

## 1. 一张乐谱 = PDF + 音频 + 标记

```
IndexedDB: pdf-score
├── scores  { id, title, openedAt, meta(JSON), thumb, coverCustom, pageCount, measureCount, ... }
└── files   `<id>/pdf`、`<id>/audio`、`<id>/peaks`
```

- `openedAt` 是**最近一次打开的时间**：新建时按「刚打开过」算，之后**只有 `store/player.js` 的 `open()`
  会刷新它**（`store/library.js` 的 `markOpened`）。**记录里没有创建时间 / 更新时间**，
  改标记 / 标签 / 封面都不动 `openedAt`；乐谱库「最近打开 / 最早打开」那一档排序用的就是它。
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
      "id": "sg_x", "barId": "br_x",     // 锚定的小节线
      "name": "A 段",
      "bpm": 120,
      "beatsPerBar": 4, "beatUnit": 4,   // 拍号 4/4
      "measure": 4, "beat": 3,           // 小节位置：第 4 小节第 3 拍（拍号夹在这一段落自己的 beatsPerBar 内）
      "time": null                       // 可选时间锚点（秒），用于精确对齐
    }
  ],
  "repeats": [                           // 反复标记
    { "id": "rp_x", "kind": "start", "barId": "br_x" },
    { "id": "rp_y", "kind": "end", "barId": "br_z", "passes": 2, "backToMeasure": null },
    { "id": "rp_z", "kind": "house1", "barId": "br_h1", "houseEndMeasure": null }
  ]
}
```

- 反复 `kind` **只有三种**：`start` / `end` / `house1`。
  - `start` 与 `end` 成对构成一个**反复区块**（配对规则见 `concepts.md` §2），`end` 是「它之前的小节结束」。
  - `house1` 写在**区块第一条线之后、结束线之前**的某条小节线上；**房子 2 不是标记**，是从结束线往右推出来的显示样式。
  - `passes`（默认 2）、`backToMeasure`（默认 null = 上一个 `start`）、`houseEndMeasure`（默认 null = 结束线）、`label`
    都还在数据里、导入时照旧规整，但**界面上已经没有改它们的入口**：反复标记现在全靠落点自动定类型。
  - `house2` 作为 `kind` **不再产生**（`createMeta` 仍容忍外来数据里的它，但渲染与判类型都按「不存在」处理）。
- 段落是**调速点**：从它的位置起生效的 BPM 与拍号；`time` 是第一遍经过时用来强制对齐的时间锚点。
- 结构由 `src/domain/schema.js` 的 `createMeta` 规整 / 校验（外来 JSON 也走它），`syncPages` / `metaStats` 负责页与统计。
- **同一页的行不许重叠、也不许比「一档点击尺寸」更扁**（`ROW_MIN_PX` = 46 CSS px 折算成的 pt，
  见 `src/domain/rows.js`），但这是**交互写入的约束、不是数据的不变量**：行标记工具划出来的新行
  只压住某个已有行的一半（一端伸到行外，或与别的行相交）、或划出来的区间在屏幕上不够 46px 高时
  整条都不加（判定在 `src/domain/rows.js`，预览带换成灰色 + 一条 toast 说明是哪一种），
  而 schema 照样接受外来 JSON / OMR 里重叠的行、比 46px 更扁的行。
- **整条套在某个已有行内部**（两端都在它内部）是唯一的例外：那一笔**不落成新行**，而是把那条已有行
  减去新行、**拆成上下两条**（预览带是红色）。拆出来的两条各自**克隆**原行的小节线，
  以及挂在这些小节线上的段落 / 反复 —— 每个新行拿一份**独立的副本**（新的 `br_` / `sg_` / `rp_` id，
  `barId` 指向本行那份新线）；原行的那几条标记随之删除。
- 拆出来的两条行**也受同一个下限约束**：剩下的哪一半在屏幕上不够 46px 高就拆不成
  （原行本身不够两条最小行的高度时，怎么切都拆不成，但它仍然可能被一条更小的行拆开）——
  **拆不成不算红色那一档**：它落回上面那条「不加也不拆」的路，预览带同样是灰色，
  只是 toast 说的是「这一行太扁，拆不了」。
- 拆行后**各自的小节号会整体平移**（原来的行拆成两条，行数变了，它后面的小节号跟着变），
  所以段落克隆的 `measure` **必须按它自己那一半的小节重算，不能沿用原值**：段落落在哪一小节是
  **`measure` 说了算**（`segmentStartMeasure()`，`barId` 只是它当初挂靠的那条线，见 `docs/ui.md`
  与 `src/domain/timeline.js`），沿用原值会把克隆钉死在原来的小节号上 ——
  下半行那份会被拽到上半行的位置去，它自己那一行反而没有标记。
  重算是**行内相对位置不变**：段落在原行的第几格，在两半里就还是第几格（记 `start` = 原行第一小节号、
  `off` = 段落在原行内的格偏移，则克隆的 `measure = 该半行第一小节号 + off`）；**`beat` 照抄**。
  **名字 / BPM / 拍号继续与原来相同** —— 两半各自管各自的小节。
  某一半**一个小节都没有**、或段落**没有合法 `measure`** 时，那一份克隆**丢掉**（没有位置可落）。
- 反复克隆没有这个问题：反复**只认 `barId`**，不认小节号。

## 3. 导出 / 导入的包

一张乐谱 = 一个 **`.pmz`**（改了后缀的 zip），内容**直接在根目录**：

```
score.json   元数据（小节线、段落、反复、音频起点…），缩进 2 空格
score.pdf    PDF 乐谱
audio.mp3    音频（原扩展名，缺省 mp3）
peaks.f32    波形峰值缓存（可选，缺失时自动重算）
cover.jpg    自定义封面（可选，只有用户换过封面时才写）
```

- **导出一张就是这单个 `.pmz`；导出多张打一个外层 `.zip`**，里面每张乐谱各是一个以标题命名的 `.pmz`（重名自动加 `-2`）。外层 zip 的文件名带**本地时间戳** `乐谱库-{n}张-yyyymmdd-hhmmss.zip`，所以连续导出几次不会互相覆盖。
- 导入时把嵌套的 zip / pmz 递归摊平（展开到「以该条目文件名命名的子目录」里，所以外层 zip 里的每张 pmz 各成一组、不会串味）；旧版「每张乐谱一个子目录」的 zip 也照样读。同目录内按扩展名识别（JSON 优先认 `score/meta/sheet/index`，封面认 `cover.*`），散装文件按去掉扩展名的文件名归并。
- 包内容的读写实现在 `src/domain/zip.js`，库侧编排在 `src/store/library.js`。
