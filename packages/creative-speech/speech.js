const $ = id => document.getElementById(id)
const say = text => { $('status').textContent = text }
const request = (action, params = {}) => window.componentHost.request({ action, ...params })
let models = [], busy = false, refreshing = false
const cache = new Map(), cards = new Map()
function options() {
  const model = models.find(item => item.id === $('model').value)
  for (const [id, values] of [['voice', model?.voices || []], ['format', model?.outputFormats || ['mp3']]]) {
    const previous = $(id).value
    $(id).replaceChildren(...values.map(value => new Option(value, value)))
    if (values.includes(previous)) $(id).value = previous
  }
}
$('model').onchange = options
document.querySelector('form').onsubmit = async event => {
  event.preventDefault(); if (busy) return
  const prompt = $('prompt').value.trim(), model = models.find(item => item.id === $('model').value)
  if (!model || !prompt) return say('请选择模型并输入朗读文本。')
  const params = { modelProfileId: model.id, prompt, outputFormat: $('format').value, ...($('voice').value ? { voice: $('voice').value } : {}) }
  busy = true
  const controls = [...document.querySelectorAll('form button,form select,form textarea')]; controls.forEach(control => { control.disabled = true })
  try { await request('submit', { operation: 'speech.generate', idempotencyKey: crypto.randomUUID(), params, inputAssets: [] }); say('已提交，关闭窗口后任务继续。'); await refresh() } catch (error) { say(error.message) }
  finally { busy = false; controls.forEach(control => { control.disabled = false }) }
}
async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
    const result = await request('listJobs'), jobs = (Array.isArray(result) ? result : result.jobs || []).filter(job => job.request.operation === 'speech.generate')
    for (const job of jobs) {
      const previous = cache.get(job.id), events = await request('events', { jobId: job.id, afterSequence: previous?.sequence || 0 })
      const outputs = [...(previous?.outputs || []), ...events.flatMap(event => event.data?.assets || (event.type === 'asset' ? [event.data] : []))]
      job.outputs = [...new Map(outputs.map(ref => [ref.id, ref])).values()]; job.sequence = Math.max(previous?.sequence || 0, ...events.map(event => event.sequence)); cache.set(job.id, job)
      const signature = JSON.stringify([job.state, job.sequence, job.outputs]); if (cards.get(job.id)?.dataset.signature === signature) continue
      const card = document.createElement('article'); card.dataset.signature = signature
      const text = document.createElement('p'); text.textContent = job.request.params.prompt
      const state = document.createElement('p'); state.textContent = ({accepted:'排队中',running:'生成中',succeeded:'已完成',failed:'失败',cancelled:'已取消','cancel-requested':'取消中'})[job.state] || '待确认'
      card.append(state, text)
      const action = (label, fn) => { const button = document.createElement('button'); button.textContent = label; button.onclick = async () => { try { await fn() } catch (error) { say(error.message) } }; card.append(button) }
      action('复用', () => { if (busy) return; const params = job.request.params; $('model').value = params.modelProfileId; options(); $('prompt').value = params.prompt; $('voice').value = params.voice || ''; $('format').value = params.outputFormat || $('format').value })
      action('重试', async () => { await request('submit', { operation:'speech.generate', idempotencyKey:crypto.randomUUID(), params:structuredClone(job.request.params), inputAssets:[] }); await refresh() })
      const terminal = ['succeeded','failed','cancelled'].includes(job.state)
      action(terminal ? '删除记录' : '取消', async () => { await request(terminal ? 'deleteJob' : 'cancel', {jobId:job.id}); await refresh() })
      for (const ref of job.outputs) {
        const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.setAttribute('aria-label', ref.filename); card.append(audio)
        request('previewAsset', { ref }).then(url => { audio.src = url }).catch(error => say(error.message))
        action('导出原始音频', () => request('exportAsset', { ref }))
      }
      const old = cards.get(job.id); if (old) old.replaceWith(card); else $('history').append(card); cards.set(job.id,card)
    }
    const ids = new Set(jobs.map(job => job.id)); for (const [id,card] of cards) if (!ids.has(id)) {card.remove(); cards.delete(id); cache.delete(id)}
  } finally { refreshing = false }
}
if (!window.componentHost) { say('请在 MAM 中打开，并在设置 → 创作模型配置语音模型。'); $('submit').disabled = true }
else { try { const result = await request('listModels'); models = (Array.isArray(result) ? result : result.models || []).filter(model => model.kind === 'speech' && model.operations.includes('speech.generate')); $('model').replaceChildren(...models.map(model => new Option(model.label,model.id))); options(); $('submit').disabled = !models.length; if (!models.length) say('没有可用语音模型，请在 MAM 设置 → 创作模型配置语音模型。'); await refresh() } catch(error) {say(error.message)}; setInterval(() => refresh().catch(error => say(error.message)),3000) }
