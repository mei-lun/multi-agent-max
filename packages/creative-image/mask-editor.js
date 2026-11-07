export function createMaskEditor(container, request) {
  const section = document.createElement('section')
  section.innerHTML = `<h3>蒙版编辑器</h3><p>透明区域将被替换。载入参考图后涂抹需要重绘的区域，或向四周扩展画布。</p><button id="load-source">载入第一张参考图</button><label>画笔 <input id="brush" type="range" min="1" max="150" value="30"></label><label><input id="erase" type="checkbox"> 恢复源图像素</label><button id="undo-mask">撤销</button><button id="extend-mask">四周扩展 64 像素</button><div class="checker"><canvas id="mask-source" style="display:block;max-width:100%;touch-action:none"></canvas></div>`
  container.append(section)
  const find = id => section.querySelector(`#${id}`)
  const canvas = find('mask-source'), context = canvas.getContext('2d', { willReadFrequently: true })
  let original = null, history = [], painting = false, refs = () => [], report = () => {}, sourceId = null, locked = false, revision = 0
  const snapshot = () => { history.push({ pixels: context.getImageData(0, 0, canvas.width, canvas.height), original }); if (history.length > 20) history.shift() }
  find('load-source').onclick = async () => {
    if (locked) return
    const loadingRevision = ++revision
    try {
      const ref = refs()[0]; if (!ref) throw new Error('Import a reference first.')
      const image = new Image(); image.src = await request('previewAsset', { ref }); await image.decode()
      if (locked || revision !== loadingRevision || refs()[0]?.id !== ref.id) return
      if (image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('Reference exceeds 16 million pixels.')
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; context.drawImage(image, 0, 0)
      original = context.getImageData(0, 0, canvas.width, canvas.height); history = []
      sourceId = ref.id
    } catch (error) { report(error.message) }
  }
  find('undo-mask').onclick = () => { if (locked) return; revision++; const item = history.pop(); if (item) { const { pixels } = item; original = item.original; canvas.width = pixels.width; canvas.height = pixels.height; context.putImageData(pixels, 0, 0) } }
  find('extend-mask').onclick = () => {
    if (!original || locked) return
    revision++
    if ((canvas.width + 128) * (canvas.height + 128) > 16_000_000) return report('Canvas exceeds 16 million pixels.')
    snapshot(); const pixels = history.at(-1).pixels; canvas.width += 128; canvas.height += 128; context.putImageData(pixels, 64, 64)
    const source = document.createElement('canvas'); source.width = canvas.width; source.height = canvas.height; source.getContext('2d').putImageData(original, 64, 64); original = source.getContext('2d').getImageData(0, 0, source.width, source.height)
  }
  function paint(event) {
    if (!painting || locked) return
    revision++
    const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) * canvas.width / rect.width, y = (event.clientY - rect.top) * canvas.height / rect.height
    const radius = Number(find('brush').value) / 2
    if (find('erase').checked) {
      const left = Math.max(0, Math.floor(x - radius)), top = Math.max(0, Math.floor(y - radius)), size = Math.ceil(radius * 2)
      context.putImageData(original, 0, 0, left, top, size, size)
    } else { context.save(); context.globalCompositeOperation = 'destination-out'; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.restore() }
  }
  canvas.onpointerdown = event => { if (!original || locked) return; snapshot(); painting = true; canvas.setPointerCapture(event.pointerId); paint(event) }
  canvas.onpointermove = paint
  canvas.onpointerup = canvas.onpointercancel = () => { painting = false }
  return {
    lock(value) { locked = value; painting = false },
    visible(value) { section.hidden = !value },
    configure(getReferences, say) { refs = getReferences; report = say },
    async store() {
      if (!original) throw new Error('Load a source into the mask editor first.')
      if (refs()[0]?.id !== sourceId) throw new Error('References changed. Reload the first reference into the mask editor.')
      const capturedRevision = revision, capturedRefs = JSON.stringify(refs()), capturedId = sourceId
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const sourcePixels = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height)
      const maskCanvas = document.createElement('canvas'); maskCanvas.width = pixels.width; maskCanvas.height = pixels.height; maskCanvas.getContext('2d').putImageData(pixels, 0, 0)
      const source = document.createElement('canvas'); source.width = sourcePixels.width; source.height = sourcePixels.height
      source.getContext('2d').putImageData(sourcePixels, 0, 0)
      const valid = () => { if (capturedRevision !== revision || capturedId !== sourceId || capturedRefs !== JSON.stringify(refs())) throw new Error('编辑来源已更改，请重新提交。') }
      const blob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'))
      const mask = await request('storeImage', { bytes: [...new Uint8Array(await blob.arrayBuffer())], filename: 'replacement-mask.png' })
      valid()
      const sourceBlob = await new Promise(resolve => source.toBlob(resolve, 'image/png'))
      const ref = await request('storeImage', { bytes: [...new Uint8Array(await sourceBlob.arrayBuffer())], filename: 'extended-source.png' })
      valid()
      return { mask, ref }
    }
  }
}
