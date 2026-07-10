const WebSocket = require('ws');

async function main(url, outfile, width) {
  const vRes = await fetch('http://localhost:9333/json/new?about:blank', { method: 'PUT' });
  const target = await vRes.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending[msg.id]) {
      pending[msg.id](msg.result);
      delete pending[msg.id];
    }
  });
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const myId = ++id;
      pending[myId] = resolve;
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }
  await new Promise((r) => ws.on('open', r));
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 });
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 2500));
  const metrics = await send('Page.getLayoutMetrics');
  const height = Math.ceil(metrics.cssContentSize.height);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await new Promise((r) => setTimeout(r, 800));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
  require('fs').writeFileSync(outfile, Buffer.from(shot.data, 'base64'));
  console.log('saved', outfile, width, 'x', height);
  ws.close();
  process.exit(0);
}

const [,, url, outfile, width] = process.argv;
main(url, outfile, Number(width) || 1440);
