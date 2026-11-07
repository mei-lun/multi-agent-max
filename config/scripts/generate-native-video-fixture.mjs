import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
const require = createRequire(import.meta.url),
  output = path.join(process.cwd(), '.mam-local/native-video-fixture')
await mkdir(output, { recursive: true })
const source = `const {app,BrowserWindow}=require('electron'),fs=require('fs');app.disableHardwareAcceleration();app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:160,height:160,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});await w.loadURL('data:text/html,<html><body></body></html>');const result=await w.webContents.executeJavaScript(\`(async()=>{const supported=['video/mp4;codecs=avc1.42001E','video/mp4;codecs=avc1','video/mp4'].filter(t=>MediaRecorder.isTypeSupported(t));if(!supported.length)return {supported};const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;document.body.append(canvas);const context=canvas.getContext('2d'),stream=canvas.captureStream(10),chunks=[],recorder=new MediaRecorder(stream,{mimeType:supported[0]});const done=new Promise(resolve=>recorder.onstop=resolve);recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();for(let i=0;i<15;i++){context.fillStyle=i%2?'red':'blue';context.fillRect(0,0,64,64);await new Promise(r=>setTimeout(r,100))}recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:recorder.mimeType});return {supported,mime:recorder.mimeType,bytes:[...new Uint8Array(await blob.arrayBuffer())]}})()\`);if(result.bytes){fs.writeFileSync(${JSON.stringify(path.join(output, 'fixture.mp4'))},Buffer.from(result.bytes));delete result.bytes}fs.writeFileSync(${JSON.stringify(path.join(output, 'result.json'))},JSON.stringify(result));w.destroy();app.quit()}).catch(e=>{console.error(e);app.exit(1)})`
await writeFile(path.join(output, 'main.cjs'), source)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [path.join(output, 'main.cjs')], {
  env,
  windowsHide: true,
  stdio: 'inherit'
})
const code = await new Promise((resolve) => child.on('exit', resolve))
if (code !== 0) throw Error('Fixture capture failed')
console.log(await readFile(path.join(output, 'result.json'), 'utf8'))
