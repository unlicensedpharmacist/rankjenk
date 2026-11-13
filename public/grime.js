/* RankJenk grime: hanging chains, smudges, finger smears, fingerprints,
   flies, and blood splatter around the logo. Purely decoration. */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(tag, cls, css) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) e.style.cssText = css;
    return e;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // goo filter for the splatter blobs
  var svgNS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.innerHTML = '<filter id="goo"><feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b"/>' +
    '<feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="g"/>' +
    '<feComposite in="SourceGraphic" in2="g" operator="atop"/></filter>';
  document.body.appendChild(svg);

  // hanging chains on both sides
  document.body.appendChild(el("div", "chain-v l"));
  document.body.appendChild(el("div", "chain-v r"));

  // blood splatter around the logo
  var logo = document.querySelector(".logo");
  if (logo) {
    var wrap = el("span", "logo-title");
    logo.parentNode.insertBefore(wrap, logo);
    wrap.appendChild(logo);
    var blood = el("div", "bloodlayer");
    blood.setAttribute("aria-hidden", "true");
    wrap.appendChild(blood);
    [[4,10],[12,82],[22,2],[30,78],[45,5],[52,85],[60,12],[70,80],[78,3],[88,76],[97,12],[38,50],[66,60]].forEach(function (c) {
      var r = rnd(6, 18);
      blood.appendChild(el("div", "spl",
        "left:" + c[0] + "%;top:" + c[1] + "%;width:" + r + "px;height:" + (r * rnd(.6, 1.2)) + "px;" +
        "transform:rotate(" + rnd(0, 180) + "deg);border-radius:" + rnd(40, 60) + "% " + rnd(50, 70) + "% " + rnd(40, 70) + "% " + rnd(55, 75) + "%"));
      var n = 5 + Math.floor(Math.random() * 6);
      for (var k = 0; k < n; k++) {
        var rr = rnd(1.5, 5.5);
        blood.appendChild(el("div", "spl",
          "left:calc(" + c[0] + "% + " + rnd(-30, 30) + "px);top:calc(" + c[1] + "% + " + rnd(-18, 18) + "px);width:" + rr + "px;height:" + rr + "px"));
      }
    });
    // flies around the logo
    var header = document.querySelector("header");
    if (header && !reduce) {
      for (var f = 0; f < 5; f++) {
        header.appendChild(el("span", "fly",
          "left:" + rnd(10, 90) + "%;top:" + rnd(5, 70) + "%;animation-duration:" + rnd(2, 5) + "s;animation-delay:-" + rnd(0, 3) + "s"))
          .textContent = "🪰";
      }
    }
  }

  // smudges, smears and fingerprints across the whole page
  var grime = el("div", null);
  grime.id = "grime";
  grime.setAttribute("aria-hidden", "true");
  document.body.appendChild(grime);

  function paint() {
    grime.innerHTML = "";
    var h = Math.max(document.body.scrollHeight, window.innerHeight);
    grime.style.height = h + "px";
    var cols = ["rgba(60,35,5,.55)", "rgba(40,22,2,.6)", "rgba(90,55,10,.45)", "rgba(30,15,0,.5)"];
    var count = Math.round(h / 60);
    for (var i = 0; i < count; i++) {
      var w = rnd(30, 190);
      grime.appendChild(el("div", "smudge",
        "left:" + rnd(-5, 100) + "%;top:" + rnd(0, h) + "px;width:" + w + "px;height:" + (w * rnd(.3, 1)) + "px;" +
        "background:radial-gradient(ellipse," + cols[i % 4] + ",transparent 70%);transform:rotate(" + rnd(0, 180) + "deg)"));
    }
    for (i = 0; i < count / 4; i++) {
      grime.appendChild(el("div", "smudge",
        "left:" + rnd(0, 90) + "%;top:" + rnd(0, h) + "px;width:" + rnd(120, 240) + "px;height:" + rnd(14, 24) + "px;border-radius:40%;" +
        "background:linear-gradient(90deg,transparent,rgba(50,28,3,.7) 20%,rgba(70,40,8,.5) 70%,transparent);" +
        "transform:rotate(" + rnd(-30, 30) + "deg);filter:blur(3px)"));
    }
    var fp = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='50' height='64'><g fill='none' stroke='%233b2208' stroke-width='1.6'>";
    for (var k = 0; k < 8; k++) fp += "<ellipse cx='25' cy='32' rx='" + (4 + k * 3) + "' ry='" + (6 + k * 3.6) + "'/>";
    fp += "</g></svg>";
    for (i = 0; i < count / 6; i++) {
      var im = el("img", "print",
        "left:" + rnd(0, 95) + "%;top:" + rnd(0, h) + "px;transform:rotate(" + rnd(0, 360) + "deg) scale(" + rnd(.7, 1.3) + ")");
      im.src = fp; im.alt = "";
      grime.appendChild(im);
    }
  }
  paint();
  // repaint once things have loaded in (forum, products) so grime covers the full page
  window.addEventListener("load", function () { setTimeout(paint, 1500); });
})();
