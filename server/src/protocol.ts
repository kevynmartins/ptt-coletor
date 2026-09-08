// Mensagens de controle trocadas em texto (JSON) sobre o WebSocket.
// Áudio trafega como frames binários separados, fora deste tipo.

export interface UserInfo {
  id: string;
  name: string;
}

export type ClientMessage =
  | {
      type: "hello";
      username?: string;
      password?: string;
      adminPassword?: string;
      name: string;
      deviceId: string;
    }
  | { type: "join"; channel: string }
  | { type: "ptt_start" }
  | { type: "ptt_stop" }
  | { type: "call_start"; targetId: string }
  | { type: "call_end" };

export type ServerMessage =
  | { type: "welcome"; clientId: string; channels: string[] }
  | { type: "channel_state"; channel: string; users: UserInfo[]; speaker: string | null }
  | { type: "ptt_granted" }
  | { type: "ptt_denied"; reason: "busy" | "not_in_channel" }
  | { type: "speaker_started"; speakerId: string; speakerName: string }
  | { type: "speaker_stopped" }
  | { type: "error"; message: string }
  | { type: "channels"; channels: string[] }
  | { type: "channel_removed"; channel: string }
  | { type: "call_started"; peerId: string; peerName: string }
  | { type: "call_ended"; reason: "hangup" | "peer_disconnected" }
  | { type: "call_denied"; reason: "target_offline" | "already_in_call" | "not_found" };

export interface ActivityEntry {
  time: string;
  channel: string;
  userId: string;
  userName: string;
  action: "start" | "stop";
  durationMs?: number;
}

export interface AdminChannelSnapshot {
  name: string;
  users: UserInfo[];
  speaker: string | null;
}

export interface AdminActiveCall {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
}

export interface AdminSnapshot {
  channels: AdminChannelSnapshot[];
  recentActivity: ActivityEntry[];
  activeCalls: AdminActiveCall[];
}
