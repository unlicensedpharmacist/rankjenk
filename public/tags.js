/* member tags: shared by the main page and the owner dashboard */
(function () {
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var EFFECTS = [
    ["none", "No effect"],
    ["sparkle", "Sparkles"],
    ["glow", "Pulsing glow"],
    ["fire", "On fire"],
    ["glitch", "Glitch"],
    ["shine", "Shine sweep"],
    ["rainbow", "Rainbow"],
    ["drip", "Blood drip"]
  ];
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function fx(e) { for (var i = 0; i < EFFECTS.length; i++) if (EFFECTS[i][0] === e) return e; return "none"; }

  /* the tag pill itself */
  function html(t) {
    if (!t || !t.label) return "";
    var bg = HEX.test(t.color) ? t.color : "#a01010";
    var fg = HEX.test(t.text) ? t.text : "#ffd23b";
    return '<span class="utag fx-' + fx(t.effect) + '" style="--tb:' + bg + ';--tf:' + fg + '">' + esc(t.label) + "</span>";
  }

  /* extra class + style for a post whose author's tag highlights their posts */
  function hl(t) {
    if (!t || !t.highlight || !HEX.test(t.color)) return { cls: "", style: "" };
    return { cls: " hl", style: ' style="--tb:' + t.color + '"' };
  }

  window.RJTag = { EFFECTS: EFFECTS, html: html, hl: hl };
})();
