import type { Client } from "./channelManager";
import type { AdminActiveCall } from "./protocol";

interface CallState {
  speakerId: string | null;
}

export interface CallManagerHooks {
  onStateChange?: () => void;
}

export class CallManager {
  private pairs = new Map<string, string>(); // clientId -> peerId (uma entrada por lado)
  private calls = new Map<string, CallState>(); // chave: clientId, estado é compartilhado pelos dois lados via mesma referência

  constructor(private hooks: CallManagerHooks = {}) {}

  isInCall(clientId: string): boolean {
    return this.pairs.has(clientId);
  }

  peerOf(clientId: string): string | undefined {
    return this.pairs.get(clientId);
  }

  startCall(caller: Client, target: Client): void {
    const state: CallState = { speakerId: null };
    this.pairs.set(caller.id, target.id);
    this.pairs.set(target.id, caller.id);
    this.calls.set(caller.id, state);
    this.calls.set(target.id, state);
    caller.inCall = true;
    target.inCall = true;
    caller.sendCall({ type: "call_started", peerId: target.id, peerName: target.name });
    target.sendCall({ type: "call_started", peerId: caller.id, peerName: caller.name });
    this.hooks.onStateChange?.();
  }

  /** Encerra a chamada do cliente (se houver), avisando o par com o motivo informado. */
  endCall(client: Client, registry: Map<string, Client>, reason: "hangup" | "peer_disconnected"): void {
    const peerId = this.pairs.get(client.id);
    if (!peerId) return;
    this.pairs.delete(client.id);
    this.pairs.delete(peerId);
    this.calls.delete(client.id);
    this.calls.delete(peerId);
    client.inCall = false;
    client.sendCall({ type: "call_ended", reason });
    const peer = registry.get(peerId);
    if (peer) {
      peer.inCall = false;
      peer.sendCall({ type: "call_ended", reason });
    }
    this.hooks.onStateChange?.();
  }

  requestFloor(client: Client): void {
    const peerId = this.pairs.get(client.id);
    if (!peerId) return;
    const state = this.calls.get(client.id);
    if (!state) return;
    if (state.speakerId && state.speakerId !== client.id) {
      client.sendCall({ type: "ptt_denied", reason: "busy" });
      return;
    }
    state.speakerId = client.id;
    client.sendCall({ type: "ptt_granted" });
  }

  releaseFloor(client: Client): void {
    const state = this.calls.get(client.id);
    if (!state || state.speakerId !== client.id) return;
    state.speakerId = null;
  }

  relayAudio(client: Client, data: Buffer, registry: Map<string, Client>): void {
    const peerId = this.pairs.get(client.id);
    if (!peerId) return;
    const state = this.calls.get(client.id);
    if (!state || state.speakerId !== client.id) return;
    const peer = registry.get(peerId);
    peer?.sendCallBinary(data);
  }

  snapshotActiveCalls(registry: Map<string, Client>): AdminActiveCall[] {
    const seen = new Set<string>();
    const result: AdminActiveCall[] = [];
    for (const [aId, bId] of this.pairs.entries()) {
      const pairKey = [aId, bId].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const a = registry.get(aId);
      const b = registry.get(bId);
      if (a && b) result.push({ aId: a.id, aName: a.name, bId: b.id, bName: b.name });
    }
    return result;
  }
}
