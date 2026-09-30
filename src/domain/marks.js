/**
 * 标记列表（treeview）的数据：**把一份 meta 里的四种标记摊成一棵树**，纯逻辑、无 DOM。
 *
 * 层级 = **行做父节点**，子节点是挂在这一行上的**小节线 / 段落 / 跳转**：
 *   · 行按 `structure.systems` 的顺序（页 → 页内自上而下的行，`deriveStructure` 已经排好），
 *     显示成「第 N 页 第 M 行」，M 用它在**整本谱**里的第几条（`index`）；
 *     **没有小节线、推不出小节的行也照样是一个节点**（`summary.measures === 0`）——
 *     行标记工具最常画的就是这种行，漏掉它们等于列表里看不到刚画的那一条。
 *   · `summary` 是这一行的**小字摘要**（`{ measures, segments, jumps }`）：这一行里的小节数、
 *     挂在它上面的段落数与跳转记号数。`measures` 按小节所属的那个行数（`structure.measures` 的 `systemId`），
 *     所以一行少于两条小节线时它自然是 0。
 *   · 小节线归它所在的行（`structure.barInfo` 里的 `systemId`）。
 *   · 段落按**它挂靠的那条小节线**归行：小节号由 `segmentStartMeasure`（`segmentMeasure` 现推）
 *     给出来，**与谱面上那条线、总览里那根蓝线共用同一份**；那条线取不到小节号时不进列表。
 *   · **跳转记号归它起点那条小节线所在的行**（起点 / 终点就是 `meta.jumps` 里存着的那两条线）。
 *   · 「开头」段落（`head`）**不进列表**：它是固定段落、删不掉，列出来只会让人试着去删它
 *     （它在谱面上**有**自己的标记线，固定在第 1 小节第 1 拍 —— 那是 `ScorePage` 的事，与这份列表无关）。
 *
 * 每一项都带上**它在谱面上的坐标**（`page` + `y0` / `y1`，PDF pt、meta 的 y-up，已 min/max 成 lo/hi）
 * 与**那一行上要显示的文字**（`line`，子节点就一行字）：
 * 「点列表项 → 谱面滚到它那儿并闪一下」直接用坐标，显示直接用 `line`。
 *
 * 这里**只管数据**：`line` 里的量词 / 文案由调用方 `t()` 好再传进来（`texts` 参数）——
 * 这样这个模块不引 i18n，`scripts/unit-test.mjs` 里能直接跑（见 `docs/code.md` §2）。
 * 删除也归调用方：`MarksPanel` 按 `kind` + `id` 调 `store/player.js` 里对应的那几个函数
 * （语义边界见 `docs/concepts.md` §2）。
 */
import { resolveJumps, segmentStartMeasure } from './timeline.js'

/** 子节点的排列顺序：小节线 → 段落 → 跳转（一行上的标记都是这条线，按这个顺序读起来最顺） */
const KIND_ORDER = { bar: 0, segment: 1, jump: 2 }

/**
 * 造这棵树。`texts` 是那几段要拼进 `line` 的模板：
 *   `{ measure: '第 {n} 小节', segment: (seg) => …, jump: (jump) => … }`。
 * 返回 `[{ id, index, page, y0, y1, summary, children }]`：
 *   · `id` = 行自己的 id（就是 meta 里那个 `sy_*`，谱面上高亮时认的也是它）；
 *   · `index` 从 1 起、按阅读顺序数（含推不出小节的行）；
 *   · `children[].kind` = `'bar'` / `'segment'` / `'jump'`，各自带自己的 `id` 与 `line`。
 */
