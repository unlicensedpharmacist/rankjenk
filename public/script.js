(function () {
  var $ = function (id) { return document.getElementById(id); };

  var PRODUCTS = [
    { id: 1, name: "Jenkem Classic", desc: "The original. Allegedly. Nobody can confirm.", price: 9.99, was: 19.99, rank: 1204 },
    { id: 2, name: "Gas Station Edition", desc: "Tastes like a 2AM decision.", price: 4.2, was: 6.9, rank: 980 },
    { id: 3, name: "Jenkem Zero Sugar", desc: "Same rumor, fewer calories.", price: 7.77, was: 12.0, rank: 905 },
    { id: 4, name: "Scented Candle", desc: "Smells like nothing. We checked. Twice.", price: 14.99, was: 29.99, rank: 760 },
    { id: 5, name: "Deluxe Gift Basket", desc: "A basket. It is empty. It is a gift.", price: 49.99, was: 99.99, rank: 655 },
    { id: 6, name: "Rank #1 Trophy", desc: "Trophy for your shelf. Participation not required.", price: 19.99, was: 25.0, rank: 540 },
    { id: 7, name: "Artisanal Small Batch", desc: "Hand-rumored in limited quantities.", price: 24.5, was: 40.0, rank: 410 },
    { id: 8, name: "Free AOL CD-ROM", desc: "1,000 free hours. Disc may be scratched.", price: 0.0, was: 5.0, rank: 330 }
  ];

  var REVIEWS = [
    ["xX_Dave_Xx", 5, "Would rank again. A+++ seller. Fast shipping (nothing shipped)."],
    ["mom", 1, "Please clean your room. Also why is my credit card on this site."],
    ["TotallyReal_Customer", 5, "Best purchase of 2011. I have not purchased anything. Still best."],
    ["Anonymous", 4, "The vibes are immaculate. Loses one star because of the popups."],
    ["guy_from_forums", 3, "I came here from a link in 2009 and I never left."]
  ];

  var cart = {};
  var coupon = false;
  var user = null;

  function money(n) { return "$" + n.toFixed(2); }
  function stars(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }
  function esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  /* ---------- crusty pixel-art item pictures ---------- */
  var PALETTE = [
    0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0,
    0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
    0x804000, 0xc08040, 0xffc080, 0xffe0a0, 0xe0c000, 0x404040, 0xff8000, 0x80c0ff
  ].map(function (c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; });
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var BGS = {
    1: ["#80c0ff", "#ffffff"], 2: ["#ffe0a0", "#ff8000"], 3: ["#c0c0c0", "#ffffff"], 4: ["#400040", "#ff80ff"],
    5: ["#80ff80", "#ffffff"], 6: ["#000080", "#80c0ff"], 7: ["#ffc080", "#ffff80"], 8: ["#00ffff", "#ffffff"]
  };

  function pen(ctx) {
    function path(pts) { ctx.beginPath(); pts.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); }
    return {
      r: function (c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); },
      e: function (c, x, y, rx, ry) { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832); ctx.fill(); },
      p: function (c, pts) { ctx.fillStyle = c; path(pts); ctx.closePath(); ctx.fill(); },
      l: function (c, w, pts) { ctx.strokeStyle = c; ctx.lineWidth = w; path(pts); ctx.stroke(); },
      a: function (c, w, x, y, rad, a0, a1) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, rad, a0, a1); ctx.stroke(); },
      o: function (x, y, w, h) { ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w, h); },
      t: function (c, s, size, x, y) { ctx.fillStyle = c; ctx.font = "bold " + size + "px Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(s, x, y); }
    };
  }

  var ART = {
    1: function (d) {
      d.r("#808080", 18, 12, 28, 8); d.r("#c0c0c0", 20, 13, 4, 6);
      d.r("#c0e0ff", 16, 20, 32, 34); d.r("#804000", 17, 28, 30, 25); d.r("#a06020", 17, 28, 30, 3);
      d.r("#ffffff", 18, 22, 3, 28);
      d.r("#ffffff", 22, 35, 21, 13); d.o(22, 35, 20, 12); d.t("#e00000", "J", 12, 32, 42);
      d.o(16, 20, 31, 33);
    },
    2: function (d) {
      d.l("#202020", 2, [[46, 24], [54, 28], [54, 44], [50, 46]]); d.r("#202020", 48, 44, 5, 6);
      d.r("#404040", 12, 54, 38, 5);
      d.r("#c00000", 16, 8, 30, 46); d.r("#ff4040", 16, 8, 30, 4);
      d.r("#003000", 20, 14, 22, 10); d.t("#00ff00", "8.88", 7, 31, 19);
      d.r("#ffffff", 16, 30, 30, 4); d.t("#ffffff", "GAS", 9, 31, 44);
      d.o(16, 8, 29, 45);
    },
    3: function (d) {
      d.r("#c0c0c0", 21, 12, 22, 42); d.e("#808080", 32, 12, 11, 3); d.e("#c0c0c0", 32, 12, 9, 2);
      d.r("#e00000", 21, 24, 22, 16); d.t("#ffffff", "0", 14, 32, 32);
      d.r("#ffffff", 24, 14, 3, 38); d.e("#808080", 32, 54, 11, 3);
      d.o(21, 12, 21, 41);
    },
    4: function (d) {
      d.r("#808080", 17, 50, 30, 6);
      d.r("#ffe0a0", 22, 28, 20, 24); d.r("#ffffff", 22, 28, 4, 24); d.e("#ffe0a0", 26, 31, 3, 5);
      d.e("#e0c000", 32, 28, 10, 2); d.r("#000000", 31, 20, 2, 8);
      d.p("#ff8000", [[32, 6], [37, 14], [36, 20], [28, 20], [27, 14]]);
      d.p("#ffff00", [[32, 11], [35, 16], [34, 20], [30, 20], [29, 16]]);
      d.o(22, 28, 19, 23);
    },
    5: function (d) {
      var i;
      d.l("#804000", 3, [[16, 34], [20, 12], [44, 12], [48, 34]]);
      d.r("#e02020", 22, 22, 20, 14); d.r("#ffff00", 30, 22, 4, 14); d.r("#ffff00", 22, 27, 20, 3);
      d.e("#ffff00", 28, 20, 4, 3); d.e("#ffff00", 36, 20, 4, 3);
      d.p("#a06020", [[12, 34], [52, 34], [48, 56], [16, 56]]);
      d.r("#804000", 10, 32, 44, 4);
      for (i = 0; i < 6; i++) d.l("#804000", 1, [[18 + i * 6, 36], [19 + i * 6, 56]]);
      for (i = 0; i < 3; i++) d.l("#804000", 1, [[14, 42 + i * 6], [50, 42 + i * 6]]);
    },
    6: function (d) {
      d.l("#e0c000", 3, [[20, 14], [12, 14], [14, 26], [24, 28]]);
      d.l("#e0c000", 3, [[44, 14], [52, 14], [50, 26], [40, 28]]);
      d.p("#e0c000", [[18, 10], [46, 10], [42, 32], [32, 38], [22, 32]]);
      d.p("#ffff80", [[22, 12], [27, 12], [25, 30], [23, 28]]);
      d.r("#e0c000", 29, 38, 6, 10); d.r("#804000", 20, 48, 24, 8); d.r("#e0c000", 24, 50, 16, 3);
      d.t("#804000", "1", 16, 33, 22);
    },
    7: function (d) {
      d.r("#e0c000", 20, 10, 24, 7); d.r("#ffff80", 22, 11, 3, 5);
      d.r("#c0e0ff", 18, 17, 28, 4); d.r("#c0e0ff", 14, 21, 36, 33); d.r("#c08040", 15, 30, 34, 23);
      d.r("#ffffff", 17, 24, 3, 26);
      d.l("#804000", 1, [[18, 19], [46, 21]]); d.l("#804000", 1, [[18, 21], [46, 19]]);
      d.r("#ffe0a0", 21, 35, 23, 13); d.o(21, 35, 22, 12); d.t("#800000", "No.7", 8, 32, 41);
      d.o(14, 21, 35, 32);
    },
    8: function (d) {
      d.e("#c0c0c0", 32, 32, 25, 25);
      d.a("#ff0000", 3, 32, 32, 18, 3.6, 4.4); d.a("#ffff00", 3, 32, 32, 18, 4.4, 5.2);
      d.a("#00c000", 3, 32, 32, 18, 5.2, 6.0); d.a("#0080ff", 3, 32, 32, 18, 0.0, 0.8);
      d.e("#0000a0", 32, 32, 9, 9); d.e("#ffffff", 32, 32, 4, 4);
      d.a("#000000", 1.5, 32, 32, 25, 0, 6.2832);
    }
  };

  function dither(ctx, seed) {
    var img = ctx.getImageData(0, 0, 64, 64), px = img.data;
    var s = seed * 7919 + 13;
    function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
    var x, y, k, prev = null;
    for (y = 0; y < 64; y++) {
      for (x = 0; x < 64; x++) {
        var i = (y * 64 + x) * 4;
        var off = (BAYER[(y & 3) * 4 + (x & 3)] - 7.5) * 5;
        var r = px[i] + off, g = px[i + 1] + off, b = px[i + 2] + off;
        var best = PALETTE[0], bd = 1e9;
        for (k = 0; k < PALETTE.length; k++) {
          var c = PALETTE[k], dist = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]);
          if (dist < bd) { bd = dist; best = c; }
        }
        if (x > 0 && prev && rnd() < 0.06) best = prev;
        px[i] = best[0]; px[i + 1] = best[1]; px[i + 2] = best[2]; px[i + 3] = 255;
        prev = best;
      }
      prev = null;
    }
    ctx.putImageData(img, 0, 0);
  }

  function paintIcon(p) {
    var cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    cv.className = "icon";
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", p.name);
    var ctx = cv.getContext("2d");
    var bg = BGS[p.id];
    var g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(32, 58, 22, 4, 0, 0, 6.2832); ctx.fill();
    ART[p.id](pen(ctx));
    dither(ctx, p.id);
    return cv;
  }

  /* ---------- server calls ---------- */
  function api(path, body) {
    var opts = { credentials: "same-origin", headers: { "content-type": "application/json" } };
    if (body) { opts.method = "POST"; opts.body = JSON.stringify(body); }
    return fetch("/api/" + path, opts)
      .catch(function () { throw new Error("Can't reach the server. Try again."); })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error(d.error || "Server error.");
          return d;
        }, function () { throw new Error("The server is not answering right now."); });
      });
  }

  /* ---------- splash + popups ---------- */
  var pct = 0;
  var splashTimer = setInterval(function () {
    pct += Math.floor(Math.random() * 12) + 2;
    if (pct >= 99) { pct = 99; clearInterval(splashTimer); $("splash-enter").hidden = false; }
    $("splash-pct").textContent = pct;
    $("splash-bar").style.width = pct + "%";
  }, 180);
  function closeSplash() {
    $("splash").style.display = "none";
    if (window.RJMusic) window.RJMusic.autoplay();
    setTimeout(function () { $("code-popup").hidden = false; }, 1500);
    setTimeout(function () { $("popup").hidden = false; }, 14000);
    setTimeout(function () { $("social-popup").hidden = false; }, 26000);
  }
  $("splash-enter").addEventListener("click", closeSplash);
  $("splash-skip").addEventListener("click", function (e) { e.preventDefault(); clearInterval(splashTimer); closeSplash(); });

  $("code-close").addEventListener("click", function () { $("code-popup").hidden = true; });
  $("code-apply").addEventListener("click", function () {
    applyCoupon("Sniffin");
    $("code-msg").textContent = "Code applied to your cart! Go ahead and try checking out. It will not work.";
    setTimeout(function () { $("code-popup").hidden = true; }, 2200);
  });

  $("social-close").addEventListener("click", function () { $("social-popup").hidden = true; });

  var dodges = 0;
  $("popup-close").addEventListener("mouseover", function () {
    if (dodges++ < 4) { this.style.right = (Math.random() * 300) + "px"; this.style.top = (Math.random() * 120) + "px"; }
  });
  $("popup-close").addEventListener("click", function () { $("popup").hidden = true; });
  $("popup-claim").addEventListener("click", function () { $("popup-msg").textContent = "Prize claimed! Check your inbox for nothing."; });

  /* ---------- misc page bits ---------- */
  function tick() { $("clock").textContent = new Date().toLocaleString(); }
  tick(); setInterval(tick, 1000);
  $("fav").addEventListener("click", function (e) { e.preventDefault(); alert("Press Ctrl+D to bookmark this page! (Thanks for visiting)"); });
  $("homepage").addEventListener("click", function (e) { e.preventDefault(); alert("Your browser said no. Rude."); });

  var visits = 13337;
  try { visits = (parseInt(localStorage.getItem("rj_visits"), 10) || 13337) + 1; localStorage.setItem("rj_visits", visits); } catch (e) {}
  $("counter").textContent = String(visits).padStart(6, "0");
  $("counter-text").textContent = "#" + visits.toLocaleString();

  $("poll-btn").addEventListener("click", function () { $("poll-msg").textContent = "Thanks for voting! Results: you. 100%."; });

  /* ---------- products ---------- */
  PRODUCTS.forEach(function (p) {
    var el = document.createElement("div");
    el.className = "product";
    el.innerHTML =
      '<span class="sale">SALE!!!</span>' +
      '<div class="pic"></div>' +
      '<h4>' + esc(p.name) + '</h4>' +
      '<div class="stars">★★★★★</div>' +
      '<div class="desc">' + esc(p.desc) + '</div>' +
      '<div class="price"><s>' + money(p.was) + '</s> ' + money(p.price) + '</div>' +
      '<button class="btn small" data-id="' + p.id + '">ADD TO CART</button>';
    el.querySelector(".pic").appendChild(paintIcon(p));
    $("products").appendChild(el);
  });
  $("products").addEventListener("click", function (e) {
    var id = e.target.getAttribute("data-id");
    if (!id) return;
    cart[id] = (cart[id] || 0) + 1;
    renderCart();
    e.target.textContent = "ADDED!";
    setTimeout(function () { e.target.textContent = "ADD TO CART"; }, 700);
  });

  /* ---------- ranking + reviews ---------- */
  function renderRanking() {
    var sorted = PRODUCTS.slice().sort(function (a, b) { return b.rank - a.rank; }).slice(0, 10);
    $("ranking").innerHTML = sorted.map(function (p) {
      return '<li><span class="n">' + p.rank + ' pts</span>' + esc(p.name) +
        ' <button class="vote" data-v="1" data-id="' + p.id + '">▲</button>' +
        '<button class="vote" data-v="-1" data-id="' + p.id + '">▼</button></li>';
    }).join("");
  }
  $("ranking").addEventListener("click", function (e) {
    var id = e.target.getAttribute("data-id");
    if (!id) return;
    var v = parseInt(e.target.getAttribute("data-v"), 10);
    PRODUCTS.forEach(function (p) { if (String(p.id) === id) p.rank += v * (Math.floor(Math.random() * 120) + 30); });
    renderRanking();
  });
  renderRanking();

  $("review-list").innerHTML = REVIEWS.map(function (r) {
    return '<div class="review"><b>' + esc(r[0]) + '</b> <span class="stars">' + stars(r[1]) + '</span><q>' + esc(r[2]) + '</q></div>';
  }).join("");

  /* ---------- cart + promo code ---------- */
  function applyCoupon(code) {
    if (String(code).trim().toLowerCase() === "sniffin") { coupon = true; renderCart(); return true; }
    return false;
  }
  function renderCart() {
    var count = 0, total = 0, rows = "";
    PRODUCTS.forEach(function (p) {
      var q = cart[p.id];
      if (!q) return;
      count += q; total += q * p.price;
      rows += '<div class="cart-row"><span>' + esc(p.name) + ' x' + q + '</span><span>' + money(q * p.price) + '</span></div>';
    });
    var discount = coupon ? total * 0.1 : 0;
    if (coupon && total > 0) rows += '<div class="cart-row discount"><span>Code SNIFFIN (10% off)</span><span>-' + money(discount) + '</span></div>';
    $("cart-count").textContent = count;
    $("cart-total").textContent = money(total - discount);
    $("cart-items").innerHTML = rows || '<p class="tiny">Your cart is empty. Much like our warehouse.</p>';
  }
  renderCart();
  $("cart-open").addEventListener("click", function (e) { e.preventDefault(); $("checkout-msg").textContent = ""; $("cart-modal").hidden = false; });
  $("cart-close").addEventListener("click", function () { $("cart-modal").hidden = true; });
  $("coupon-btn").addEventListener("click", function () {
    $("coupon-msg").textContent = applyCoupon($("coupon").value)
      ? "Code SNIFFIN applied! 10% off your first order."
      : "That code does not exist. Maybe check the popup.";
  });
  var ERRORS = [
    "ERROR 402: Payment declined. This is a joke website.",
    "Your imaginary money has expired.",
    "Checkout failed: we do not have a checkout.",
    "ERROR: Server is being held together with tape.",
    "Transaction blocked by your own better judgment."
  ];
  $("checkout").addEventListener("click", function () {
    $("checkout-msg").textContent = ERRORS[Math.floor(Math.random() * ERRORS.length)];
  });

  /* ---------- accounts ---------- */
  function setUser(u) {
    user = u;
    $("account-guest").hidden = !!u;
    $("account-user").hidden = !u;
    $("whoami").textContent = u ? u.name : "";
    $("board-name-wrap").hidden = !!u;
    $("board-register").hidden = !!u;
    $("board-as").hidden = !u;
    $("board-as").textContent = u ? "Posting as " + u.name : "";
  }

  $("login").addEventListener("submit", function (e) {
    e.preventDefault();
    $("login-msg").textContent = "Logging in...";
    api("login", { username: $("u").value, password: $("p").value }).then(function (d) {
      $("login-msg").textContent = "";
      $("p").value = "";
      setUser(d.user);
      loadBoard();
    }).catch(function (err) { $("login-msg").textContent = err.message; });
  });

  $("logout-btn").addEventListener("click", function () {
    api("logout", {}).then(function () { setUser(null); }).catch(function (err) { $("login-msg").textContent = err.message; });
  });

  $("register-open").addEventListener("click", function (e) { e.preventDefault(); $("register-msg").textContent = ""; $("register-modal").hidden = false; });
  $("register-close").addEventListener("click", function () { $("register-modal").hidden = true; });
  $("register-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("register-msg");
    if ($("r-pass").value !== $("r-pass2").value) { msg.textContent = "Those passwords do not match."; return; }
    if (!$("r-joke").checked) { msg.textContent = "Please check the box. It is a joke site."; return; }
    msg.textContent = "Creating your account...";
    api("register", { username: $("r-user").value, password: $("r-pass").value }).then(function (d) {
      $("register-form").reset();
      msg.textContent = "";
      $("register-modal").hidden = true;
      setUser(d.user);
      loadBoard();
    }).catch(function (err) { msg.textContent = err.message; });
  });

  /* ---------- message board ---------- */
  function loadBoard() {
    $("board-status").textContent = "Loading...";
    api("comments").then(function (d) {
      $("member-count").textContent = d.members;
      $("board-list").innerHTML = d.posts.length
        ? d.posts.map(function (p) {
            return '<div class="post"><b>' + esc(p.name) + '</b>' + (p.guest ? ' <span class="tiny">(guest)</span>' : '') + ' <span class="tiny">' +
              esc(new Date(p.created * 1000).toLocaleString()) + '</span><br>' + esc(p.body) + '</div>';
          }).join("")
        : '<p class="tiny">No posts yet. Be the first!</p>';
      $("board-status").textContent = "Updated " + new Date().toLocaleTimeString();
    }).catch(function (err) { $("board-status").textContent = err.message; });
  }
  $("board-refresh").addEventListener("click", loadBoard);
  $("board-register").addEventListener("click", function (e) { e.preventDefault(); $("register-open").click(); });
  $("board-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("board-msg"), btn = $("board-btn");
    $("board-err").textContent = "";
    btn.disabled = true;
    api("comments", { message: input.value, name: $("board-name").value }).then(function () {
      input.value = "";
      loadBoard();
    }).catch(function (err) { $("board-err").textContent = err.message; })
      .then(function () { btn.disabled = false; });
  });
  setInterval(function () { if (!document.hidden) loadBoard(); }, 30000);

  setUser(null);
  api("me").then(function (d) { setUser(d.user); }).catch(function () {});
  loadBoard();

  /* ---------- sparkle cursor trail ---------- */
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) {
    document.addEventListener("mousemove", function (e) {
      var s = document.createElement("span");
      s.textContent = "✦";
      s.style.cssText = "position:fixed;pointer-events:none;z-index:2000;font-size:14px;color:hsl(" + (Math.random() * 360) + ",100%,60%);left:" + e.clientX + "px;top:" + e.clientY + "px;transition:all .7s;";
      document.body.appendChild(s);
      requestAnimationFrame(function () { s.style.opacity = "0"; s.style.transform = "translateY(20px) scale(.2)"; });
      setTimeout(function () { s.remove(); }, 750);
    });
  }
})();
