<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { latestProfile } from '../store/store'
import { DB_FLOOR, gainToCss } from '../compute/colormap'

const canvasRef = ref<HTMLCanvasElement | null>(null)
let ro: ResizeObserver | null = null

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const padL = 46
  const padR = 14
  const padT = 14
  const padB = 26
  const pw = w - padL - padR
  const ph = h - padT - padB
  const profile = latestProfile.value

  // —— 坐标映射 ——
  const xOf = (offset: number) => padL + ((offset + 90) / 180) * pw
  const dbTop = 2
  const dbBottom = DB_FLOOR
  const yOf = (db: number) =>
    padT + ((dbTop - Math.max(dbBottom, db)) / (dbTop - dbBottom)) * ph

  // —— 网格与坐标轴 ——
  ctx.font = '10px ui-monospace, monospace'
  ctx.lineWidth = 1
  for (let db = 0; db >= dbBottom; db -= 10) {
    const y = yOf(db)
    ctx.strokeStyle = db === -3 ? 'rgba(255,255,255,0.35)' : 'rgba(120,150,190,0.15)'
    ctx.setLineDash(db === -3 ? [5, 4] : [])
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(w - padR, y)
    ctx.stroke()
    ctx.fillStyle = '#7f97bb'
    ctx.fillText(`${db}`, 8, y + 3)
  }
  ctx.setLineDash([])
  for (let off = -90; off <= 90; off += 30) {
    const x = xOf(off)
    ctx.strokeStyle = 'rgba(120,150,190,0.12)'
    ctx.beginPath()
    ctx.moveTo(x, padT)
    ctx.lineTo(x, padT + ph)
    ctx.stroke()
    ctx.fillStyle = '#7f97bb'
    ctx.textAlign = 'center'
    ctx.fillText(`${off}°`, x, h - 9)
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = '#9db4d6'
  ctx.fillText('增益 (dB)', 6, padT - 3)
  ctx.textAlign = 'center'
  ctx.fillText('距主瓣轴角偏移', padL + pw / 2, h - 0)

  if (!profile) {
    ctx.fillStyle = '#6f86a8'
    ctx.textAlign = 'center'
    ctx.fillText('等待方向图计算…', padL + pw / 2, padT + ph / 2)
    return
  }

  // —— 增益剖面曲线（按 dB 值逐段着色）——
  const pts = profile.points
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const avgDb = (Math.max(dbBottom, p1.gainDb) + Math.max(dbBottom, p2.gainDb)) / 2
    ctx.strokeStyle = gainToCss(avgDb)
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(xOf(p1.offsetDeg), yOf(p1.gainDb))
    ctx.lineTo(xOf(p2.offsetDeg), yOf(p2.gainDb))
    ctx.stroke()
  }

  // —— HPBW 标注：-3 dB 穿越点与宽度箭头 ——
  if (profile.hpbwDeg !== null) {
    const threshold = profile.peakDb - 3
    // 由剖面点重找穿越位置
    const center = (pts.length - 1) / 2
    const crossing = (dir: -1 | 1): number | null => {
      for (let k = center + dir; k > 0 && k < pts.length - 1; k += dir) {
        const a = pts[k - dir].gainDb
        const b = pts[k].gainDb
        if (Number.isFinite(a) && Number.isFinite(b) && (a - threshold) * (b - threshold) <= 0 && a !== b) {
          const t = (threshold - a) / (b - a)
          return pts[k - dir].offsetDeg + (pts[k].offsetDeg - pts[k - dir].offsetDeg) * t
        }
        if (b < threshold) break
      }
      return null
    }
    const xl = crossing(-1)
    const xr = crossing(1)
    if (xl !== null && xr !== null) {
      const yTh = yOf(threshold)
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.fillStyle = '#ffffff'
      ctx.lineWidth = 1.4
      for (const xc of [xOf(xl), xOf(xr)]) {
        ctx.beginPath()
        ctx.moveTo(xc, yTh - 6)
        ctx.lineTo(xc, yTh + 6)
        ctx.stroke()
      }
      // 宽度双向箭头
      ctx.strokeStyle = '#ffd166'
      ctx.beginPath()
      ctx.moveTo(xOf(xl), yTh + 11)
      ctx.lineTo(xOf(xr), yTh + 11)
      ctx.moveTo(xOf(xl), yTh + 11)
      ctx.lineTo(xOf(xl) + 5, yTh + 8)
      ctx.moveTo(xOf(xl), yTh + 11)
      ctx.lineTo(xOf(xl) + 5, yTh + 14)
      ctx.moveTo(xOf(xr), yTh + 11)
      ctx.lineTo(xOf(xr) - 5, yTh + 8)
      ctx.moveTo(xOf(xr), yTh + 11)
      ctx.lineTo(xOf(xr) - 5, yTh + 14)
      ctx.stroke()
      ctx.fillStyle = '#ffd166'
      ctx.textAlign = 'center'
      ctx.font = 'bold 11px ui-monospace, monospace'
      ctx.fillText(`HPBW ${profile.hpbwDeg.toFixed(2)}°`, (xOf(xl) + xOf(xr)) / 2, yTh + 25)
    }
  }

  // —— 第一旁瓣电平标注 ——
  if (profile.firstSidelobeDb !== null) {
    const slDb = profile.peakDb + profile.firstSidelobeDb
    const y = yOf(slDb)
    ctx.strokeStyle = 'rgba(255,107,107,0.7)'
    ctx.setLineDash([7, 5])
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + pw, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#ff8a8a'
    ctx.textAlign = 'right'
    ctx.font = 'bold 10.5px ui-monospace, monospace'
    ctx.fillText(`第一旁瓣 ${profile.firstSidelobeDb.toFixed(2)} dB`, w - padR - 4, y - 4)
  }
  ctx.textAlign = 'left'
}

onMounted(() => {
  draw()
  ro = new ResizeObserver(() => draw())
  if (canvasRef.value) ro.observe(canvasRef.value)
})
watch(latestProfile, draw)
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <section class="panel profile-panel">
    <header class="panel-head">
      <h2>剖面分析（主瓣子午面）</h2>
      <span class="live-tag">随指向 / 布局同步刷新</span>
    </header>
    <div class="canvas-wrap">
      <canvas ref="canvasRef" class="profile-canvas"></canvas>
    </div>
  </section>
</template>

<style scoped>
.profile-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.panel-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #e6efff;
}
.live-tag {
  font-size: 11px;
  color: #6f86a8;
}
.canvas-wrap {
  flex: 1;
  min-height: 220px;
  border: 1px solid #22344f;
  border-radius: 10px;
  background: #0b1220;
  overflow: hidden;
}
.profile-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
