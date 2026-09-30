<script setup>
/**
 * Markdown 的「一行行内内容」渲染器：吃 `domain/markdown.js` 解出来的 `spans`，画成
 * 文字 / **粗体** / *斜体* / `代码` / 链接。文档的标题、段落、列表项、引用都走它 ——
 * **行内标记只有这一份实现**，别在别处再写一套。
 *
 * **为什么正文不是一段 HTML 字符串**：链接前那颗图标必须是 `@lucide/vue` 的**组件**
 * （图标只能用组件、仓库里不放本地 svg、描边由根组件 `setLucideProps` 一处给，
 * 见 `docs/ui.md` §15 / §16.1），而组件塞不进 HTML 字符串 —— 所以 md 那侧只解析结构、
 * 画全在模板里（顺带没有 `v-html`，文本由 Vue 自己转义）。
 *
 * **链接**：只有 `http(s)://` 的地址才会被解析成链接（`domain/markdown.js` 那一侧就把关，
 * 别的写法原样留在正文里）；这里一律 `target="_blank"` + `rel="noreferrer"`，
 * 前面贴一颗 **`SquareArrowOutUpRight`（14px）** —— 它同时说明「这是往外走的」。
 * 注意图标外面那层 `span` 必须是 `inline-flex`：`main.css` 里 `svg.lucide { display: block }`
 * 是给 flex 容器里的图标用的，直接放进行内文字里会把这一行拆断。
 *
 * **交互态**（`docs/ui.md` §5 / §10）：悬停 = 加下划线 + 字色 `--accent-strong`，
 * 按下 = 再叠一层 `filter: brightness(0.85)`。两者都不改尺寸与布局；链接没有底色可加深，
 * 所以按下这一档的重量落在字色上（与带按钮那条 toast 里那颗按钮同一个道理）。
 */
import { SquareArrowOutUpRight } from '@lucide/vue'

defineProps({
  /** `domain/markdown.js` 的行内节点数组：`{ t: 'text', v, b, i }` / `{ t: 'code', v }` / `{ t: 'link', v, href }` */
  spans: { type: Array, default: () => [] },
})
</script>

<template>
  <!-- 平铺的 spans：粗体 / 斜体是 text 节点上的两个标志，所以只有「又粗又斜」才需要套两层 -->
  <template v-for="(s, i) in spans" :key="i">
    <a v-if="s.t === 'link'" class="md-link" :href="s.href" target="_blank" rel="noreferrer">
      <span class="md-link-icon"><SquareArrowOutUpRight :size="14" /></span>{{ s.v }}
    </a>
    <code v-else-if="s.t === 'code'">{{ s.v }}</code>
    <strong v-else-if="s.b && s.i"><em>{{ s.v }}</em></strong>
    <strong v-else-if="s.b">{{ s.v }}</strong>
    <em v-else-if="s.i">{{ s.v }}</em>
    <template v-else>{{ s.v }}</template>
  </template>
</template>

<style scoped>
/* 行内代码：`score.json` 这种标识符，走控件面 + 药丸圆角（与 `.chip` 同一档圆角） */
code {
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--surface-control);
  color: var(--text-strong);
  font-size: 12.5px;
}
strong {
  font-weight: 600;
  color: var(--text-strong);
}

/* 链接前那颗图标：`inline-flex` 是为了装住 main.css 里 `display: block` 的 `.lucide`，
   `vertical-align: middle` 让它在 13.5px 的文字里与字面居中（行内元素，不撑高行距）。 */
.md-link-icon {
  display: inline-flex;
  margin-right: 4px;
  vertical-align: middle;
}
/* 悬停：加下划线 + 字色提一档（下划线不改变布局，只是把「这是链接」再说一遍） */
@media (hover: hover) {
  .md-link:hover {
    color: var(--accent-strong);
    text-decoration: underline;
  }
}
/* 按下：比悬停更重一档，落在字色上（链接没有底色可以加深） */
.md-link:active {
  filter: brightness(0.85);
}
</style>
