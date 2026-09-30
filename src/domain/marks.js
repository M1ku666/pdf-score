import { segmentStartMeasure } from './timeline.js'

const KIND_ORDER = { bar: 0, segment: 1, repeat: 2 }

export function buildMarkTree(meta, structure, texts = {}) {
  if (!structure) return []
  const kids = groupChildren(meta, structure, texts)
  return structure.systems.map((s, i) => {
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
      summary: {
        measures: structure.measures.filter((m) => m.systemId === s.id).length,
        segments: children.filter((c) => c.kind === 'segment').length,
        repeats: children.filter((c) => c.kind === 'repeat').length,
      },
      children,
    }
  })
}

function groupChildren(meta, structure, texts) {
  const map = new Map()
  const push = (systemId, item) => {
    if (!systemId) return
    if (!map.has(systemId)) map.set(systemId, [])
    map.get(systemId).push(item)
  }
  const rowId = (page, sysIndex) => structure.systems.find((s) => s.page === page && s.sys === sysIndex)?.id || null
  const span = (o) => ({ page: o?.page, y0: Math.min(o?.y0, o?.y1), y1: Math.max(o?.y0, o?.y1) })
  const repeatText = texts.repeat || {}
  const measureText = texts.measure || '第{n}小节'

  for (const b of structure.barInfo.values()) {
    const no = structure.barStartMeasure.get(b.id)
    push(b.systemId, {
      kind: 'bar',
      id: b.id,
      no: no ?? null,
      line: Number.isFinite(no) ? measureText.replace('{n}', String(no)) : texts.bar || '',
      ...span(b),
    })
  }

  for (const seg of meta?.segments || []) {
    if (seg.head) continue
    const m = segmentStartMeasure(structure, seg)
    const bar = seg.barId ? structure.barInfo.get(seg.barId) : null
    const systemId = m ? rowId(m.page, m.sys) : bar?.systemId
    if (!systemId) continue
    push(systemId, {
      kind: 'segment',
      id: seg.id,
      line: texts.segment ? texts.segment(seg) : seg.name || '',
      ...span(m || bar),
    })
  }

  for (const rep of meta?.repeats || []) {
    const bar = rep.barId ? structure.barInfo.get(rep.barId) : null
    if (!bar) continue
    push(bar.systemId, {
      kind: 'repeat',
      id: rep.id,
      barId: rep.barId,
      repeatKind: rep.kind,
      line: repeatText[rep.kind] || '',
      no: structure.barStartMeasure.get(rep.barId) ?? null,
      ...span(bar),
    })
  }

  for (const list of map.values()) list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  return map
}
