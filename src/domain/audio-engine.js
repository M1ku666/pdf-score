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
 *     节拍器拉到 0 时预备拍照样响。**取消倒数当刻静音**走 `cueGain` 后面那道 `cueGate`
 *     （整小节是一次排进 Web Audio 的，撤不掉，只能关闸）——「按暂停要立刻停，不许把剩下的几下打完」。
 *   · `OutputClock` 的墙上时钟兜底分支有三个坑（`this.origin` 别写成 `_origin`；`play()` 要在读
 *     `before` 之前钉住 `_pn`；`pause()` 要先把已走过的时间折进 `origin` 再清 `_pn`），文件里都标了。
 *   · **上下文分支**（无音频、节拍器建起了 AudioContext）的读数是
 *     `origin + (ctx.currentTime − _ac) × rate`：**是加 origin 不是减**（减的话 seek 之后读数
 *     一直贴着 0，过 origin 秒才开始爬 —— 跳过小节 / 暂停一下位置就归零），倍速也要乘在这里；
 *     而 `_ac` 必须在 **`seek` / `play` / `pause` / `resync` 四处重新钉住**（AudioContext 是节拍器
 *     共用的，暂停期间它照样在走），`resync()` 还要先把读数折进 `origin` 才不会弹回去。
 *   · **seek / 循环回跳后必须 `metronome.reset()`**，否则会补发过期拍子。
 *   · **弱起前导**：音频 0 秒**之前**那一段（记谱的弱起小节比音频里那段长时会出现）位置是**负数**，
 *     由 `store/player.js` 的前导循环推进、以 `leadPos` 的形式寄存在本时钟上（`now` 优先读它）；
 *     底层的 `<audio>` / AudioContext 时钟**永远只看得到 ≥ 0**（那段时间它们停在 0 秒等）。
 *     `seek()` 会清掉前导，位置随即交回音频自己的时钟。
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

  get rate() {
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
    this._lastTime = 0
    this._startTicker()
  }

  unload() {
    if (!this.el) return
    this.pause()
    this.el.removeAttribute('src')
    try {
      this.el.load()
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
    /** 倒数专用闸门（`cueGain → cueGate → master`）：取消倒数时当刻静音，见 `cancelCountIn` */
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
    // 倒数（`countIn`）**一次把一整小节都排进 Web Audio**，撤是撤不掉的 —— 所以再多一道闸门：
    // 取消倒数（按暂停 / 进编辑 / 离开乐谱）时把它关到 0，剩下的几下**当刻静音**，
    // 而不是照样打完（用户明确要求：「按暂停也要立刻停下，不等预备拍播完」）。
    // **音量与闸门是两个节点**：`setCueVolume` 照旧写 `cueGain.gain`，别合并。
    this.cueGate = this.ctx.createGain()
    this.cueGate.gain.value = 1
    this.cueGain.connect(this.cueGate)
    this.cueGate.connect(this.master)
    // 只能有一处输出时钟：这里建立上下文时把它挂上去
    this.clock?.attach(null, this.ctx)
    return this.ctx
  }

  /** 倒数闸门：1 = 放行、0 = 当刻静音（已经排进 Web Audio 的点击声只能这么掐掉） */
  _cueGateOpen(v) {
    const param = this.cueGate?.gain
    if (!param || !this.ctx) return
    const t = this.ctx.currentTime
    try {
      param.cancelScheduledValues(t)
    } catch {}
    param.setValueAtTime(v, t)
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
   */
  countIn(beats, beatDur, onDone) {
    const beatsN = Math.max(1, Math.round(beats || 4))
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
    // 开闸（上一次取消时关过它），再排这一轮
    this._cueGateOpen(1)
    const t0 = this.ctx.currentTime + 0.06
    for (let i = 0; i < beatsN; i++) this.click(t0 + i * beatDur, i === 0, true)
    clearTimeout(this._cueTimer)
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
    // 剩下的几下**已经在 Web Audio 里排好了**，撤不掉 —— 关闸把它们当刻掐掉。
    // 不关的话「按暂停」之后预备拍还会把剩下几拍打完（用户报过这个）。
    this._cueGateOpen(0)
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
    if (now < this.lastScheduled - 0.25) this.lastScheduled = now - 0.02
    const horizon = now + 0.25 * rate
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
    g.connect(cue ? this.cueGain || this.gain : this.gain)
    osc.start(when)
    osc.stop(when + 0.08)
  }
}
