import {randomChars, hexToByteString, mapRemove} from './util.js';

// TODO: expire pendingStubs and almost connected

function randomPeerId() {
  return '-OH0001-' + randomChars(12);
}

async function makeOffer(pendingStubs, makeStub) {
  const pc = new RTCPeerConnection({
    iceServers: [{urls:["stun:stun.l.google.com:19302"]}],
  });
  const channel = pc.createDataChannel('BUNDLE', {negotiated: true, id: 0});
  const $description = new Promise(function(resolve, reject) {
    pc.onicecandidate = e => {
      if (!e.candidate) {
        resolve(pc.localDescription);
      }
    }
  });
  await pc.setLocalDescription(await pc.createOffer());
  const description = await $description;
  const id = randomChars(20);
  pendingStubs.set(id, makeStub(pc, channel));
  return {
    offer_id: id,
    offer: description,
  }
}

async function sendOffer(infoHash, myPeerId, pendingStubs, makeStub) {
  const offerCount = 1;
  return {
    info_hash: hexToByteString(infoHash),
    peer_id: myPeerId,
    numwant: offerCount,
    uploaded: 0,
    downloaded: 0,
    left: null,
    event: 'started',  // this should only exist first time
    action: 'announce',
    offers: await Promise.all(Array.from({length: offerCount}, () => makeOffer(pendingStubs, makeStub))),
  };
}

async function answerRequest(data, myPeerId, makeStub) {
  const pc = new RTCPeerConnection();
  const channel = pc.createDataChannel('BUNDLE', {negotiated: true, id: 0});
  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return [{
    info_hash: data.info_hash,
    offer_id: data.offer_id,
    peer_id: myPeerId,
    to_peer_id: data.peer_id,
    action: 'announce',
    answer: answer,
  }, makeStub(pc, channel)];
}

async function answerResponse(data, pendingStubs) {
  const stub = mapRemove(pendingStubs, data.offer_id);
  await stub.$pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  return stub;
}

function autoremove(stubs, peerId, stub) {
  stub.$pc.onconnectionstatechange = event => {
    if (stub.$pc.connectionState != 'connected') {
      stubs.delete(peerId);
    }
  };
}

function saveStub(stubs, peerId, stub, onPeerWatchers) {
  const save = () => {
    stubs.set(peerId, stub);
    autoremove(stubs, peerId, stub);
    onPeerWatchers.forEach(f => f(peerId, stub));
  };
  if (stub.$channel.readyState == 'open') {
    save();
  } else {
    stub.$channel.onopen = event => {
      if (stub.$channel.readyState == 'open') {
        save();
      }
    };
  }
}

function Discovery(url, infoHash, makeStub) {
  // TODO: make infoHash = hash(publicKey)
  const ws = new WebSocket(url);
  const myPeerId = randomPeerId();
  const pendingStubs = new Map();
  const stubs = new Map();
  const onPeerWatchers = [];
  const onPeer = watcher => onPeerWatchers.push(watcher);
  ws.onopen = async () => {
    const request = await sendOffer(infoHash, myPeerId, pendingStubs, makeStub);
    ws.send(JSON.stringify(request));
  };
  ws.onmessage = async e => {
    const data = JSON.parse(e.data);
    if (stubs.has(data.peer_id)) {
      return console.log('ignoring seen peer ', data.peer_id);
    }
    if (data.answer) {
      const stub = await answerResponse(data, pendingStubs);
      saveStub(stubs, data.peer_id, stub, onPeerWatchers);
    } else if (data.offer) {
      const [request, stub] = await answerRequest(data, myPeerId, makeStub);
      saveStub(stubs, data.peer_id, stub, onPeerWatchers);
      ws.send(JSON.stringify(request));
    }
  };
  onPeer((peerId, stub) => {
    console.log('added a peer: ', peerId);
  });
  return {stubs, onPeer};
}

export {Discovery};
