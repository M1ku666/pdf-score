/**
 * 谱面文字的公共拼法
 *
 * **只放「同一个意思在多处显示、必须永远一致」的句子** —— 现在只有段落名牌那一句。
 * 放在 `src/i18n/` 而不是 `src/domain/`：domain 层**不引 i18n**（见 `docs/code.md` §2），
 * 而这里两个模板都要 `t()`，所以它属于「文案」这一层。
 *
 * 用在两处：谱面上的段落名牌（`ScorePage.vue`）与标记列表的子项（`MarksPanel.vue`，
 * 经 `buildMarkTree` 的 `texts.segment` 传下去）——
 * **两处必须走这一个函数**，否则列表与谱面会各说各话。
 */
import { t } from './index.js'

/**
 * 段落显示成一句什么：**名字 + 速度拍号**（用户拍板：名牌上两样都要有）。
 *   · 有名字 → 「A 段 120 4/4」
 *   · 没名字 → 「120 4/4」（不留前导分隔符，所以两个模板要分开拼）
 * BPM 取整（120.4 显示成 120），拍号缺省 4/4 —— 与谱面那条名牌的估算宽度算法无关，
 * 这里只出文字。
 */
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
