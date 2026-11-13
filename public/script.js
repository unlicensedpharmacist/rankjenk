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

  /* ---------- product photos ---------- */
  function paintIcon(p) {
    var img = document.createElement("img");
    img.className = "icon";
    img.src = "img/product" + p.id + ".jpg";
    img.alt = p.name;
    img.width = 400; img.height = 400;
    img.loading = "lazy";
    return img;
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
    setTimeout(showIpPopup, 20000);
    setTimeout(showSocialPopup, 26000);
    randomOverwatch();
  }

  /* overwatch sound also plays at random moments while you browse (every 40s to 2.5 min) */
  function randomOverwatch() {
    setTimeout(function () {
      if (!document.hidden) playSound(sounds.overwatch);
      randomOverwatch();
    }, 40000 + Math.random() * 110000);
  }
  $("splash-enter").addEventListener("click", function () { unlockSounds(); closeSplash(); });

  /* phones only let a page play sound after a tap, so the ENTER tap "unlocks"
     the alarm and overwatch sounds now, and they play later when the popups show */
  var sounds = { alarm: new Audio("alarm.mp3"), overwatch: new Audio("overwatch.mp3") };
  sounds.alarm.loop = true;
  sounds.alarm.preload = sounds.overwatch.preload = "auto";
  function unlockSounds() {
    Object.keys(sounds).forEach(function (k) {
      var a = sounds[k];
      a.muted = true;
      var p = a.play();
      var reset = function () { a.pause(); a.currentTime = 0; a.muted = false; };
      if (p && p.then) p.then(reset, function () { a.muted = false; }); else reset();
    });
  }
  function playSound(a) {
    try {
      a.muted = false; a.currentTime = 0; a.volume = 1;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  $("code-close").addEventListener("click", function () { $("code-popup").hidden = true; });
  $("code-apply").addEventListener("click", function () {
    applyCoupon("Sniffin");
    $("code-msg").textContent = "Code applied to your cart! Go ahead and try checking out. It will not work.";
    setTimeout(function () { $("code-popup").hidden = true; }, 2200);
  });

  function showSocialPopup() {
    $("social-popup").hidden = false;
    playSound(sounds.overwatch);
  }

  function startAlarm() {
    playSound(sounds.alarm);
    if (navigator.vibrate) { try { navigator.vibrate([400, 150, 400, 150, 400]); } catch (e) {} }
  }
  function stopAlarm() {
    try { sounds.alarm.pause(); sounds.alarm.currentTime = 0; } catch (e) {}
  }

  var ipInfo = null, ipTimer = null;
  api("whoami").then(function (d) { ipInfo = d; }).catch(function () { ipInfo = {}; });
  function regionName(code) {
    try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code); } catch (e) { return code; }
  }
  function showIpPopup() {
    var d = ipInfo || {};
    var place = [d.city, d.region, d.country ? regionName(d.country) : ""].filter(Boolean).join(", ");
    var text = "> tracing connection...\n" +
      "IP ADDRESS .... " + (d.ip || "[hidden. suspicious.]") + "\n" +
      "LOCATION ...... " + (place || "[somewhere on Earth]") + "\n" +
      "> status: spotted";
    var out = $("ip-readout"), i = 0;
    $("ip-popup").hidden = false;
    startAlarm();
    var flash = $("red-flash");
    flash.classList.remove("on");
    void flash.offsetWidth;
    flash.classList.add("on");
    clearInterval(ipTimer);
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { out.textContent = text; return; }
    out.textContent = "";
    ipTimer = setInterval(function () {
      out.textContent = text.slice(0, ++i);
      if (i >= text.length) clearInterval(ipTimer);
    }, 35);
  }
  $("ip-close").addEventListener("click", function () { clearInterval(ipTimer); stopAlarm(); $("ip-popup").hidden = true; });

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

  /* ---------- forum ---------- */
  var CATS = ["General", "Product Reviews", "Recipes", "Gaming", "Off Topic"];
  var forumCat = "", forumThread = 0, lastOwner = false;

  function when(sec) { return new Date(sec * 1000).toLocaleString(); }
  function badges(p) {
    return (p.owner ? ' <span class="owner-tag">&#9733; SITE OWNER &#9733;</span>' : '') +
      (p.guest ? ' <span class="tiny">(guest)</span>' : '');
  }
  function delBtn(kind, id) {
    return user && user.owner
      ? ' <button class="vote del" type="button" data-kind="' + kind + '" data-id="' + id + '">delete</button>'
      : '';
  }
  function postHtml(p, kind) {
    return '<div class="fpost' + (p.owner ? ' owner' : '') + '"><div class="fpost-head"><b>' + esc(p.name) + '</b>' +
      badges(p) + ' <span class="tiny">' + esc(when(p.created)) + '</span>' + delBtn(kind, p.id) +
      '</div><div class="fpost-body">' + esc(p.body) + '</div></div>';
  }

  $("forum-cats").innerHTML = '<button type="button" class="chip on" data-cat="">All</button>' +
    CATS.map(function (c) { return '<button type="button" class="chip" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join("");
  $("forum-cat").innerHTML = CATS.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join("");

  function loadThreads() {
    $("forum-status").textContent = "Loading...";
    api("threads" + (forumCat ? "?cat=" + encodeURIComponent(forumCat) : "")).then(function (d) {
      $("forum-threads").innerHTML = d.threads.length
        ? d.threads.map(function (t) {
            return '<tr><td><a href="#" class="thread-link" data-id="' + t.id + '">' + esc(t.title) + '</a></td>' +
              '<td>' + esc(t.category) + '</td>' +
              '<td><b>' + esc(t.name) + '</b>' + badges(t) + '</td>' +
              '<td class="num">' + t.replies + '</td>' +
              '<td class="tiny">' + esc(when(t.last_activity)) + '</td></tr>';
          }).join("")
        : '<tr><td colspan="5" class="tiny">No threads here yet. Start the first one!</td></tr>';
      $("forum-status").textContent = "";
    }).catch(function (err) { $("forum-status").textContent = err.message; });
  }

  function showList() {
    forumThread = 0;
    $("forum-thread-view").hidden = true;
    $("forum-list-view").hidden = false;
    loadThreads();
  }

  function openThread(id) {
    forumThread = id;
    $("forum-list-view").hidden = true;
    $("forum-thread-view").hidden = false;
    $("forum-thread").innerHTML = '<p class="tiny">Loading...</p>';
    api("thread?id=" + id).then(function (d) {
      $("forum-thread").innerHTML =
        '<h3 class="thread-title">' + esc(d.thread.title) + '</h3>' +
        '<p class="tiny">in ' + esc(d.thread.category) + ' | ' + d.replies.length + ' ' + (d.replies.length === 1 ? 'reply' : 'replies') + '</p>' +
        postHtml(d.thread, "thread") +
        d.replies.map(function (r) { return postHtml(r, "reply"); }).join("");
    }).catch(function (err) { $("forum-thread").innerHTML = '<p class="err">' + esc(err.message) + '</p>'; });
  }

  function forumUserChanged() {
    $("forum-name-wrap").hidden = !!user;
    $("forum-rname-wrap").hidden = !!user;
    var owner = !!(user && user.owner);
    if (owner !== lastOwner) {
      lastOwner = owner;
      loadBoard();
      if (forumThread) openThread(forumThread);
    }
  }

  $("forum-cats").addEventListener("click", function (e) {
    var cat = e.target.getAttribute("data-cat");
    if (cat === null) return;
    forumCat = cat;
    [].forEach.call($("forum-cats").children, function (c) { c.classList.toggle("on", c === e.target); });
    loadThreads();
  });
  $("forum-new-btn").addEventListener("click", function () { $("forum-new-form").hidden = !$("forum-new-form").hidden; });
  $("forum-refresh").addEventListener("click", loadThreads);
  $("forum-back").addEventListener("click", showList);
  $("forum-threads").addEventListener("click", function (e) {
    if (!e.target.classList.contains("thread-link")) return;
    e.preventDefault();
    openThread(Number(e.target.getAttribute("data-id")));
    $("forum").scrollIntoView();
  });

  $("forum-new-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("forum-post-btn");
    $("forum-new-err").textContent = "";
    btn.disabled = true;
    api("threads", {
      title: $("forum-title").value, message: $("forum-body").value,
      category: $("forum-cat").value, name: $("forum-name").value
    }).then(function (d) {
      $("forum-title").value = "";
      $("forum-body").value = "";
      $("forum-new-form").hidden = true;
      openThread(d.id);
    }).catch(function (err) { $("forum-new-err").textContent = err.message; })
      .then(function () { btn.disabled = false; });
  });

  $("forum-reply-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("forum-reply-btn");
    $("forum-reply-err").textContent = "";
    btn.disabled = true;
    api("replies", { thread_id: forumThread, message: $("forum-reply").value, name: $("forum-rname").value })
      .then(function () {
        $("forum-reply").value = "";
        openThread(forumThread);
      }).catch(function (err) { $("forum-reply-err").textContent = err.message; })
      .then(function () { btn.disabled = false; });
  });

  document.addEventListener("click", function (e) {
    var b = e.target;
    if (!b.classList || !b.classList.contains("del")) return;
    if (!b.getAttribute("data-sure")) {
      b.setAttribute("data-sure", "1");
      b.textContent = "really?";
      setTimeout(function () { b.removeAttribute("data-sure"); b.textContent = "delete"; }, 3000);
      return;
    }
    var kind = b.getAttribute("data-kind");
    api("delete", { kind: kind, id: Number(b.getAttribute("data-id")) }).then(function () {
      if (kind === "comment") loadBoard();
      else if (kind === "thread") showList();
      else openThread(forumThread);
    }).catch(function (err) { b.textContent = err.message; });
  });

  setInterval(function () { if (!document.hidden && !forumThread) loadThreads(); }, 30000);
  loadThreads();

  /* ---------- accounts ---------- */
  function setUser(u) {
    user = u;
    $("account-guest").hidden = !!u;
    $("account-user").hidden = !u;
    $("whoami").textContent = u ? u.name : "";
    $("whoami-tag").hidden = !(u && u.owner);
    $("board-name-wrap").hidden = !!u;
    $("board-register").hidden = !!u;
    $("board-as").hidden = !u;
    $("board-as").textContent = u ? "Posting as " + u.name : "";
    forumUserChanged();
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
            return '<div class="post' + (p.owner ? ' owner' : '') + '"><b>' + esc(p.name) + '</b>' +
              (p.owner ? ' <span class="owner-tag">&#9733; SITE OWNER &#9733;</span>' : '') +
              (p.guest ? ' <span class="tiny">(guest)</span>' : '') + ' <span class="tiny">' +
              esc(new Date(p.created * 1000).toLocaleString()) + '</span>' + delBtn("comment", p.id) + '<br>' + esc(p.body) + '</div>';
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
      s.textContent = "●";
      s.style.cssText = "position:fixed;pointer-events:none;z-index:2000;font-size:" + (6 + Math.random() * 8) + "px;color:hsl(" + (20 + Math.random() * 15) + "," + (50 + Math.random() * 30) + "%," + (12 + Math.random() * 14) + "%);left:" + e.clientX + "px;top:" + e.clientY + "px;transition:all .7s;";
      document.body.appendChild(s);
      requestAnimationFrame(function () { s.style.opacity = "0"; s.style.transform = "translateY(20px) scale(.2)"; });
      setTimeout(function () { s.remove(); }, 750);
    });
  }
})();
