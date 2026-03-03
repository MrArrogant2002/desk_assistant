/* global acquireVsCodeApi */
'use strict';
const vscode = acquireVsCodeApi();

// ─── DOM refs ────────────────────────────────────────────────────────────────
const msgs          = document.getElementById('msgs');
const welcome       = document.getElementById('welcome');
const inp           = document.getElementById('inp');
const sendBtn       = document.getElementById('send');
const stopBtn       = document.getElementById('stop');
const newChatBtn    = document.getElementById('new-chat');
const modelSel      = document.getElementById('model');
const wsPath        = document.getElementById('ws-path');
const atDrop        = document.getElementById('at-dropdown');
const historyToggle = document.getElementById('history-toggle');
const sessionPanel  = document.getElementById('session-panel');
const sessionClose  = document.getElementById('session-close');
const sessionList   = document.getElementById('session-list');
const charCount     = document.getElementById('char-count');
const tokenBar      = document.getElementById('token-bar');

let streamBubble        = null;
let lastAssistantBubble = null;
let streaming           = false;
let activeSessionId     = null;
let userMsgCount        = 0;   // tracks user bubble index for edit target

// ─── Welcome screen ───────────────────────────────────────────────────────────
function hideWelcome() {
  if (welcome && !welcome.classList.contains('hidden')) {
    welcome.classList.add('hidden');
  }
}
function showWelcome() {
  const hasMsgs = msgs.querySelector('.bubble.user, .bubble.assistant');
  if (!hasMsgs && welcome) { welcome.classList.remove('hidden'); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function scroll() { msgs.scrollTop = msgs.scrollHeight; }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMd(raw) {
  if (!raw) { return ''; }

  // 1. Pull out fenced code blocks (```lang\ncode```) and store as safe placeholders.
  //    This preserves their already-escaped HTML without double-escaping.
  const blocks = [];
  let out = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = 'cb-' + Math.random().toString(36).slice(2);
    blocks.push(
      `<div class="code-block">` +
      `<div class="code-header"><span class="code-lang">${esc(lang || 'code')}</span>` +
      `<button class="copy-btn" data-cbid="${id}">Copy</button></div>` +
      `<pre id="${id}"><code>${esc(code.replace(/\n$/, ''))}</code></pre>` +
      `</div>`
    );
    return '\x00CODEBLOCK' + (blocks.length - 1) + '\x00';
  });

  // 2. Escape ALL remaining plain text — prevents model-generated HTML (<button>, etc.)
  //    from rendering as real DOM elements.
  out = esc(out);

  // 3. Apply safe inline markdown on already-escaped text.
  //    Patterns use &lt;/&gt; equivalents because esc() ran first.
  out = out
    .replace(/`([^`\n]+)`/g, (_, c) => `<code class="inline-code">${c}</code>`)
    .replace(/\*\*(.+?)\*\*/g, (_, t) => `<strong>${t}</strong>`)
    .replace(/\*(.+?)\*/g,     (_, t) => `<em>${t}</em>`)
    .replace(/^#{1,3} (.+)$/gm,(_, t) => `<p class="md-heading">${t}</p>`)
    .replace(/\n/g, '<br>');

  // 4. Re-insert the safe code block HTML.
  out = out.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i) => blocks[+i]);

  return out;
}

// ── Item 28: RAF token-batch state ──────────────────────────────────────────
let _rafPending = false;

function setStreaming(on) {
  streaming = on;
  sendBtn.disabled = on;
  inp.disabled = on;
  stopBtn.classList.toggle('hidden', !on);
  sendBtn.classList.toggle('hidden', on);
}

function mkBubble(cls) {
  hideWelcome();
  const d = document.createElement('div');
  d.className = 'bubble ' + cls;

  // Add edit overlay to user bubbles
  if (cls === 'user') {
    const idx = userMsgCount++;
    d.dataset.msgidx = String(idx);
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-edit-btn';
    editBtn.title = 'Edit message';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => {
      if (streaming) { return; }
      inp.value = d.dataset.origText || d.textContent || '';
      inp.focus();
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
      updateCharCount();
      // Remove this bubble and everything after it
      const allBubbles = [...msgs.querySelectorAll('.bubble')];
      const pos = allBubbles.indexOf(d);
      allBubbles.slice(pos).forEach(b => b.remove());
      userMsgCount = idx;  // reset counter for re-numbering
      vscode.postMessage({ type: 'editMessage', msgIdx: idx, newText: d.dataset.origText || d.textContent || '' });
    });
    d.appendChild(editBtn);
  }

  msgs.appendChild(d);
  scroll();
  return d;
}

function addCopyListeners(container) {
  container.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pre = document.getElementById(btn.dataset.cbid);
      if (!pre) { return; }
      navigator.clipboard?.writeText(pre.innerText ?? pre.textContent ?? '')
        .then(() => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); })
        .catch(() => {});
    });
  });
  // Apply syntax highlighting to any new code blocks
  applyHljs(container);
}

// ─── Assistant response action bar ────────────────────────────────────────────
function addAssistantActions(bubble) {
  if (!bubble || bubble.querySelector('.msg-actions')) { return; }
  const bar = document.createElement('div');
  bar.className = 'msg-actions';

  // Regenerate
  const regenBtn = document.createElement('button');
  regenBtn.title = 'Regenerate response';
  regenBtn.textContent = '↺';
  regenBtn.addEventListener('click', () => {
    if (streaming) { return; }
    bubble.remove();
    vscode.postMessage({ type: 'regenerate' });
  });

  // Copy whole response
  const copyBtn = document.createElement('button');
  copyBtn.title = 'Copy response';
  copyBtn.textContent = '⎘';
  copyBtn.addEventListener('click', () => {
    const text = bubble.innerText || bubble.textContent || '';
    navigator.clipboard?.writeText(text)
      .then(() => { copyBtn.textContent = '✓'; setTimeout(() => { copyBtn.textContent = '⎘'; }, 1500); })
      .catch(() => {});
  });

  // Pin to memory
  const pinBtn = document.createElement('button');
  pinBtn.title = 'Pin to memory';
  pinBtn.textContent = '📌';
  pinBtn.addEventListener('click', () => {
    const text = bubble.innerText || bubble.textContent || '';
    vscode.postMessage({ type: 'pin', content: text.slice(0, 500) });
    pinBtn.textContent = '✓';
    setTimeout(() => { pinBtn.textContent = '📌'; }, 1500);
  });

  // Thumbs up
  const upBtn = document.createElement('button');
  upBtn.title = 'Good response';
  upBtn.textContent = '👍';
  upBtn.addEventListener('click', () => {
    upBtn.classList.toggle('rated');
    downBtn.classList.remove('rated');
  });

  // Thumbs down
  const downBtn = document.createElement('button');
  downBtn.title = 'Bad response';
  downBtn.textContent = '👎';
  downBtn.addEventListener('click', () => {
    downBtn.classList.toggle('rated');
    upBtn.classList.remove('rated');
  });

  bar.append(regenBtn, copyBtn, pinBtn, upBtn, downBtn);
  bubble.appendChild(bar);
}

// ─── Syntax highlighting (highlight.js) ──────────────────────────────────────
function applyHljs(container) {
  if (typeof hljs === 'undefined') { return; }
  container.querySelectorAll('pre code:not([data-highlighted])').forEach(el => {
    hljs.highlightElement(el);
  });
}

// ─── Char counter ─────────────────────────────────────────────────────────────
function updateCharCount() {
  const len = inp.value.length;
  if (charCount) { charCount.textContent = len > 200 ? len + ' chars' : ''; }
}

// ─── Clear chat ───────────────────────────────────────────────────────────────
function clearChat() {
  msgs.querySelectorAll('.bubble').forEach(b => b.remove());
  lastAssistantBubble = null;
  userMsgCount = 0;
  if (tokenBar) { tokenBar.classList.add('hidden'); tokenBar.innerHTML = ''; }
  showWelcome();
}

// ─── Session panel ────────────────────────────────────────────────────────────
function toggleSessionPanel() {
  sessionPanel.classList.toggle('hidden');
}

historyToggle.addEventListener('click', toggleSessionPanel);
sessionClose.addEventListener('click', () => sessionPanel.classList.add('hidden'));

function renderSessions(list, newActiveId) {
  activeSessionId = newActiveId;
  sessionList.innerHTML = '';
  if (!list.length) {
    sessionList.innerHTML = '<div class="session-empty">No previous sessions</div>';
    return;
  }
  list.forEach(s => {
    const d = document.createElement('div');
    d.className = 'session-item' + (s.id === newActiveId ? ' active' : '');

    const info = document.createElement('div');
    info.className = 'session-info';

    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = s.title || 'Untitled';

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = s.model + ' · ' + new Date(s.ts).toLocaleDateString();

    info.appendChild(title);
    info.appendChild(meta);

    const del = document.createElement('button');
    del.className = 'session-del';
    del.title = 'Delete';
    del.textContent = '✕';
    del.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm('Delete this session?')) {
        vscode.postMessage({ type: 'deleteSession', sessionId: s.id });
        d.remove();
        if (!sessionList.children.length) {
          sessionList.innerHTML = '<div class="session-empty">No previous sessions</div>';
        }
      }
    });

    d.appendChild(info);
    d.appendChild(del);
    d.addEventListener('click', () => {
      sessionPanel.classList.add('hidden');
      clearChat();
      vscode.postMessage({ type: 'loadSession', sessionId: s.id });
    });
    sessionList.appendChild(d);
  });
}

// ─── Send ─────────────────────────────────────────────────────────────────────
function send() {
  const text = inp.value.trim();
  if (!text || streaming) { return; }
  hideAtDrop();

  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.split(' ');
    const arg = rest.join(' ').trim();
    inp.value = '';
    inp.style.height = '';
    updateCharCount();
    switch (cmd.toLowerCase()) {
      case '/clear':
        clearChat();
        vscode.postMessage({ type: 'clear' });
        return;
      case '/new':
        clearChat();
        vscode.postMessage({ type: 'newChat' });
        return;
      case '/model':
        if (arg) { vscode.postMessage({ type: 'model', model: arg }); }
        else { showInfo('Usage: /model <model-name>'); }
        return;
      case '/remember':
        vscode.postMessage({ type: 'remember', text: arg });
        return;
      case '/memory':
        vscode.postMessage({ type: 'memoryList' });
        return;
      case '/forget':
        if (arg) { vscode.postMessage({ type: 'forget', text: arg }); }
        else { showInfo('Usage: /forget <key>  — delete a saved memory fact'); }
        return;
      case '/commit':
        vscode.postMessage({ type: 'generateCommit' });
        return;
      case '/search':
        if (arg) {
          mkBubble('user').textContent = '/search ' + arg;
          setStreaming(true);
          vscode.postMessage({ type: 'send', text: 'Use search_web to search: ' + arg });
        }
        return;
      case '/history':
        toggleSessionPanel();
        return;
      case '/help':
        showInfo(
          '**Slash commands**\n' +
          '`/clear` — clear messages\n`/new` — new session\n`/model <name>` — switch model\n' +
          '`/remember key = value` — save a fact\n`/memory` — show all memories\n' +
          '`/forget <key>` — delete a saved memory fact\n' +
          '`/commit` — generate a Conventional Commits message from staged diff\n' +
          '`/search <query>` — web search\n`/history` — browse past sessions\n' +
          '`/help` — this message\n\n' +
          '**Shortcuts:** `Enter` send \u00b7 `Shift+Enter` newline \u00b7 `Ctrl+N` new chat\n\n' +
          '**Mention files:** type `@` to autocomplete workspace files.\n\n' +
          '**Branch chat:** click \uD83C\uDF3F on any user bubble to fork the conversation from that point.'
        );
        return;
      default:
        showInfo(`Unknown command: ${cmd}. Type /help for commands.`);
        return;
    }
  }

  const b = mkBubble('user');
  b.textContent = text;
  b.dataset.origText = text;   // preserve for edit
  inp.value = '';
  inp.style.height = '';
  updateCharCount();
  setStreaming(true);
  vscode.postMessage({ type: 'send', text, model: modelSel.value });
}

function showInfo(md) {
  const b = mkBubble('info');
  b.innerHTML = renderMd(md);
  addCopyListeners(b);
  scroll();
}

sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));

// ─── Prompt templates bar ───────────────────────────────────────────────
document.querySelectorAll('.tpl-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (streaming) { return; }
    const prefix = btn.dataset.tpl || '';
    const editor = vscode.window;  // not available in webview — use active file approach
    // Put template text + cursor in textarea for user to complete
    const existing = inp.value.trim();
    inp.value = existing ? `${prefix} ${existing}` : prefix + ' ';
    inp.focus();
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
    updateCharCount();
    // Move cursor to end
    inp.selectionStart = inp.selectionEnd = inp.value.length;
  });
});

newChatBtn.addEventListener('click', () => {
  clearChat();
  vscode.postMessage({ type: 'newChat' });
});

modelSel.addEventListener('change', () => {
  vscode.postMessage({ type: 'model', model: modelSel.value });
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    clearChat();
    vscode.postMessage({ type: 'newChat' });
  }
});

inp.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  if (e.key === 'Escape') { hideAtDrop(); }
  if (e.key === 'ArrowDown' && !atDrop.classList.contains('hidden')) {
    e.preventDefault(); focusAtItem(0);
  }
});
inp.addEventListener('input', () => {
  inp.style.height = 'auto';
  inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
  updateCharCount();
  handleAtMention();
});
inp.addEventListener('blur', () => { setTimeout(hideAtDrop, 150); });

// Prevent textarea blur when clicking dropdown items (fixes @mention autofill)
atDrop.addEventListener('mousedown', e => e.preventDefault());

// ─── @mention autocomplete ────────────────────────────────────────────────────
let atStart = -1;

function handleAtMention() {
  const val = inp.value;
  const pos = inp.selectionStart ?? 0;
  // Find last @ before cursor
  const before = val.slice(0, pos);
  const atIdx = before.lastIndexOf('@');
  if (atIdx === -1 || before.slice(atIdx).includes(' ')) { hideAtDrop(); return; }
  atStart = atIdx;
  const prefix = before.slice(atIdx + 1);
  vscode.postMessage({ type: 'getFiles', prefix });
}

function hideAtDrop() {
  atDrop.classList.add('hidden');
  atDrop.innerHTML = '';
  atStart = -1;
}

function focusAtItem(idx) {
  const items = atDrop.querySelectorAll('.at-item');
  if (items[idx]) { items[idx].focus(); }
}

function showAtDrop(list) {
  if (!list.length || atStart === -1) { hideAtDrop(); return; }
  atDrop.innerHTML = '';
  list.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'at-item';
    d.textContent = f;
    d.tabIndex = 0;
    d.addEventListener('click', () => insertMention(f));
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter') { insertMention(f); }
      if (e.key === 'ArrowDown') { e.preventDefault(); focusAtItem(i + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); i > 0 ? focusAtItem(i - 1) : inp.focus(); }
      if (e.key === 'Escape') { hideAtDrop(); inp.focus(); }
    });
    atDrop.appendChild(d);
  });
  atDrop.classList.remove('hidden');
}

function insertMention(file) {
  const val = inp.value;
  const pos = inp.selectionStart ?? val.length;
  const before = val.slice(0, atStart) + '@' + file;
  const after  = val.slice(pos);
  inp.value = before + after;
  inp.setSelectionRange(before.length, before.length);
  hideAtDrop();
  inp.focus();
}

// ─── Confirmation ─────────────────────────────────────────────────────────────
function resolveConfirm(bubble, id, accepted) {
  bubble.querySelectorAll('button.btn-yes, button.btn-no').forEach(b => { b.disabled = true; });
  const s = bubble.querySelector('.confirm-status');
  if (s) { s.textContent = accepted ? '✔ Accepted' : '✖ Declined'; }
  vscode.postMessage({ type: 'confirm', id, accepted });
  setStreaming(true);
}

// ─── Message handler ──────────────────────────────────────────────────────────
window.addEventListener('message', ({ data: m }) => {
  switch (m.type) {

    case 'workspace':
      wsPath.textContent = m.path
        ? ('⌂ …/' + m.path.replace(/\\/g, '/').split('/').pop())
        : '⌂ (no workspace)';
      wsPath.title = m.path || '';
      break;

    case 'models':
      modelSel.innerHTML = '';
      (m.list || []).forEach(name => {
        const o = document.createElement('option');
        o.value = o.textContent = name;
        if (name === m.active) { o.selected = true; }
        modelSel.appendChild(o);
      });
      if (!(m.list || []).length) {
        const o = document.createElement('option');
        o.textContent = '⚠ No models — start Ollama';
        o.disabled = true;
        modelSel.appendChild(o);
      }
      break;

    case 'modelChanged':
      for (const o of modelSel.options) { o.selected = o.value === m.model; }
      break;

    case 'clearChat':
      clearChat();
      break;

    case 'sessions':
      renderSessions(m.list || [], m.activeId);
      break;

    case 'restoreMessage': {
      const rb = mkBubble(m.role === 'user' ? 'user' : 'assistant');
      if (m.role === 'user') {
        rb.textContent = m.content;
        rb.dataset.origText = m.content;
      } else {
        rb.innerHTML = renderMd(m.content);
        addCopyListeners(rb);
        addAssistantActions(rb);
        lastAssistantBubble = rb;
      }
      break;
    }

    case 'streamStart':
      lastAssistantBubble = null;
      streamBubble = mkBubble('assistant thinking');
      streamBubble.innerHTML =
        '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      setStreaming(true);
      break;

    case 'token':
      if (streamBubble) {
        // Transition out of "thinking" spinner on first real token (immediate, cosmetic)
        if (streamBubble.classList.contains('thinking')) {
          streamBubble.classList.remove('thinking');
          streamBubble.innerHTML = '';
          streamBubble._raw = '';
          streamBubble._inThink = false;
        }
        // Accumulate into _raw immediately so RAF always sees latest data
        streamBubble._raw = (streamBubble._raw || '') + m.d;

        // Item 28: Only schedule one RAF per frame — batch all incoming tokens
        if (!_rafPending) {
          _rafPending = true;
          requestAnimationFrame(() => {
            _rafPending = false;
            if (!streamBubble) { return; }

            const raw = streamBubble._raw || '';
            const thinkOpen   = raw.lastIndexOf('<think>')   > raw.lastIndexOf('</think>');
            const thoughtOpen = raw.lastIndexOf('<Thought>') > raw.lastIndexOf('</Thought>');
            const insideThink = thinkOpen || thoughtOpen;

            const stripped = raw
              .replace(/<(?:think|Thought)>[\s\S]*?<\/(?:think|Thought)>/g, '')
              .trim();

            if (insideThink) {
              const thinkTag     = thinkOpen ? '<think>' : '<Thought>';
              const thinkContent = raw.slice(raw.lastIndexOf(thinkTag) + thinkTag.length);
              const preview = thinkContent.length > 300
                ? '\u2026' + thinkContent.slice(-300)
                : thinkContent;
              streamBubble.innerHTML =
                '<span class="stream-thinking">\uD83E\uDDE0 Thinking\u2026</span>' +
                '<div class="think-stream">' + esc(preview) + '</div>';
            } else {
              streamBubble.innerHTML = stripped ? renderMd(stripped) : '';
              addCopyListeners(streamBubble);
            }
            scroll();
          });
        }
      }
      break;

    case 'streamEnd':
      if (streamBubble) {
        streamBubble.classList.remove('thinking');
        if (!streamBubble._raw || !streamBubble.innerHTML.trim()) {
          streamBubble.remove();
          lastAssistantBubble = null;
        } else {
          if (m.cancelled) {
            streamBubble.innerHTML += '<br><em class="stopped">[stopped]</em>';
          }
          // Final render – apply syntax highlighting now that all tokens arrived
          applyHljs(streamBubble);
          addAssistantActions(streamBubble);
          lastAssistantBubble = streamBubble; // remember so think bubbles insert before it
        }
        streamBubble = null;
      }
      if (m.cancelled) { setStreaming(false); }
      break;

    case 'done':
      setStreaming(false);
      break;

    case 'tokenUsage': {
      if (!tokenBar) { break; }
      const pct = m.total > 0 ? Math.min(100, Math.round(m.used / m.total * 100)) : 0;
      const color = pct >= 90
        ? '#f48771'
        : pct >= 70
          ? '#cca700'
          : 'var(--vscode-progressBar-background, #0e70c0)';
      tokenBar.title = `${m.used.toLocaleString()} / ${m.total.toLocaleString()} tokens used (${pct}%)`;
      tokenBar.innerHTML =
        `<div class="token-fill" style="width:${pct}%;background:${color}"></div>` +
        `<span class="token-label">${m.used.toLocaleString()} / ${m.total.toLocaleString()} tokens</span>`;
      tokenBar.classList.remove('hidden');
      break;
    }

    case 'error': {
      if (streamBubble) {
        if (!streamBubble._raw) { streamBubble.remove(); }
        else { streamBubble.classList.remove('thinking'); }
        streamBubble = null;
      }
      const eb = mkBubble('error');
      eb.textContent = '⚠ ' + (m.msg || 'Unknown error');
      setStreaming(false);
      break;
    }

    case 'info': {
      showInfo(m.msg || '');
      break;
    }

    case 'thinking': {
      const b = document.createElement('div');
      b.className = 'bubble think';
      b.innerHTML =
        '<div class="think-label" onclick="this.nextSibling.classList.toggle(\'collapsed\')">' +
        '🧠 Thinking… <span class="think-chevron">▾</span></div>' +
        '<div class="think-body">' + esc(m.text) + '</div>';
      // Insert BEFORE the assistant text bubble so thinking appears above the reply
      if (lastAssistantBubble && lastAssistantBubble.parentNode === msgs) {
        msgs.insertBefore(b, lastAssistantBubble);
      } else {
        msgs.appendChild(b);
      }
      scroll();
      break;
    }

    case 'tool': {
      const b = mkBubble('tool');
      b.innerHTML =
        '<div class="tool-header">⚙ <strong>' + esc(m.name) + '</strong></div>' +
        '<pre class="tool-args">' + esc(JSON.stringify(m.args, null, 2)) + '</pre>';
      break;
    }

    case 'result': {
      const b = mkBubble('result');
      const txt = String(m.text || '');
      const preview = txt.length > 600 ? txt.slice(0, 600) + '\n…[truncated]' : txt;
      b.innerHTML =
        '<div class="result-header">✔ Result</div>' +
        '<pre class="result-body">' + esc(preview) + '</pre>';
      break;
    }

    case 'confirmReq': {
      if (streamBubble) { streamBubble.classList.remove('thinking'); streamBubble = null; }
      setStreaming(false);
      const b = mkBubble('confirm');
      b.innerHTML =
        '<div class="confirm-header"><strong>' + esc(m.title) + '</strong>' +
        ' <code>' + esc(m.filePath) + '</code></div>' +
        '<div class="diff-box">' + mkDiff(m.before, m.after) + '</div>' +
        '<div class="confirm-btns">' +
          '<button class="btn-yes">✔ Apply</button>' +
          '<button class="btn-no">✖ Skip</button>' +
          '<span class="confirm-status"></span>' +
        '</div>';
      b.querySelector('.btn-yes').onclick = () => resolveConfirm(b, m.id, true);
      b.querySelector('.btn-no').onclick  = () => resolveConfirm(b, m.id, false);
      scroll();
      break;
    }

    case 'simpleConfirmReq': {
      if (streamBubble) { streamBubble.classList.remove('thinking'); streamBubble = null; }
      setStreaming(false);
      const b = mkBubble('confirm');
      b.innerHTML =
        '<div class="confirm-header"><strong>' + esc(m.title) + '</strong></div>' +
        '<pre class="confirm-detail">' + esc(m.detail) + '</pre>' +
        '<div class="confirm-btns">' +
          '<button class="btn-yes">✔ Yes</button>' +
          '<button class="btn-no">✖ No</button>' +
          '<span class="confirm-status"></span>' +
        '</div>';
      b.querySelector('.btn-yes').onclick = () => resolveConfirm(b, m.id, true);
      b.querySelector('.btn-no').onclick  = () => resolveConfirm(b, m.id, false);
      scroll();
      break;
    }

    case 'files':
      showAtDrop(m.list || []);
      break;

    case 'routeInfo': {
      // Collapsible routing-decision bubble before the assistant's response
      const intentLabel = String(m.intent || 'UNKNOWN').replace(/_/g, ' ');
      const confidence  = typeof m.confidence === 'number'
        ? Math.round(m.confidence * 100) + '%'
        : '?';
      const reasoning   = esc(String(m.reasoning || ''));
      const modelName   = esc(String(m.model     || ''));
      const b = document.createElement('div');
      b.className = 'bubble route-info';
      b.innerHTML =
        '<div class="route-summary" onclick="this.nextSibling.classList.toggle(\'collapsed\')">' +
          '<span class="route-intent">' + esc(intentLabel) + '</span>' +
          '<span class="route-model-name">' + modelName + '</span>' +
          '<span class="route-confidence">' + confidence + '</span>' +
          '<span class="route-chevron">▾</span>' +
        '</div>' +
        '<div class="route-body collapsed">' + reasoning + '</div>';
      msgs.appendChild(b);
      scroll();
      break;
    }

    case 'modelForMessage':
      // Update model selector to reflect the specialist model in use right now
      if (m.model) {
        for (const o of modelSel.options) { o.selected = o.value === m.model; }
      }
      break;

    case 'prefillText': {
      const text = String(m.text || '');
      inp.value = text;
      inp.focus();
      inp.style.height = 'auto';
      inp.style.height = Math.min(inp.scrollHeight, 160) + 'px';
      updateCharCount();
      break;
    }
  }
});

// ─── Diff renderer ────────────────────────────────────────────────────────────
// Shows only changed lines with up to 3 lines of context either side,
// collapsing long unchanged runs so the diff box stays compact.
function mkDiff(before, after) {
  const a = (before || '').split('\n');
  const b = (after  || '').split('\n');
  const max = Math.max(a.length, b.length);
  const CONTEXT = 3;

  // Mark which lines are changed
  const changed = new Array(max).fill(false);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) { changed[i] = true; }
  }

  // Build set of lines to show (changed ± CONTEXT)
  const show = new Set();
  for (let i = 0; i < max; i++) {
    if (changed[i]) {
      for (let j = Math.max(0, i - CONTEXT); j <= Math.min(max - 1, i + CONTEXT); j++) {
        show.add(j);
      }
    }
  }

  if (!show.size) {
    return '<div class="diff-ctx"><em>(no changes)</em></div>';
  }

  let html = '';
  let lastShown = -1;
  for (let i = 0; i < max; i++) {
    if (!show.has(i)) { continue; }
    if (lastShown !== -1 && i > lastShown + 1) {
      html += '<div class="diff-ctx diff-ellipsis">… ' + (i - lastShown - 1) + ' unchanged lines …</div>';
    }
    const o = a[i], n = b[i];
    if (o === n) {
      html += '<div class="diff-ctx">' + esc(o || '') + '</div>';
    } else {
      if (o !== undefined) { html += '<div class="diff-del">- ' + esc(o) + '</div>'; }
      if (n !== undefined) { html += '<div class="diff-add">+ ' + esc(n) + '</div>'; }
    }
    lastShown = i;
  }
  return html;
}

// Signal extension that the webview JS is loaded and ready to receive messages
vscode.postMessage({ type: 'ready' });
