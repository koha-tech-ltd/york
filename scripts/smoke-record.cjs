/**
 * End-to-end-ish smoke: canvas MediaRecorder → webm → ffmpeg mp4 into Videos/York
 */
const { app } = require('electron')
const { join } = require('path')
const { existsSync, mkdirSync, writeFileSync, createWriteStream, unlinkSync } = require('fs')
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')
const ffmpeg = require('fluent-ffmpeg')

ffmpeg.setFfmpegPath(ffmpegInstaller.path)

app.whenReady().then(async () => {
  // Need a BrowserWindow for MediaRecorder / canvas
  const { BrowserWindow } = require('electron')
  const win = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false }
  })

  await win.loadURL(
    'data:text/html,<canvas id=c width=640 height=360></canvas><script>' +
      'const c=document.getElementById("c"); const ctx=c.getContext("2d");' +
      'let f=0; (function draw(){ctx.fillStyle="#223";ctx.fillRect(0,0,640,360);' +
      'ctx.beginPath();ctx.arc(120+f%400,180,40,0,6.28);ctx.fillStyle="#e84040";ctx.fill();f++;requestAnimationFrame(draw);})();' +
      'window.start=()=>{const s=c.captureStream(30); const r=new MediaRecorder(s,{mimeType:"video/webm;codecs=vp8"});' +
      'const chunks=[]; r.ondataavailable=e=>chunks.push(e.data);' +
      'return new Promise(res=>{r.onstop=async()=>{const blob=new Blob(chunks,{type:"video/webm"});' +
      'const buf=Buffer.from(await blob.arrayBuffer()); res(buf.toString("base64"));}; r.start(); setTimeout(()=>r.stop(),1500);});};' +
      '</script>'
  )

  try {
    await new Promise((r) => setTimeout(r, 300))
    const b64 = await win.webContents.executeJavaScript('window.start()')
    const webm = Buffer.from(b64, 'base64')
    const tmp = join(app.getPath('temp'), 'york-smoke.webm')
    writeFileSync(tmp, webm)
    console.log('WEBM', tmp, webm.length)

    const outDir = join(app.getPath('videos'), 'York')
    mkdirSync(outDir, { recursive: true })
    const out = join(outDir, 'smoke-' + Date.now() + '.mp4')

    await new Promise((resolve, reject) => {
      ffmpeg(tmp)
        .outputOptions(['-c:v libx264', '-preset ultrafast', '-pix_fmt yuv420p', '-movflags +faststart'])
        .on('end', resolve)
        .on('error', reject)
        .save(out)
    })

    try {
      unlinkSync(tmp)
    } catch (_) {}
    console.log('MP4', out, existsSync(out))
    console.log('RECORD_SMOKE_OK')
    app.exit(0)
  } catch (e) {
    console.error('RECORD_SMOKE_FAIL', e)
    app.exit(1)
  }
})
