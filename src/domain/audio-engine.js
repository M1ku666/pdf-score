/**
 * 音频播放引擎 + 节拍器
 *  - OutputClock: 播放时钟的唯一来源。有音频时读 <audio>.currentTime，没有音频时读 Web Audio 的
 *                 currentTime —— 两者的走时机制一样（都是音频硬件时钟，硬件故障时同样停摆），
 *                 所以「只响节拍器」的播放才能和节拍器落在同一条时间线上。
 *  - AudioEngine: 包装 <audio>，提供播放/暂停/跳转/倍速/音量/循环段落，rAF 回调
 *  - Metronome  : Web Audio 前瞻调度点击声，跟随媒体时间与倍速
 *
 *  语义约定（详见 docs/concepts.md §3–4）：
 *   · **音量不是播放开关**：`setMetronomeVolume(0)` 只让节拍器没声音，**不会停掉播放**（静音也能走带）；
 *     「有没有东西可走」只由 `canPlay` 判断（有音频，或时间轴有长度）。
 *   · **预备拍与节拍器音量解耦**：`countIn()` 只看 `cueVolume`，走独立的 `cueGain` 节点 ——
 *     节拍器拉到 0 时预备拍照样响。**取消倒数当刻静音**走**每一轮自己那道** `cueGate`
 *     （`本轮点击声 → cueGate → cueGain → master`；整小节是一次排进 Web Audio 的，撤不掉，
 *     只能断开那一轮那道闸门）——「按暂停要立刻停，不许把剩下的几下打完」。
 *     ⚠️ **闸门必须一轮一道**（`countIn()` 开头先 `cancelCountIn()`）：点击声排在 `cueGain`
 *     **之前**，闸门要是几轮共用，重新开闸就会把上一轮还没响的几下一起放出来 ——
 *     用户明确要求「预备拍正在播放的时候再次触发播放预备拍要把之前的停掉」。
 *   · `OutputClock` 的墙上时钟兜底分支有三个坑（`this.origin` 别写成 `_origin`；`play()` 要在读
 *     `before` 之前钉住 `_pn`；`pause()` 要先把已走过的时间折进 `origin` 再清 `_pn`），文件里都标了。
 *   · **上下文分支**（无音频、节拍器建起了 AudioContext）的读数是
 *     `origin + (ctx.currentTime − _ac) × rate`：**是加 origin 不是减**（减的话 seek 之后读数
 *     一直贴着 0，过 origin 秒才开始爬 —— 跳过小节 / 暂停一下位置就归零），倍速也要乘在这里；
 *     而 `_ac` 必须在 **`seek` / `play` / `pause` / `resync` 四处重新钉住**（AudioContext 是节拍器
 *     共用的，暂停期间它照样在走），`resync()` 还要先把读数折进 `origin` 才不会弹回去。
 *   · **seek / 循环回跳后必须 `metronome.reset()`**，否则会补发过期拍子。
 *   · **节拍器的时间轴秒 ↔ 真实秒换算只有一支算式**：前瞻 = `0.25 × clock.rate`、每拍等待 = `÷ clock.rate`，
 *     连 `_tick` 里「位置往回跳了」那道兜底判据（`now < lastScheduled − 前瞻`）也要按**同一个前瞻量**判 ——
 *     判据里的 0.25 写死的话，倍速 > 1 时它每 25ms 都命中，同一批拍子被反复排程：
 *     节拍器变成约 40 下/秒（与段落 BPM 无关），而且暂停也停不下来（`now` 冻住，判据照样命中）。
 *     所以 `OutputClock.rate` 必须报**真实走带速度**（见它的注释）。
 *   · **弱起前导**：音频 0 秒**之前**那一段（记谱的弱起小节比音频里那段长时会出现）位置是**负数**，
 *     由 `store/player.js` 的前导循环推进、以 `leadPos` 的形式寄存在本时钟上（`now` 优先读它）；
 *     底层的 `<audio>` / AudioContext 时钟**永远只看得到 ≥ 0**（那段时间它们停在 0 秒等）。
 *     `seek()` 会清掉前导，位置随即交回音频自己的时钟。
 *   · **试听是第二只 `<audio>`**（`previewEl`，音频起点那一屏的「试听」）：
 *     它不进 `OutputClock`、不碰节拍器、不报 `play` / `pause` / `time`，位置单独报 `previewTime` ——
 *     `player.currentTime` 与 `player.playing` 一概不动（见 `docs/concepts.md` §3.1）。
 *     **起播失败报 `previewError`，不是 `error`**：后者是「谱面播放出错」，借它会一次失败报两条。
 */

