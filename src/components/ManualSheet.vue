<script setup>
/**
 * 操作说明面板：把 `src/assets/manual.md` 渲染成文档，并在同一个抽屉里给一份目录。
 *
 * **入口**：设置面板 footer 那颗「查看操作说明」（`BookText`），开合状态是页面那一层的 `manualOpen`
 * （`PlayerView` 挂在 `LibrarySettings` 的 `open-manual` 上），面板本体是 `AppSheet` +
 * `follow-layout` + `panel-key="manual"` —— 与其他面板一样是**底部抽屉**、一次只有一个。
 *
 * **md 是一份随包打进来的文件**（`?raw`，解析在 `domain/markdown.js`，纯逻辑、有单测）：
 *  · 标题栏的标题 = **md 第一行那个一级标题**（`doc.title`），图标恒为 `BookOpenText`
 *    （`icon` 传的是图标组件本身，见 `docs/ui.md` §16.1）；一级标题**不在正文里重复画**；
 *  · 目录**只有二级标题**（`## `），点一项就切回文档并滚到那一段；
 *  · 正文是**节点树**、不是 HTML 字符串：块级元素（标题 / 段落 / 列表 / 代码块 / 引用 / 分隔线）
 *    由本组件的模板画，行内内容（文字 / 粗体 / 斜体 / 行内代码 / **链接**）交给 `MarkdownLine.vue` ——
 *    链接前那颗图标必须是 `@lucide/vue` 的组件，塞不进 HTML 字符串，所以没有 `v-html`。
 *    本文件里的样式因此也**不需要 `:deep()`**：块级元素就是本模板建出来的，带得到 scope id。
 *  ⚠️ 它**不过语言包**（`src/i18n/*.yaml` 里没有这篇正文）：正文是随包发布的内容、不是界面文案，
 *  要加语言时按 `locale` 换一份 md 文件（`docs/code.md` §2 那条「文案只有一个家」说的是界面文案）。
 *  **正文里要提界面上已有的说法，写 `「key」`**（如 `「library.import」` → 「导入文件」）——
 *  同一句话不在 yaml 与说明里各存一份；`doc` 因此是 `computed`，切语言时整篇跟着换。
 *
 * **两屏 + footer 一颗按钮**（footer 是动作按钮唯一的位置，见 `docs/ui.md` §13 / §18.61 第 168 条）：
 *  · **打开时默认停在目录屏**（先看有哪几节，再挑一节进去；关掉时复位，下次打开还是目录）；
 *  · 目录屏 → 「返回文档」(`ChevronLeft`，与音频面板那颗「返回音频设置」同一档)；
 *  · 文档屏 → 「查看目录」(`TableOfContents`)。
 *  两颗都是**中性实心底 `.btn` + 18px 图标**，抽屉里 footer 是纵向的，所以各占一整行。
 *  切屏是**本组件自己的显示开关**（不换 `panel-key`、不新开第二个抽屉）。
 *
 * **滚到某一段靠不算魔法数字的一步**：滚动容器是 `AppSheet` 的 `.sheet-body`，也就是本组件
 * 根元素的 `parentElement`（Teleport 进抽屉后槽内容就挂在它下面）。落点按「这个标题出现在滚动区
 * 内容顶端」算 —— 读容器自己的 `padding-top`，不写死像素，也只改这一个容器的 `scrollTop`
 * （不用 `scrollIntoView`：那会连带滚动祖先）。
 *
 * **版本号不在这里**：它跟在设置面板 footer 那颗按钮下面（`LibrarySettings`），
 * 与这份说明无关 —— 说明面板的 footer 只有切目录那一颗。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { BookOpenText, ChevronLeft, TableOfContents } from '@lucide/vue'
import AppSheet from './AppSheet.vue'
import MarkdownLine from './MarkdownLine.vue'
import { renderMarkdown } from '../domain/markdown.js'
import manualSource from '../assets/manual.md?raw'
import { t } from '../i18n/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

/**
 * 正文、目录与标题都从这一处出来。**是 computed、不是常量**：md 里的「key」引用语言包
 * （`domain/markdown.js` 的 `「key」` 写法），`t()` 读的是 `locale` 那个 ref —— 放进 computed 里，
 * 切语言时标题、目录与正文一起跟着换。
 */
