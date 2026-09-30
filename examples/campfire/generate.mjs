// Campfire flame, 8-frame seamless loop, 32x40 cells.
// Emits an agent-sprites operations array on stdout (see sprite-project.json).
// Every motion term is an integer harmonic of the frame phase, so frame 7 flows into frame 0.
const N = 8, W = 32, H = 40, CX = 16, BASE = 37;
const ops = [];
const TAU = Math.PI * 2;
const r = (v) => Math.round(v);
const pts = (list) => list.map(([x, y]) => `${r(x)},${r(y)}`).join(" ");

ops.push({ command: "new", name: "campfire", size: `${W}x${H}`, rows: 1, cols: N, palette: "pico8" });

const C = {
  glow: "#7a1313", red: "#c4271a", orange: "#ff7a1a", yellow: "#ffc72c", core: "#fff4b0",
  bark: "#4a2e18", barkHi: "#6d4527", cut: "#d9a066", cutIn: "#a06a3c", coal: "#ff9a2e", coalHot: "#ffd86b",
  sparkA: "#ffe066", sparkB: "#ff8a1a", sparkC: "#d22a14",
};

function draw(cell, type, name, extra) {
  ops.push({ command: "draw", type, cell, name, ...extra });
}

// A flame tongue: a teardrop from a base width to a swaying tip.
function tongue(cell, name, color, { cx, by, w, h, sway, lean = 0, bulge = 0.6 }) {
  const tipX = cx + sway;
  const tipY = by - h;
  const pts_ = [
    [cx - w / 2, by],
    [cx - w * (0.5 + bulge * 0.35) + sway * 0.25 + lean * 0.2, by - h * 0.32],
    [cx - w * 0.36 + sway * 0.6 + lean * 0.5, by - h * 0.66],
    [tipX + lean, tipY],
    [cx + w * 0.36 + sway * 0.6 + lean * 0.5, by - h * 0.66],
    [cx + w * (0.5 + bulge * 0.35) + sway * 0.25 + lean * 0.2, by - h * 0.32],
    [cx + w / 2, by],
  ];
  draw(cell, "polygon", name, { points: pts(pts_), filled: true, color });
}

for (let i = 0; i < N; i++) {
  const cell = `0,${i}`;
  const t = i / N;
  const s1 = Math.sin(TAU * t);
  const s2 = Math.sin(TAU * 2 * t + 1.0);
  const sway = 1.8 * s1 + 0.7 * s2;
  const hm = 1 + 0.10 * Math.sin(TAU * 2 * t + 0.6) + 0.05 * Math.sin(TAU * t + 2.0);

  ops.push({ command: "clear", cell });

  // back glow + body layers, widest and darkest first
  tongue(cell, "glow", C.glow, { cx: CX, by: BASE, w: 24, h: 22 * hm, sway: sway * 0.5, bulge: 0.5 });
  tongue(cell, "flame_red", C.red, { cx: CX, by: BASE, w: 19, h: 31 * hm, sway: sway, lean: 0.6 * s2 });
  tongue(cell, "flame_orange", C.orange, { cx: CX, by: BASE, w: 14, h: 25 * hm, sway: sway * 0.9 + 0.5 * Math.sin(TAU * t + 0.8), lean: 0.5 * s1 });
  tongue(cell, "flame_yellow", C.yellow, { cx: CX, by: BASE, w: 9, h: 17 * hm, sway: sway * 0.75 + 0.4 * Math.sin(TAU * 2 * t + 2.2), lean: 0.3 * s2 });
  tongue(cell, "flame_core", C.core, { cx: CX, by: BASE - 1, w: 5, h: 9 * hm, sway: sway * 0.5, bulge: 0.4 });

  // licking side tongues: each is visible for part of the cycle
  for (const [k, side, phase, baseX] of [[0, -1, 0.0, CX - 8], [1, 1, 0.5, CX + 8], [2, -1, 0.27, CX - 4], [3, 1, 0.77, CX + 4]]) {
    const p = Math.sin(TAU * (t + phase));
    if (p > 0.1) {
      const size = p;
      tongue(cell, `lick_${k}`, k < 2 ? C.orange : C.yellow, {
        cx: baseX, by: BASE - 7 - 2 * (k >= 2), w: 5 + 2 * size, h: (8 + 9 * size) * hm,
        sway: side * (1.5 + 2.5 * size) + sway * 0.4, bulge: 0.5,
      });
    }
  }

  // two crossed logs sit in front of the flame base
  draw(cell, "polygon", "log_back", { points: pts([[28, 33], [7, 35], [7, 39], [28, 37]]), filled: true, color: C.bark });
  draw(cell, "line", "log_back_hi", { x1: 27, y1: 33, x2: 8, y2: 35, color: C.barkHi });
  draw(cell, "circle", "log_back_end", { cx: 28, cy: 35, r: 2, color: C.cut, filled: true });
  draw(cell, "point", "log_back_core", { x: 28, y: 35, color: C.cutIn });
  draw(cell, "polygon", "log_front", { points: pts([[3, 34], [24, 36], [24, 40], [3, 38]]), filled: true, color: C.bark });
  draw(cell, "line", "log_front_hi", { x1: 4, y1: 34, x2: 23, y2: 36, color: C.barkHi });
  draw(cell, "circle", "log_front_end", { cx: 3, cy: 36, r: 2, color: C.cut, filled: true });
  draw(cell, "point", "log_front_core", { x: 3, y: 36, color: C.cutIn });

  // coals glowing in the gap between the logs, flickering out of step
  for (const [k, x, y] of [[0, 12, 36], [1, 16, 35], [2, 19, 36]]) {
    const hot = Math.sin(TAU * (t + k / 3)) > 0;
    draw(cell, "point", `coal_${k}`, { x, y, color: hot ? C.coalHot : C.coal });
  }

  // rising sparks: a full rise takes one loop, so they wrap cleanly
  for (let j = 0; j < 4; j++) {
    const p = (t + j / 4) % 1;
    if (p > 0.92) continue;
    const dir = j % 2 ? 1 : -1;
    const x = CX + dir * (2 + 6 * p) + 2 * Math.sin(TAU * (2 * p + j * 0.3)) + sway * 0.5 * (1 - p);
    const y = BASE - 12 - 24 * p;
    const color = p < 0.4 ? C.sparkA : p < 0.75 ? C.sparkB : C.sparkC;
    draw(cell, "point", `spark_${j}`, { x, y, color });
  }

  ops.push({ command: "name", cell, as: `burn_${i}` });
}

ops.push({ command: "group", sub: "create", name: "burn", cells: Array.from({ length: N }, (_, i) => `0,${i}`), fps: 10 });
ops.push({ command: "pivot", anchor: "bottom-center" });

process.stdout.write(JSON.stringify(ops));