/** 无音频时的音量：节拍器自己那条音量就够用了，这里只是个满刻度 */
const SILENT_VOLUME = 1

export class OutputClock {
  constructor() {
    this.engine = null
    this.context = null
    // 注意：`paused` 是本类的一个**只读访问器**（由 _paused / engine 推导），
    // 构造函数里不能再给它赋值 —— 严格模式下给只有 getter 的属性赋值会直接抛 TypeError，
    // 而本模块是 ESM（恒为严格模式），一抛就是整个 App 起不来。状态一律写 _paused。
    /**
     * 播放起点（秒）。只有「无音频」的播放用得上：节拍器是往未来提前排程的，
     * 按下播放时 Web Audio 还来不及起振，这段时间里位置就得靠它垫着。
     * 有音频时它恒为 0，输出时间就等于 <audio>.currentTime。
     */
    this.origin = 0
    /**
     * 前导位置（秒，**负数** = 还在音频 0 秒之前，乐谱上有内容但音频里没有声音）。
     * 由 `store/player.js` 的弱起前导循环推进；非 null 时 `now` 直接读它 ——
     * 节拍器、`rewindToMeasureStart` 这些读时钟的地方就都跟着走负数，
     * 而底层的 `<audio>` / AudioContext 时钟**永远只看得到 ≥ 0**（弱起那段它们停在 0 秒等）。
     */
    this._leadPos = null
    this._rate = 1
    this._ac = null
    this._dur = 0
    this._loop = null
    this._paused = true
    this._pn = 0
    this._listeners = new Map()
  }

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event).add(cb)
    return () => this.off(event, cb)
  }

  off(event, cb) {
    this._listeners.get(event)?.delete(cb)
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload)
      } catch (err) {
        console.error(err)
      }
    })
  }

  /**
   * 绑定引擎与 AudioContext：AudioEngine 装载音频 / Metronome 建立上下文时都会调用，
   * 谁后到都不会丢（两边都调一次，重复调用无副作用）。
   */
  attach(engine, context) {
    if (engine) this.engine = engine
    if (context) this.context = context
  }

  get hasAudio() {
    return !!this.engine?.ready
  }

  /** 音频上下文当前时间；上下文还没建起来（节拍器没启用过）时退回到墙上时钟 */
  _ctx() {
    if (this.context) return this.context
    return this.engine?.context || null
  }

  /** 时钟读数（秒）：位置随倍速走，所以倍速要乘在这里 —— 音频由 playbackRate 自己走快 */
  get now() {
    // 弱起前导：位置在音频 0 秒之前，只有乐谱与节拍器在走
    if (this._leadPos != null) return this._leadPos
    if (this.hasAudio) return this.engine.currentTime || 0
    const ctx = this._ctx()
    if (ctx) {
      // 读数 = 起点 + 上下文走过的时间 × 倍速。三处都不能动：
      //  · 是 **+ origin**（写成 − 的话 seek 之后读数会一直贴着 0，过 origin 秒才开始爬）；
      //  · 倍速要乘在这里（和墙上时钟那条分支、和音频的 playbackRate 一个意思）；
      //  · **暂停时读 origin** —— AudioContext 是节拍器共用的，暂停期间它照样在走，
      //    现算就会把暂停的那段时间也算成播放进度。
      if (this._paused) return Math.max(0, this.origin)
      return Math.max(0, this.origin + (ctx.currentTime - this._ac) * this._rate)
    }
    // 连 AudioContext 都建不起来：只能按墙上时钟走，节拍器本来也就响不了。
    // _pn 为 0 表示「还没起播过」，这时不能拿 performance.now() 去减它 ——
    // 那等于把「页面打开到现在的时长」算成播放进度（origin 会被算成一个巨大的负数再夹回 0）。
    // 注意是 this.origin（没有下划线）：写成 this._origin 会得到 number + undefined = NaN。
    if (!this._pn) return Math.max(0, this.origin)
    return Math.max(0, ((performance.now() - this._pn) / 1000) * this._rate + this.origin)
  }

  /**
   * 走带速度（**时间轴秒 / 真实秒**）。有音频时它是 `<audio>` 的 `playbackRate`（`now` 就是
   * `el.currentTime`，走多快由它定），无音频时是 `_rate`。
   * 节拍器的前瞻与延迟都拿它做「时间轴秒 ↔ 真实秒」的换算，所以这里必须报**真实走带速度**：
   * 有音频时 `setRate` 只把倍速交给引擎，读的时候从引擎那份取回来，两边就不会各说各的
   * （写得恒为 1 的话，倍速 ≠ 1 时拍点的真实时刻算错，点击声与音乐对不上）。
   */
  get rate() {
    if (this.hasAudio) return this.engine.rate || 1
    return this._rate
  }

  /** 前导位置：负数 = 还在音频 0 秒之前；传 null / NaN 取消（位置回到音频自己的时钟） */
  get leadPos() {
    return this._leadPos
  }

  set leadPos(v) {
    this._leadPos = Number.isFinite(v) ? v : null
  }

  get duration() {
    if (this.hasAudio) return this.engine.duration
    return this._dur || 0
  }

  set duration(sec) {
    this._dur = Number(sec) || 0
  }

  set volume(v) {
    this._volume = Math.max(0, Math.min(1, Number(v) || 0))
  }

  get volume() {
    return this._volume ?? SILENT_VOLUME
  }

  set muted(m) {
    this._muted = !!m
  }

  get muted() {
    return !!this._muted
  }

  setRate(rate) {
    const next = Number(rate) || 1
    if (this.hasAudio) {
      // 有音频：走带速度由 `<audio>` 自己承担（读数就是 `el.currentTime`），
      // 倍速交给引擎即可 —— `rate` 那个 getter 会从引擎那份读回来，别在这里另存一份。
      this.engine.setRate(next)
      return
    }
    // 无音频：把已经走过的那段按新倍速折算进起点，位置才不会因为变速跳一下
    this.origin = this.now
    this._ac = this._ctx()?.currentTime ?? this._ac
    this._rate = next
  }

  /**
   * seek 到 time。无音频时把 `origin` 设成 time、`_ac` 钉在当前上下文时间上，于是
   * 「读数 = origin + 上下文走过的时间 × 倍速」在 seek 那一刻正好等于 time（不动声色地跳过去），
   * 还没起振时如实等一个 lead 再出声 —— 和音频刚 seek 完要等 buffering 是一回事。
   */
  seek(time) {
    const target = Math.max(0, Number(time) || 0)
    // 取消前导：位置重新由音频/上下文时钟负责（要停在音频之前请用 `leadPos`）
    this._leadPos = null
    if (this.hasAudio) {
      this.engine.seek(target)
      return
    }
    const ctx = this._ctx()
    this.origin = target
    this._ac = ctx ? ctx.currentTime : 0
    this.emit('seek', target)
    this.emit('time', target)
  }

  async play() {
    if (!this.hasAudio) {
      // _pn 要在读 before 之前就钉住：它是墙上时钟分支的唯一基准，
      // 晚一步设的话 before 与后面的读数就不在同一个基准上，差值全是垃圾。
      if (!this._pn) this._pn = performance.now()
      const before = this.now
      this._paused = false
      // 上下文那条分支的基准也要钉在「按下播放这一刻」：暂停期间 ctx.currentTime 照样在走，
      // 不重打基准的话，`origin += this.now - before` 会把暂停的那段整段加进播放位置
      this._ac = this._ctx()?.currentTime ?? this._ac
      await this._startContext()
      // 起振前的等待不该算进播放位置（节拍器正是靠这个 lead 提前排程的）
      this.origin += this.now - before
      this._ac = this._ctx()?.currentTime ?? this._ac
      this._pn = performance.now()
      this.emit('play')
      return true
    }
    return this.engine.play()
  }

  async resume() {
    if (this.hasAudio && this.paused) return this.play()
    // 暂停中：先接上上下文（挂起的上下文起振后 currentTime 会继续走），再补上停摆这段时间
    this._paused = false
    // 与 play() 同理：基准要先钉住，否则 before 与 after 不同基准
    if (!this._pn) this._pn = performance.now()
    const before = this.now
    await this._startContext()
    const still = this._paused
    this._paused = false
    this.origin += this.now - before
    this._ac = this._ctx()?.currentTime ?? this._ac
    if (still) this.pause()
    return true
  }

  pause() {
    if (!this.hasAudio) {
      if (this._paused) return
      // 先把已经走过的那段折进 origin，再钉住基准 —— 否则 position 会一路掉回 0
      // （旧写法直接覆盖 _pn，读数就变成「从暂停那一刻起算」，暂停即归零）
      this.origin = this.now
      // 上下文那条分支的基准也要一起钉住：暂停期间 ctx.currentTime 还在走（节拍器共用同一个上下文）
      this._ac = this._ctx()?.currentTime ?? this._ac
      this._paused = true
      this._pn = 0
      this.emit('pause')
      return
    }
    this.engine.pause()
  }

  async _startContext() {
    if (this._paused) return null
    const ctx = this._ctx()
    if (!ctx) return null
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {}
    }
    return ctx
  }

  get paused() {
    if (this.hasAudio) return this.engine.paused
    return !!this._paused
  }

  get ended() {
    if (this.hasAudio) return this.engine.ended
    const dur = this.duration
    return dur > 0 && this.now >= dur
  }

  get loop() {
    return this.hasAudio ? this.engine.loop : this._loop || null
  }

  /** region: {start, end} 秒；传 null 取消。无音频时循环回跳由上层 rAF 驱动 */
  setLoop(region) {
    const next = region && region.end > region.start ? { ...region } : null
    if (this.hasAudio) {
      this.engine.setLoop(next)
      return
    }
    this._loop = next
  }

  /** 每帧驱动：无音频时没有 <audio> 的 timeupdate，只能自己推 */
  tick() {
    if (this.hasAudio || this._paused) return
    const t = this.now
    // 到循环末尾：先问上层要不要接管（例如打预备拍），没人管就自己跳回去
    const loop = this._loop
    if (loop && t >= loop.end - 0.02) {
      const region = { ...loop }
      const handled = this.onLoopEnd ? this.onLoopEnd(region) : false
      if (!handled && !this._paused) this.seek(region.start)
      return
    }
    this.emit('time', t)
  }

  /**
   * 循环回跳前的善后（`metronome.reset()` 会调它）。**读数必须不变**：
   * 先把已经走过的那段折进 `origin`，再重新钉上下文基准 —— 只重钉 `_ac` 的话，
   * 读数会当场弹回上一次 seek 的落点（`origin`），中途把节拍器音量拉起来都能看见它跳。
   */
  resync() {
    if (this.hasAudio) return
    // 前导期间位置归 `leadPos`，别去动 origin（负数折进 origin 没有意义）
    if (this._leadPos != null) return
    const ctx = this._ctx()
    if (!ctx) return
    this.origin = this.now
    this._ac = ctx.currentTime
  }
}