const doc = computed(() => renderMarkdown(manualSource))

/** 现在看的是目录那一屏吗（false = 文档）。**默认停在目录**：进来先看有哪几节 */
const tocOpen = ref(true)
/** 本组件的根元素：它的 `parentElement` 就是 `AppSheet` 的滚动区 `.sheet-body` */
const rootEl = ref(null)
/** 去目录之前文档停在哪儿 —— 从目录返回时按原处接着看，不把人甩回开头 */
let docScroll = 0

/** 滚动容器（`AppSheet` 的 `.sheet-body`）：槽内容直接挂在它下面，所以是根元素的父节点 */
function scrollBox() {
  return rootEl.value?.parentElement ?? null
}

/** 把正文滚到某个标题（`id` 是 `domain/markdown.js` 给的 `md-h-<n>`） */
async function scrollToHeading(id) {
  await nextTick()
  const root = rootEl.value
  const box = scrollBox()
  const target = root?.querySelector(`#${id}`)
  if (!box || !target) return
  const pad = parseFloat(getComputedStyle(box).paddingTop) || 0
  box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - pad
}

/** 去目录：记住文档停在哪儿，目录从头上看起 */
async function showToc() {
  docScroll = scrollBox()?.scrollTop ?? 0
  tocOpen.value = true
  await nextTick()
  const box = scrollBox()
  if (box) box.scrollTop = 0
}

/** 返回文档：回到去目录之前那一处 */
async function backToDoc() {
  tocOpen.value = false
  await nextTick()
  const box = scrollBox()
  if (box) box.scrollTop = docScroll
}

/** 点一条目录 = 切回文档 + 滚到那一段 */
function openSection(id) {
  tocOpen.value = false
  void scrollToHeading(id)
}

/**
 * **每次进入面板都从目录看起**：两屏的开关与文档的阅读位置一起归零。
 *
 * 复位写在**「打开」这一侧**、而且带 `immediate`，是为了不依赖「上一次有没有正常走到关闭」——
 * 抽屉互斥（被另一个面板顶掉）、组件卸载这几条路都可能在没跑过关闭分支的情况下再进来一次，
 * 而 `tocOpen` / `docScroll` 是本组件的状态（抽屉的 DOM 反倒每次都会重建）。
 * 写在打开这一侧还顺带没有副作用：退场过渡期间内容照旧，不会在收起来的那一刻闪一下另一屏。
 */
watch(
  () => props.open,
  (open) => {
    if (!open) return
    tocOpen.value = true
    docScroll = 0
  },
  { immediate: true }
)
</script>

