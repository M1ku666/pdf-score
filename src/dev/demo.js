/**
 * 开发用示例乐谱：程序生成一份「五线谱 + 小节线」PDF 与一段可对齐的音频，
 * 并给出与之完全对应的 JSON 标记，用于验证导入、渲染、同步与标记流程。
 *
 * **App 里没有入口**，只有手工调试道具在用它：`scripts/probe-omr.mjs`（OMR 探针）。
 * 要么照旧只当调试素材留着，要么连同那个脚本一起删掉 —— 别让它变成没人读的死代码。
 */
import { defaultSegment, uid } from '../domain/schema.js'
import { encodeWav } from '../domain/audio-peaks.js'

const PAGE = { width: 595.28, height: 841.89 }
const SYSTEMS_PER_PAGE = 5
const MEASURES_PER_SYSTEM = 4
const PAGES = 2
const BPM = 96
const BEATS_PER_BAR = 4
const STAFF_TOP = 700
const SYSTEM_STEP = 128
const X0 = 72
const X1 = 523
const LINE_GAP = 8
const SAMPLE_RATE = 16000

function pdfEscape(s) {
  return String(s).replace(/[\\()]/g, (m) => '\\' + m)
}

/** 手写一个最小可用的 PDF（无外部依赖，pdf.js 可直接解析） */
function buildPdf() {
  const contents = []
  const barXs = []
  const step = (X1 - X0) / MEASURES_PER_SYSTEM
  for (let i = 0; i <= MEASURES_PER_SYSTEM; i++) barXs.push(X0 + step * i)

  for (let p = 0; p < PAGES; p++) {
    const ops = []
    ops.push('BT /F1 18 Tf 72 800 Td (' + pdfEscape(`示例练习曲 · Demo Etude`) + ') Tj ET')
    ops.push('BT /F1 10 Tf 72 782 Td (' + pdfEscape(`Page ${p + 1} / ${PAGES}   ${BPM} BPM  4/4`) + ') Tj ET')
    for (let s = 0; s < SYSTEMS_PER_PAGE; s++) {
      const top = STAFF_TOP - s * SYSTEM_STEP
      ops.push('0.8 w 0 0 0 RG')
      for (let l = 0; l < 5; l++) {
        const y = top - l * LINE_GAP
        ops.push(`${X0} ${y} m ${X1} ${y} l S`)
      }
      // 小节线
      for (const x of barXs) {
        ops.push(`${x} ${top} m ${x} ${top - 4 * LINE_GAP} l S`)
      }
      // 行首谱号（简单图形）与小节号
      ops.push(`0.6 w 0.2 0.2 0.2 RG`)
      ops.push(`${X0 + 4} ${top - 4 * LINE_GAP} m ${X0 + 14} ${top} l S`)
      ops.push('BT /F1 7 Tf 0 0 0 rg')
      ops.push(`${X0 + 2} ${top + 8} Td (${1 + s * MEASURES_PER_SYSTEM + p * SYSTEMS_PER_PAGE * MEASURES_PER_SYSTEM}) Tj ET`)
      // 一些“音符”
      for (let m = 0; m < MEASURES_PER_SYSTEM; m++) {
        for (let b = 0; b < BEATS_PER_BAR; b++) {
          const x = X0 + step * m + 8 + (step - 16) * (b / BEATS_PER_BAR)
          const y = top - LINE_GAP * ((m + b) % 5)
          ops.push('0 0 0 rg')
          ops.push(`${x} ${y} m ${x + 7} ${y} l S`)
          ops.push(`${x + 7} ${y} m ${x + 7} ${y - 16} l S`)
          ops.push(`${x + 7} ${y - 16} m ${x + 1} ${y - 16} l S`)
        }
      }
    }
    contents.push(ops.join('\n'))
  }

  const objects = []
  const pageCount = PAGES
  const firstPageObj = 3
  const contentStart = firstPageObj + pageCount
  const fontObj = contentStart + pageCount

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  const kids = []
  for (let i = 0; i < pageCount; i++) kids.push(`${firstPageObj + i} 0 R`)
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(' ')}] >>`
  for (let i = 0; i < pageCount; i++) {
    objects[firstPageObj + i] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentStart + i} 0 R >>`
    const stream = contents[i]
    objects[contentStart + i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  }
  objects[fontObj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'

  let out = '%PDF-1.4\n'
  const offsets = []
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefPos = out.length
  const total = objects.length
  out += `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let i = 1; i < total; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  }
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`

  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
  return { blob: new Blob([bytes], { type: 'application/pdf' }), barXs }
}

/** 生成与 PDF 小节一一对应的音频（每拍一个音，和弦每 4 小节换一次） */
async function buildAudio(measureCount) {
  const rate = SAMPLE_RATE
  const secPerBeat = 60 / BPM
  const total = measureCount * BEATS_PER_BAR * secPerBeat + 2
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  const ctx = new Ctx(1, Math.ceil(total * rate), rate)
  const master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)
  const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]

  for (let m = 0; m < measureCount; m++) {
    for (let b = 0; b < BEATS_PER_BAR; b++) {
      const t = (m * BEATS_PER_BAR + b) * secPerBeat
      const note = scale[(m * 2 + b * 3) % scale.length] * (b === 0 ? 0.5 : 0.25)
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = b === 0 ? 'triangle' : 'sine'
      osc.frequency.value = note
      const peak = b === 0 ? 0.5 : 0.3
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peak, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + secPerBeat * 0.9)
      osc.connect(g)
      g.connect(master)
      osc.start(t)
      osc.stop(t + secPerBeat)
    }
  }
  const rendered = await ctx.startRendering()
  return encodeWav(rendered)
}

