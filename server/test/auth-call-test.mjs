import WebSocket from "ws";

const PORT = process.env.TEST_PORT ?? "8787";
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}`;
const ADMIN_PW = process.env.TEST_ADMIN_PASSWORD ?? "teste123";
const results = [];
const ok = (label, cond) => results.push([label, !!cond]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}/admin/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PW, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function rawConnect() {
  const ws = new WebSocket(`${WS_BASE}/`);
  const messages = [];
  const binaries = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) binaries.push(data);
    else messages.push(JSON.parse(data.toString("utf8")));
  });
  return { ws, messages, binaries };
}

function connect(username, password, displayName) {
  return new Promise((resolve) => {
    const c = rawConnect();
    c.ws.on("open", () => {
      c.ws.send(JSON.stringify({ type: "hello", username, password, name: displayName, deviceId: displayName }));
      // canal agora é atribuído automaticamente pelo servidor (defaultChannel da conta, todas caem em Canal 1 por padrão)
    });
    setTimeout(() => resolve(c), 300);
  });
}

await api("/users", { method: "POST", body: JSON.stringify({ username: "alice", password: "senha123" }) });
await api("/users", { method: "POST", body: JSON.stringify({ username: "bob", password: "senha123" }) });
await api("/users", { method: "POST", body: JSON.stringify({ username: "carol", password: "senha123" }) });

// 1. senha errada -> sem welcome, socket fecha com 4003
const bad = rawConnect();
let badCloseCode = null;
bad.ws.on("close", (code) => (badCloseCode = code));
await new Promise((resolve) => bad.ws.on("open", () => {
  bad.ws.send(JSON.stringify({ type: "hello", username: "alice", password: "errada", name: "X", deviceId: "x" }));
  setTimeout(resolve, 300);
}));
ok("senha errada nao recebe welcome", !bad.messages.some((m) => m.type === "welcome"));
ok("senha errada fecha o socket com 4003", badCloseCode === 4003);

// 2. login correto
const alice = await connect("alice", "senha123", "Alice");
ok("alice recebeu welcome", alice.messages.some((m) => m.type === "welcome"));
const aliceId = alice.messages.find((m) => m.type === "welcome")?.clientId;

// 3. mensagem antes do hello -> erro
const early = rawConnect();
await new Promise((resolve) => early.ws.on("open", () => {
  early.ws.send(JSON.stringify({ type: "join", channel: "Canal 1" }));
  setTimeout(resolve, 200);
}));
ok(
  "mensagem antes do login retorna erro pedindo autenticacao",
  early.messages.some((m) => m.type === "error" && m.message.includes("Autentique"))
);
early.ws.close();

const bob = await connect("bob", "senha123", "Bob");
const bobId = bob.messages.find((m) => m.type === "welcome")?.clientId;
const carol = await connect("carol", "senha123", "Carol");

// 4. chamada individual alice -> bob
alice.messages.length = 0;
bob.messages.length = 0;
alice.ws.send(JSON.stringify({ type: "call_start", targetId: bobId }));
await wait(300);
ok(
  "alice recebeu call_started com peer bob",
  alice.messages.some((m) => m.type === "call_started" && m.peerId === bobId && m.peerName === "Bob")
);
ok(
  "bob recebeu call_started com peer alice",
  bob.messages.some((m) => m.type === "call_started" && m.peerId === aliceId && m.peerName === "Alice")
);

// 5. carol fala no canal 1 -> alice (em chamada) NAO deve ouvir nem receber speaker_started
carol.messages.length = 0;
alice.messages.length = 0;
carol.ws.send(JSON.stringify({ type: "ptt_start" }));
await wait(200);
const audioFromCarol = Buffer.from(new Uint8Array(320).fill(7));
carol.ws.send(audioFromCarol);
await wait(200);
ok(
  "alice em chamada individual nao recebe speaker_started do canal",
  !alice.messages.some((m) => m.type === "speaker_started")
);
ok("alice em chamada individual nao recebe audio do canal", alice.binaries.length === 0);
carol.ws.send(JSON.stringify({ type: "ptt_stop" }));
await wait(200);

// 6. audio dentro da chamada só chega no par
alice.binaries.length = 0;
bob.binaries.length = 0;
alice.ws.send(JSON.stringify({ type: "ptt_start" }));
await wait(200);
ok("alice recebeu ptt_granted na chamada", alice.messages.some((m) => m.type === "ptt_granted"));
const callAudio = Buffer.from(new Uint8Array(320).fill(9));
alice.ws.send(callAudio);
await wait(200);
ok("bob recebeu o audio da chamada", bob.binaries.some((b) => Buffer.compare(b, callAudio) === 0));
alice.ws.send(JSON.stringify({ type: "ptt_stop" }));
await wait(200);

// 7. call_start para quem ja esta em chamada -> already_in_call
carol.messages.length = 0;
carol.ws.send(JSON.stringify({ type: "call_start", targetId: bobId }));
await wait(200);
ok(
  "chamar quem ja esta em chamada retorna already_in_call",
  carol.messages.some((m) => m.type === "call_denied" && m.reason === "already_in_call")
);

// 8. call_start para id inexistente -> not_found
carol.ws.send(JSON.stringify({ type: "call_start", targetId: "nao-existe-123" }));
await wait(200);
ok(
  "chamar id inexistente retorna not_found",
  carol.messages.some((m) => m.type === "call_denied" && m.reason === "not_found")
);

// 9. snapshot do admin mostra a chamada ativa
const stateWithCall = await api("/state");
ok(
  "snapshot do admin lista a chamada ativa alice/bob",
  stateWithCall.body.activeCalls.some(
    (c) => [c.aId, c.bId].includes(aliceId) && [c.aId, c.bId].includes(bobId)
  )
);

// 10. encerrar chamada
bob.messages.length = 0;
alice.ws.send(JSON.stringify({ type: "call_end" }));
await wait(300);
ok("bob recebeu call_ended (hangup)", bob.messages.some((m) => m.type === "call_ended" && m.reason === "hangup"));

const stateAfterEnd = await api("/state");
ok("nenhuma chamada ativa apos encerrar", stateAfterEnd.body.activeCalls.length === 0);

// 11. desconexao durante chamada avisa o par
alice.messages.length = 0;
alice.ws.send(JSON.stringify({ type: "call_start", targetId: bobId }));
await wait(300);
bob.ws.close();
await wait(300);
ok(
  "alice recebe call_ended (peer_disconnected) quando o par cai",
  alice.messages.some((m) => m.type === "call_ended" && m.reason === "peer_disconnected")
);

alice.ws.close();
carol.ws.close();
await wait(200);

// 12. login via senha de administrador (sem usuario/senha de conta) - usado pelo painel
const adminDev = rawConnect();
await new Promise((resolve) => adminDev.ws.on("open", () => {
  adminDev.ws.send(JSON.stringify({ type: "hello", adminPassword: ADMIN_PW, name: "Administrador", deviceId: "admin-web" }));
  setTimeout(resolve, 300);
}));
ok("login via senha de admin recebe welcome", adminDev.messages.some((m) => m.type === "welcome"));
adminDev.ws.close();

// 13. senha de admin errada tambem falha
const adminBad = rawConnect();
let adminBadCloseCode = null;
adminBad.ws.on("close", (code) => (adminBadCloseCode = code));
await new Promise((resolve) => adminBad.ws.on("open", () => {
  adminBad.ws.send(JSON.stringify({ type: "hello", adminPassword: "errada", name: "X", deviceId: "x2" }));
  setTimeout(resolve, 300);
}));
ok("senha de admin errada tambem fecha com 4003", adminBadCloseCode === 4003);

// 14. conta normal cadastrada com defaultChannel entra automaticamente nesse canal
await api("/users", { method: "POST", body: JSON.stringify({ username: "dave", password: "senha123", defaultChannel: "Canal 2" }) });
const dave = await connect("dave", "senha123", "Dave");
ok(
  "conta com defaultChannel entra automaticamente no canal certo",
  dave.messages.some((m) => m.type === "channel_state" && m.channel === "Canal 2")
);

// 15. conta normal nao pode trocar de canal sozinha
dave.messages.length = 0;
dave.ws.send(JSON.stringify({ type: "join", channel: "Canal 3" }));
await wait(200);
ok(
  "conta normal recebe erro ao tentar trocar de canal",
  dave.messages.some((m) => m.type === "error" && m.message.includes("administrador"))
);
ok(
  "conta normal nao recebe channel_state do Canal 3 (nao mudou de canal)",
  !dave.messages.some((m) => m.type === "channel_state" && m.channel === "Canal 3")
);

// 16. admin move um cliente conectado para outro canal (move-user)
const daveWelcome = dave.messages.find((m) => m.type === "welcome");
const daveState = await api("/state");
const daveClientId =
  daveWelcome?.clientId ||
  daveState.body.channels.flatMap((c) => c.users).find((u) => u.name === "Dave")?.id;
dave.messages.length = 0;
const moveRes = await api("/move-user", { method: "POST", body: JSON.stringify({ clientId: daveClientId, channel: "Canal 3" }) });
ok("move-user retorna ok", moveRes.status === 200 && moveRes.body.ok);
await wait(200);
ok(
  "cliente movido recebe channel_state do novo canal",
  dave.messages.some((m) => m.type === "channel_state" && m.channel === "Canal 3")
);

// 16b. mover fica salvo como canal padrao da conta - reconectar mantem o canal novo
dave.ws.close();
await wait(200);
const daveReconnected = await connect("dave", "senha123", "Dave");
ok(
  "apos reconectar, cliente continua no canal para onde foi movido (nao volta ao antigo)",
  daveReconnected.messages.some((m) => m.type === "channel_state" && m.channel === "Canal 3")
);
daveReconnected.ws.close();

// 17. conexao de admin continua podendo mandar join livremente
const adminFree = rawConnect();
await new Promise((resolve) => adminFree.ws.on("open", () => {
  adminFree.ws.send(JSON.stringify({ type: "hello", adminPassword: ADMIN_PW, name: "Admin2", deviceId: "admin-web-2" }));
  setTimeout(resolve, 200);
}));
adminFree.messages.length = 0;
adminFree.ws.send(JSON.stringify({ type: "join", channel: "Canal 4" }));
await wait(200);
ok(
  "conexao de admin consegue trocar de canal livremente",
  adminFree.messages.some((m) => m.type === "channel_state" && m.channel === "Canal 4")
);

dave.ws.close();
adminFree.ws.close();
await wait(200);

let allPass = true;
for (const [label, pass] of results) {
  console.log(`${pass ? "OK  " : "FAIL"} - ${label}`);
  if (!pass) allPass = false;
}
process.exit(allPass ? 0 : 1);
