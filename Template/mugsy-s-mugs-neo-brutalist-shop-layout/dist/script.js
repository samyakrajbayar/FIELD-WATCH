/* ════════════════════════════════════════
   STATE
═══════════════════════════════════════ */
let cart = [];
const FREE_SHIP = 50;

const $ = (id) => document.getElementById(id);
const cartBadge = $("cart-badge");
const cartDrawer = $("cart-drawer");
const cartOverlay = $("cart-overlay");
const cartBody = $("cart-body");
const cartEmpty = $("cart-empty");
const cartFooter = $("cart-footer");
const subtotalEl = $("cart-subtotal");
const itemsCount = $("cart-items-count");
const shipNote = $("ship-note");
const shipFill = $("ship-fill");
const toast = $("toast");
const toastText = $("toast-text");

/* ════════════════════════════════════════
   DRAWER
═══════════════════════════════════════ */
const openCart = () => {
	cartDrawer.classList.add("open");
	cartOverlay.classList.add("open");
};
const closeCart = () => {
	cartDrawer.classList.remove("open");
	cartOverlay.classList.remove("open");
};

$("cart-toggle").addEventListener("click", openCart);
$("cart-close").addEventListener("click", closeCart);
cartOverlay.addEventListener("click", closeCart);
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") closeCart();
});

/* ════════════════════════════════════════
   ADD TO CART
═══════════════════════════════════════ */
document.querySelectorAll(".item").forEach((item) => {
	const btn = item.querySelector(".add-btn");

	btn.addEventListener("click", () => {
		/* validate */
		let valid = true;
		item.querySelectorAll("[required]").forEach((f) => {
			const wrap = f.closest(".field");
			if (!f.value.trim()) {
				valid = false;
				wrap.classList.add("invalid");
				setTimeout(() => wrap.classList.remove("invalid"), 600);
			}
		});
		if (!valid) {
			showToast("PICK YOUR OPTIONS! ☝️");
			return;
		}

		/* gather */
		const name = item.dataset.name;
		const price = +item.dataset.price;
		const img = item.querySelector("img").src;
		const opts = [];
		let qty = 1;
		item.querySelectorAll("select, input").forEach((f) => {
			if (f.name === "quantity") qty = +f.value || 1;
			else if (f.value.trim()) opts.push(f.value.trim());
		});

		cart.push({ name, price, img, opts, qty, id: Date.now() + Math.random() });
		renderCart();
		flyToCart(item);
		burstConfetti(btn, item);

		/* button feedback */
		const orig = btn.textContent;
		btn.classList.add("added");
		btn.textContent = "ADDED ✓";
		setTimeout(() => {
			btn.classList.remove("added");
			btn.textContent = orig;
		}, 1300);

		cartBadge.classList.add("bump");
		setTimeout(() => cartBadge.classList.remove("bump"), 320);

		showToast(`${name.toUpperCase()} ADDED!`);
	});
});

/* ════════════════════════════════════════
   RENDER CART
═══════════════════════════════════════ */
function renderCart() {
	const totalQty = cart.reduce((s, i) => s + i.qty, 0);
	cartBadge.textContent = totalQty;
	itemsCount.textContent = `(${totalQty})`;

	cartBody.querySelectorAll(".cart-line").forEach((l) => l.remove());

	if (!cart.length) {
		cartEmpty.style.display = "";
		cartFooter.hidden = true;
		return;
	}
	cartEmpty.style.display = "none";
	cartFooter.hidden = false;

	cart.forEach((line) => {
		const el = document.createElement("div");
		el.className = "cart-line";
		const opt = line.opts.length
			? line.opts.join(" · ").replace(/-/g, " ")
			: "standard";
		el.innerHTML = `
      <img src="${line.img}" alt="${line.name}">
      <div class="cl-info">
        <div class="cl-name">${line.name}</div>
        <div class="cl-opts">${opt} · qty ${line.qty}</div>
        <div class="cl-bottom">
          <span class="cl-price">$${line.price * line.qty}</span>
          <button class="cl-remove" data-id="${line.id}">remove</button>
        </div>
      </div>`;
		cartBody.appendChild(el);
	});

	const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
	subtotalEl.textContent = `$${subtotal}`;

	const pct = Math.min(100, (subtotal / FREE_SHIP) * 100);
	shipFill.style.width = pct + "%";
	if (subtotal >= FREE_SHIP) {
		shipNote.innerHTML = "🎉 FREE SHIPPING UNLOCKED!";
		shipNote.classList.add("free");
	} else {
		shipNote.innerHTML = `Add <b>$${FREE_SHIP - subtotal}</b> for FREE shipping`;
		shipNote.classList.remove("free");
	}

	cartBody.querySelectorAll(".cl-remove").forEach((b) => {
		b.addEventListener("click", () => {
			cart = cart.filter((i) => i.id != b.dataset.id);
			renderCart();
		});
	});
}

/* ════════════════════════════════════════
   FLY TO CART
═══════════════════════════════════════ */
function flyToCart(item) {
	const img = item.querySelector("img");
	const target = $("cart-toggle");
	const r = img.getBoundingClientRect();
	const t = target.getBoundingClientRect();

	const clone = img.cloneNode();
	clone.className = "fly-img";
	clone.style.cssText += `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
	document.body.appendChild(clone);
	void clone.offsetWidth;

	clone.style.left = t.left + t.width / 2 - 22 + "px";
	clone.style.top = t.top + t.height / 2 - 22 + "px";
	clone.style.width = "44px";
	clone.style.height = "44px";
	clone.classList.add("go");
	setTimeout(() => clone.remove(), 720);
}

/* ════════════════════════════════════════
   CONFETTI
═══════════════════════════════════════ */
function burstConfetti(btn, item) {
	const r = btn.getBoundingClientRect();
	const cx = r.left + r.width / 2;
	const cy = r.top + r.height / 2;
	const styles = getComputedStyle(document.documentElement);
	const colors = [
		"--pink",
		"--teal",
		"--yellow",
		"--lime",
		"--violet",
		"--orange"
	].map((v) => styles.getPropertyValue(v).trim());

	for (let i = 0; i < 14; i++) {
		const c = document.createElement("div");
		c.className = "confetti";
		const size = 8 + Math.random() * 8;
		c.style.width = size + "px";
		c.style.height = size + "px";
		c.style.background = colors[i % colors.length];
		c.style.left = cx + "px";
		c.style.top = cy + "px";
		if (Math.random() > 0.5) c.style.borderRadius = "50%";
		document.body.appendChild(c);

		const ang = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
		const dist = 70 + Math.random() * 70;
		c.animate(
			[
				{ transform: "translate(0,0) rotate(0)", opacity: 1 },
				{
					transform: `translate(${Math.cos(ang) * dist}px, ${
						Math.sin(ang) * dist - 30
					}px) rotate(${Math.random() * 540}deg)`,
					opacity: 0
				}
			],
			{ duration: 700 + Math.random() * 300, easing: "cubic-bezier(.16,1,.3,1)" }
		);

		setTimeout(() => c.remove(), 1100);
	}
}

/* ════════════════════════════════════════
   TOAST
═══════════════════════════════════════ */
let toastTimer;
function showToast(msg) {
	toastText.textContent = msg;
	toast.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

/* ════════════════════════════════════════
   THE BOLD · uppercase letter
═══════════════════════════════════════ */
const letterInput = $("letter");
if (letterInput) {
	letterInput.addEventListener("input", () => {
		letterInput.value = letterInput.value.toUpperCase();
	});
}