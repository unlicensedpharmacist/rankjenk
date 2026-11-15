(function () {
  var PLAYLIST = [
    { file: "music/track.mp3", title: "Finn James - Discord Drillingz" },
    { file: "music/track2.mp3", title: "Acid Souljah - I Take Drugs & I Feel Weird (Prod. Ticox)" },
    { file: "music/track3.mp3", title: "Christ Dillinger & Acid Souljah - On The Spectrum (ft. Xhris2eazy & BMG)" },
    { file: "music/track4.mp3", title: "Very Super Famous" },
    { file: "music/track5.mp3", title: "Chief Keef - Been Ballin (Nightcore Remix)" },
    { file: "music/track6.mp3", title: "Yeat - Tonka 2 (Nightcore)" },
    { file: "music/track7.mp3", title: "IM AUTISTIC (feat. $weet T & Danny G)" },
    { file: "music/track8.mp3", title: "Kissy Face (Prod. Jetskiii & Luvniko)" },
    { file: "music/track9.mp3", title: "Sandman (feat. bicflame)" },
    { file: "music/track10.mp3", title: "Retarded (Prod. Maxxs & Ericslake)" }
  ];

  var audio = new Audio();

  audio.preload = "none";
  audio.volume = 0.5;
  audio.loop = PLAYLIST.length === 1;

  function pref() { try { return localStorage.getItem("rj_music"); } catch (e) { return null; } }
  function setPref(v) { try { localStorage.setItem("rj_music", v); } catch (e) {} }

  var idx = 0, resumeAt = 0, saved = null;
  try {
    saved = sessionStorage.getItem("rj_music_idx");
    idx = parseInt(saved, 10) || 0;
    resumeAt = parseFloat(sessionStorage.getItem("rj_music_pos")) || 0;
  } catch (e) {}
  if (saved === null || document.getElementById("splash") || idx < 0 || idx >= PLAYLIST.length) {
    idx = Math.floor(Math.random() * PLAYLIST.length);
    resumeAt = 0;
  }

  var many = PLAYLIST.length > 1;
  var box = document.createElement("div");
  box.id = "music-player";
  box.innerHTML =
    '<div class="mp-title">&#9835; MIDI PLAYER</div>' +
    '<div class="mp-scroll"><span id="mp-now"></span></div>' +
    '<div class="mp-row">' +
    (many ? '<button type="button" id="mp-prev" class="btn small" aria-label="Previous song">&lt;&lt;</button>' : '') +
    '<button type="button" id="mp-btn" class="btn small">PLAY</button>' +
    (many ? '<button type="button" id="mp-next" class="btn small" aria-label="Next song">&gt;&gt;</button>' : '') +
    '</div>' +
    '<div class="mp-row"><label class="mp-vol">VOL <input id="mp-vol" type="range" min="0" max="100" value="50"></label></div>';
  document.body.appendChild(box);

  var btn = document.getElementById("mp-btn");
  var now = document.getElementById("mp-now");

  function showTrack() {
    now.textContent = "now playing: " + PLAYLIST[idx].title + (many ? " (" + (idx + 1) + "/" + PLAYLIST.length + ")" : "");
  }
  /* iPhones ignore audio.volume, so when that's the case the volume goes through a Web Audio gain node instead.
     It's set up on the first tap (browsers only allow audio setup after a tap). */
  var volumeWorks = (function () { var t = new Audio(); t.volume = 0.5; return t.volume === 0.5; })();
  var actx = null, gain = null;
  function ensureGain() {
    if (volumeWorks) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!actx) {
        actx = new AC();
        gain = actx.createGain();
        actx.createMediaElementSource(audio).connect(gain);
        gain.connect(actx.destination);
        setVolume();
      }
      if (actx.state === "suspended") actx.resume();
    } catch (e) { volumeWorks = true; }
  }

  function load(i) {
    idx = i;
    audio.src = PLAYLIST[i].file;
    showTrack();
    try { sessionStorage.setItem("rj_music_idx", String(i)); sessionStorage.setItem("rj_music_pos", "0"); } catch (e) {}
  }
  function start() {
    ensureGain();
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
  }
  function go(step) {
    resumeAt = 0;
    load((idx + step + PLAYLIST.length) % PLAYLIST.length);
    start();
  }
  function render() { btn.textContent = audio.paused ? "PLAY" : "PAUSE"; }

  load(idx);
  try { sessionStorage.setItem("rj_music_pos", String(resumeAt)); } catch (e) {}

  audio.addEventListener("loadedmetadata", function () {
    if (resumeAt > 0 && resumeAt < audio.duration) audio.currentTime = resumeAt;
    resumeAt = 0;
  });
  audio.addEventListener("play", function () { showTrack(); render(); });
  audio.addEventListener("pause", function () { render(); now.textContent = "music off"; });
  audio.addEventListener("ended", function () { go(1); });
  setInterval(function () {
    if (!audio.paused) { try { sessionStorage.setItem("rj_music_pos", String(audio.currentTime)); } catch (e) {} }
  }, 1000);

  /* music lock: members whose tag (or the site default) doesn't allow it can't pause or turn down the music */
  var allowed = true;
  btn.addEventListener("click", function () {
    if (!allowed) { if (audio.paused) start(); return; }
    if (audio.paused) { setPref("on"); start(); } else { setPref("off"); audio.pause(); }
  });
  if (many) {
    document.getElementById("mp-next").addEventListener("click", function () { setPref("on"); go(1); });
    document.getElementById("mp-prev").addEventListener("click", function () {
      setPref("on");
      if (audio.currentTime > 3) { audio.currentTime = 0; start(); } else { go(-1); }
    });
  }
  var volInput = document.getElementById("mp-vol");
  function setVolume() {
    var v = volInput.value / 100;
    if (gain) { gain.gain.value = v; audio.volume = 1; } else audio.volume = v;
    volInput.style.setProperty("--fill", volInput.value + "%");
  }
  volInput.addEventListener("input", function () { ensureGain(); setVolume(); });
  setVolume();

  function autoplay() {
    if (pref() === "off" && allowed) { ensureGain(); return; } // they turned it off: stay silent
    if (audio.paused) start();
  }
  function setAllowed(ok) {
    ok = ok !== false;
    if (ok === allowed) return;
    allowed = ok;
    box.classList.toggle("locked", !ok);
    volInput.disabled = !ok;
    btn.title = ok ? "" : "Your tag can't turn the music off";
    if (!ok) {
      volInput.value = Math.max(volInput.value, 50);
      setVolume();
      if (audio.paused) start();
      btn.textContent = "LOCKED";
    } else {
      render();
    }
  }
  audio.addEventListener("pause", function () { if (!allowed) btn.textContent = "LOCKED"; });
  audio.addEventListener("play", function () { if (!allowed) btn.textContent = "LOCKED"; });
  window.RJMusic = { autoplay: autoplay, setAllowed: setAllowed };

  autoplay();
  ["pointerdown", "keydown", "touchend", "click"].forEach(function (name) {
    document.addEventListener(name, function (e) {
      if (e.target && e.target.closest && e.target.closest("#music-player")) return;
      autoplay();
    }, true);
  });
})();
