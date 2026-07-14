// platforms/registry.js
// ============================================================
// Platform registry — selects the adapter for the current host.
//
// Load order (manifest.json): every platforms/*.js adapter loads
// BEFORE this file; each one pushes { hosts, adapter } onto
// window.__DB_PLATFORMS. This file then picks the adapter whose
// host list matches location.hostname and exposes it as
// window.Platform, which content_script.js consumes.
//
// If no adapter matches (or in unit tests, where this file isn't
// loaded), content_script.js falls back to window.ChatGPT.
// ============================================================

'use strict';

(function() {
  var registrations = (typeof window !== 'undefined' && window.__DB_PLATFORMS) || [];
  var host = (typeof location !== 'undefined' && location.hostname) || '';

  function hostMatches(pattern) {
    // 'chatgpt.com' matches 'chatgpt.com' and any subdomain of it.
    return host === pattern || host.slice(-(pattern.length + 1)) === '.' + pattern;
  }

  var selected = null;
  for (var i = 0; i < registrations.length && !selected; i++) {
    var reg = registrations[i];
    for (var j = 0; j < reg.hosts.length; j++) {
      if (hostMatches(reg.hosts[j])) { selected = reg.adapter; break; }
    }
  }

  if (typeof window !== 'undefined') window.Platform = selected;

  if (typeof module !== 'undefined') {
    module.exports = {
      _select: function(hostname, regs) {
        for (var a = 0; a < regs.length; a++) {
          for (var b = 0; b < regs[a].hosts.length; b++) {
            var p = regs[a].hosts[b];
            if (hostname === p || hostname.slice(-(p.length + 1)) === '.' + p) {
              return regs[a].adapter;
            }
          }
        }
        return null;
      },
    };
  }
})();
