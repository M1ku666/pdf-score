<script setup>
/**
 * 通用浮层。
 *
 * **投递方式只有一处决定**：能弹成「抽屉」的面板（`followLayout` + 唯一的 `panelKey`）
 * Teleport 到 `#sheet-slot`（页面里那个**底部抽屉**的盒子）；其余的（`center` 确认弹窗）
 * 自己作为普通浮层弹出（底部抽屉 / 居中弹窗 + 遮罩）。
 *
 * **抽屉是互斥的**：开着就 `openDrawer(panelKey)` —— 有新的要出来时它会**替旧面板把 `open` 置 false**，
 * 于是旧的那个走自己的退场过渡（落回底部、并压暗），新的从下面升上来。所以永远只有一个抽屉，
 * 这里也不需要「栈」。
 *
 * **抽屉的盒子由页面给**（`#sheet-slot` 的定位与尺寸随横竖屏变：横屏与侧栏同宽同列、竖屏整幅宽 ≤620），
 * 组件只管铺满那个盒子 —— 所以**换朝向不需要动面板的任何状态**，也没有两套宿主。
 *
 * 用法：要弹成抽屉的面板传 `follow-layout` + 唯一的 `panel-key`；
 * `center` 的确认类弹窗（如删除乐谱）**不要**传 followLayout，它始终居中。
 *
 * **标题行由本组件渲染**：`<component :is="icon" v-if="icon" /> + <h2>{{ title }}</h2>` + 右侧关闭圆钮。
 * 要配图标就传 `icon`（**`@lucide/vue` 的图标组件本身**，取值见 `docs/ui.md` §18.59 第 166 条），
 * **不要自己写标题行**。
 *
 * **footer = 动作按钮唯一的位置**（`docs/ui.md` §13 / §18.61）：`#footer` 槽排在滚动区**之外**、贴着面板底边，
 * 所以放进去的按钮**不跟着内容滚**。两种形态的排布**不一样**：
 *  · **抽屉**（本组件加了 `drawer-box`）：**纵向**，一行一个、各占满整行 —— 抽屉最窄时就是整幅宽的手机屏，
 *    并排两颗各剩不到半行（所以 `.drawer-box .sheet-foot` 是 `flex-direction: column`，
 *    按钮靠拉伸撑满宽度即可，**别加 `.block`**）；
 *  · **`center` 确认弹窗**：仍是**并排**两颗（取消 + 删除），那条 `flex: 1` 只挂给 `.sheet-panel.center`。
 * 没有动作可做时**连 footer 都不给**（调用方用 `v-if` 管住整个 `#footer` 模板），免得留一条空边框。
 *
 * ⚠️ **这里没有 `header` 插槽，是故意的**：`.sheet-head h2` 这条样式带的是**本组件的 scope id**，
 * 而 Vue 的 scoped CSS **管不到父组件塞进插槽的内容** —— 调用方自己写一个 `<h2>`，它带的是
 * **调用方的** scope id，这条样式一个字都落不上去：字号从 16 掉回 `1.5em`(24)、`font-weight: 600`
 * 没了，**`flex: 1` 也没了**（于是关闭钮不再被顶到右边，紧贴着标题）。
 * 所以标题行必须留在本组件里渲染。要加别的头部内容时，先想清楚这一点再动。
 *
 * **手机端的返回手势先关它**（规则与落点顺序见 `docs/ui.md` §13）：
 * 开着就 `pushBackLayer(close, …)` 登记一层、关掉就注销 —— `dismiss` 走本组件自己的 `close()`，
 * 于是返回手势与点遮罩 / 右上角 × / Esc 是**同一条收尾**，没有第二套关闭逻辑。
 *
 * **`Teleport` 上的 `defer` 不能删**（2026-09-27 修的就是这条）：
 * `#sheet-slot` 就长在**本组件所属的那个页面里**（`PlayerView`），而 Vue 挂载是「先把整棵子树建完、
 * 最后才把根元素 insert 进 document」—— 于是首帧挂载时 `document.querySelector('#sheet-slot')`
 * **必然找不到**（Teleport 只在**挂载那一刻**解析目标，找不到就整块内容都不挂，只留个警告）。
 * 后果不是「晚一点出来」而是**永远出不来**：之后 `open` 变 true 时没有目标可进，更新还会把子节点
 * patch 到 null 容器上抛 `Cannot read properties of null`，表现就是「点设置 / 段落 / 反复没反应」。
 * 开 `defer` 后 Vue 把目标解析推迟到本次渲染结束（那时整棵树已经进了 document）。
 * **有谱之后才挂载的面板（底栏的「音频」「倍速」在 `v-if="hasScore"` 里）不受影响** ——
 * 所以这个坑当年只在「设置 / 信息 / 标签 / 跳转 / 段落 / 反复」这几个**首帧就挂**的面板上露出来。
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { X } from '@lucide/vue'
import { closeDrawer, layout, openDrawer, popBackLayer, pushBackLayer, registerPanel, unregisterPanel } from '../store/ui.js'
import { t } from '../i18n/index.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  /** 标题行左边的图标（**`@lucide/vue` 的组件本身**，不传 = 不画图标）。**必须由本组件渲染**，理由见文件头注释
      ⚠️ 类型要写 `[Object, Function]`：Lucide 的图标是**函数组件**，只写 `Object` 会在 DEV 下报
      「Expected Object, got Function」（每个带图标的面板都会刷一条）。 */
  icon: { type: [Object, Function], default: null },
  position: { type: String, default: 'bottom' }, // bottom | center
  compact: { type: Boolean, default: false },
  /** 播放器里的面板：允许被托管进乐谱库宿主 */
  followLayout: { type: Boolean, default: false },
  /** 托管时的身份，宿主靠它决定该显示谁（同一时刻只有一个） */
  panelKey: { type: String, default: '' },
})

