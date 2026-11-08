import { matteSpineSolidBackground } from './matting.js'
const element = id => document.getElementById(id)
const original = element('original'), processed = element('processed')
const status = element('status'), tolerance = element('tolerance')
let source = null, filename = 'image', revision = 0
const say = message => { status.textContent = message }
const draw = (canvas, pixels) => { canvas.width = pixels.width; canvas.height = pixels.height; canvas.getContext('2d').putImageData(pixels, 0, 0); canvas.style.display = 'block'; canvas.parentElement.querySelector('.empty').hidden = true }
tolerance.addEventListener('input', () => { element('value').value = tolerance.value })
element('file').addEventListener('change', async event => {
  const current = ++revision, file = event.target.files?.[0]
  if (!file) return
  try {
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 32 * 1024 * 1024) throw new Error('请选择不超过 32 MiB 的 PNG 或 JPEG 图片。')
    const bitmap = await createImageBitmap(file)
    try {
      if (current !== revision) return
      if (bitmap.width * bitmap.height > 16_000_000) throw new Error('图片超过 1600 万像素限制。')
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
      source = context.getImageData(0, 0, canvas.width, canvas.height); filename = file.name.replace(/\.[^.]+$/, '')
      draw(original, source); draw(processed, source)
      for (const id of ['apply', 'restore', 'export']) element(id).disabled = false
      say(`${bitmap.width} × ${bitmap.height} · 已加载，调整容差后应用处理。`)
    } finally { bitmap.close() }
  } catch (error) { if (current === revision) say(error.message || '无法读取图片。') }
})
element('apply').addEventListener('click', () => {
  if (!source) return
  try {
    const result = matteSpineSolidBackground(source.data, source.width, source.height, Number(tolerance.value))
    draw(processed, new ImageData(result.pixels, source.width, source.height))
    say(`已移除 ${result.removed.toLocaleString()} 个背景像素；边缘优化 ${result.feathered.toLocaleString()} 个像素。`)
  } catch { say('无法识别一致的纯色背景。请检查四角颜色或调整容差；原图未改变。') }
})
element('restore').addEventListener('click', () => { if (source) { draw(processed, source); say('已恢复原图。') } })
element('export').addEventListener('click', () => {
  if (!source) return
  processed.toBlob(blob => {
    if (!blob) { say('PNG 导出失败。'); return }
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${filename}-processed.png`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000); say('已请求下载 PNG，透明通道已保留。')
  }, 'image/png')
})