<template>
  <AppSheet
    :open="open"
    :title="doc.title || t('manual.title')"
    :icon="BookOpenText"
    position="bottom"
    follow-layout
    panel-key="manual"
    @close="emit('close')"
  >
    <!-- 根元素常驻（两屏共用）：`scrollBox()` 靠它拿滚动区，切屏时不能跟着换节点 -->
    <div ref="rootEl" class="manual">
      <!-- 文档屏：块级元素在这里画，行内交给 `MarkdownLine`（它的头部注释解释了为什么不用 v-html） -->
      <div v-if="!tocOpen" class="md-body">
        <template v-for="(b, i) in doc.blocks" :key="i">
          <!-- 标题层级是数据，所以用动态标签；`id` 就是目录要滚过去的那个锚点 -->
          <component :is="`h${b.level}`" v-if="b.type === 'heading'" :id="b.id">
            <MarkdownLine :spans="b.spans" />
          </component>
          <p v-else-if="b.type === 'p'"><MarkdownLine :spans="b.spans" /></p>
          <ul v-else-if="b.type === 'list' && !b.ordered" class="md-list">
            <li v-for="(item, j) in b.items" :key="j"><MarkdownLine :spans="item" /></li>
          </ul>
          <ol v-else-if="b.type === 'list'" class="md-list">
            <li v-for="(item, j) in b.items" :key="j"><MarkdownLine :spans="item" /></li>
          </ol>
          <pre v-else-if="b.type === 'code'" class="md-code"><code>{{ b.text }}</code></pre>
          <blockquote v-else-if="b.type === 'quote'" class="md-quote">
            <p><MarkdownLine :spans="b.spans" /></p>
          </blockquote>
          <hr v-else-if="b.type === 'hr'" class="md-rule" />
        </template>
      </div>

      <!-- 目录屏：只有二级标题，一行一个按钮（可点元素 ≥ `--tap`） -->
      <ul v-else-if="doc.toc.length" class="toc">
        <li v-for="item in doc.toc" :key="item.id">
          <button type="button" class="toc-item" @click="openSection(item.id)">{{ item.text }}</button>
        </li>
      </ul>

      <!-- 兜底：md 里一个二级标题都没有（正常不会走到） -->
      <div v-else class="empty">
        <TableOfContents :size="30" />
        <p>{{ t('manual.noToc') }}</p>
      </div>
    </div>

    <template #footer>
      <button v-if="tocOpen" type="button" class="btn" @click="backToDoc">
        <ChevronLeft :size="18" /> {{ t('manual.backToDoc') }}
      </button>
      <button v-else type="button" class="btn" @click="showToc">
        <TableOfContents :size="18" /> {{ t('manual.toc') }}
      </button>
    </template>
  </AppSheet>
</template>

<style scoped>
/* 正文的字号 / 行距与「备份」面板里的说明同一档；颜色走三级文字令牌 */
.manual {
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--text-soft);
}

/* ------------------------------- 文档 ------------------------------- */
/* 块级元素的样式（标题 / 段落 / 列表 / 代码块 / 引用 / 分隔线）。
   **行内的那几个（粗体 / 斜体 / 行内代码 / 链接）在 `MarkdownLine.vue` 里**，别在这儿再写一份。
   这些元素都是本组件的模板建出来的，带得到 scope id —— 所以不需要 `:deep()`。 */
.md-body h1,
.md-body h2,
.md-body h3,
.md-body h4,
.md-body h5,
.md-body h6 {
  margin: 24px 0 8px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-strong);
}
/* 正文最上面那一块不留上间距（md 里若没有引言段落，第一个标题就直接顶在滚动区开头） */
.md-body > :first-child {
  margin-top: 0;
}
.md-body p {
  margin: 0 0 10px;
}
.md-body .md-list {
  margin: 0 0 10px;
  padding-left: 20px;
}
.md-body .md-list li {
  margin: 0 0 6px;
}
.md-body .md-code {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  overflow-x: auto;
}
/* 代码块里的 `<code>` 不要 `MarkdownLine` 里那层药丸底（这里是块，不是行内标识符） */
.md-body .md-code code {
  padding: 0;
  border-radius: 0;
  background: none;
}
.md-body .md-quote {
  margin: 0 0 10px;
  padding: 2px 0 2px 12px;
  border-left: 2px solid var(--stroke-strong);
  color: var(--text-muted);
}
.md-body .md-quote p {
  margin: 0;
}
/* 分隔线用 `--stroke-strong`：浮层面是近白色，`--stroke-soft` 压在上面看不见（见 main.css 的 `.divider`） */
.md-body .md-rule {
  height: 1px;
  margin: 16px 0;
  border: 0;
  background: var(--stroke-strong);
}

/* ------------------------------- 目录 ------------------------------- */
.toc {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.toc-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--tap);
  padding: 0 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-strong);
  font-size: 14.5px;
  text-align: left;
}
/* 悬停写在按下前面（否则按下时会被 hover 盖住，见 docs/ui.md §10） */
@media (hover: hover) {
  .toc-item:hover {
    background: var(--surface-hover);
  }
}
.toc-item:active {
  background: var(--surface-active);
  transform: scale(0.98);
}
</style>
