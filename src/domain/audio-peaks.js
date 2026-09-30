import { t } from '../i18n/index.js'

export const PEAKS_PER_SECOND = 150

let decodeCtx = null

function getDecodeContext() {
  if (!decodeCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) throw new Error(t('domain.error.noWebAudio'))
    decodeCtx = new Ctx()
  }
  return decodeCtx
}

export async function decodeAudioBlob(blob) {
  const ctx = getDecodeContext()
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer())
  } catch {
    try {
      return await ctx.decodeAudioData(await blob.arrayBuffer())
    } catch {
      throw new Error(t('domain.error.audioDecodeFailed'))
    }
  }
}

export function computePeaks(audioBuffer, perSecond = PEAKS_PER_SECOND) {
  const chCount = audioBuffer.numberOfChannels
  const len = audioBuffer.length
  const rate = audioBuffer.sampleRate
  const step = Math.max(1, Math.round(rate / perSecond))
  const buckets = Math.max(1, Math.ceil(len / step))
  const out = new Float32Array(buckets * 2)
  const channels = []
  for (let c = 0; c < chCount; c++) channels.push(audioBuffer.getChannelData(c))
  let max = 1e-6
  for (let b = 0; b < buckets; b++) {
    const start = b * step
    const end = Math.min(len, start + step)
    let mn = 1
    let mx = -1
    for (let c = 0; c < channels.length; c++) {
      const data = channels[c]
      for (let i = start; i < end; i++) {
        const v = data[i]
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
    }
    if (mn > mx) {
      mn = 0
      mx = 0
    }
    out[b * 2] = mn
    out[b * 2 + 1] = mx
    const a = Math.max(Math.abs(mn), Math.abs(mx))
    if (a > max) max = a
  }
  if (max > 0 && max < 0.98) {
    const k = 1 / max
    for (let i = 0; i < out.length; i++) out[i] *= k
  }
  return { peaks: out, perSecond: rate / step, duration: len / rate }
}

export async function peaksFromBlob(blob, perSecond = PEAKS_PER_SECOND) {
  const audioBuffer = await decodeAudioBlob(blob)
  const res = computePeaks(audioBuffer, perSecond)
  return { ...res, sampleRate: audioBuffer.sampleRate, channels: audioBuffer.numberOfChannels }
}

export function encodeWav(audioBuffer) {
  const ch = audioBuffer.numberOfChannels
  const len = audioBuffer.length
  const rate = audioBuffer.sampleRate
  const bytes = 44 + len * ch * 2
  const view = new DataView(new ArrayBuffer(bytes))
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, bytes - 8, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, ch, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * ch * 2, true)
  view.setUint16(32, ch * 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, len * ch * 2, true)
  let off = 44
  const chans = []
  for (let c = 0; c < ch; c++) chans.push(audioBuffer.getChannelData(c))
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]))
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}
