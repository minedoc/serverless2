import {randomChars, hexToByteString, mapRemove} from './util.js';

// TODO: expire pendingStubs and almost connected

function randomPeerId() {
  return '-OH0001-' + randomChars(12);
}

function Discovery(url, infoHash) {
  // TODO: make infoHash = hash(publicKey)
  const ws = new WebSocket(url);
  const myPeerId = randomPeerId();
  const pendingPeers = new Map();
  const peers = new Map();
  const onPeerWatchers = [], onPeerDisconnectWatchers = [];
  const onPeer = watcher => onPeerWatchers.push(watcher);
  const onPeerDisconnect = watcher => onPeerDisconnectWatchers.push(watcher);
  async function makeOffer() {
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
    pendingPeers.set(id, {pc, channel});
    return {
      offer_id: id,
      offer: description,
    }
  }
  function makeOffers(count) {
    const offers = [];
    for (var i=0; i<count; i++) {
      offers.push(makeOffer());
    }
    return Promise.all(offers);
  }
  function savePeer(peerId, peer) {
    const save = () => {
      peer.id = peerId;
      peers.set(peerId, peer);
      peer.pc.onconnectionstatechange = event => {
        if (peer.pc.connectionState != 'connected') {
          onPeerDisconnectWatchers.forEach(f => f(peer));
          peers.delete(peerId);
        }
      };
      onPeerWatchers.forEach(f => f(peer));
    };
    if (peer.channel.readyState == 'open') {
      save();
    } else {
      peer.channel.onopen = event => {
        if (peer.channel.readyState == 'open') {
          save();
        }
      };
    }
  }
  ws.onopen = async () => {
    const offerCount = 1;
    const request = {
      info_hash: hexToByteString(infoHash),
      peer_id: myPeerId,
      numwant: offerCount,
      uploaded: 0,
      downloaded: 0,
      left: null,
      event: 'started',  // this should only exist first time
      action: 'announce',
      offers: await makeOffers(offerCount),
    };
    ws.send(JSON.stringify(request));
  };
  ws.onmessage = async e => {
    const data = JSON.parse(e.data);
    if (peers.has(data.peer_id)) {
      return console.log('ignoring seen peer ', data.peer_id);
    }
    if (data.answer) {
      const peer = mapRemove(pendingPeers, data.offer_id);
      await peer.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      savePeer(data.peer_id, peer);
    } else if (data.offer) {
      const pc = new RTCPeerConnection();
      const channel = pc.createDataChannel('BUNDLE', {negotiated: true, id: 0});
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      savePeer(data.peer_id, {pc, channel});
      ws.send(JSON.stringify({
        info_hash: data.info_hash,
        offer_id: data.offer_id,
        peer_id: myPeerId,
        to_peer_id: data.peer_id,
        action: 'announce',
        answer: answer,
      }));
    }
  };
  onPeer(peer => {
    console.log('added a peer: ', peer);
  });
  return {onPeer, onPeerDisconnect};
}

export {Discovery};