export class AudioEngine {
  constructor() {
    this.el = typeof Audio !== 'undefined' ? new Audio() : null
    if (this.el) {
      this.el.preload = 'auto'
      this.el.playsInline = true
      this.el.setAttribute('playsinline', '')
    }
    /**
     * **试听专用的第二只 `<audio>`**（音频起点那一屏的「试听」，见 `store/player.js` 的
     * `startPreview` / `stopPreview`）。
     *
     * 为什么单开一只、而不是借 `this.el`：`this.el` 是**谱面走带的声源** ——
     * 它的 `currentTime` 就是播放位置，`play` / `pause` 事件会把整个 app 切进 / 切出播放态。
     * 借它试听一次，谱面位置就被挪走了，也说不清「这算不算在播放」。
     * 试听只是「单独放一下这个音频文件」，所以它有自己的元素、自己的位置，
     * 不进 `OutputClock`、不碰节拍器、不报 `time` 事件（只报 `previewTime`）。
     * 音量 / 静音跟着音乐音量走（`setPreviewVolume` / `setPreviewMuted`），但**不走 `_applyVolume`**：
     * 那只元素是谱面的声源，两者互不影响。
     */
    this.previewEl = typeof Audio !== 'undefined' ? new Audio() : null
    if (this.previewEl) {
      this.previewEl.preload = 'auto'
      this.previewEl.playsInline = true
      this.previewEl.setAttribute('playsinline', '')
    }
    this._previewVolume = 1
    this._previewMuted = false
    /** 「放到头」这条只报一次（见 `_startTicker`）：`ended` 会一直为真到下一次 seek / play */
    this._previewEnded = false
    this._rate = 1
    this._volume = 1
    this._muted = false
    this._loop = null
    this._listeners = new Map()
    this._raf = 0
    this._objectUrl = null
    this._lastTime = 0
    this._srcDuration = 0
    /** 循环回到起点时回调，返回 true 表示上层已接管（例如先打预备拍） */
    this.onLoopEnd = null
  }

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event).add(cb)
    return () => this.off(event, cb)
  }

  off(event, cb) {
    this._listeners.get(event)?.delete(cb)
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload)
      } catch (err) {
        console.error(err)
      }
    })
  }

  get ready() {
    return !!this.el && !!this.el.src
  }

  get currentTime() {
    return this.el ? this.el.currentTime || 0 : 0
  }

  get duration() {
    const d = this.el?.duration
    if (Number.isFinite(d) && d > 0) return d
    return this._srcDuration || 0
  }

  get paused() {
    return !this.el || this.el.paused
  }

  get ended() {
    return !!this.el && this.el.ended
  }

  get rate() {
    return this._rate
  }

  get volume() {
    return this._muted ? 0 : this._volume
  }

  get muted() {
    return this._muted
  }

  get loop() {
    return this._loop
  }

  load(url, knownDuration = 0) {
    if (!this.el) return
    this.pause()
    if (this._objectUrl && this._objectUrl !== url) URL.revokeObjectURL(this._objectUrl)
    this._objectUrl = url
    this._srcDuration = knownDuration || 0
    this.el.src = url
    this.el.load()
    // 试听那只 `<audio>` 用**同一个 url**（同一个 blob 的 object URL，不额外 revoke 一次）
    this.loadPreview(url)
    this._lastTime = 0
    this._startTicker()
  }

  /**
   * 把音频挂到试听那只元素上（`load` 里自动调；单独调没有副作用）。
   * **不再 revoke 一遍 url** —— object URL 的所有权在 `this._objectUrl` 那一份上，
   * 两边各 revoke 一次会把还在用的地址撤掉。
   */
  loadPreview(url) {
    if (!this.previewEl) return
    this.previewPause()
    this.previewEl.src = url
    this.previewEl.load()
    this._startTicker()
  }

  /**
   * 兜底：**打开乐谱时只有主元素拿到了音频**（`load` 里那次 `loadPreview` 管的是「换音频」），
   * 从库里读出来的那条路（`open()` 的 `engine.load`）走的是同一个 `load`，所以正常情况下这只元素
   * 早就有 src 了；这里再兜一次「试听时才发现没 src」——直接把主元素的地址借过来。
   * 借 `this.el.src`（绝对地址）而不是 `_objectUrl`：它已经被浏览器解析过，不必再拼一次。
   */
  previewEnsure() {
    if (!this.previewEl || this.previewEl.src) return
    const src = this.el?.src
    if (!src) return
    this.previewEl.src = src
    this.previewEl.load()
    this._startTicker()
  }

  unload() {
    if (!this.el) return
    this.pause()
    this.previewPause()
    this.el.removeAttribute('src')
    this.previewEl?.removeAttribute('src')
    try {
      this.el.load()
    } catch {}
    try {
      this.previewEl?.load()
    } catch {}
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl)
      this._objectUrl = null
    }
    this._stopTicker()
  }

  async play() {
    if (!this.el || !this.el.src) return false
    try {
      await this.el.play()
      this._startTicker()
      this.emit('play')
      return true
    } catch (err) {
      this.emit('error', err)
      return false
    }
  }

  pause() {
    if (!this.el) return
    this.el.pause()
    this.emit('pause')
  }

  async toggle() {
    if (this.paused) return this.play()
    this.pause()
    return false
  }

  seek(time) {
    if (!this.el || !this.el.src) return
    const t = Math.max(0, time)
    try {
      this.el.currentTime = t
    } catch {}
    this._lastTime = t
    this.emit('seek', t)
    this.emit('time', t)
  }

  setRate(rate) {
    this._rate = rate
    if (this.el) {
      try {
        this.el.playbackRate = rate
        this.el.preservesPitch = true
        this.el.mozPreservesPitch = true
        this.el.webkitPreservesPitch = true
      } catch {}
    }
  }

  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v))
    if (this._muted && this._volume > 0) this._muted = false
    this._applyVolume()
  }

  setMuted(m) {
    this._muted = !!m
    this._applyVolume()
  }

  _applyVolume() {
    if (this.el) this.el.volume = this._muted ? 0 : this._volume
  }

  /* ------------------------------- 试听 ------------------------------- */
  /*
   * 试听（音频起点那一屏）= **单独放一下这个音频文件**，与谱面走带互不相干：
   * 只动 `previewEl`，不报 `play` / `pause` / `time`（那是谱面播放态与播放头的事件），
   * 位置单独报 `previewTime`、放到头报一次 `previewEnded`。
   * 见 `store/player.js` 的 `startPreview` / `stopPreview`。
   */

  get previewReady() {
    return !!this.previewEl && !!this.previewEl.src
  }

  /** 试听播放头（秒，音频文件自己的时间轴） */
  get previewTime() {
    return this.previewEl ? this.previewEl.currentTime || 0 : 0
  }

  /** 试听位置（秒，音频自己的时间轴，夹到 ≥ 0）。越界的位置浏览器自己会夹住 */
  previewSeek(time) {
    this.previewEnsure()
    if (!this.previewEl || !this.previewEl.src) return
    try {
      this.previewEl.currentTime = Math.max(0, time)
    } catch {}
    this.emit('previewTime', this.previewTime)
  }

  /**
   * 起播试听。**返回值就是「到底放起来没有」**（`store/player.js` 的 `startPreview` 拿它决定要不要退回未试听）。
   *
   * 起不来时发的是 **`previewError`（带错误对象，或 `null` = 连地址都没有），不是 `error`**：
   * `error` 那条是「谱面播放出错」，由 store 弹「音频播放出错：错误原文」——
   * 试听失败借它会变成**同一次起播失败报两条**（而且是两条不同的话）。
   * 所以试听那条由 store 挂在 `previewError` 上弹（可复制的报错，正文「试听失败：错误原文」）。
   */
  async previewPlay() {
    this.previewEnsure()
    if (!this.previewReady) {
      // 兜底：这只元素连地址都没有（正常路径上 `previewEnsure()` 已经把主元素的地址借过来了）。
      // **照样报一条**，别让「点了试听按钮变了、屏幕上什么提示都没有」——错误对象给 null，
      // 正文由 store 回落到「无音频」（见 `store/player.js` 那条 listener）。
      this.emit('previewError', null)
      return false
    }
    try {
      await this.previewEl.play()
      this._startTicker()
      return true
    } catch (err) {
      this.emit('previewError', err)
      return false
    }
  }

  previewPause() {
    if (!this.previewEl) return
    this.previewEl.pause()
  }

  setPreviewVolume(v) {
    this._previewVolume = Math.max(0, Math.min(1, Number(v) || 0))
    this._applyPreviewVolume()
  }

  setPreviewMuted(m) {
    this._previewMuted = !!m
    this._applyPreviewVolume()
  }

  _applyPreviewVolume() {
    if (this.previewEl) this.previewEl.volume = this._previewMuted ? 0 : this._previewVolume
  }

  /** region: {start, end} 秒；传 null 取消 */
  setLoop(region) {
    this._loop = region && region.end > region.start ? { ...region } : null
    if (this.el) this.el.loop = false
  }

  _startTicker() {
    if (this._raf) return
    const tick = () => {
      this._raf = requestAnimationFrame(tick)
      if (!this.el) return
      // 试听那只 `<audio>` 的位置单独报（它的 `time` 不是谱面播放位置，别混进下面那支）：
      // 这一条是「频谱里的播放头会走」的唯一来源，见 `store/player.js` 的 `player.previewTime`
      if (this.previewEl && !this.previewEl.paused) this.emit('previewTime', this.previewTime)
      /**
       * 试听**放到头**了也要报一声（这一段本来就短，或起点贴着结尾）：
       * 上层据此把「试听中」收掉 —— 不报的话按钮会挂在一个没有声音的「停止试听」上
       * （放到头之后 `paused` 为真，上面那条 `previewTime` 也就不再发了）。
       * `ended` 会一直为真到下一次 seek / play，所以**只在刚变成真的那一帧报一次**。
       */
      if (this.previewEl) {
        if (this.previewEl.ended) {
          if (!this._previewEnded) {
            this._previewEnded = true
            this.emit('previewEnded')
          }
        } else {
          this._previewEnded = false
        }
      }
      const t = this.el.currentTime || 0
      // 到达循环末尾：交给上层（可能要打预备拍），没人管就自己跳回去
      if (this._loop && !this.el.paused && t >= this._loop.end - 0.02) {
        const region = { ...this._loop }
        const handled = this.onLoopEnd ? this.onLoopEnd(region) : false
        if (handled) {
          // **上层接了这条循环末尾，这一帧就到此为止**：`t` 是「已经越过 `loop.end`」的读数
          // （判定线是 `end - 0.02`，加上一帧的步进还能再超出一点），
          // 再 `emit('time', t)` 就是把**越界的读数**报给上层、由它写进 `player.currentTime`。
          // 上层此刻正把播放头同步钉在循环段末尾（`handleLoopEnd`），这一报会跟它抢 ——
          // 抢赢的样子就是「播放头跑到循环段后一个小节才停住」。**别删这个 return。**
          this._lastTime = t
          return
        }
        if (!this.el.paused) this.el.currentTime = region.start
      }
      this._lastTime = t
      this.emit('time', t)
    }
    this._raf = requestAnimationFrame(tick)
  }

  _stopTicker() {
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = 0
  }
}

