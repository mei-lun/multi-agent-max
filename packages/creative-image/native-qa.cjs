const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, '.mam-local/creative-image-qa')
app.setPath('userData', path.join(output, 'isolated-profile'))
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true })
  const window = new BrowserWindow({ width: 720, height: 780, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const run = code => window.webContents.executeJavaScript(code, true)
  await window.loadFile(path.join(root, '.mam-local/component-packages/creative-image/index.html'))
  await run(`document.getElementById('mode').value='local';document.getElementById('mode').dispatchEvent(new Event('change'))`)
  await run(`(async()=>{const c=document.createElement('canvas');c.width=15;c.height=15;const x=c.getContext('2d');x.fillStyle='#00ff00';x.fillRect(0,0,15,15);x.fillStyle='#dc2828';x.fillRect(4,4,7,7);x.fillStyle='#00ff00';x.fillRect(7,7,1,1);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'fixture.png',{type:'image/png'}));const input=document.getElementById('file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  for (let i = 0; i < 100; i++) { if (await run(`!document.getElementById('apply').disabled`)) break; await new Promise(resolve => setTimeout(resolve, 20)) }
  const original = await run(`Array.from(document.getElementById('original').getContext('2d').getImageData(0,0,15,15).data)`)
  assert.equal(original.length, 900)
  await run(`document.getElementById('apply').click()`)
  const processed = await run(`Array.from(document.getElementById('processed').getContext('2d').getImageData(0,0,15,15).data)`)
  assert.equal(processed[3], 0)
  assert.deepEqual(processed.slice(448, 452), [0, 255, 0, 255])
  assert.deepEqual(await run(`Array.from(document.getElementById('original').getContext('2d').getImageData(0,0,15,15).data)`), original)
  const download = new Promise((resolve, reject) => window.webContents.session.once('will-download', (_event, item) => {
    item.setSavePath(path.join(output, 'processed.png'))
    item.once('done', (_event, state) => state === 'completed' ? resolve() : reject(new Error(state)))
  }))
  await run(`document.getElementById('export').click()`)
  await download
  const decoded = nativeImage.createFromPath(path.join(output, 'processed.png'))
  assert.deepEqual(decoded.getSize(), { width: 15, height: 15 })
  const bitmap = decoded.toBitmap()
  assert.equal(bitmap[3], 0)
  assert.equal(bitmap[451], 255)
  await window.webContents.debugger.attach('1.3')
  for (const mode of ['light', 'dark']) {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] })
    await new Promise(resolve => setTimeout(resolve, 100))
    const metrics = await run(`({width:innerWidth,scroll:document.documentElement.scrollWidth,bg:getComputedStyle(document.body).backgroundColor,canvases:[...document.querySelectorAll('#original,#processed')].map(c=>({width:c.clientWidth,height:c.clientHeight}))})`)
    assert.ok(metrics.scroll <= metrics.width)
    assert.ok(metrics.canvases.every(canvas => canvas.width > 0 && canvas.height > 0))
    await fs.writeFile(path.join(output, `${mode}.png`), (await window.webContents.capturePage()).toPNG())
    await fs.writeFile(path.join(output, `${mode}.json`), JSON.stringify(metrics))
  }
  await run(`document.getElementById('restore').click()`)
  assert.deepEqual(await run(`Array.from(document.getElementById('processed').getContext('2d').getImageData(0,0,15,15).data)`), original)
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: ['real file input decode', 'apply', 'enclosed detail', 'original unchanged', 'PNG download and decode alpha', 'light/dark at 720px', 'restore'] }, null, 2))
  // Explicitly mocked host: exercise UI controls, not provider or IPC behavior.
  await run(`(async()=>{window.componentHost={calls:[],jobs:[],async request(r){this.calls.push(r);if(r.action==='listModels')return [{id:'mock-image',label:'Mock QA',kind:'image',operations:['image.generate','image.edit'],sizes:['1024x1024'],qualities:['standard']}];if(r.action==='listJobs')return this.jobs;if(r.action==='events')return [];if(r.action==='submit'){const id='job-'+this.jobs.length;this.jobs.push({id,state:'succeeded',events:[],request:r});return id}if(r.action==='deleteJob'){this.jobs=this.jobs.filter(j=>j.id!==r.jobId);return true}return null}};await import(new URL('./generation.js?mockqa',location.href).href)})()`)
  await run(`document.querySelectorAll('#prompts')[0].value='mock button prompt';document.querySelectorAll('#submit')[0].click()`)
  for (let i = 0; i < 100; i++) { if (await run(`window.componentHost.jobs.length===1&&document.querySelectorAll('#history')[0].querySelector('article')!==null`)) break; await new Promise(resolve => setTimeout(resolve, 20)) }
  assert.equal(await run(`window.componentHost.jobs[0].request.params.prompt`), 'mock button prompt')
  await run(`document.querySelectorAll('#history')[0].querySelectorAll('button')[1].click()`)
  for (let i = 0; i < 100; i++) { if (await run(`window.componentHost.jobs.length===2`)) break; await new Promise(resolve => setTimeout(resolve, 20)) }
  assert.equal(await run(`window.componentHost.jobs.length`), 2)
  await run(`document.querySelectorAll('#prompts')[0].value='changed';document.querySelectorAll('#history')[0].querySelector('button').click()`)
  assert.equal(await run(`document.querySelectorAll('#prompts')[0].value`), 'mock button prompt')
  await fs.writeFile(path.join(output, 'mock-controls.json'), JSON.stringify({ mock: true, passed: true, checks: ['real submit button', 'retry button', 'reuse prompt'] }))
  await run(`(async()=>{const host=window.componentHost;const original=host.request.bind(host);host.request=async r=>{if(r.action==='submit'&&!host.release){await new Promise(resolve=>host.release=resolve)}return original(r)};document.querySelector('#prompts').value='batch-one\\nbatch-two';document.querySelector('#submit').click()})()`)
  for (let i = 0; i < 100; i++) { if (await run(`!!window.componentHost.release`)) break; await new Promise(resolve => setTimeout(resolve, 20)) }
  assert.equal(await run(`document.querySelector('#model').disabled&&document.querySelector('#reference').disabled`), true)
  await run(`document.querySelector('#mode').value='image.edit';document.querySelector('#format').value='webp';window.componentHost.release()`)
  for (let i = 0; i < 100; i++) { if (await run(`window.componentHost.jobs.length===4`)) break; await new Promise(resolve => setTimeout(resolve, 20)) }
  assert.deepEqual(await run(`window.componentHost.jobs.slice(-2).map(job=>[job.request.operation,job.request.params.outputFormat,job.request.params.prompt])`), [['image.generate', 'png', 'batch-one'], ['image.generate', 'png', 'batch-two']])
  await run(`(async()=>{const {createMaskEditor}=await import(new URL('./mask-editor.js',location.href).href);const container=document.createElement('div');document.body.append(container);const refs=[{id:'source-a'}];let resolveStore;const source=document.createElement('canvas');source.width=4;source.height=4;source.getContext('2d').fillRect(0,0,4,4);const editor=createMaskEditor(container,async(action)=>{if(action==='previewAsset')return source.toDataURL();if(action==='storeImage')return new Promise(resolve=>resolveStore=resolve)});editor.configure(()=>refs,()=>{});container.querySelector('#load-source').click();while(container.querySelector('#mask-source').width!==4)await new Promise(r=>setTimeout(r,10));editor.lock(true);window.maskRace=editor.store().then(()=>false,()=>true);while(!resolveStore)await new Promise(r=>setTimeout(r,10));refs[0]={id:'source-b'};resolveStore({id:'mask'});window.maskRaceRejected=await window.maskRace;container.remove()})()`)
  assert.equal(await run(`window.maskRaceRejected`), true)
  await fs.writeFile(path.join(output, 'mock-races.json'), JSON.stringify({ mock: true, passed: true, checks: ['delayed batch immutable mode and format', 'controls locked', 'delayed mask store rejects changed reference'] }))
  await run(`(async()=>{const host=window.componentHost,original=host.request.bind(host);host.request=async r=>r.action==='listModels'?[{id:'gpt',label:'GPT fixture',kind:'image',operations:['image.generate','image.edit'],supportsMask:true,outputFormats:['png','webp']},{id:'native',label:'Native fixture',kind:'image',operations:['image.generate','image.edit'],supportsMask:false,outputFormats:['png']}]:original(r);await import(new URL('./generation.js?capabilityqa',location.href).href);const model=document.querySelector('#model');model.value='gpt';model.dispatchEvent(new Event('change'));document.querySelector('#format').value='webp';model.value='native';model.dispatchEvent(new Event('change'));window.nativeFormat=[...document.querySelector('#format').options].map(o=>o.value);const mode=document.querySelector('#mode');mode.value='masked';mode.dispatchEvent(new Event('change'));window.maskModels=[...model.options].map(o=>o.value)})()`)
  assert.deepEqual(await run(`window.nativeFormat`), ['png'])
  assert.deepEqual(await run(`window.maskModels`), ['gpt'])
  for (const scheme of ['light', 'dark']) {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    for (const mode of ['image.generate', 'image.edit', 'masked', 'local']) {
      await run(`document.querySelector('#mode').value=${JSON.stringify(mode)};document.querySelector('#mode').dispatchEvent(new Event('change'))`)
      assert.ok(await run(`document.documentElement.scrollWidth <= innerWidth`))
      await fs.writeFile(path.join(output, `mock-${scheme}-${mode.replace('.', '-')}.png`), (await window.webContents.capturePage()).toPNG())
    }
  }
  window.destroy(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
