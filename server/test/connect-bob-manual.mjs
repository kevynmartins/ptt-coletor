import WebSocket from "ws";
const port = process.env.TEST_PORT ?? "8793";
const ws = new WebSocket(`ws://localhost:${port}/`);
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", username: "bob", password: "senha123", name: "Bob", deviceId: "bob-dev" }));
  // canal agora é atribuído automaticamente pelo servidor (defaultChannel da conta)
});
ws.on("message", (data, isBinary) => {
  if (!isBinary) console.log("bob recv:", data.toString());
});
process.stdin.resume();
