import WebSocket from "ws";

const url = process.argv[2];
if (!url) {
  console.error("uso: node tunnel-test.mjs wss://host");
  process.exit(1);
}

const ws = new WebSocket(url);
const timeout = setTimeout(() => {
  console.log("FAIL - timeout esperando welcome");
  process.exit(1);
}, 10000);

ws.on("open", () => {
  console.log("OK - conexao WebSocket aberta pelo tunnel");
  ws.send(JSON.stringify({
    type: "hello",
    username: process.env.TEST_USERNAME ?? "usera",
    password: process.env.TEST_PASSWORD ?? "senha123",
    name: "TunnelTest",
    deviceId: "tunnel-test",
  }));
});

ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  const msg = JSON.parse(data.toString("utf8"));
  if (msg.type === "welcome") {
    console.log("OK - recebeu welcome via tunnel:", JSON.stringify(msg));
    clearTimeout(timeout);
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (err) => {
  console.log("FAIL -", err.message);
  process.exit(1);
});