const emit = defineEmits(['close'])

/** 该弹进哪个槽（'' = 自己作为普通浮层弹出） */
const hostId = computed(() => (props.followLayout && props.panelKey ? 'sheet-slot' : ''))
/** 抽屉互斥：只有「现在轮到我」的那个才显示 */
const current = computed(() => !!hostId.value && layout.panel === props.panelKey)
/** 真正要渲染的内容：普通浮层看 open，抽屉看「open 且轮到我」 */
const shown = computed(() => (hostId.value ? props.open && current.value : props.open))
/** 过渡名只看 props、不看 `shown`：退场时 `shown` 已经是 false，按它取名会临时换成另一套动画 */
const transitionName = computed(() => (hostId.value ? 'drawer' : 'sheet'))

function close() {
  emit('close')
}

/**
 * 要弹成抽屉的面板：开着就 `openDrawer`（**它会替上一个面板把 `open` 置 false**，所以抽屉永远只有一个），
 * 关掉就 `closeDrawer`（只有自己确实是当前那个才清）。
 * 同时登记自己的 close，好让「从外面关掉抽屉」（点遮罩）能走面板自己的收尾。
 */
watch(
  () => props.open,
  (open) => {
    if (!props.followLayout || !props.panelKey) return
    if (open) {
      openDrawer(props.panelKey)
      registerPanel(props.panelKey, close)
    } else {
      closeDrawer(props.panelKey)
      unregisterPanel(props.panelKey)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  closeDrawer(props.panelKey)
  unregisterPanel(props.panelKey)
})

/**
 * 手机端的返回手势（见 `store/ui.js` 的「返回手势」一段）：**开着的时候返回手势先关它**。
 *
 *  · **抽屉**：一层就够（抽屉本来就互斥，一次只有一个），但**被新抽屉顶掉的那个还开着过渡**
 *    （`open` 已被置 false，`shown` 已经不为真）—— 它自己的 watch 会去注销，所以这里用
 *    `panelKey` 当 id 去重，同一个面板重开不会压两层。
 *  · **`center` 确认弹窗**（不传 `followLayout`）：也吃一层，但它不参与抽屉那张表，id 用空串
 *    （同一个组件实例同时只会有一个 `open`）。
 *
 * `dismiss` 走的是本组件自己的 `close()` —— 和点遮罩 / 右上角 × / Esc **同一条收尾**，
 * 所以返回手势只是「又一个关闭入口」，不是第二套关闭逻辑。
 */
let popBack = null

function syncBackLayer(open) {
  if (open && !popBack) popBack = pushBackLayer(close, hostId.value ? props.panelKey : '')
  else if (!open && popBack) {
    popBack()
    popBack = null
  }
}

watch(() => props.open, syncBackLayer, { immediate: true })

onBeforeUnmount(() => {
  popBack?.()
  popBack = null
})

function onKey(e) {
  if (e.key !== 'Escape' || !props.open) return
  // 抽屉互斥：只有当前那个响应 Esc —— 被新抽屉顶掉的那个已经是过去式了
  if (hostId.value && !current.value) return
  close()
}

watch(
  () => props.open,
  (v) => {
    if (v) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- `defer` 见文件头部注释：槽长在宿主页面里，首帧挂载时它还没进 document，不推迟就永远解析不到 -->
  <Teleport :to="hostId ? `#${hostId}` : 'body'" defer>
    <Transition :name="transitionName">
      <div v-if="shown" :class="hostId ? 'drawer-host' : ['sheet-root', position]">
        <div v-if="!hostId" class="scrim" @click="close"></div>
        <section class="sheet-panel" :class="hostId ? 'drawer-box' : [position, { compact }]">
          <!-- 头部永远在：被托管时这个头部就是面板自己的标题栏（宿主的头部已经让位了）。
               ⚠️ 图标与 `<h2>` **都在这里渲染、不走插槽** —— 理由见文件头注释（scoped CSS 管不到插槽内容） -->
          <header class="sheet-head">
            <component :is="icon" v-if="icon" :size="20" />
            <h2>{{ title }}</h2>
            <button type="button" class="icon-btn flat" :aria-label="t('common.close')" @click="close">
              <X :size="20" />
            </button>
          </header>
          <div class="sheet-body scroll-y">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="sheet-foot">
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
}
.sheet-root.bottom {
  align-items: flex-end;
  justify-content: center;
}
.sheet-root.center {
  align-items: center;
  justify-content: center;
  padding: 16px;
}

/* 落进抽屉：盒子（位置、宽、高）由页面的 `#sheet-slot` 给，这里只管铺满它。
   `pointer-events: auto` 是必须的 —— 槽自己是 `pointer-events: none`（空着的时候不吃指针） */
.drawer-host {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  pointer-events: auto;
}
/* 「老一层」的遮罩：被新抽屉顶掉的那个一边往下落、一边压暗（正常显示时是 0） */
.drawer-host::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--scrim);
  opacity: 0;
  transition: opacity var(--side-io) var(--ease);
  pointer-events: none;
}
.drawer-leave-active::after {
  opacity: 1;
}
/* 抽屉的盒子长相：与普通的底部浮层（`.sheet-panel.bottom`）同一套取值 —— 整幅宽、上圆角、没有下边框。
   **但圆角要按朝向分**（见下面 `.sheet-slot.landscape` 那条）：横屏的抽屉只是左侧一列，
   上面那条边与右面那条边都是**贴着屏幕的实边**，只有**右上角**该圆；竖屏维持「整幅宽底部抽屉」的上圆角。 */
