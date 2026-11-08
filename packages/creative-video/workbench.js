const $ = (id) => document.getElementById(id)
const request = (action, values = {}) => window.componentHost.request({ action, ...values })
const say = (value) => {
  $('status').textContent = value
}
const labels = {
  text: '文字生成',
  image: '首图生成',
  first_last: '首尾帧',
  reference: '多图参考',
  video: '视频编辑'
}
const states = {
  accepted: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  'cancel-requested': '正在停止本地跟踪',
  'reconciliation-required': '跟踪已中断，可查询远程任务'
}
let models = [],
  refs = [],
  busy = false,
  refreshing = false
const jobs = new Map()
const cards = new Map()
const selectedModel = () => models.find((model) => model.id === $('model').value)
function options(id, values, title = '模型默认') {
  const old = $(id).value
  $(id).replaceChildren(
    new Option(title, ''),
    ...values.map((value) => new Option(String(value), String(value)))
  )
  if (values.map(String).includes(old)) $(id).value = old
}
function capabilities() {
  const model = selectedModel(),
    old = $('mode').value
  const modes = (model?.supportedVideoModes || ['text']).filter(
    (mode) => mode !== 'video' || model?.operations?.includes('video.edit')
  )
  $('mode').replaceChildren(...modes.map((mode) => new Option(labels[mode] || mode, mode)))
  if (modes.includes(old)) $('mode').value = old
  options('duration', model?.durations || [])
  options('resolution', model?.resolutions || [])
  options('ratio', model?.aspectRatios || [])
  $('submit').disabled = busy || !model
  referenceMode()
}
function referenceMode() {
  const mode = $('mode').value
  $('reference-area').hidden = mode === 'text'
  $('reference-help').textContent =
    mode === 'video'
      ? '导入一个本地视频。只会发送所选素材，不读取其他文件。'
      : mode === 'first_last'
        ? '依次导入首帧和尾帧，共两张图片。'
        : mode === 'reference'
          ? '依次导入一至三张参考图片。'
          : '导入一张参考图片。'
}
function renderRefs() {
  $('references').replaceChildren(
    ...refs.map((ref, index) => {
      const row = document.createElement('li')
      row.textContent = ref.filename
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = '移除'
      remove.disabled = busy
      remove.onclick = () => {
        refs.splice(index, 1)
        renderRefs()
      }
      row.append(remove)
      return row
    })
  )
}
$('model').onchange = () => {
  refs = []
  renderRefs()
  capabilities()
}
$('mode').onchange = () => {
  refs = []
  renderRefs()
  referenceMode()
}
$('import').onclick = async () => {
  if (busy) return
  const mode = $('mode').value,
    modelId = $('model').value
  try {
    const ref = await request('importAsset')
    if (mode !== $('mode').value || modelId !== $('model').value || busy || !ref) return
    const video = mode === 'video'
    if (!(video ? ref.mime?.startsWith('video/') : ref.mime?.startsWith('image/')))
      throw new Error(video ? '请选择视频文件。' : '请选择图片。')
    const maximum = mode === 'reference' ? 3 : mode === 'first_last' ? 2 : 1
    if (refs.length >= maximum) throw new Error(`此模式最多使用 ${maximum} 个素材。`)
    refs.push(ref)
    renderRefs()
  } catch (error) {
    say(error.message)
  }
}
$('generation').onsubmit = async (event) => {
  event.preventDefault()
  if (busy) return
  const model = selectedModel(),
    mode = $('mode').value,
    prompt = $('prompt').value.trim()
  if (!model || !prompt || !(model.supportedVideoModes || ['text']).includes(mode))
    return say('请选择支持的模型和模式，并输入提示词。')
  const inputAssets = structuredClone(mode === 'text' ? [] : refs)
  const count = mode === 'first_last' ? 2 : mode === 'reference' ? null : mode === 'text' ? 0 : 1
  if (count === null ? !inputAssets.length || inputAssets.length > 3 : inputAssets.length !== count)
    return say('素材数量不符合当前模式。')
  const params = {
    modelProfileId: model.id,
    prompt,
    mode,
    ...($('duration').value ? { duration: Number($('duration').value) } : {}),
    ...($('resolution').value ? { resolution: $('resolution').value } : {}),
    ...($('ratio').value ? { aspectRatio: $('ratio').value } : {})
  }
  const controls = [...$('generation').querySelectorAll('button,select,textarea')]
  busy = true
  controls.forEach((control) => {
    control.disabled = true
  })
  try {
    await request('submit', {
      operation: mode === 'video' ? 'video.edit' : 'video.generate',
      params,
      inputAssets,
      idempotencyKey: crypto.randomUUID()
    })
    say('任务已提交。关闭工作台不会自动重新提交远程任务。')
    await refresh()
  } catch (error) {
    say(error.message)
  } finally {
    busy = false
    controls.forEach((control) => {
      control.disabled = false
    })
    capabilities()
    renderRefs()
  }
}
function button(label, action) {
  const element = document.createElement('button')
  element.textContent = label
  element.onclick = async () => {
    element.disabled = true
    try {
      await action()
      await refresh()
    } catch (error) {
      say(error.message)
    } finally {
      element.disabled = false
    }
  }
  return element
}
async function render(job) {
  const article = document.createElement('article'),
    title = document.createElement('h3'),
    prompt = document.createElement('p')
  title.textContent = states[job.state] || '待确认'
  prompt.textContent = job.request.params.prompt || '查询远程视频任务'
  article.append(title, prompt)
  const receipt = job.events.find((event) => event.data?.type === 'remote_task')?.data
  const progress = [...job.events]
    .reverse()
    .find((event) => event.data?.type === 'remote_progress')?.data
  if (receipt || progress) {
    const text = document.createElement('p')
    text.textContent = `远程任务 ${receipt?.remoteId || progress.remoteId}${progress ? ` · ${progress.status || '处理中'}${Number.isFinite(progress.progress) ? ` · ${progress.progress}%` : ''}` : ''}`
    article.append(text)
  }
  if (['accepted', 'running'].includes(job.state))
    article.append(button('停止本地跟踪', () => request('cancel', { jobId: job.id })))
  if (receipt && ['reconciliation-required', 'failed', 'cancelled'].includes(job.state)) {
    const note = document.createElement('p')
    note.textContent = '查询已有远程任务，不会再次创建视频。原任务记录保留待确认状态。'
    article.append(note)
    article.append(
      button('恢复查询', () =>
        request('submit', {
          operation: 'video.refresh',
          params: { sourceJobId: job.id },
          inputAssets: [],
          idempotencyKey: crypto.randomUUID()
        })
      )
    )
  }
  const outputs = job.events.flatMap((event) => (event.type === 'asset' ? [event.data] : []))
  for (const ref of [...new Map(outputs.map((ref) => [ref.id, ref])).values()]) {
    const video = document.createElement('video')
    video.controls = true
    video.preload = 'metadata'
    video.setAttribute('aria-label', ref.filename || '生成视频')
    try {
      video.src = await request('previewAsset', { ref })
    } catch (error) {
      say(error.message)
    }
    article.append(
      video,
      button('导出视频', () => request('exportAsset', { ref }))
    )
  }
  return article
}
async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
    const result = await request('listJobs'),
      list = (Array.isArray(result) ? result : result.jobs || []).filter((job) =>
        ['video.generate', 'video.edit', 'video.refresh'].includes(job.request.operation)
      )
    for (const job of list) {
      const previous = jobs.get(job.id),
        events = await request('events', { jobId: job.id, afterSequence: previous?.sequence || 0 })
      job.events = [...(previous?.events || []), ...events]
      job.sequence = Math.max(previous?.sequence || 0, ...events.map((event) => event.sequence))
      jobs.set(job.id, job)
    }
    const live = new Set(list.map((job) => job.id))
    for (const [id, card] of cards)
      if (!live.has(id)) {
        card.element.remove()
        cards.delete(id)
        jobs.delete(id)
      }
    for (const job of list) {
      const current = jobs.get(job.id),
        signature = JSON.stringify([current.state, current.sequence])
      const previous = cards.get(job.id)
      if (previous?.signature === signature) continue
      const element = await render(current)
      if (previous) previous.element.replaceWith(element)
      else $('history').append(element)
      cards.set(job.id, { element, signature })
    }
  } finally {
    refreshing = false
  }
}
$('refresh').onclick = () => refresh().catch((error) => say(error.message))
if (!window.componentHost) {
  say('请在 MAM 中打开视频工作台。')
  $('submit').disabled = true
} else {
  try {
    const result = await request('listModels')
    models = (Array.isArray(result) ? result : result.models || []).filter(
      (model) => model.kind === 'video'
    )
    $('model').replaceChildren(...models.map((model) => new Option(model.label, model.id)))
    capabilities()
    if (!models.length) say('没有可用视频模型，请在 MAM 设置中配置。')
    await refresh()
  } catch (error) {
    say(error.message)
  }
  setInterval(() => refresh().catch((error) => say(error.message)), 3000)
}
