const SILENT_VOLUME = 1

export class OutputClock {
  constructor() {
    this.engine = null
    this.context = null
    this.origin = 0
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

  attach(engine, context) {
    if (engine) this.engine = engine
    if (context) this.context = context
  }

  get hasAudio() {
    return !!this.engine?.ready
  }

  _ctx() {
    if (this.context) return this.context
    return this.engine?.context || null
  }

  get now() {
    if (this._leadPos != null) return this._leadPos
    if (this.hasAudio) return this.engine.currentTime || 0
    const ctx = this._ctx()
    if (ctx) {
      if (this._paused) return Math.max(0, this.origin)
      return Math.max(0, this.origin + (ctx.currentTime - this._ac) * this._rate)
    }
    if (!this._pn) return Math.max(0, this.origin)
    return Math.max(0, ((performance.now() - this._pn) / 1000) * this._rate + this.origin)
  }

  get rate() {
    if (this.hasAudio) return this.engine.rate || 1
    return this._rate
  }

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
    this.origin = this.now
    this._ac = this._ctx()?.currentTime ?? this._ac
    this._rate = next
  }

  seek(time) {
    const target = Math.max(0, Number(time) || 0)
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
      if (!this._pn) this._pn = performance.now()
      const before = this.now
      this._paused = false
      this._ac = this._ctx()?.currentTime ?? this._ac
      await this._startContext()
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
    this._paused = false
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
      this.origin = this.now
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

  setLoop(region) {
    const next = region && region.end > region.start ? { ...region } : null
    if (this.hasAudio) {
      this.engine.setLoop(next)
      return
    }
    this._loop = next
  }

  tick() {
    if (this.hasAudio || this._paused) return
    const t = this.now
    const loop = this._loop
    if (loop && t >= loop.end - 0.02) {
      const region = { ...loop }
      const handled = this.onLoopEnd ? this.onLoopEnd(region) : false
      if (!handled && !this._paused) this.seek(region.start)
      return
    }
    this.emit('time', t)
  }

  resync() {
    if (this.hasAudio) return
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
    this.previewEl = typeof Audio !== 'undefined' ? new Audio() : null
    if (this.previewEl) {
      this.previewEl.preload = 'auto'
      this.previewEl.playsInline = true
      this.previewEl.setAttribute('playsinline', '')
    }
    this._previewVolume = 1
    this._previewMuted = false
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
    this.loadPreview(url)
    this._lastTime = 0
    this._startTicker()
  }

  loadPreview(url) {
    if (!this.previewEl) return
    this.previewPause()
    this.previewEl.src = url
    this.previewEl.load()
    this._startTicker()
  }

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

  get previewReady() {
    return !!this.previewEl && !!this.previewEl.src
  }

  get previewTime() {
    return this.previewEl ? this.previewEl.currentTime || 0 : 0
  }

  previewSeek(time) {
    this.previewEnsure()
    if (!this.previewEl || !this.previewEl.src) return
    try {
      this.previewEl.currentTime = Math.max(0, time)
    } catch {}
    this.emit('previewTime', this.previewTime)
  }

  async previewPlay() {
    this.previewEnsure()
    if (!this.previewReady) {
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

  setLoop(region) {
    this._loop = region && region.end > region.start ? { ...region } : null
    if (this.el) this.el.loop = false
  }

  _startTicker() {
    if (this._raf) return
    const tick = () => {
      this._raf = requestAnimationFrame(tick)
      if (!this.el) return
      if (this.previewEl && !this.previewEl.paused) this.emit('previewTime', this.previewTime)
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
      if (this._loop && !this.el.paused && t >= this._loop.end - 0.02) {
        const region = { ...this._loop }
        const handled = this.onLoopEnd ? this.onLoopEnd(region) : false
        if (handled) {
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
    this.cueGate = null
    this.master = null
    this.timer = 0
    this.enabled = false
    this.volume = 0.6
    this.cueVolume = 0.6
    this.provider = null
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
    this.cueGate = this.ctx.createGain()
    this.cueGate.gain.value = 1
    this.cueGain.connect(this.cueGate)
    this.cueGate.connect(this.master)
    this.clock?.attach(null, this.ctx)
    return this.ctx
  }

  _cueGateOpen(v) {
    const param = this.cueGate?.gain
    if (!param || !this.ctx) return
    const t = this.ctx.currentTime
    try {
      param.cancelScheduledValues(t)
    } catch {}
    param.setValueAtTime(v, t)
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0))
    if (this.gain) this.gain.gain.value = this.volume
  }

  setCueVolume(v) {
    this.cueVolume = Math.max(0, Math.min(1, Number(v) || 0))
    if (this.cueGain) this.cueGain.gain.value = this.cueVolume
  }

  setMuted(m) {
    if (this.master) this.master.gain.value = m ? 0 : 1
  }

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

  reset() {
    this.clock?.resync()
    this.lastScheduled = this.clock ? this.clock.now : -Infinity
  }

  _tick() {
    if (!this.enabled || !this.ctx || !this.provider || !this.clock) return
    const rate = this.clock.rate || 1
    const now = this.clock.now
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
    g.connect(cue ? this.cueGain || this.gain : this.gain)
    osc.start(when)
    osc.stop(when + 0.08)
  }
}
