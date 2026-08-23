;(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
  const bar = list.find((t) => t.title === 'York')
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
  console.log('state', JSON.stringify(state.result.value, null, 2))

  const sources = await send('Runtime.evaluate', {
    expression: 'window.york.getSources()',
    awaitPromise: true,
    returnByValue: true
  })
  const src = state.result.value.selectedSourceId || sources.result.value[0]?.id
  console.log('using source', src)

  if (state.result.value.recording) {
    console.log('stopping leftover recording...')
    const stop = await send('Runtime.evaluate', {
      expression: 'window.york.stopRecord()',
      awaitPromise: true,
      returnByValue: true
    })
    console.log('stop', stop.result.value)
  }

  // Start a short recording without camera to reduce permission friction
  const startExpr =
    'window.york.startRecord(' +
    JSON.stringify({
      sourceId: src,
      sourceType: 'screen',
      cameraEnabled: false,
      cameraDeviceId: null,
      micEnabled: false,
      micDeviceId: null,
      bubbleSize: 'M',
      pip: { x: 0.78, y: 0.72 }
    }) +
    ')'

  const start = await send('Runtime.evaluate', {
    expression: startExpr,
    awaitPromise: true,
    returnByValue: true
  })
  console.log('start', start.result.value)

  await new Promise((r) => setTimeout(r, 2500))

  const stop2 = await send('Runtime.evaluate', {
    expression: 'window.york.stopRecord()',
    awaitPromise: true,
    returnByValue: true
  })
  console.log('stop2', JSON.stringify(stop2.result.value, null, 2))
  ws.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
