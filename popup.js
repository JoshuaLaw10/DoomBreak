// popup.js
// ============================================================
// Doomscroll Break — popup controller.
//
// Reads / writes chrome.storage.local for:
//   enabled       — master on/off toggle
//   promptMode    — prompt-aware clip filtering
//   selectorTelemetry — per-selector match data (written by chatgpt.js)
//   autoCloseStreak   — daily auto-close counts
//
// No external network calls; no cross-origin requests.
// ============================================================

'use strict';

var btn        = document.getElementById('toggleBtn');
var promptEl   = document.getElementById('promptMode');
var pipEl      = document.getElementById('pipMode');
var vibeEls    = Array.prototype.slice.call(document.querySelectorAll('#vibe-grid input[data-tag]'));
var healthList = document.getElementById('health-list');
var healthSumm = document.getElementById('health-summary');

// Selector keys that must match for detection to work
var STOP_KEYS = [
  'stop:testid',
  'stop:button-testid',
  'stop:aria-stop-gen',
  'stop:aria-stop-str',
  'stop:composer-aria',
];

// A selector is "stale" if last matched > 3 days ago, "dead" if > 7 days.
var STALE_MS = 3 * 24 * 60 * 60 * 1000;
var DEAD_MS  = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Render main toggle
// ---------------------------------------------------------------------------
function renderToggle(enabled) {
  var on = !!enabled;
  btn.textContent = on ? 'Turn OFF' : 'Turn ON';
  btn.className   = on ? 'on' : 'off';
}

// ---------------------------------------------------------------------------
// Render selector health
// ---------------------------------------------------------------------------
function renderHealth(telemetry) {
  telemetry = telemetry || {};
  var now   = Date.now();
  var items = [];
  var anyMatch = false;

  STOP_KEYS.forEach(function(key) {
    var entry = telemetry[key];
    var status, label;

    if (!entry || !entry.lastMatch) {
      status = 'unseen';
      label  = key + ' — never matched';
    } else {
      var age = now - entry.lastMatch;
      anyMatch = true;
      if (age < STALE_MS) {
        status = 'ok';
        label  = key + ' — ✓ ' + _relTime(entry.lastMatch);
      } else if (age < DEAD_MS) {
        status = 'stale';
        label  = key + ' — stale ' + _relTime(entry.lastMatch);
      } else {
        status = 'dead';
        label  = key + ' — last matched ' + _relTime(entry.lastMatch);
      }
    }

    items.push({ status: status, label: label });
  });

  healthList.innerHTML = items.map(function(item) {
    return '<li>' +
      '<span class="health-dot health-' + item.status + '"></span>' +
      '<span>' + _escHtml(item.label) + '</span>' +
      '</li>';
  }).join('');

  if (!anyMatch) {
    healthSumm.textContent = 'No selector has matched yet. Open ChatGPT and send a prompt.';
    healthSumm.style.color = '#f87171';
  } else {
    var okCount = items.filter(function(i) { return i.status === 'ok'; }).length;
    if (okCount > 0) {
      healthSumm.textContent = okCount + ' of ' + STOP_KEYS.length + ' stop selectors recently matched. Detection looks healthy.';
      healthSumm.style.color = '#4ade80';
    } else {
      healthSumm.textContent = 'All stop selectors are stale. ChatGPT may have changed its DOM.';
      healthSumm.style.color = '#facc15';
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _relTime(ts) {
  var age = Date.now() - ts;
  var m   = Math.round(age / 60000);
  if (m < 2)  return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Refresh everything from storage
// ---------------------------------------------------------------------------
function refresh() {
  chrome.storage.local.get(
    ['enabled', 'promptMode', 'overlayMode', 'feedTags', 'selectorTelemetry'],
    function(res) {
      renderToggle(res.enabled !== false); // default: enabled
      promptEl.checked = res.promptMode !== false; // default ON
      pipEl.checked    = res.overlayMode === 'pip';
      var tags = Array.isArray(res.feedTags) ? res.feedTags : [];
      vibeEls.forEach(function(el) {
        el.checked = tags.indexOf(el.getAttribute('data-tag')) !== -1;
      });
      renderHealth(res.selectorTelemetry);
    }
  );
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
btn.addEventListener('click', function() {
  chrome.storage.local.get(['enabled'], function(res) {
    var nowEnabled = !(res.enabled !== false);
    chrome.storage.local.set({ enabled: nowEnabled }, refresh);
  });
});

promptEl.addEventListener('change', function() {
  chrome.storage.local.set({ promptMode: promptEl.checked }, refresh);
});

pipEl.addEventListener('change', function() {
  chrome.storage.local.set({ overlayMode: pipEl.checked ? 'pip' : 'full' }, refresh);
});

// Vibe picker: store the checked tags; none checked = no filter (remove key).
vibeEls.forEach(function(el) {
  el.addEventListener('change', function() {
    var tags = vibeEls
      .filter(function(e) { return e.checked; })
      .map(function(e) { return e.getAttribute('data-tag'); });
    if (tags.length) {
      chrome.storage.local.set({ feedTags: tags }, refresh);
    } else {
      chrome.storage.local.remove('feedTags', refresh);
    }
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
refresh();
