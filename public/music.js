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

  var idx = 0, resumeAt = 0;
  try {
    idx = parseInt(sessionStorage.getItem("rj_music_idx"), 10) || 0;
    resumeAt = parseFloat(sessionStorage.getItem("rj_music_pos")) || 0;
  } catch (e) {}
  if (idx < 0 || idx >= PLAYLIST.length) { idx = 0; resumeAt = 0; }

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

  function load(i) {
    idx = i;
    audio.src = PLAYLIST[i].file;
    now.textContent = "now playing: " + PLAYLIST[i].title + (many ? " (" + (i + 1) + "/" + PLAYLIST.length + ")" : "");
    try { sessionStorage.setItem("rj_music_idx", String(i)); sessionStorage.setItem("rj_music_pos", "0"); } catch (e) {}
  }
  function start() {
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
  audio.addEventListener("play", render);
  audio.addEventListener("pause", render);
  audio.addEventListener("ended", function () { go(1); });
  setInterval(function () {
    if (!audio.paused) { try { sessionStorage.setItem("rj_music_pos", String(audio.currentTime)); } catch (e) {} }
  }, 1000);

  btn.addEventListener("click", function () {
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
    audio.volume = volInput.value / 100;
    volInput.style.setProperty("--fill", volInput.value + "%");
  }
  volInput.addEventListener("input", setVolume);
  setVolume();

  window.RJMusic = {
    autoplay: function () { if (pref() !== "off") start(); }
  };

  if (pref() === "on" && !document.getElementById("splash")) start();
})();
