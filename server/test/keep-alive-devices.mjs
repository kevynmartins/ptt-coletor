import WebSocket from "ws";

const PORT = process.env.TEST_PORT ?? "8787";
const WS_BASE = `ws://localhost:${PORT}`;
const ADMIN_PW = process.env.TEST_ADMIN_PASSWORD ?? "teste123";

async function ensureUser(username, password, defaultChannel) {
  await fetch(`http://localhost:${PORT}/admin/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PW },
    body: JSON.stringify({ username, password, defaultChannel }),
  });
}

function connectDevice(username, password, displayName) {
  const ws = new WebSocket(`${WS_BASE}/`);
  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "hello", username, password, name: displayName, deviceId: displayName }));
    // canal agora é atribuído automaticamente pelo servidor (defaultChannel da conta)
  });
  return ws;
}

await ensureUser("empilhadeira1", "senha123", "Canal 1");
await ensureUser("recebimento", "senha123", "Canal 1");
await ensureUser("expedicao", "senha123", "Canal 2");

const a = connectDevice("empilhadeira1", "senha123", "Empilhadeira 1");
connectDevice("recebimento", "senha123", "Recebimento");
connectDevice("expedicao", "senha123", "Expedicao");

setTimeout(() => {
  a.send(JSON.stringify({ type: "ptt_start" }));
}, 1000);

process.stdin.resume();