.drawer-box {
  width: 100%;
  height: 100%;
  border-bottom: 0;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding-bottom: var(--safe-b);
}

.sheet-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--surface-float);
  border: 1px solid var(--stroke-strong);
  box-shadow: var(--shadow-3);
  min-height: 0;
}
.sheet-panel.bottom {
  width: 100%;
  max-width: 620px;
  max-height: 78dvh;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border-bottom: 0;
  padding-bottom: var(--safe-b);
}
.sheet-panel.compact.bottom {
  max-height: 62dvh;
}
.sheet-panel.center {
  width: 100%;
  max-width: 460px;
  max-height: 86dvh;
  border-radius: var(--radius);
}
/* 标题栏：高、内边距、字号、下边框与**乐谱库那条 `.lib-head`** 是同一套取值
   （`LibraryPanel` 里那条本来就是照这里写的，两者在同一列上一上一下，形态不一样一眼就看出来）。
   `min-height` 必须显式写住：不给的话它只剩一行 16px 的字（≈48），标题栏比乐谱库那条矮一截，
   下面那块内容跟着往上跳。取 `--tap`(46) + 上下各 12 的 `padding` + 1px 下边框。 */
.sheet-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 12px 18px;
  min-height: calc(var(--tap) + 24px + 1px);
  border-bottom: 1px solid var(--stroke-soft);
  flex: none;
}
.sheet-head h2 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-body {
  padding: 16px 18px 18px;
  flex: 1;
  min-height: 0;
}
/* ---------------------- footer：动作按钮唯一的位置（见文件头注释） ---------------------- */
/* 滚动区之外、贴着面板底边的一条固定区：里面的按钮不跟着内容滚。
   `border-top` 是它与内容区之间的那道分隔，别再让调用方自己画分割线。 */
