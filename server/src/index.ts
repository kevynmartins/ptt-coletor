import { randomUUID } from "crypto";
import { createServer } from "http";
import { join } from "path";
import express from "express";
import { Bonjour } from "bonjour-service";
import { WebSocketServer, WebSocket } from "ws";
import { createAdminRouter, createAdminWebSocketServer } from "./admin";
import { checkPassword, initAdminPassword } from "./adminAuth";
import { appendActivity, getRecentActivity, loadActivityLog } from "./activityLog";
import { CallManager } from "./callManager";
import { ChannelManager, type Client } from "./channelManager";
import { loadChannels, saveChannels } from "./channelsStore";
import type { ClientMessage, ServerMessage } from "./protocol";
import { getUser, verifyUser } from "./userStore";

const PORT = Number(process.env.PTT_PORT ?? 8787);

initAdminPassword();
loadActivityLog();

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", channels: manager.listChannels() });
});

app.use("/admin", express.static(join(__dirname, "..", "public", "admin")));

const httpServer = createServer(app);

const registry = new Map<string, Client>();

function broadcastToAllDevices(msg: ServerMessage): void {
  for (const client of registry.values()) client.send(msg);
}

function currentSnapshot() {
  return manager.snapshot(getRecentActivity(), callManager.snapshotActiveCalls(registry));
}

const { wss: adminWss, broadcast: broadcastAdminSnapshot } = createAdminWebSocketServer(() => currentSnapshot());

function pushAdminSnapshot(): void {
  broadcastAdminSnapshot(currentSnapshot());
}

const manager = new ChannelManager(loadChannels(), {
  onStateChange: () => pushAdminSnapshot(),
  onChannelsChanged: (channels) => {
    saveChannels(channels);
    broadcastToAllDevices({ type: "channels", channels });
    pushAdminSnapshot();
  },
  onActivity: (entry) => {
    appendActivity(entry);
    pushAdminSnapshot();
  },
});

const callManager = new CallManager({
  onStateChange: () => pushAdminSnapshot(),
});

app.use("/admin/api", createAdminRouter(manager, registry, () => currentSnapshot()));

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "", "http://localhost");
  const target = pathname === "/admin-ws" ? adminWss : wss;
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

wss.on("connection", (ws: WebSocket) => {
  let authenticated = false;
  let isAdmin = false;

  const client: Client = {
    id: randomUUID(),
    name: "desconhecido",
    username: null,
    channel: null,
    inCall: false,
    send(msg: ServerMessage) {
      if (client.inCall) return;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    sendBinary(data: Buffer) {
      if (client.inCall) return;
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true });
    },
    sendCall(msg: ServerMessage) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    sendCallBinary(data: Buffer) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true });
    },
    close() {
      ws.close(4001, "Desconectado pelo administrador");
    },
  };

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (!authenticated) return;
      if (client.inCall) {
        callManager.relayAudio(client, data, registry);
      } else {
        manager.relayAudio(client, data);
      }
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      client.sendCall({ type: "error", message: "JSON inválido" });
      return;
    }

    if (!authenticated) {
      if (msg.type !== "hello") {
        client.sendCall({ type: "error", message: "Autentique-se primeiro" });
        return;
      }
      const validAccount = !!msg.username && !!msg.password && verifyUser(msg.username, msg.password);
      const validAdmin = !!msg.adminPassword && checkPassword(msg.adminPassword);
      if (!validAccount && !validAdmin) {
        client.sendCall({ type: "error", message: "Usuário ou senha inválidos" });
        ws.close(4003, "Credenciais inválidas");
        return;
      }
      authenticated = true;
      isAdmin = validAdmin;
      client.name = msg.name?.trim() || msg.username || "Administrador";
      client.username = !isAdmin && msg.username ? msg.username : null;
      registry.set(client.id, client);
      client.sendCall({ type: "welcome", clientId: client.id, channels: manager.listChannels() });
      if (!isAdmin && msg.username) {
        const account = getUser(msg.username);
        const channels = manager.listChannels();
        const target =
          account?.defaultChannel && channels.includes(account.defaultChannel)
            ? account.defaultChannel
            : channels[0];
        if (target) manager.join(client, target);
      }
      return;
    }

    switch (msg.type) {
      case "hello":
        break; // já autenticado, ignora hello duplicado
      case "join":
        if (!isAdmin) {
          client.sendCall({ type: "error", message: "Somente o administrador pode trocar de canal." });
          break;
        }
        manager.join(client, msg.channel);
        break;
      case "ptt_start":
        if (client.inCall) callManager.requestFloor(client);
        else manager.requestFloor(client);
        break;
      case "ptt_stop":
        if (client.inCall) callManager.releaseFloor(client);
        else manager.releaseFloor(client);
        break;
      case "call_start": {
        const target = registry.get(msg.targetId);
        if (!target) {
          client.sendCall({ type: "call_denied", reason: "not_found" });
          break;
        }
        if (client.inCall || target.inCall) {
          client.sendCall({ type: "call_denied", reason: "already_in_call" });
          break;
        }
        manager.releaseFloor(client);
        callManager.startCall(client, target);
        break;
      }
      case "call_end":
        callManager.endCall(client, registry, "hangup");
        break;
      default:
        client.sendCall({ type: "error", message: "Mensagem desconhecida" });
    }
  });

  const cleanup = () => {
    if (!authenticated) return;
    registry.delete(client.id);
    callManager.endCall(client, registry, "peer_disconnected");
    manager.disconnect(client);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

httpServer.listen(PORT, () => {
  console.log(`Servidor PTT ouvindo na porta ${PORT}`);
  console.log(`Canais disponíveis: ${manager.listChannels().join(", ")}`);
  console.log(`Painel de administrador: http://localhost:${PORT}/admin`);

  const bonjour = new Bonjour();
  bonjour.publish({ name: "PTT Coletor", type: "ptt", port: PORT, protocol: "tcp" });
  console.log('Anunciando via mDNS como serviço "_ptt._tcp"');

  const shutdown = () => {
    bonjour.unpublishAll(() => {
      bonjour.destroy();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
