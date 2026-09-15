/* Folienbetrachter: zeigt die Kurs-Präsentation (PDF) direkt auf der Seite.
   pdf.js wird erst geladen, wenn jemand "Folien ansehen" antippt. */
(function () {
  'use strict';
  var PDFJS  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var ladePdfjs = null;

  function pdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!ladePdfjs) ladePdfjs = new Promise(function (ok, fehler) {
      var s = document.createElement('script');
      s.src = PDFJS; s.async = true;
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; ok(window.pdfjsLib); };
      s.onerror = function () { ladePdfjs = null; fehler(new Error('pdfjs')); };
      document.head.appendChild(s);
    });
    return ladePdfjs;
  }

  var ZEICHEN = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ZEICHEN[c]; });
  }

  function stil() {
    if (document.getElementById('folienStil')) return;
    var st = document.createElement('style');
    st.id = 'folienStil';
    st.textContent = [
      '.folien{margin-top:16px;border:1px solid var(--linie);border-radius:var(--r);background:var(--glas);overflow:hidden}',
      '.folien-kopf{display:flex;align-items:center;gap:12px;padding:14px 16px;flex-wrap:wrap}',
      '.folien-icon{font-size:1.5rem;line-height:1}',
      '.folien-txt{flex:1;min-width:180px}',
      '.folien-txt b{display:block;font-weight:700;line-height:1.35}',
      '.folien-txt small{color:var(--text-3);font-size:.8rem}',
      '.folien-knoepfe{display:flex;gap:8px;flex-wrap:wrap}',
      '.folien-knoepfe .btn{padding:10px 16px;font-size:.88rem}',
      '.folien-buehne{border-top:1px solid var(--linie);background:#000}',
      '.folien-buehne[hidden]{display:none}',
      '.folien-flaeche{position:relative;display:flex;justify-content:center;align-items:center;min-height:180px;cursor:pointer;-webkit-user-select:none;user-select:none}',
      '.folien-flaeche canvas{display:block;height:auto;max-width:100%;max-height:78vh}',
      '.folien-lade{position:absolute;inset:0;display:grid;place-items:center;padding:20px;text-align:center;color:var(--text-3);font-size:.9rem}',
      '.folien-lade[hidden]{display:none}',
      '.folien-lade a{color:var(--tuerkis)}',
      '.folien-leiste{display:flex;align-items:center;justify-content:center;gap:10px;padding:10px;background:rgba(0,0,0,.35);border-top:1px solid var(--linie)}',
      '.folien-leiste button{min-width:44px;height:40px;border-radius:var(--r-s);border:1px solid var(--linie-2);background:var(--glas-2);color:var(--text);font-size:1.3rem;line-height:1;cursor:pointer}',
      '.folien-leiste button:disabled{opacity:.35;cursor:default}',
      '.folien-leiste button:hover:not(:disabled){border-color:var(--tuerkis)}',
      '.folien-zahl{min-width:84px;text-align:center;font-variant-numeric:tabular-nums;color:var(--text-2);font-size:.9rem}',
      '.folien-leiste .folien-voll{margin-left:8px;font-size:1rem}',
      '.folien-buehne:fullscreen{display:flex;flex-direction:column;justify-content:center;height:100%}',
      '.folien-buehne:fullscreen .folien-flaeche{flex:1}',
      '.folien-buehne:fullscreen .folien-flaeche canvas{max-height:calc(100vh - 64px)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function zeige(box, url, opt) {
    opt = opt || {};
    if (!box || !url) return;
    stil();
    if (box._folienAufraeumen) box._folienAufraeumen();
    var titel = opt.titel || 'Präsentation zum Kurs';
    box.classList.add('folien');
    box.innerHTML =
      '<div class="folien-kopf"><span class="folien-icon">📄</span>' +
        '<div class="folien-txt"><b>' + esc(titel) + '</b><small>Direkt hier durchblättern oder als PDF sichern</small></div>' +
        '<div class="folien-knoepfe"><button type="button" class="btn t folien-auf">Folien ansehen</button>' +
        '<a class="btn geist" href="' + esc(url) + '" target="_blank" rel="noopener" download>PDF</a></div></div>' +
      '<div class="folien-buehne" hidden>' +
        '<div class="folien-flaeche"><canvas></canvas><div class="folien-lade">Folien werden geladen …</div></div>' +
        '<div class="folien-leiste">' +
          '<button type="button" class="folien-zurueck" aria-label="Vorherige Folie">‹</button>' +
          '<span class="folien-zahl">– / –</span>' +
          '<button type="button" class="folien-vor" aria-label="Nächste Folie">›</button>' +
          '<button type="button" class="folien-voll" aria-label="Vollbild">⛶</button>' +
        '</div></div>';

    function q(s) { return box.querySelector(s); }
    var knopf = q('.folien-auf'), buehne = q('.folien-buehne'), flaeche = q('.folien-flaeche');
    var canvas = q('canvas'), lade = q('.folien-lade'), zahl = q('.folien-zahl');
    var doc = null, seite = 1, rendert = null, wartend = null, geladen = false;

    function male(n) {
      if (!doc) return;
      seite = Math.max(1, Math.min(doc.numPages, n));
      zahl.textContent = seite + ' / ' + doc.numPages;
      q('.folien-zurueck').disabled = seite <= 1;
      q('.folien-vor').disabled = seite >= doc.numPages;
      if (rendert) { wartend = seite; return; }
      rendert = true;
      var ziel = seite;
      doc.getPage(ziel).then(function (p) {
        var v1 = p.getViewport({ scale: 1 });
        var breite = flaeche.clientWidth || 640;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var v = p.getViewport({ scale: breite / v1.width * dpr });
        canvas.width = Math.floor(v.width);
        canvas.height = Math.floor(v.height);
        canvas.style.width = Math.floor(v.width / dpr) + 'px';
        return p.render({ canvasContext: canvas.getContext('2d'), viewport: v }).promise;
      }).catch(function () { /* abgebrochen */ }).then(function () {
        rendert = null;
        lade.hidden = true;
        if (wartend && wartend !== ziel) { var w = wartend; wartend = null; male(w); } else { wartend = null; }
        if (ziel < doc.numPages) doc.getPage(ziel + 1).catch(function () {});
      });
    }

    function oeffnen() {
      buehne.hidden = false;
      knopf.textContent = 'Folien schließen';
      if (geladen) { male(seite); return; }
      geladen = true;
      pdfjs().then(function (lib) {
        return lib.getDocument({ url: url }).promise;
      }).then(function (d) {
        doc = d;
        q('.folien-txt small').textContent = doc.numPages + ' Folien · mit den Pfeilen, per Wischen oder Antippen blättern';
        male(1);
      }).catch(function () {
        geladen = false;
        lade.hidden = false;
        lade.innerHTML = 'Die Folien ließen sich hier nicht anzeigen. <a href="' + esc(url) + '" target="_blank" rel="noopener">PDF öffnen</a>';
      });
    }

    knopf.addEventListener('click', function () {
      if (buehne.hidden) oeffnen();
      else { buehne.hidden = true; knopf.textContent = 'Folien ansehen'; }
    });
    q('.folien-zurueck').addEventListener('click', function () { male(seite - 1); });
    q('.folien-vor').addEventListener('click', function () { male(seite + 1); });
    q('.folien-voll').addEventListener('click', function () {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (buehne.requestFullscreen) buehne.requestFullscreen().catch(function () {});
      else if (buehne.webkitRequestFullscreen) buehne.webkitRequestFullscreen();
    });
    flaeche.addEventListener('click', function (ev) {
      if (!doc) return;
      var r = flaeche.getBoundingClientRect();
      male(seite + (ev.clientX - r.left < r.width / 3 ? -1 : 1));
    });
    var x0 = null;
    flaeche.addEventListener('touchstart', function (ev) { x0 = ev.touches[0].clientX; }, { passive: true });
    flaeche.addEventListener('touchend', function (ev) {
      if (x0 === null) return;
      var dx = ev.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) { ev.preventDefault(); male(seite + (dx < 0 ? 1 : -1)); }
    });
    function taste(ev) {
      if (buehne.hidden || !doc) return;
      var t = ev.target && ev.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'VIDEO' || t === 'SELECT') return;
      if (ev.key === 'ArrowRight') male(seite + 1);
      else if (ev.key === 'ArrowLeft') male(seite - 1);
    }
    document.addEventListener('keydown', taste);
    var takt = null;
    function neu() { clearTimeout(takt); takt = setTimeout(function () { if (doc && !buehne.hidden) male(seite); }, 200); }
    window.addEventListener('resize', neu);
    document.addEventListener('fullscreenchange', neu);
    box._folienAufraeumen = function () {
      document.removeEventListener('keydown', taste);
      window.removeEventListener('resize', neu);
      document.removeEventListener('fullscreenchange', neu);
      if (doc) doc.destroy();
      box._folienAufraeumen = null;
    };
    if (opt.offen) oeffnen();
  }

  function aufraeumen(wurzel) {
    (wurzel || document).querySelectorAll('.folien').forEach(function (b) { if (b._folienAufraeumen) b._folienAufraeumen(); });
  }

  window.AUFolien = { zeige: zeige, aufraeumen: aufraeumen };
})();
