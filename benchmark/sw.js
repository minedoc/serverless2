self.addEventListener('message', event => {
  if (event.data == 'port') {
    const port = event.ports[0];
    port.onmessage = event => {
      port.postMessage([event.data[0], event.data[1] + 1]);
    };
  } else if (event.data == 'perf') {
  } else {
    console.log('unknown sw message');
  }
});
