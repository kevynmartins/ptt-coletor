import WebSocket from "ws";

const PORT = process.env.TEST_PORT ?? "8787";
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}`;
const PW = process.env.TEST_ADMIN_PASSWORD ?? "teste123";
const results = [];
const ok = (label, cond) => results.push([label, !!cond]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/admin/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Admin-Password": PW, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function ensureUser(username, password) {
  await api("/users", { method: "POST", body: JSON.stringify({ username, password }) });
}

function connectDevice(username, password, displayName) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/`);
    const messages = [];
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", username, password, name: displayName, deviceId: displayName }));
      // canal agora é atribuído automaticamente pelo servidor (defaultChannel da conta)
    });
    ws.on("message", (data, isBinary) => {
      if (!isBinary) messages.push(JSON.parse(data.toString("utf8")));
    });
    setTimeout(() => resolve({ ws, messages }), 300);
  });
}

await ensureUser("dispositivo1", "senha123");
await ensureUser("dispositivo2", "senha123");

// 1. criar canal
const created = await api("/channels", { method: "POST", body: JSON.stringify({ action: "create", name: "Canal Teste" }) });
ok("criar canal retorna ok", created.status === 200 && created.body.ok);

const state1 = await api("/state");
ok("novo canal aparece no snapshot", state1.body.channels.some((c) => c.name === "Canal Teste"));

// 2. cliente entra no Canal 1
const dev = await connectDevice("dispositivo1", "senha123", "Dispositivo1");
const clientId = dev.messages.find((m) => m.type === "welcome")?.clientId;
ok("dispositivo recebeu clientId no welcome", !!clientId);

// 3. renomear Canal 1 -> Canal Principal, dispositivo deve ser notificado via "channels"
dev.messages.length = 0;
const renamed = await api("/channels", { method: "POST", body: JSON.stringify({ action: "rename", name: "Canal 1", newName: "Canal Principal" }) });
ok("renomear canal retorna ok", renamed.status === 200 && renamed.body.ok);
await wait(300);
ok(
  "dispositivo recebeu broadcast 'channels' com o novo nome apos renomear",
  dev.messages.some((m) => m.type === "channels" && m.channels.includes("Canal Principal"))
);

// 4. remover o canal onde o dispositivo esta -> deve receber channel_removed
dev.messages.length = 0;
const removed = await api("/channels", { method: "POST", body: JSON.stringify({ action: "remove", name: "Canal Principal" }) });
ok("remover canal retorna ok", removed.status === 200 && removed.body.ok);
await wait(300);
ok(
  "dispositivo recebeu channel_removed para o canal removido",
  dev.messages.some((m) => m.type === "channel_removed" && m.channel === "Canal Principal")
);
ok(
  "dispositivo recebeu 'channels' atualizado sem o canal removido",
  dev.messages.some((m) => m.type === "channels" && !m.channels.includes("Canal Principal"))
);

// 5. kick
const dev2 = await connectDevice("dispositivo2", "senha123", "Dispositivo2");
const clientId2 = dev2.messages.find((m) => m.type === "welcome")?.clientId;
let closeCode = null;
dev2.ws.on("close", (code) => (closeCode = code));
const kicked = await api("/kick", { method: "POST", body: JSON.stringify({ clientId: clientId2 }) });
ok("kick retorna ok", kicked.status === 200 && kicked.body.ok);
await wait(300);
ok("conexao do dispositivo expulso foi fechada", closeCode === 4001);

// 6. kick de id inexistente -> 404
const kickBad = await api("/kick", { method: "POST", body: JSON.stringify({ clientId: "nao-existe" }) });
ok("kick de clientId inexistente retorna 404", kickBad.status === 404);

// 7. remover ultimo canal deve falhar
const state2 = await api("/state");
for (const c of state2.body.channels.slice(0, -1)) {
  await api("/channels", { method: "POST", body: JSON.stringify({ action: "remove", name: c.name }) });
}
const lastState = await api("/state");
ok("sobrou exatamente 1 canal", lastState.body.channels.length === 1);
const lastName = lastState.body.channels[0].name;
const removeLast = await api("/channels", { method: "POST", body: JSON.stringify({ action: "remove", name: lastName }) });
ok("nao permite remover o ultimo canal restante", removeLast.status === 400);

dev.ws.close();
dev2.ws.close();
await wait(200);

let allPass = true;
for (const [label, pass] of results) {
  console.log(`${pass ? "OK  " : "FAIL"} - ${label}`);
  if (!pass) allPass = false;
}
process.exit(allPass ? 0 : 1);