.sheet-foot {
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + var(--safe-b));
  border-top: 1px solid var(--stroke-soft);
  flex: none;
}
/* `center` 的居中确认弹窗：**并排**两颗、各占一半（取消 + 删除）—— 这条只给它用。
   ⚠️ 抽屉**不吃**这条：那里是纵向的，`flex: 1`（flex-basis: 0）在纵向容器里会让按钮的高度塌掉，
   见下面 `.drawer-box .sheet-foot` 那条。 */
.sheet-panel.center .sheet-foot :deep(.btn) {
  flex: 1;
}
/* 抽屉里的 footer：**纵向、一行一个、各占满整行**（docs/ui.md §13 / §18.42 / §18.61）——
   横向排布在抽屉里不存在：抽屉最窄时就是整幅宽的手机屏，并排两颗各剩不到半行。
   宽度靠 `align-items: stretch`（默认）撑满，**别加 `.block`**（见 docs/ui.md §14）。 */
.drawer-box .sheet-foot {
  flex-direction: column;
  padding-bottom: 12px;
}

/* ---------------------- 抽屉的圆角：按朝向分 ---------------------- */
/*
 * **为什么选择器要从槽出发**：`AppSheet` 的样式全是 scoped 的，而抽屉一 Teleport 进
 * `#sheet-slot`（`PlayerView` 里的元素），**父链上的 scoped 属性就没有了** —— 组件内直接写
 * `.landscape .drawer-box` 匹配不到。`.sheet-slot.landscape` 是 `PlayerView` 给槽自己挂的类，
 * 而 `.drawer-box` 是 Teleport 进去的那个根（它带着本组件的数据属性），两段选择器于是正好接得上。
 *
 * 横屏（槽带 `.landscape`，见 `PlayerView` 的 `slotStyle()` / `syncOrientation`）：
 * 抽屉贴左边、与侧栏同占一列 —— 上边和右边都是贴屏幕的实边，圆角只留**右上角**（那才是与侧栏一致的那颗）。
 * 用四值 `22px 22px 0 0` 显式写出来，别用 `border-top-right-radius` 覆盖：
 * 那条声明排在 `.drawer-box` 的简写**前面**、同分比顺序，会被简写整个盖掉（.drawer-box 照样四角圆）。
 */
.sheet-slot.landscape .drawer-box {
  border-radius: 0 var(--radius-lg) 0 0;
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}
.sheet-enter-active .sheet-panel,
.sheet-leave-active .sheet-panel {
  transition: transform 0.22s var(--ease);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet-panel.bottom,
.sheet-leave-to .sheet-panel.bottom {
  transform: translateY(24px);
}
.sheet-enter-from .sheet-panel.center,
.sheet-leave-to .sheet-panel.center {
  transform: scale(0.96);
}

/* 抽屉：**从下往上弹**（横竖屏同一套），退场落回底部。
   退场那个同时被压暗（`.drawer-leave-active::after`）—— 它就是被新抽屉盖住的「老一层」 */
.drawer-enter-from,
.drawer-leave-to {
  transform: translateY(100%);
}
.drawer-enter-active,
.drawer-leave-active {
  transition: transform var(--side-io) var(--ease);
}
</style>