export async function buildDemoScore() {
  const { blob: pdf, barXs } = buildPdf()
  const totalMeasures = PAGES * SYSTEMS_PER_PAGE * MEASURES_PER_SYSTEM
  const audio = await buildAudio(totalMeasures)

  const meta = {
    version: 1,
    title: '示例练习曲（Demo Etude）',
    audio: { name: 'demo-etude.wav', type: 'audio/wav', startOffset: 0, startPosition: 1, duration: null },
    pages: [],
    segments: [],
    jumps: [],
  }

  const pages = []
  for (let p = 0; p < PAGES; p++) {
    const systems = []
    for (let s = 0; s < SYSTEMS_PER_PAGE; s++) {
      const top = STAFF_TOP - s * SYSTEM_STEP
      systems.push({
        id: uid('sy'),
        y0: top - 4 * LINE_GAP - 10,
        y1: top + 10,
        bars: barXs.map((x) => ({ id: uid('br'), x })),
      })
    }
    pages.push({ width: PAGE.width, height: PAGE.height, systems })
  }
  meta.pages = pages

  // 第 1 小节的 120 BPM 4/4 由固定的「开头」段落提供，这里只加后面的段落
  // （段落位置 = 小节号 + 拍号两个字段，这几段都落在各自小节的开头 = 第 1 拍）
  meta.segments = [
    defaultSegment({ barId: pages[0].systems[1].bars[0].id, name: 'B 段', bpm: BPM, beatsPerBar: 4, beatUnit: 4, measure: MEASURES_PER_SYSTEM + 1, beat: 1 }),
    defaultSegment({ barId: pages[0].systems[3].bars[0].id, name: 'C 段', bpm: BPM, beatsPerBar: 4, beatUnit: 4, measure: MEASURES_PER_SYSTEM * 3 + 1, beat: 1 }),
  ]
  if (pages[1]) {
    const perPage = SYSTEMS_PER_PAGE * MEASURES_PER_SYSTEM
    meta.segments.push(
      defaultSegment({ barId: pages[1].systems[0].bars[0].id, name: 'D 段', bpm: BPM, beatsPerBar: 4, beatUnit: 4, measure: perPage + 1, beat: 1 })
    )
  }

  // 提示：示例音频是「一遍到底」的线性演奏，因此不预置跳转记号
  // （跳转记号用在音频里真的跳了的地方 —— 演奏顺序与谱面顺序不一致时才需要，见编辑模式里的跳转工具）

  return { pdf, audio, meta }
}

/**
 * 调试用：造假 `n` 张乐谱（标题 / 标签 / 一个已知大小的假 PDF），
 * 让乐谱库那几行有东西可看 —— 列表、标签、占用大小与各档排序都靠它。
 * **App 里没有入口**，只在 DEV 的 `window.__app.library` 上暴露。
 *
 * 它落的是**真记录 + 真文件**（`db.putScore` / `db.putFile`），所以量出来的占用、
 * 排出来的顺序都与真导入的一样。
 */
export async function seedDemoLibrary(n = 6) {
  const { putFile, putScore } = await import('../db/idb.js')
  const { createMeta } = await import('../domain/schema.js')
  const samples = [
    { title: '月光奏鸣曲 第一乐章', bytes: 2_400_000, tags: ['练习曲', '古典'] },
    { title: 'Bach · Cello Suite No.1', bytes: 880_000, tags: ['练习曲'] },
    { title: '小星星变奏曲', bytes: 240_000, tags: ['儿童'] },
    { title: 'Chopin Nocturne Op.9 No.2', bytes: 5_100_000, tags: ['古典', '视奏'] },
    { title: '哈农练指法 第一条', bytes: 96_000, tags: [] },
    { title: '卡农（简易版）', bytes: 1_300_000, tags: ['合奏'] },
  ]
  const made = []
  for (let i = 0; i < n; i++) {
    const s = samples[i % samples.length]
    const id = uid('sc')
    const meta = createMeta({ title: s.title, tags: s.tags })
    // 假 PDF：只要字节数对得上就够了（乐谱库只看记录上的统计，不解析文件）
    meta.pages = [{ width: 595.28, height: 841.89, systems: [] }]
    await putFile(id, 'pdf', new Blob([new Uint8Array(s.bytes)], { type: 'application/pdf' }))
    await putScore({
      id,
      title: s.title,
      openedAt: Date.now() - i * 3600_000,
      meta,
      thumb: null,
      coverCustom: false,
      hasPdf: true,
      hasAudio: false,
      pdfName: `${s.title}.pdf`,
      audioName: '',
      pageCount: 1,
      measureCount: 0,
      systemCount: 0,
    })
    made.push(id)
  }
  return made
}
