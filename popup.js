const statusEl = document.getElementById("status");
const btn = document.getElementById("toggleBtn");
const promptModeEl = document.getElementById("promptMode");

async function refresh() {
  const { enabled, promptMode } = await chrome.storage.local.get(["enabled", "promptMode"]);

  const on = !!enabled;
  statusEl.textContent = on ? "ON" : "OFF";
  btn.textContent = on ? "Turn OFF" : "Turn ON";
  btn.className = on ? "on" : "off";

  promptModeEl.checked = !!promptMode;
}

btn.addEventListener("click", async () => {
  const { enabled } = await chrome.storage.local.get(["enabled"]);
  await chrome.storage.local.set({ enabled: !enabled });
  refresh();
});

promptModeEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ promptMode: promptModeEl.checked });
});

refresh();
