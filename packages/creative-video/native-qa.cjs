const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..'),
  output = path.join(root, '.mam-local/creative-video-qa')
app.setPath('userData', path.join(output, 'isolated-profile'))
app
  .whenReady()
  .then(async () => {
    await fs.mkdir(output, { recursive: true })
    const window = new BrowserWindow({
      width: 720,
      height: 780,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    const run = (code) => window.webContents.executeJavaScript(code, true)
    await window.loadFile(
      path.join(root, '.mam-local/component-packages/creative-video/index.html')
    )
    await run(
      `(async()=>{window.componentHost={calls:[],jobs:[],events:{},async request(r){this.calls.push(r);if(r.action==='listModels')return [{id:'video',label:'视频测试模型',kind:'video',operations:['video.generate','video.edit'],supportedVideoModes:['text','image','video'],durations:[5,10],resolutions:['720p'],aspectRatios:['16:9']}];if(r.action==='listJobs')return this.jobs;if(r.action==='events')return (this.events[r.jobId]||[]).filter(e=>e.sequence>r.afterSequence);if(r.action==='importAsset')return {id:'source',mime:document.querySelector('#mode').value==='video'?'video/mp4':'image/png',filename:'fixture',bytes:10};if(r.action==='submit'){const id='job-'+this.jobs.length;this.jobs.push({id,state:'running',request:r});this.events[id]=[];return id}if(r.action==='cancel')return true;if(r.action==='previewAsset')return 'data:video/mp4;base64,AAAA';if(r.action==='exportAsset')return true;return null}};await import('./workbench.js?nativeqa')})()`
    )
    await run(
      `document.querySelector('#prompt').value='视频提示';document.querySelector('#duration').value='5';document.querySelector('#resolution').value='720p';document.querySelector('#generation').requestSubmit()`
    )
    const wait = async (condition) => {
      for (let i = 0; i < 100; i++) {
        if (await run(condition)) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw Error('Timed out: ' + condition)
    }
    await wait(
      `window.componentHost.jobs.length===1&&document.querySelector('article button')!==null`
    )
    assert.deepEqual(await run(`window.componentHost.jobs[0].request.params`), {
      modelProfileId: 'video',
      prompt: '视频提示',
      mode: 'text',
      duration: 5,
      resolution: '720p'
    })
    await run(`document.querySelector('article button').click()`)
    await wait(`window.componentHost.calls.some(r=>r.action==='cancel'&&r.jobId==='job-0')`)
    await run(
      `window.componentHost.jobs[0].state='reconciliation-required';window.componentHost.events['job-0']=[{sequence:1,type:'log',data:{type:'remote_task',remoteId:'remote-original'}}];document.querySelector('#refresh').click()`
    )
    await wait(
      `[...document.querySelectorAll('article button')].some(b=>b.textContent==='恢复查询')`
    )
    await run(
      `[...document.querySelectorAll('article button')].find(b=>b.textContent==='恢复查询').click()`
    )
    await wait(`window.componentHost.jobs.length===2`)
    assert.deepEqual(await run(`window.componentHost.jobs[1].request`), {
      action: 'submit',
      operation: 'video.refresh',
      params: { sourceJobId: 'job-0' },
      inputAssets: [],
      idempotencyKey: await run(`window.componentHost.jobs[1].request.idempotencyKey`)
    })
    await run(
      `document.querySelector('#mode').value='video';document.querySelector('#mode').dispatchEvent(new Event('change'));document.querySelector('#import').click()`
    )
    await wait(`document.querySelector('#references li')!==null`)
    await run(`document.querySelector('#generation').requestSubmit()`)
    await wait(`window.componentHost.jobs.length===3`)
    assert.equal(await run(`window.componentHost.jobs[2].request.operation`), 'video.edit')
    assert.equal(await run(`window.componentHost.jobs[2].request.inputAssets[0].mime`), 'video/mp4')
    await run(
      `window.componentHost.jobs[2].state='succeeded';window.componentHost.events['job-2']=[{sequence:1,type:'asset',data:{id:'output',mime:'video/mp4',filename:'video.mp4'}}];document.querySelector('#refresh').click()`
    )
    await wait(`document.querySelector('video')!==null`)
    assert.equal(await run(`document.querySelector('video').controls`), true)
    await run(
      `[...document.querySelectorAll('article button')].find(b=>b.textContent==='导出视频').click()`
    )
    await wait(`window.componentHost.calls.some(r=>r.action==='exportAsset')`)
    await window.webContents.debugger.attach('1.3')
    for (const scheme of ['light', 'dark']) {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }]
      })
      assert.ok(await run(`document.documentElement.scrollWidth<=innerWidth`))
      await fs.writeFile(
        path.join(output, scheme + '.png'),
        (await window.webContents.capturePage()).toPNG()
      )
    }
    await fs.writeFile(
      path.join(output, 'result.json'),
      JSON.stringify({
        passed: true,
        mocked: true,
        checks: [
          'text submit payload',
          'local cancel tracking',
          'remote recovery sourceJobId',
          'local video edit reference',
          'preview controls',
          'export',
          '720px light/dark'
        ],
        limits: [
          'mock video bytes are not a playback decode fixture; real MP4 pipeline is parent-owned'
        ]
      })
    )
    window.destroy()
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
