import { createMaskEditor } from './mask-editor.js'
const panel = document.createElement('section')
panel.innerHTML = `<h2>图像工作台</h2><p id="studio-status" role="status"></p><label>工作流 <select id="mode"><option value="image.generate">生成</option><option value="image.edit">参考图编辑</option></select></label><label>模型 <select id="model"></select></label><label>提示词（每行一个任务）<textarea id="prompts" rows="4"></textarea></label><button id="reference">导入参考图</button><ol id="references"></ol><button id="submit">提交批次</button><h3>历史记录</h3><div id="history"></div>`
document.querySelector('main').prepend(panel)
const $ = id => panel.querySelector(`#${id}`)
const say = text => { $('studio-status').textContent = text }
const request = (action, params = {}) => window.componentHost.request({ action, ...params })
let models = [], references = [], busy = false, refreshing = false
const cache = new Map(), cards = new Map()
let page = 0
const filters = document.createElement('div')
filters.innerHTML = `<label>搜索 <input id="search" type="search" placeholder="提示词 / 状态"></label><label>起始日期 <input id="date" type="date"></label><button id="previous-page">上一页</button><span id="page-status"></span><button id="next-page">下一页</button>`
$('history').before(filters)
function filterHistory() {
  const query = $('search').value.trim().toLowerCase(), date = $('date').value
  const matches = [...cache.values()].filter(job => JSON.stringify([job.request.params.prompt, job.state]).toLowerCase().includes(query) && (!date || (job.events?.[0]?.at || '') >= date))
  page = Math.min(page, Math.max(0, Math.ceil(matches.length / 8) - 1))
  const visible = new Set(matches.slice(page * 8, page * 8 + 8).map(job => job.id))
  for (const [id, card] of cards) card.hidden = !visible.has(id)
  $('page-status').textContent = `${page + 1} / ${Math.max(1, Math.ceil(matches.length / 8))}`
  $('previous-page').disabled = page === 0; $('next-page').disabled = (page + 1) * 8 >= matches.length
}
for (const id of ['search', 'date']) $(id).oninput = () => { page = 0; filterHistory() }
$('previous-page').onclick = () => { page--; filterHistory() }
$('next-page').onclick = () => { page++; filterHistory() }
const masked = new Option('局部重绘 / 扩图', 'masked'); $('mode').append(masked)
const localMode = new Option('本地预处理', 'local'); $('mode').append(localMode)
const navigation = document.createElement('nav'); navigation.setAttribute('aria-label', '图像工作流')
for (const [label, value] of [['生成', 'image.generate'], ['参考图编辑', 'image.edit'], ['局部重绘 / 扩图', 'masked'], ['本地预处理', 'local']]) {
  const button = document.createElement('button'); button.textContent = label; button.dataset.mode = value
  button.onclick = () => { $('mode').value = value; showModels() }; navigation.append(button)
}
$('mode').parentElement.after(navigation); $('mode').parentElement.hidden = true
const localSections = [...document.querySelector('main').children].filter(node => node !== panel)
const maskEditor = createMaskEditor(panel, request)
maskEditor.configure(() => references, say)
const operation = () => $('mode').value === 'masked' ? 'image.edit' : $('mode').value
const options = document.createElement('div')
options.innerHTML = `<label>尺寸 <select id="size"><option value="">模型默认</option></select></label><label>质量 <select id="quality"><option value="">模型默认</option></select></label><label>格式 <select id="format"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option></select></label><label>数量 <input id="count" type="number" min="1" max="4" value="1"></label>`
$('prompts').parentElement.after(options)
function modelOptions() {
  const model = models.find(m => m.id === $('model').value)
  const format = $('format').value
  const formats = model?.outputFormats || ['png']
  $('format').replaceChildren(...formats.map(value => new Option(value.toUpperCase(), value)))
  if (formats.includes(format)) $('format').value = format
  masked.hidden = !models.some(candidate => candidate.operations.includes('image.edit') && candidate.supportsMask === true)
  navigation.querySelector('[data-mode="masked"]').hidden = masked.hidden
  maskEditor.visible($('mode').value === 'masked' && !masked.hidden)
  for (const [id, values] of [['size', model?.sizes], ['quality', model?.qualities]]) {
    const previous = $(id).value
    $(id).replaceChildren(new Option('模型默认', ''), ...(values || []).map(value => new Option(value, value)))
    if ((values || []).includes(previous)) $(id).value = previous
  }
}
$('model').onchange = modelOptions
function showModels() {
  for (const button of navigation.children) button.setAttribute('aria-pressed', String(button.dataset.mode === $('mode').value))
  const local = $('mode').value === 'local'
  for (const node of localSections) node.hidden = !local
  for (const node of [options, $('prompts').parentElement, $('reference'), $('references'), $('submit')]) node.hidden = local
  const selected = $('model').value
  $('model').replaceChildren(...models.filter(m => m.operations.includes(operation()) && ($('mode').value !== 'masked' || m.supportsMask === true)).map(m => new Option(m.label, m.id)))
  if ([...$('model').options].some(option => option.value === selected)) $('model').value = selected
  $('submit').disabled = !$('model').value || busy
  modelOptions()
}
$('mode').onchange = showModels
function renderReferences() {
  $('references').replaceChildren(...references.map((ref, index) => {
    const row = document.createElement('li')
    row.textContent = ref.filename || ref.id || ref.assetId
    const move = document.createElement('button'); move.textContent = '前移'; move.disabled = index === 0
    move.onclick = () => { [references[index - 1], references[index]] = [ref, references[index - 1]]; renderReferences() }
    const remove = document.createElement('button'); remove.textContent = '移除'
    remove.onclick = () => { references.splice(index, 1); renderReferences() }
    row.append(move, remove); return row
  }))
}
$('reference').onclick = async () => {
  try { const ref = await request('importAsset'); if (ref) { references.push(ref); renderReferences() } } catch (error) { say(error.message) }
}
$('submit').onclick = async () => {
  if (busy) return
  const prompts = $('prompts').value.split('\n').map(s => s.trim()).filter(Boolean)
  if (!prompts.length) return say('请输入提示词。')
  if (operation() === 'image.edit' && !references.length) return say('请先导入参考图。')
  const mode = $('mode').value, selectedOperation = operation()
  const model = models.find(item => item.id === $('model').value)
  if (!model || (mode === 'masked' && model.supportsMask !== true)) return say('当前模型不支持该编辑模式。')
  const inputRefs = structuredClone(references)
  const params = { modelProfileId: model.id, outputFormat: $('format').value, count: Number($('count').value), ...($('size').value ? { size: $('size').value } : {}), ...($('quality').value ? { quality: $('quality').value } : {}) }
  if (!(model.outputFormats || ['png']).includes(params.outputFormat)) return say('当前模型不支持该输出格式。')
  const controls = [...panel.querySelectorAll('button,input,select,textarea')]
  const disabled = controls.map(control => control.disabled)
  busy = true; controls.forEach(control => { control.disabled = true }); maskEditor.lock(true)
  try {
    const mask = mode === 'masked' ? await maskEditor.store() : null
    const count = params.count
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('Count must be 1–4.')
    for (const prompt of prompts) await request('submit', { operation: selectedOperation, idempotencyKey: crypto.randomUUID(), params: { ...params, prompt, ...(mask ? { maskAssetId: mask.mask.id } : {}) }, inputAssets: structuredClone(mask ? [mask.ref, ...inputRefs.slice(1), mask.mask] : selectedOperation === 'image.edit' ? inputRefs : []) })
    say('已提交，关闭此界面后任务仍会继续。'); await refresh()
  } catch (error) { say(error.message) } finally { busy = false; controls.forEach((control, index) => { control.disabled = disabled[index] }); maskEditor.lock(false); showModels() }
}
async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
  const result = await request('listJobs')
  const jobs = (Array.isArray(result) ? result : result.jobs || []).filter(job => ['image.generate', 'image.edit'].includes(job.request.operation))
  await Promise.all(jobs.map(async job => {
    const previous = cache.get(job.id)
    const events = await request('events', { jobId: job.id, afterSequence: previous?.sequence || 0 })
    const output = [...(previous?.outputs || []), ...events.flatMap(event => event.data?.assets || (event.type === 'asset' ? [event.data] : []))]
    job.outputs = [...new Map(output.map(ref => [ref.id || ref.assetId, ref])).values()]
    job.sequence = Math.max(previous?.sequence || 0, ...events.map(event => event.sequence))
    cache.set(job.id, job)
  }))
  const activeIds = new Set(jobs.map(job => job.id))
  for (const [id, card] of cards) if (!activeIds.has(id)) { card.remove(); cards.delete(id); cache.delete(id) }
  jobs.forEach(job => {
    const signature = JSON.stringify([job.state, job.sequence, job.outputs])
    if (cards.get(job.id)?.dataset.signature === signature) return
    const card = document.createElement('article')
    card.dataset.signature = signature
    const title = document.createElement('p'); title.textContent = `${job.request?.operation === 'image.edit' ? '图像编辑' : '图像生成'} · ${{accepted:'排队中',running:'生成中',succeeded:'已完成',failed:'失败',cancelled:'已取消','cancel-requested':'正在取消','reconciliation-required':'待确认'}[job.state] || '待确认'}`
    const prompt = document.createElement('p'); prompt.textContent = job.request.params.prompt; card.append(prompt)
    const reuse = document.createElement('button'); reuse.textContent = '复用参数'
    reuse.onclick = () => { const params = job.request.params; $('prompts').value = params.prompt || ''; references = [...job.request.inputAssets].filter(ref => ref.id !== params.maskAssetId); $('mode').value = job.request.operation; showModels(); $('model').value = params.modelProfileId || ''; modelOptions(); for (const id of ['size', 'quality']) $(id).value = params[id] || ''; $('format').value = params.outputFormat || 'png'; $('count').value = params.count || 1; renderReferences(); if (params.maskAssetId) say('已复用提示词和源图。要继续局部编辑，请重新载入并绘制蒙版；重试可保留原蒙版。') }
    const retry = document.createElement('button'); retry.textContent = '重试'
    retry.onclick = async () => { try { await request('submit', { operation: job.request.operation, params: job.request.params, inputAssets: job.request.inputAssets, idempotencyKey: crypto.randomUUID() }); await refresh() } catch (error) { say(error.message) } }
    const cancel = document.createElement('button'); cancel.textContent = '取消'
    cancel.onclick = async () => { try { await request('cancel', { jobId: job.id }); await refresh() } catch (error) { say(error.message) } }
    card.append(title, reuse, retry, cancel)
    const terminal = ['succeeded', 'failed', 'cancelled'].includes(job.state)
    cancel.hidden = terminal
    if (terminal) { const remove = document.createElement('button'); remove.textContent = '删除记录'; remove.onclick = async () => { try { await request('deleteJob', { jobId: job.id }); await refresh() } catch (error) { say(error.message) } }; card.append(remove) }
    for (const ref of job.outputs || []) {
      const thumbnail = document.createElement('img'); thumbnail.alt = ref.filename || '生成图像'; thumbnail.loading = 'lazy'; thumbnail.style.maxWidth = '100%'
      request('previewAsset', { ref }).then(url => { thumbnail.src = url }).catch(error => say(error.message)); card.append(thumbnail)
      const preview = document.createElement('button'); preview.textContent = '查看原图'
      preview.onclick = async () => { try { const url = await request('previewAsset', { ref }); const image = document.createElement('img'); image.src = url; image.alt = '生成结果'; image.style.maxWidth = '100%'; card.append(image) } catch (error) { say(error.message) } }
      const save = document.createElement('button'); save.textContent = '导出'
      save.onclick = async () => { try { await request('exportAsset', { ref }) } catch (error) { say(error.message) } }
      card.append(preview, save)
    }
    const previous = cards.get(job.id)
    if (previous) previous.replaceWith(card); else $('history').append(card)
    cards.set(job.id, card)
  })
  filterHistory()
  } finally { refreshing = false }
}
if (!window.componentHost) { say('请在 MAM 中打开，并在设置 → 创作模型中配置图像模型。'); $('submit').disabled = true }
else {
  try { const result = await request('listModels'); models = (Array.isArray(result) ? result : result.models || []).filter(m => m.kind === 'image'); showModels(); if (!models.length) say('没有可用图像模型，请在 MAM 设置 → 创作模型中配置图像模型。'); await refresh() } catch (error) { say(error.message) }
  setInterval(() => refresh().catch(error => say(error.message)), 3000)
}
