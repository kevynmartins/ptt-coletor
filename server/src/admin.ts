import { Router } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { checkPassword, requireAdminAuth } from "./adminAuth";
import type { ChannelManager, Client } from "./channelManager";
import type { AdminSnapshot } from "./protocol";
import { createUser, deleteUser, listUsers, updateUser } from "./userStore";

export function createAdminRouter(manager: ChannelManager, registry: Map<string, Client>, getSnapshot: () => AdminSnapshot): Router {
  const router = Router();
  router.use(requireAdminAuth);

  router.get("/state", (_req, res) => {
    res.json(getSnapshot());
  });

  router.post("/kick", (req, res) => {
    const clientId = req.body?.clientId;
    if (typeof clientId !== "string") {
      res.status(400).json({ error: "clientId é obrigatório" });
      return;
    }
    const client = registry.get(clientId);
    if (!client) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }
    client.sendCall({ type: "error", message: "Desconectado pelo administrador" });
    client.close();
    res.json({ ok: true });
  });

  router.post("/channels", (req, res) => {
    const { action, name, newName } = req.body ?? {};
    if (typeof name !== "string") {
      res.status(400).json({ error: "name é obrigatório" });
      return;
    }
    let result;
    switch (action) {
      case "create":
        result = manager.createChannel(name);
        break;
      case "rename":
        if (typeof newName !== "string") {
          res.status(400).json({ error: "newName é obrigatório para renomear" });
          return;
        }
        result = manager.renameChannel(name, newName);
        break;
      case "remove":
        result = manager.removeChannel(name);
        break;
      default:
        res.status(400).json({ error: "action deve ser create, rename ou remove" });
        return;
    }
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/users", (_req, res) => {
    res.json({ users: listUsers() });
  });

  router.post("/users", (req, res) => {
    const { username, password, defaultChannel } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username e password são obrigatórios" });
      return;
    }
    const result = createUser(username, password, typeof defaultChannel === "string" ? defaultChannel : null);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  router.put("/users/:username", (req, res) => {
    const { password, defaultChannel } = req.body ?? {};
    const changes: { password?: string; defaultChannel?: string | null } = {};
    if (typeof password === "string" && password.length > 0) changes.password = password;
    if (defaultChannel !== undefined) changes.defaultChannel = defaultChannel === null ? null : String(defaultChannel);
    const result = updateUser(req.params.username, changes);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  router.delete("/users/:username", (req, res) => {
    const result = deleteUser(req.params.username);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/move-user", (req, res) => {
    const { clientId, channel } = req.body ?? {};
    if (typeof clientId !== "string" || typeof channel !== "string") {
      res.status(400).json({ error: "clientId e channel são obrigatórios" });
      return;
    }
    const client = registry.get(clientId);
    if (!client) {
      res.status(404).json({ error: "Cliente não encontrado" });
      return;
    }
    if (!manager.listChannels().includes(channel)) {
      res.status(400).json({ error: "Canal desconhecido" });
      return;
    }
    manager.join(client, channel);
    // O canal atribuído fica valendo também para as próximas conexões dessa conta,
    // não só para a sessão atual — senão a pessoa "voltaria" ao canal padrão antigo ao reconectar.
    if (client.username) {
      updateUser(client.username, { defaultChannel: channel });
    }
    res.json({ ok: true });
  });

  return router;
}

export function createAdminWebSocketServer(getSnapshot: () => AdminSnapshot): {
  wss: WebSocketServer;
  broadcast: (snapshot: AdminSnapshot) => void;
} {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, request) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const password = url.searchParams.get("password");
    if (!checkPassword(password)) {
      ws.close(4001, "Senha inválida");
      return;
    }
    ws.send(JSON.stringify(getSnapshot()));
  });

  const broadcast = (snapshot: AdminSnapshot) => {
    const payload = JSON.stringify(snapshot);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  return { wss, broadcast };
}
