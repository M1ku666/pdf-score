import { t } from './index.js'

export function segmentLabel(seg) {
  const tempo = t('score.segmentTempo', {
    bpm: Math.round(seg?.bpm || 120),
    beats: seg?.beatsPerBar || 4,
    unit: seg?.beatUnit || 4,
  })
  const name = String(seg?.name || '').trim()
  if (!name) return tempo
  return t('score.segmentLabel', { name, tempo })
}
