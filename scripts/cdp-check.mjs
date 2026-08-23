;(async () => {
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
  const bar = list.find((t) => t.title === 'York')
  if (!bar) throw new Error('bar target not found')
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
  const expr =
    '({' +
    'hasYork: !!window.york,' +
    'text: document.body.innerText,' +
    "buttons: [...document.querySelectorAll('button')].map(b => b.title || b.textContent.trim())," +
    "hasPill: !!document.querySelector('.pill')" +
    '})'
  const res = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true
  })
  console.log(JSON.stringify(res.result.value, null, 2))

  // Take screenshot via CDP of selected source through york API
  const shot = await send('Runtime.evaluate', {
    expression:
      'window.york ? window.york.takeScreenshot().then(r => r.path).catch(e => "ERR:"+e.message) : Promise.resolve("no-api")',
    awaitPromise: true,
    returnByValue: true
  })
  console.log('screenshotResult', shot.result.value)
  ws.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
