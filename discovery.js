import {randomChars, mapRemove} from './util.js';

// TODO: expire pendingStubs and almost connected

function randomPeerId() {
  return '-OH0001-' + randomChars(12);
}

const connectionSettings = {
  iceServers: [{urls:["stun:stun.l.google.com:19302"]}],
};

const OFFER_INTERVAL = 60 * 1000;
const OFFER_TIMEOUT = OFFER_INTERVAL + 10 * 1000;

function Discovery(url, feed, onPeer, onPeerDisconnect) {
  const ws = new WebSocket(url);
  const myPeerId = randomPeerId();
  const pendingPeers = new Map();
  const peers = new Map();
  function expireOffer(id, pc) {
    if (pendingPeers.has(id)) {
      pendingPeers.delete(id);
    }
    if (pc.connectionState != 'connected') {
      pc.close();
    }
  }
  async function makeOffer() {
    const pc = new RTCPeerConnection(connectionSettings);
    const channel = pc.createDataChannel('BUNDLE', {negotiated: true, id: 0});
    const $description = new Promise(function(resolve, reject) {
      pc.onicecandidate = e => {
        if (e.candidate == null) {
          resolve(pc.localDescription);
        }
      }
    });
    await pc.setLocalDescription(await pc.createOffer());
    const id = randomChars(20);
    pendingPeers.set(id, {pc, channel});
    setTimeout(() => expireOffer(id, pc), OFFER_TIMEOUT);
    return {
      offer_id: id,
      offer: await $description,
    }
  }
  function savePeer(peerId, peer) {
    function maybeSave() {
      if (peer.channel.readyState == 'open' && !peers.has(peerId)) {
        peer.pc.onconnectionstatechange = maybeRemove;
        peer.channel.onclose = maybeRemove;
        peers.set(peerId, peer);
        console.log('added a peer:', peerId);
        onPeer(peer);
      }
    }
    function maybeRemove() {
      if ((peer.pc.connectionState != 'connected' ||  peer.channel.readyState != 'open') && peers.has(peerId)) {
        peers.delete(peerId);
        console.log('removed a peer:', peerId);
        onPeerDisconnect(peer);
      }
    }
    peer.id = peerId;
    peer.channel.onopen = maybeSave;
    maybeSave();
  }
  async function sendOffers() {
    const offerCount = 1;
    const request = {
      info_hash: feed,
      peer_id: myPeerId,
      numwant: offerCount,
      uploaded: 0,
      downloaded: 0,
      left: null,
      action: 'announce',
      offers: await Promise.all(new Array(offerCount).fill(0).map(makeOffer)),
    };
    ws.send(JSON.stringify(request));
  }
  ws.onopen = function() {
    sendOffers();
    setInterval(sendOffers, OFFER_INTERVAL);
  };
  ws.onmessage = async e => {
    const data = JSON.parse(e.data);
    if (peers.has(data.peer_id)) {
      return;
    }
    if (data.answer) {
      const peer = mapRemove(pendingPeers, data.offer_id);
      await peer.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      savePeer(data.peer_id, peer);
    } else if (data.offer) {
      const pc = new RTCPeerConnection(connectionSettings);
      const channel = pc.createDataChannel('BUNDLE', {negotiated: true, id: 0});
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const $description = new Promise(function(resolve, reject) {
        pc.onicecandidate = e => {
          if (e.candidate == null) {
            resolve(pc.localDescription);
          }
        }
      });
      setTimeout(() => expireOffer('', pc), OFFER_TIMEOUT);
      savePeer(data.peer_id, {pc, channel});
      const description = await $description;
      ws.send(JSON.stringify({
        info_hash: data.info_hash,
        offer_id: data.offer_id,
        peer_id: myPeerId,
        to_peer_id: data.peer_id,
        action: 'announce',
        answer: description,
      }));
    }
  };
}

export {Discovery};
