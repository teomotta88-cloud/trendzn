import type { PluginToUiMessage } from "./types";

const statusEl = document.getElementById("status") as HTMLParagraphElement;
const textareaEl = document.getElementById("json") as HTMLTextAreaElement;
const copyBtn = document.getElementById("copy") as HTMLButtonElement;
const downloadLink = document.getElementById("download") as HTMLAnchorElement;

let currentJson = "";

function setStatus(text: string, isError: boolean) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#e5484d" : "#3e9b4f";
}

window.onmessage = (event: MessageEvent) => {
  const message = event.data.pluginMessage as PluginToUiMessage | undefined;
  if (!message) return;

  if (message.type === "error") {
    setStatus(message.message, true);
    textareaEl.value = "";
    copyBtn.disabled = true;
    downloadLink.removeAttribute("href");
    return;
  }

  currentJson = JSON.stringify(message.root, null, 2);
  textareaEl.value = currentJson;
  setStatus(`Pronto: ${message.elementCount} elementi. Copia il JSON o scaricalo e incollalo in trendzn.`, false);
  copyBtn.disabled = false;

  const blob = new Blob([currentJson], { type: "application/json" });
  downloadLink.href = URL.createObjectURL(blob);
  downloadLink.download = "trendzn-figma-export.json";
};

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentJson);
    setStatus("Copiato negli appunti.", false);
  } catch {
    textareaEl.select();
    document.execCommand("copy");
    setStatus("Copiato negli appunti.", false);
  }
});
