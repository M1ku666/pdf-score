/**
 * 极简 Markdown → **节点树**：只服务「操作说明」那一份 md（`src/assets/manual.md`）。
 *
 * **为什么手写、不引解析库**：全站要渲染的 md 只有我们自己的说明文档，用到的语法就是标题 / 段落 /
 * 列表 / 代码 / 引用 / 分隔线 / 链接；为这几样多背一个解析库不划算，而且这套子集小到能一眼看完。
 *
 * **为什么给节点树、不给 HTML 字符串**：正文里的链接前面要贴一颗 `SquareArrowOutUpRight`，
 * 而它必须是 `@lucide/vue` 的**组件**（图标只能用组件、仓库里不放本地 svg、描边由根组件
 * `setLucideProps` 一处给，见 `docs/ui.md` §15 / §16.1）—— 组件塞不进 HTML 字符串。
 * 所以本模块只负责「认出结构」，画交给 `ManualSheet.vue` 与 `MarkdownLine.vue` 的模板；
 * 顺带也就没有 `v-html`、没有转义这件事（文本原样交给 Vue，由它自己转义）。
 *
 * **支持的语法**（子集之外的写法不会被当成别的块，会原样落在段落文字里）：
 *   · ATX 标题 `#` ~ `######`（`#` 与文字之间要有空格）；
 *   · 段落（连续几行拼成一段，行间用一个空格接起来）；
 *   · 无序列表 `- ` / `* ` / `+ `、有序列表 `1. ` —— **不嵌套**，行首缩进直接忽略；
 *   · 围栏代码块（三个反引号）、引用块 `> `、分隔线 `---` / `***` / `___`；
 *   · 行内只有 `` `代码` ``、`**粗体**`、`*斜体*`、`[文字](地址)`、`「文案key」`。
 *   **没有表格 / 图片 / 原始 HTML**（md 里的 `<` `>` `&` 就是普通文字）。
 *   **链接只认 `http://` / `https://`**：别的写法（相对路径、其它协议）不当链接，原样留在正文里 ——
 *   一个写错的地址宁可看起来「没生效」，也不要变成一个点不动或者不该点的链接。
 *
 * **「key」= 直接引用语言包里那条文案**（`src/i18n/*.yaml` 的 key，如 `「common.confirm」` → `「确定」`）：
 *   · 界面上已有的说法不在说明里另抄一份 —— 改文案只改 yaml，说明跟着变；
 *   · **角括号保留**：只换括号里那个 key，括号本身照旧画出来（作者不用自己再套一层引号）；
 *   · key 认**只有点号分层的 ASCII**（`toolbar.audioPanel.offsetTitle` 这种），
 *     所以正文里那些普通引号（「抓手 / 指针」「设置」）根本不会被当成 key，照旧是引号；
 *   · **没这个 key 就整串原样画出来** —— 作者一眼看得出没解析成功，也不会静默丢字；
 *   · **只替换一层、不带参数**：换进来的文字不再被当成标记解析（写 `**` 也只是两个星号），
 *     文案里带 `{名字}` 占位符的那种（如 `common.version`）在这里没人给它参数，占位符会原样留着 ——
 *     要带参数的文案别在说明里引用。
 *
 * **产物**（调用方要的三样东西，见 `ManualSheet.vue`）：
 *   · `title` —— **第一个一级标题**的文字（也就是 md 第一行那个），sheet 标题栏拿它当标题；
 *     它**不在正文里重复画一遍**；
 *   · `toc` —— **只有二级标题**，一项 `{ id, text }`（`text` 已去掉行内标记）；
 *   · `blocks` —— 正文的块数组，每个标题带 `id`（`md-h-<n>`，n = 标题在全文里的出现序号，
 *     目录就是拿这个 id 找到元素、再把 sheet 的滚动区滚过去）。
 *
 * 块（`blocks` 里的每一项）：
 *   `{ type: 'heading', level, id, spans }`、`{ type: 'p', spans }`、
 *   `{ type: 'list', ordered, items: [spans, …] }`、`{ type: 'code', text }`、
 *   `{ type: 'quote', spans }`、`{ type: 'hr' }`
 * 行内（`spans` 里的每一项）：`{ t: 'text', v, b, i }`（b / i = 粗体 / 斜体）、
 *   `{ t: 'code', v }`、`{ t: 'link', v, href }`（`v` = 链接文字）
 *
 * 纯逻辑、无 DOM 依赖（`scripts/unit-test.mjs` 直接跑）。
 * 引 `../i18n/index.js` 是为了「key」那种引用（那是 `docs/code.md` §2 允许 `domain/*` 引的唯一带 Vue 的模块）。
 */
import { has, t } from '../i18n/index.js'