export class Metronome {
  constructor() {
    this.ctx = null
    this.gain = null
    this.cueGain = null
    /**
     * **本轮**倒数的闸门（`本轮点击声 → cueGate → cueGain → master`）：一轮一道新的，
     * 撤掉它就当刻掐掉这一轮已经排进 Web Audio 的点击声，见 `_openCueGate` / `_dropCueGate`
     */
    this.cueGate = null
    this.master = null
    this.timer = 0
    this.enabled = false
    this.volume = 0.6
    this.cueVolume = 0.6
    this.provider = null // (t0, t1) => [{time, accent}]
    this.clock = null
    this.lastScheduled = -Infinity
    this._cueTimer = 0
  }

  ensure() {
    if (this.ctx) return this.ctx
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
    this.gain = this.ctx.createGain()
    this.gain.gain.value = this.volume
    this.gain.connect(this.master)
    this.cueGain = this.ctx.createGain()
    this.cueGain.gain.value = this.cueVolume
    // 倒数（`countIn`）**一次把一整小节都排进 Web Audio**，撤是撤不掉的 —— 所以每一轮倒数另外建一道
    // 闸门（`_openCueGate`，见那一处的注释）：取消倒数（按暂停 / 进编辑 / 离开乐谱）与**再打一轮**
    // 都靠撤掉这道闸门把这一轮已经排进去的点击声当刻掐掉，别的办法都停不住
    // （用户明确要求「按暂停也要立刻停下，不等预备拍播完」+「预备拍正在播放的时候再次触发播放
    // 预备拍要把之前的停掉」）。
    // **音量与闸门是两个节点**：`setCueVolume` 照旧写 `cueGain.gain`，别合并。
    this.cueGain.connect(this.master)
    // 只能有一处输出时钟：这里建立上下文时把它挂上去
    this.clock?.attach(null, this.ctx)
    return this.ctx
  }

