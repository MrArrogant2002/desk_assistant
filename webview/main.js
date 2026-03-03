/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();

const msgs    = document.getElementById("msgs");
const inp     = document.getElementById("inp");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const clearBtn= document.getElementById("clear");
const modelSel= document.getElementById("model");
const wsPath  = document.getElementById("ws-path");

let streamBubble = null;
let streaming = false;

function scroll() { msgs.scrollTop = msgs.scrollHeight; }

function mkBubble(cls) {
  const d = document.createElement("div");
  d.className = "bubble " + cls;
  msgs.appendChild(d);
  scroll();
  return d;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMd(raw) {
  return raw
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => "<pre><code>" + esc(c) + "</code></pre>")
    .replace(/`([^`]+)`/g, (_, c) => "<code>" + esc(c) + "</code>")
    .replace(/\*\*(.+?)\*\*/g, (_, t) => "<strong>" + esc(t) + "</strong>")
    .replace(/\n/g, "<br>");
}

function setStreaming(on) {
  streaming = on;
  sendBtn.disabled = on;
  inp.disabled = on;
  stopBtn.style.display = on ? "inline-block" : "none";
}

function send() {
  const text = inp.value.trim();
  if (!text || streaming) { return; }
  mkBubble("user").textContent = text;
  inp.value = "";
  setStreaming(true);
  vscode.postMessage({ type: "send", text, model: modelSel.value });
}

sendBtn.addEventListener("click", send);
stopBtn.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
clearBtn.addEventListener("click", () => { msgs.innerHTML = ""; vscode.postMessage({ type: "clear" }); });
modelSel.addEventListener("change", () => vscode.postMessage({ type: "model", model: modelSel.value }));
inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

function resolveConfirm(bubble, id, accepted) {
  bubble.querySelectorAll("button").forEach(b => { b.disabled = true; });
  const s = bubble.querySelector(".confirm-status");
  if (s) { s.textContent = accepted ? "Accepted" : "Declined"; }
  vscode.postMessage({ type: "confirm", id, accepted });
  setStreaming(true);
}

window.addEventListener("message", ({ data: m }) => {
  switch (m.type) {

    case "workspace":
      wsPath.textContent = m.path || "(none)";
      break;

    case "models":
      modelSel.innerHTML = "";
      (m.list || []).forEach(name => {
        const o = document.createElement("option");
        o.value = o.textContent = name;
        if (name === m.active) { o.selected = true; }
        modelSel.appendChild(o);
      });
      break;

    case "streamStart":
      streamBubble = mkBubble("assistant thinking");
      streamBubble.innerHTML = "<span class=\"dot\"></span><span class=\"dot\"></span><span class=\"dot\"></span>";
      setStreaming(true);
      break;

    case "token":
      if (streamBubble) {
        if (streamBubble.classList.contains("thinking")) {
          streamBubble.classList.remove("thinking");
          streamBubble.innerHTML = "";
          streamBubble._raw = "";
        }
        streamBubble._raw = (streamBubble._raw || "") + m.d;
        // Strip think/Thought tags from streamed display — they appear as separate think bubbles
        const display = streamBubble._raw
          .replace(/<(?:think|Thought)>[\s\S]*?<\/(?:think|Thought)>/g, "")
          .trim();
        if (display) {
          streamBubble.innerHTML = renderMd(display);
        } else {
          streamBubble.innerHTML = "";
        }
        scroll();
      }
      break;

    case "streamEnd":
      if (streamBubble) {
        streamBubble.classList.remove("thinking");
        // Remove bubble if nothing visible was streamed (e.g. model only output think tags)
        if (!streamBubble._raw || !streamBubble.innerHTML.trim()) {
          streamBubble.remove();
        } else if (m.cancelled) {
          streamBubble.innerHTML += "<br><em>[stopped]</em>";
        }
        streamBubble = null;
      }
      if (m.cancelled) { setStreaming(false); }
      break;

    case "done":
      setStreaming(false);
      break;

    case "error":
      if (streamBubble) {
        if (!streamBubble._raw) { streamBubble.remove(); } else { streamBubble.classList.remove("thinking"); }
        streamBubble = null;
      }
      mkBubble("error").textContent = "⚠ " + (m.msg || "Unknown error");
      setStreaming(false);
      break;

    case "thinking": {
      const b = mkBubble("think");
      b.innerHTML = "<span class=\"think-label\">Thinking…</span><div class=\"think-body\">" + esc(m.text) + "</div>";
      break;
    }

    case "tool": {
      const b = mkBubble("tool");
      b.innerHTML = "<strong>" + esc(m.name) + "</strong><pre>" + esc(JSON.stringify(m.args, null, 2)) + "</pre>";
      break;
    }

    case "result": {
      const b = mkBubble("result");
      b.innerHTML = "<strong>Result</strong><pre>" + esc(m.text) + "</pre>";
      break;
    }

    case "confirmReq": {
      if (streamBubble) { streamBubble.classList.remove("thinking"); streamBubble = null; }
      setStreaming(false);
      const b = mkBubble("confirm");
      b.innerHTML =
        "<div class=\"confirm-header\"><strong>" + esc(m.title) + "</strong>: <code>" + esc(m.filePath) + "</code></div>" +
        "<div class=\"diff-box\">" + mkDiff(m.before, m.after) + "</div>" +
        "<div class=\"confirm-btns\">" +
          "<button class=\"btn-yes\">Yes, apply</button>" +
          "<button class=\"btn-no\">No, skip</button>" +
          "<span class=\"confirm-status\"></span>" +
        "</div>";
      b.querySelector(".btn-yes").onclick = () => resolveConfirm(b, m.id, true);
      b.querySelector(".btn-no").onclick  = () => resolveConfirm(b, m.id, false);
      scroll();
      break;
    }

    case "simpleConfirmReq": {
      if (streamBubble) { streamBubble.classList.remove("thinking"); streamBubble = null; }
      setStreaming(false);
      const b = mkBubble("confirm");
      b.innerHTML =
        "<div class=\"confirm-header\"><strong>" + esc(m.title) + "</strong></div>" +
        "<pre>" + esc(m.detail) + "</pre>" +
        "<div class=\"confirm-btns\">" +
          "<button class=\"btn-yes\">Yes</button>" +
          "<button class=\"btn-no\">No</button>" +
          "<span class=\"confirm-status\"></span>" +
        "</div>";
      b.querySelector(".btn-yes").onclick = () => resolveConfirm(b, m.id, true);
      b.querySelector(".btn-no").onclick  = () => resolveConfirm(b, m.id, false);
      scroll();
      break;
    }
  }
});

function mkDiff(before, after) {
  const a = (before || "").split("\n");
  const bLines = (after || "").split("\n");
  let html = "";
  const max = Math.max(a.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const o = a[i], n = bLines[i];
    if (o === n) {
      html += "<div class=\"diff-ctx\">" + esc(o || "") + "</div>";
    } else {
      if (o !== undefined) { html += "<div class=\"diff-del\">- " + esc(o) + "</div>"; }
      if (n !== undefined) { html += "<div class=\"diff-add\">+ " + esc(n) + "</div>"; }
    }
  }
  return html;
}