/** `# 标题`：`#` 与文字之间要有空格（`#标题` 不算，与 CommonMark 一致） */
const HEADING = /^(#{1,6})\s+(.*?)\s*$/
const ULIST = /^[-*+]\s+(.*)$/
const OLIST = /^\d+[.)]\s+(.*)$/
/** 分隔线只有「同一字符连写三个以上」（`- - -` 这种带空格的写法不认） */
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/
const FENCE = /^```/
const QUOTE = /^>\s?/
/** 链接：`[文字](地址)`；地址里不许有空格或右括号 */
const LINK = /^\[([^\]]*)\]\(([^)\s]+)\)/
/** 只有 http(s) 才算链接（别的写法原样留在正文里，见文件头注释） */
const LINK_HREF = /^https?:\/\//i
/** `「key」`：角括号里是语言包的 key（点号分层的纯 ASCII，如 `toolbar.audioPanel.offsetTitle`） */
const KEY = /^「([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)」/

/**
 * 行内解析：把一行文字切成 spans。
 *
 * 用一个指针边走边认，而不是几条正则替换 —— 代码段要先摘出来（里面的 `*`、`[x](y)`、`{key}` 都不是标记），
 * 粗体 / 斜体是**成对翻转的开关**：只有一边写 `**` 时，那对标记**原样画出来**（写错了得让人看得见，
 * 与 CommonMark「没配上的分隔符就是普通字符」一致），不会把后面整段悄悄变成粗体。
 */
function parseSpans(text) {
  const spans = []
  let buf = ''
  let bold = false
  let italic = false
  let at = 0

  const flush = () => {
    if (!buf) return
    spans.push({ t: 'text', v: buf, b: bold, i: italic })
    buf = ''
  }

  while (at < text.length) {
    const ch = text[at]
    if (ch === '`') {
      const end = text.indexOf('`', at + 1)
      // 空的 `` 不算代码段（`end === at + 1`）：那种写法多半是笔误，当普通反引号画出来更明显
      if (end > at + 1) {
        flush()
        spans.push({ t: 'code', v: text.slice(at + 1, end) })
        at = end + 1
        continue
      }
    } else if (ch === '[') {
      const m = LINK.exec(text.slice(at))
      if (m && LINK_HREF.test(m[2])) {
        flush()
        spans.push({ t: 'link', v: m[1], href: m[2] })
        at += m[0].length
        continue
      }
    } else if (ch === '「') {
      const m = KEY.exec(text.slice(at))
      if (m) {
        if (has(m[1])) {
          flush()
          // **角括号保留**：只换括号里那个 key（`「library.import」` → `「导入文件」`）。
          // 外面套着的粗体 / 斜体照旧生效；换进来的文字**不再当标记解析**（只替换一层）。
          spans.push({ t: 'text', v: `「${t(m[1])}」`, b: bold, i: italic })
        } else {
          buf += m[0] // 没这个 key：整串（连角括号）原样留在正文里
        }
        at += m[0].length
        continue
      }
    } else if (ch === '*') {
      // 收尾无条件认（开着就一定能关）；开场要求后面真有一对，否则这一对标记原样留在文字里
      const pair = text[at + 1] === '*'
      if (pair && (bold || text.indexOf('**', at + 2) >= 0)) {
        flush()
        bold = !bold
        at += 2
        continue
      }
      if (!pair && (italic || text.indexOf('*', at + 1) >= 0)) {
        flush()
        italic = !italic
        at += 1
        continue
      }
    }
    buf += ch
    at += 1
  }

  flush()
  return spans
}

/** 一串 spans 的纯文字（标题那行字、目录那一行、`title` 都用它） */
function plainText(spans) {
  return spans.map((s) => s.v).join('').trim()
}

/** 这一行是不是「另一种块」的开头 —— 段落读到它就该停，交给外层那一轮去处理 */
function isBlockStart(line) {
  return HEADING.test(line) || HR.test(line) || FENCE.test(line) || QUOTE.test(line) || ULIST.test(line) || OLIST.test(line)
}

/**
 * 把 md 源码解析成 `{ title, toc, blocks }`（见文件头注释）。
 * 传空 / 非字符串时给一份空壳（`title` 空串、没有任何目录项与正文），调用方不用先判空。
 */
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  const toc = []
  let title = ''
  let seq = 0
  /** 现在开着的是哪种列表（`''` = 没开）。列表**不嵌套**，所以一个变量就够 */
  let list = ''
  let i = 0

  /** 换到别的块 / 收尾时，把开着的列表收掉 */
  const closeList = () => {
    if (!list) return
    list = ''
  }

  while (i < lines.length) {
    const line = lines[i]

    // 围栏代码块：整段原样搬进 code 块，里面的 md 标记一概不解
    if (FENCE.test(line)) {
      closeList()
      const body = []
      i++
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++])
      i++ // 收尾那个围栏（漏写了就吃到文件末尾）
      blocks.push({ type: 'code', text: body.join('\n') })
      continue
    }

    if (!line.trim()) {
      closeList()
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      const spans = parseSpans(heading[2])
      // 序号按「所有标题」排（跳过的那个一级标题也占一个号），同一个 md 里 id 因此恒定
      const id = `md-h-${++seq}`
      if (level === 1 && !title) {
        title = plainText(spans) // 第一个一级标题 = sheet 的标题，正文不再画
      } else {
        if (level === 2) toc.push({ id, text: plainText(spans) })
        blocks.push({ type: 'heading', level, id, spans })
      }
      i++
      continue
    }

    if (HR.test(line)) {
      closeList()
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // 引用块：连着几行 `> ` 合成一段
    if (QUOTE.test(line)) {
      closeList()
      const body = []
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''))
      blocks.push({ type: 'quote', spans: parseSpans(body.join(' ')) })
      continue
    }

    const ul = ULIST.exec(line)
    const ol = OLIST.exec(line)
    if (ul || ol) {
      const ordered = !ul
      if (list !== (ordered ? 'ol' : 'ul')) {
        // 换一种列表（或从别的块过来）：先收掉上一种，再开新的
        closeList()
        list = ordered ? 'ol' : 'ul'
        blocks.push({ type: 'list', ordered, items: [] })
      }
      // 追加到刚刚开出来的那个列表块上
      blocks[blocks.length - 1].items.push(parseSpans((ul || ol)[1]))
      i++
      continue
    }

    // 段落：连着几行都不是「别的块的开头」就拼成一段
    closeList()
    const para = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++])
    blocks.push({ type: 'p', spans: parseSpans(para.join(' ')) })
  }

  closeList()
  return { title, toc, blocks }
}