  /**
   * 换一道**新的倒数闸门**并返回它。
   *
   * ⚠️ **闸门一轮一道，不能几轮共用同一个节点**：点击声是从**闸门自己这一头**接进来的
   * （`click(..., cue)`），闸门再往下接音量节点 `cueGain` —— 撤掉闸门 = 这一轮那些还没响的
   * 点击声当场没了着落（`_dropCueGate`）。几轮共用一个节点的话，上一轮排进去的几下会跟着
   * 新的一起响，「再打一轮」听起来就是两次倒数叠着。
   */
  _openCueGate() {
    if (!this.ctx) return null
    const gate = this.ctx.createGain()
    gate.gain.value = 1
    gate.connect(this.cueGain || this.master)
    this.cueGate = gate
    return gate
  }

  /**
   * 撤掉当前这道倒数闸门：这一轮已经排进 Web Audio 的点击声**当刻静音、撤不回来**。
   * 取消倒数（`cancelCountIn`）与**开始新一轮**（`countIn` 开头）都走它。
   */
  _dropCueGate() {
    if (!this.cueGate) return
    try {
      this.cueGate.disconnect()
    } catch {}
    this.cueGate = null
  }

  /** 音量即开关：0 = 静音（播放器里用不到单独的开关状态） */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0))
    if (this.gain) this.gain.gain.value = this.volume
  }

  /** 预备拍音量（与节拍器分开） */
  setCueVolume(v) {
    this.cueVolume = Math.max(0, Math.min(1, Number(v) || 0))
    if (this.cueGain) this.cueGain.gain.value = this.cueVolume
  }

  setMuted(m) {
    if (this.master) this.master.gain.value = m ? 0 : 1
  }

  /**
   * 预备拍：立刻排程一整小节倒数，返回时长（毫秒）；0 表示没打（音量为 0）
   * onDone 在倒数结束后触发，用来开始真正的播放（**取消倒数时它不会触发**：见 `cancelCountIn`）
   *
   * ⚠️ **进来第一件事就是把上一轮停掉**（用户明确要求：「预备拍正在播放的时候再次触发播放预备拍
   * 要把之前的停掉」）：清掉上一轮的定时器（它的 `onDone` 不再触发 —— 否则过一会儿还会把播放头
   * 再跳一次）并撤掉上一轮那道闸门（它排进 Web Audio 的剩下几下当刻静音，见 `_dropCueGate`）。
   */
  countIn(beats, beatDur, onDone) {
    const beatsN = Math.max(1, Math.round(beats || 4))
    this.cancelCountIn()
    if (this.cueVolume <= 0) {
      onDone?.()
      return 0
    }
    const ctx = this.ensure()
    const ms = beatsN * beatDur * 1000
    if (!ctx) {
      onDone?.()
      return 0
    }
    this.resume()
    // 这一轮的闸门：上一轮那道已经在上面撤掉了，所以这里一定是干净的
    this._openCueGate()
    const t0 = this.ctx.currentTime + 0.06
    for (let i = 0; i < beatsN; i++) this.click(t0 + i * beatDur, i === 0, true)
    this._cueTimer = setTimeout(() => {
      this._cueTimer = 0
      onDone?.()
    }, ms)
    return ms
  }

  cancelCountIn() {
    if (this._cueTimer) {
      clearTimeout(this._cueTimer)
      this._cueTimer = 0
    }
    // 剩下的几下**已经在 Web Audio 里排好了**，撤不掉 —— 撤掉这一轮那道闸门把它们当刻掐掉。
    // 不撤的话「按暂停」之后预备拍还会把剩下几拍打完（用户报过这个）。
    this._dropCueGate()
  }

  get countInActive() {
    return !!this._cueTimer
  }

  async resume() {
    const ctx = this.ensure()
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {}
    }
    return ctx
  }

  start(provider, clock) {
    this.provider = provider
    this.clock = clock
    clock?.attach(null, this.ensure())
    this.enabled = true
    this.lastScheduled = -Infinity
    this.resume()
    if (!this.timer) this.timer = setInterval(() => this._tick(), 25)
    this._tick()
  }

  stop() {
    this.enabled = false
    if (this.timer) clearInterval(this.timer)
    this.timer = 0
  }

  /** seek / 循环回跳后调用，避免补发一堆过期的拍子 */
  reset() {
    // 循环回跳是直接设时钟起点的，这里顺手把音频上下文那一段偏移对回去
    this.clock?.resync()
    this.lastScheduled = this.clock ? this.clock.now : -Infinity
  }

  _tick() {
    if (!this.enabled || !this.ctx || !this.provider || !this.clock) return
    const rate = this.clock.rate || 1
    const now = this.clock.now
    /**
     * 前瞻 = 0.25 × 倍速（**时间轴秒**，换算成真实时间恒为 0.25 秒）。
     * `lastScheduled` 也是时间轴秒，正常就落在 `now + lookAhead` 上。
     *
     * ⚠️ **下面那道「位置往回跳了」的兜底判据必须用同一个 `lookAhead`，不能写死 0.25**：
     * 判据写死的话，倍速 > 1 时 `now < now + 0.25×倍速 − 0.25` **恒真** ——
     * 于是每 25ms 都把 `lastScheduled` 拨回 `now - 0.02`、把同一批拍子重新排一遍，
     * 节拍器变成每 tick 一下（约 40 下/秒，和段落 BPM 无关），而且**暂停也停不下来**
     * （`now` 冻住，判据照样每 tick 命中，已排进 Web Audio 的点击声一直往外冒）。
     * 判据与前瞻用同一支算式，就只有「位置真的往回跳了超过一个前瞻量」时才命中。
     */
    const lookAhead = 0.25 * rate
    if (now < this.lastScheduled - lookAhead) this.lastScheduled = now - 0.02
    const horizon = now + lookAhead
    const beats = this.provider(Math.max(this.lastScheduled, now - 0.02), horizon)
    for (const b of beats) {
      if (b.time <= this.lastScheduled + 1e-4) continue
      const delay = Math.max(0, (b.time - now) / (rate || 1))
      const when = this.ctx.currentTime + delay
      this.click(when, b.accent)
      this.lastScheduled = Math.max(this.lastScheduled, b.time)
    }
  }

  click(when, accent, cue = false) {
    const ctx = this.ensure()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = accent ? 1760 : 1174
    const peak = accent ? 0.55 : 0.32
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(peak, when + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
    osc.connect(g)
    // 预备拍（`cue`）接的是**这一轮那道闸门**（见 `_openCueGate`）：接 `cueGain` 的话撤闸门就撤不掉它
    g.connect(cue ? this.cueGate || this.cueGain || this.gain : this.gain)
    osc.start(when)
    osc.stop(when + 0.08)
  }
}
