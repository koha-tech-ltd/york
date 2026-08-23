;(async () => {
  await new Promise((r) => setTimeout(r, 2000))
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
  const bar = list.find((t) => t.title === 'York')
  if (!bar) throw new Error('bar not found: ' + JSON.stringify(list.map((t) => t.title)))
  const ws = new WebSocket(bar.webSocketDebuggerUrl)
  await new Promise((r) => {
    ws.onopen = r
  })
  let id = 0
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const i = ++id
      const onmsg = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id === i) {
          ws.removeEventListener('message', onmsg)
          if (msg.error) reject(msg.error)
          else resolve(msg.result)
        }
      }
      ws.addEventListener('message', onmsg)
      ws.send(JSON.stringify({ id: i, method, params }))
    })

  await send('Runtime.enable')
  const state = await send('Runtime.evaluate', {
    expression: 'window.york.getState()',
    awaitPromise: true,
    returnByValue: true
  })
  console.log('settings', state.result.value.settings)

  const ui = await send('Runtime.evaluate', {
    expression:
      "([...document.querySelectorAll('button')].map(b => b.title || b.textContent.trim()))",
    returnByValue: true
  })
  console.log('buttons', ui.result.value)

  const sources = await send('Runtime.evaluate', {
    expression: 'window.york.getSources()',
    awaitPromise: true,
    returnByValue: true
  })
  const screen = sources.result.value.find((s) => s.type === 'screen') || sources.result.value[0]
  await send('Runtime.evaluate', {
    expression: `window.york.setSelectedSource(${JSON.stringify(screen.id)})`,
    awaitPromise: true,
    returnByValue: true
  })

  const shot = await send('Runtime.evaluate', {
    expression: 'window.york.takeScreenshot()',
    awaitPromise: true,
    returnByValue: true
  })
  console.log('shot', shot.result.value)

  const start = await send('Runtime.evaluate', {
    expression:
      'window.york.startRecord(' +
      JSON.stringify({
        sourceId: screen.id,
        sourceType: 'screen',
        cameraEnabled: false,
        cameraDeviceId: null,
        micEnabled: false,
        micDeviceId: null,
        bubbleSize: 'M',
        pip: { x: 0.78, y: 0.72 }
      }) +
      ')',
    awaitPromise: true,
    returnByValue: true
  })
  console.log('start', start.result.value)
  await new Promise((r) => setTimeout(r, 3500))
  const stop = await send('Runtime.evaluate', {
    expression: 'window.york.stopRecord()',
    awaitPromise: true,
    returnByValue: true
  })
  console.log('stop', stop.result.value)
  ws.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
