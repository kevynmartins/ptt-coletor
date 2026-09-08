import type { ActivityEntry, AdminActiveCall, AdminSnapshot, ServerMessage, UserInfo } from "./protocol";

export interface Client {
  id: string;
  name: string;
  /** username da conta logada (null para a conexão de admin, que não tem conta). */
  username: string | null;
  channel: string | null;
  /** true enquanto o cliente está em uma chamada individual — pausa a entrega de mensagens do canal. */
  inCall: boolean;
  send(msg: ServerMessage): void;
  sendBinary(data: Buffer): void;
  /** Entregam sempre, mesmo com inCall=true — usados pelo callManager. */
  sendCall(msg: ServerMessage): void;
  sendCallBinary(data: Buffer): void;
  close(): void;
}

interface ChannelState {
  clients: Map<string, Client>;
  speakerId: string | null;
  speakerStartedAt: number | null;
}

export interface ChannelManagerHooks {
  onStateChange?: () => void;
  onChannelsChanged?: (channels: string[]) => void;
  onActivity?: (entry: ActivityEntry) => void;
}

export interface OpResult {
  ok: boolean;
  error?: string;
}

export class ChannelManager {
  private channels = new Map<string, ChannelState>();
  private hooks: ChannelManagerHooks;

  constructor(initialChannels: string[], hooks: ChannelManagerHooks = {}) {
    this.hooks = hooks;
    for (const name of initialChannels) {
      this.channels.set(name, { clients: new Map(), speakerId: null, speakerStartedAt: null });
    }
  }

  listChannels(): string[] {
    return [...this.channels.keys()];
  }

  private stateOf(channel: string): ChannelState {
    const state = this.channels.get(channel);
    if (!state) throw new Error(`Canal desconhecido: ${channel}`);
    return state;
  }

  join(client: Client, channel: string): void {
    if (!this.channels.has(channel)) {
      client.send({ type: "error", message: `Canal desconhecido: ${channel}` });
      return;
    }
    this.leave(client);
    client.channel = channel;
    this.stateOf(channel).clients.set(client.id, client);
    this.broadcastChannelState(channel);
    this.hooks.onStateChange?.();
  }

  leave(client: Client): void {
    const channel = client.channel;
    if (!channel) return;
    const state = this.channels.get(channel);
    if (!state) {
      client.channel = null;
      return;
    }
    state.clients.delete(client.id);
    if (state.speakerId === client.id) {
      this.stopSpeaking(channel, state, client);
    }
    client.channel = null;
    this.broadcastChannelState(channel);
    this.hooks.onStateChange?.();
  }

  requestFloor(client: Client): void {
    const channel = client.channel;
    if (!channel) {
      client.send({ type: "ptt_denied", reason: "not_in_channel" });
      return;
    }
    const state = this.stateOf(channel);
    if (state.speakerId && state.speakerId !== client.id) {
      client.send({ type: "ptt_denied", reason: "busy" });
      return;
    }
    state.speakerId = client.id;
    state.speakerStartedAt = Date.now();
    client.send({ type: "ptt_granted" });
    this.broadcast(
      channel,
      { type: "speaker_started", speakerId: client.id, speakerName: client.name },
      client.id
    );
    this.hooks.onActivity?.({
      time: new Date().toISOString(),
      channel,
      userId: client.id,
      userName: client.name,
      action: "start",
    });
    this.hooks.onStateChange?.();
  }

  releaseFloor(client: Client): void {
    const channel = client.channel;
    if (!channel) return;
    const state = this.stateOf(channel);
    if (state.speakerId !== client.id) return;
    this.stopSpeaking(channel, state, client);
    this.hooks.onStateChange?.();
  }

  private stopSpeaking(channel: string, state: ChannelState, client: Client): void {
    const durationMs = state.speakerStartedAt ? Date.now() - state.speakerStartedAt : undefined;
    state.speakerId = null;
    state.speakerStartedAt = null;
    this.broadcast(channel, { type: "speaker_stopped" });
    this.hooks.onActivity?.({
      time: new Date().toISOString(),
      channel,
      userId: client.id,
      userName: client.name,
      action: "stop",
      durationMs,
    });
  }

  relayAudio(client: Client, data: Buffer): void {
    const channel = client.channel;
    if (!channel) return;
    const state = this.stateOf(channel);
    if (state.speakerId !== client.id) return;
    for (const other of state.clients.values()) {
      if (other.id !== client.id) other.sendBinary(data);
    }
  }

  disconnect(client: Client): void {
    this.leave(client);
  }

  createChannel(name: string): OpResult {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Nome do canal não pode ser vazio" };
    if (this.channels.has(trimmed)) return { ok: false, error: "Já existe um canal com esse nome" };
    this.channels.set(trimmed, { clients: new Map(), speakerId: null, speakerStartedAt: null });
    this.notifyChannelsChanged();
    return { ok: true };
  }

  renameChannel(oldName: string, newName: string): OpResult {
    const trimmed = newName.trim();
    if (!trimmed) return { ok: false, error: "Nome do canal não pode ser vazio" };
    const state = this.channels.get(oldName);
    if (!state) return { ok: false, error: "Canal não encontrado" };
    if (trimmed !== oldName && this.channels.has(trimmed)) {
      return { ok: false, error: "Já existe um canal com esse nome" };
    }
    this.channels.delete(oldName);
    this.channels.set(trimmed, state);
    for (const client of state.clients.values()) {
      client.channel = trimmed;
    }
    this.notifyChannelsChanged();
    this.broadcastChannelState(trimmed);
    this.hooks.onStateChange?.();
    return { ok: true };
  }

  removeChannel(name: string): OpResult {
    const state = this.channels.get(name);
    if (!state) return { ok: false, error: "Canal não encontrado" };
    if (this.channels.size <= 1) return { ok: false, error: "Não é possível remover o único canal restante" };
    for (const client of [...state.clients.values()]) {
      state.clients.delete(client.id);
      client.channel = null;
      client.send({ type: "channel_removed", channel: name });
    }
    this.channels.delete(name);
    this.notifyChannelsChanged();
    this.hooks.onStateChange?.();
    return { ok: true };
  }

  private notifyChannelsChanged(): void {
    const channels = this.listChannels();
    this.hooks.onChannelsChanged?.(channels);
  }

  private broadcast(channel: string, msg: ServerMessage, exceptClientId?: string): void {
    const state = this.channels.get(channel);
    if (!state) return;
    for (const client of state.clients.values()) {
      if (client.id !== exceptClientId) client.send(msg);
    }
  }

  private broadcastChannelState(channel: string): void {
    const state = this.channels.get(channel);
    if (!state) return;
    const users: UserInfo[] = [...state.clients.values()].map((c) => ({ id: c.id, name: c.name }));
    this.broadcast(channel, { type: "channel_state", channel, users, speaker: state.speakerId });
  }

  snapshot(recentActivity: ActivityEntry[], activeCalls: AdminActiveCall[] = []): AdminSnapshot {
    return {
      channels: [...this.channels.entries()].map(([name, state]) => ({
        name,
        users: [...state.clients.values()].map((c) => ({ id: c.id, name: c.name })),
        speaker: state.speakerId,
      })),
      recentActivity,
      activeCalls,
    };
  }
}
