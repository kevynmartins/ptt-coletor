import WebSocket from "ws";

const PORT = process.env.TEST_PORT ?? "8787";
const ADMIN_PW = process.env.TEST_ADMIN_PASSWORD ?? "teste123";
const BASE = `http://localhost:${PORT}`;
const URL = `ws://localhost:${PORT}`;
const results = [];
const ok = (label, cond) => results.push([label, !!cond]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureUser(username, password) {
  await fetch(`${BASE}/admin/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Password": ADMIN_PW },
    body: JSON.stringify({ username, password }),
  });
}

function connect(username, password, displayName) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    const messages = [];
    const binaries = [];
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", username, password, name: displayName, deviceId: displayName }));
      // canal agora é atribuído automaticamente pelo servidor (defaultChannel da conta)
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) binaries.push(data);
      else messages.push(JSON.parse(data.toString("utf8")));
    });
    setTimeout(() => resolve({ ws, messages, binaries }), 300);
  });
}

await ensureUser("usera", "senha123");
await ensureUser("userb", "senha123");

const a = await connect("usera", "senha123", "A");
const b = await connect("userb", "senha123", "B");

ok("A recebeu welcome", a.messages.some((m) => m.type === "welcome"));
ok("A recebeu channel_state do Canal 1", a.messages.some((m) => m.type === "channel_state" && m.channel === "Canal 1"));
ok(
  "channel_state mostra 2 usuarios apos B entrar",
  b.messages.some((m) => m.type === "channel_state" && m.users.length === 2)
);

a.ws.send(JSON.stringify({ type: "ptt_start" }));
await wait(200);
ok("A recebeu ptt_granted", a.messages.some((m) => m.type === "ptt_granted"));
ok(
  "B recebeu speaker_started com speakerId de A",
  b.messages.some((m) => m.type === "speaker_started" && m.speakerName === "A")
);

b.ws.send(JSON.stringify({ type: "ptt_start" }));
await wait(200);
ok("B recebeu ptt_denied (busy) enquanto A fala", b.messages.some((m) => m.type === "ptt_denied" && m.reason === "busy"));

const audioChunk = Buffer.from(new Uint8Array(640).fill(42));
a.ws.send(audioChunk);
await wait(200);
ok("B recebeu o frame de audio binario de A", b.binaries.some((buf) => Buffer.compare(buf, audioChunk) === 0));
ok("A NAO recebeu seu proprio audio de volta", a.binaries.length === 0);

a.ws.send(JSON.stringify({ type: "ptt_stop" }));
await wait(200);
ok("B recebeu speaker_stopped", b.messages.some((m) => m.type === "speaker_stopped"));

b.ws.send(JSON.stringify({ type: "ptt_start" }));
await wait(200);
ok("B consegue pegar a palavra depois que A soltou", b.messages.some((m) => m.type === "ptt_granted"));

a.ws.close();
b.ws.close();
await wait(200);

let allPass = true;
for (const [label, pass] of results) {
  console.log(`${pass ? "OK  " : "FAIL"} - ${label}`);
  if (!pass) allPass = false;
}
process.exit(allPass ? 0 : 1);
