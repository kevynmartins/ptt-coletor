import WebSocket from "ws";
const port = process.env.TEST_PORT ?? "8796";
const ws = new WebSocket(`ws://localhost:${port}/`);
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", username: "dave", password: "senha123", name: "Dave", deviceId: "dave-dev" }));
});
ws.on("message", (d, bin) => { if (!bin) console.log(d.toString()); });
process.stdin.resume();