export function buildMarkTree(meta, structure, texts = {}) {
  if (!structure) return []
  const kids = groupChildren(meta, structure, texts)
  return structure.systems.map((s, i) => {
    // 行自己的 y0 / y1 从 meta 里取（`structure.systems` 记的就是同一份引用），
    // 两者谁大谁小都行（示例数据 y0 < y1、OMR 的 truth 反过来），统一成 lo / hi
    const sys = meta?.pages?.[s.page]?.systems?.[s.sys]
    const a = Number(sys?.y0 ?? s.y0)
    const b = Number(sys?.y1 ?? s.y1)
    const children = kids.get(s.id) || []
    return {
      id: s.id,
      kind: 'row',
      index: i + 1,
      page: s.page,
      y0: Math.min(a, b),
      y1: Math.max(a, b),
      // 摘要里的小节数按「小节属于哪一行」数，所以一行少于两条小节线时自然是 0
      summary: {
        measures: structure.measures.filter((m) => m.systemId === s.id).length,
        segments: children.filter((c) => c.kind === 'segment').length,
        jumps: children.filter((c) => c.kind === 'jump').length,
      },
      children,
    }
  })
}

/** 先按「行 id」把子标记分好组（一次遍历，三种标记各扫一遍） */
function groupChildren(meta, structure, texts) {
  const map = new Map()
  const push = (systemId, item) => {
    if (!systemId) return
    if (!map.has(systemId)) map.set(systemId, [])
    map.get(systemId).push(item)
  }
  /** 行 id：`structure` 里记的是 (页, 页内行号)，列表只认行自己的 id */
  const rowId = (page, sysIndex) => structure.systems.find((s) => s.page === page && s.sys === sysIndex)?.id || null
  const span = (o) => ({ page: o?.page, y0: Math.min(o?.y0, o?.y1), y1: Math.max(o?.y0, o?.y1) })
  const measureText = texts.measure || '第{n}小节'

  for (const b of structure.barInfo.values()) {
    // 末线指向「全部小节之后」，`barStartMeasure` 里没有它 —— 那种线不写小节号，但线本身照样在
    const no = structure.barStartMeasure.get(b.id)
    push(b.systemId, {
      kind: 'bar',
      id: b.id,
      no: no ?? null,
      // 小节线显示成「第 5 小节」（它起头的那一小节）；拿不到小节号的只写「小节线」
      line: Number.isFinite(no) ? measureText.replace('{n}', String(no)) : texts.bar || '',
      ...span(b),
    })
  }

  for (const seg of meta?.segments || []) {
    if (seg.head) continue
    const m = segmentStartMeasure(structure, seg) // 位置优先；「开头」上面已跳过（它在谱面上有标记，但不进这份列表）
    const bar = seg.barId ? structure.barInfo.get(seg.barId) : null
    const systemId = m ? rowId(m.page, m.sys) : bar?.systemId
    if (!systemId) continue
    push(systemId, {
      kind: 'segment',
      id: seg.id,
      // 段落那行字 = **名字 + 速度拍号**（没名字就只写速度 + 拍号），与谱面名牌上那句同一个模板
      // （`texts.segment` 由调用方 `t()` 好传进来，本层不引 i18n）
      line: texts.segment ? texts.segment(seg) : seg.name || '',
      // 坐标优先取它真正落上去的那一小节（`m`），没有才退回挂靠的那条线
      ...span(m || bar),
    })
  }

  // 跳转记号**归它起点那条小节线所在的行**：起点 / 终点各落在哪条线上由 `resolveJumps` 算好
  // （两端就是记号存着的那两条小节线），这里不再挑线。
  // **无效的记号**（两端同一个小节、或端点取不到小节号）不进列表 —— 它既不画也不跳。
  for (const jump of resolveJumps(meta, structure, structure.count)) {
    if (!jump.valid) continue
    const bar = structure.barInfo.get(jump.startBarId)
    if (!bar) continue
    push(bar.systemId, {
      kind: 'jump',
      id: jump.id,
      barId: jump.startBarId,
      line: texts.jump ? texts.jump(jump) : '',
      no: jump.start,
      ...span(bar),
    })
  }

  for (const list of map.values()) list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  return map
}
