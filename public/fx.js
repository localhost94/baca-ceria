// Lapisan PixiJS: konfeti overlay + game "Tangkap Huruf".
const Fx = (() => {
  const EMOJI = ["⭐", "🎉", "✨", "🎈", "💖"];
  const COLORS = [0xff7eb6, 0x5cc8ff, 0x5fd68a, 0xffd23f, 0x9b7bff];
  let overlay = null;
  let current = null; // app game aktif, dihancurkan saat pindah layar

  function initOverlay() {
    overlay ||= (async () => {
      const app = new PIXI.Application();
      await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
      Object.assign(app.canvas.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "50" });
      document.body.append(app.canvas);
      const parts = [];
      app.ticker.add((t) => {
        const dt = t.deltaTime;
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          p.vy += 0.25 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rotation += p.vr * dt;
          if (p.y > app.screen.height + 60) { app.stage.removeChild(p); p.destroy(); parts.splice(i, 1); }
        }
      });
      return { app, parts };
    })();
    return overlay;
  }

  async function confetti() {
    const { app, parts } = await initOverlay();
    const W = app.screen.width, H = app.screen.height;
    for (let i = 0; i < 50; i++) {
      const p = new PIXI.Text({ text: EMOJI[i % EMOJI.length], style: { fontSize: 28 + Math.random() * 22 } });
      p.anchor.set(0.5);
      p.x = W / 2; p.y = H * 0.7;
      p.vx = (Math.random() - 0.5) * 16; p.vy = -(8 + Math.random() * 10); p.vr = (Math.random() - 0.5) * 0.3;
      app.stage.addChild(p); parts.push(p);
    }
  }

  function cleanup() {
    if (!current) return;
    try { current.destroy(true, { children: true }); } catch {}
    current = null;
  }

  // Gelembung huruf jatuh; ketuk gelembung huruf target.
  async function bubbles(host, target, { alphabet, display, onWrong, onCatch, say }) {
    cleanup();
    const app = new PIXI.Application();
    const W = Math.max(280, host.clientWidth), H = host.clientHeight || 380;
    await app.init({ width: W, height: H, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    if (!host.isConnected) { app.destroy(true, { children: true }); return; } // layar sudah pindah
    current = app;
    host.append(app.canvas);

    const R = 46, ALPHABET = [...alphabet];
    const list = [];
    const randLetter = () => { let l; do l = ALPHABET[Math.random() * ALPHABET.length | 0]; while (l === target); return l; };
    const place = (b, isTarget) => {
      b.isTarget = isTarget;
      b.letter = isTarget ? target : randLetter();
      b.label.text = display(b.letter);
      b.base.tint = COLORS[b.letter.codePointAt(0) % COLORS.length];
      b.x = R + Math.random() * (W - 2 * R); b.y = -R - Math.random() * 200;
      b.vy = 0.8 + Math.random() * 0.9; b.phase = Math.random() * 6; b.shake = 0; b.pop = 0; b.alpha = 1; b.scale.set(1);
    };
    for (let i = 0; i < 7; i++) {
      const b = new PIXI.Container();
      b.base = new PIXI.Graphics().circle(0, 0, R).fill({ color: 0xffffff, alpha: 0.9 }).stroke({ width: 5, color: 0xffffff });
      b.label = new PIXI.Text({ text: "", style: { fontSize: 56, fontWeight: "800", fill: 0x3b2f63, fontFamily: "Comic Sans MS, Trebuchet MS, Noto Naskh Arabic, Traditional Arabic, Tahoma, sans-serif" } });
      b.label.anchor.set(0.5);
      b.addChild(b.base, b.label);
      b.eventMode = "static"; b.cursor = "pointer";
      b.on("pointertap", () => {
        if (b.pop || done) return;
        say?.(b.letter);
        if (b.isTarget) { b.pop = 1; done = true; onCatch(); }
        else { b.shake = 1; onWrong(); }
      });
      place(b, i < 2);
      b.y = (H / 7) * i - R; // sebaran awal
      app.stage.addChild(b); list.push(b);
    }
    let done = false;
    app.ticker.add((t) => {
      const dt = t.deltaTime;
      for (const b of list) {
        if (b.pop) {
          b.pop += 0.08 * dt; b.scale.set(1 + b.pop); b.alpha = Math.max(0, 1.6 - b.pop);
          continue;
        }
        b.y += b.vy * dt; b.phase += 0.03 * dt;
        b.x += Math.sin(b.phase) * 0.6 * dt;
        if (b.shake > 0) { b.x += Math.sin(b.shake * 40) * 6; b.shake -= 0.04 * dt; }
        if (b.y > H + R) place(b, list.filter((o) => o.isTarget && o !== b && !o.pop).length === 0);
      }
    });
  }

  return { confetti, bubbles, cleanup, active: () => current };
})();
window.Fx = Fx;
