import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const targetUrl = process.env.TARGET_URL ?? "http://localhost:5173/";
const screenshotPath = new URL(process.env.SCREENSHOT_PATH ?? "../point-cloud-verified.png", import.meta.url);
const userDataDir = "/tmp/point-cloud-chrome-profile";
const port = 9222;

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: pathname }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

async function waitForDebugger() {
  const started = Date.now();

  while (Date.now() - started < 10_000) {
    try {
      const tabs = await getJson("/json/list");
      const page = tabs.find((tab) => tab.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error("Chrome DevTools endpoint did not become available.");
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const events = [];

  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(message.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
      return;
    }
    events.push(payload);
  });

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    events,
    async send(method, params = {}) {
      await opened;
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      socket.close();
    }
  };
}

async function waitForScene(client) {
  const expression = `
    new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const loader = document.querySelector(".loader");
        const canvas = document.querySelector("canvas");
        const frame = document.querySelector(".gravity-frame");
        if (!loader && canvas && frame) {
          resolve({ ok: true, text: document.body.innerText });
          return;
        }
        if (Date.now() - started > 90000) {
          resolve({ ok: false, text: document.body.innerText });
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    })
  `;

  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  return result.result.value;
}

await mkdir(userDataDir, { recursive: true });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--use-angle=metal",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  "--window-size=1600,900",
  "about:blank"
]);

try {
  const debuggerUrl = await waitForDebugger();
  const client = createCdpClient(debuggerUrl);

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Page.navigate", { url: targetUrl });

  const sceneState = await waitForScene(client);
  const waitAfterReadyMs = Number(process.env.WAIT_AFTER_READY_MS ?? 0);
  if (waitAfterReadyMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitAfterReadyMs));
  }
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });

  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  client.close();

  const consoleMessages = client.events
    .filter((event) => event.method === "Runtime.consoleAPICalled")
    .map((event) => event.params.args.map((arg) => arg.value).join(" "));

  console.log(
    JSON.stringify(
      {
        sceneReady: sceneState.ok,
        bodyText: sceneState.text,
        screenshot: screenshotPath.pathname,
        consoleMessages
      },
      null,
      2
    )
  );
} finally {
  chrome.kill();
}
