// Small time-series line chart on a <canvas>: hairline grid, 2px lines, end-dot with a
// surface ring, direct end-labels, and a hover crosshair + tooltip.

const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' };
const FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';

function niceStep(range, target) {
  const raw = range / target;
  const e = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= raw) return m * e;
  return 10 * e;
}

/** Format v to a precision that suits the axis step (so 1.8e-9 on a 0.25 axis reads "0"). */
function fmt(v, step) {
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step / 10))));
  const s = v.toFixed(decimals);
  return Number(s) === 0 ? '0' : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export class LineChart {
  /** series: [{ key, label, color }] ; unit: shown in tooltip and axis title */
  constructor(container, { title, unit, series }) {
    this.unit = unit;
    this.series = series;
    this.data = [];
    container.classList.add('chart');
    container.innerHTML = `
      <div class="chart-head">
        <div class="chart-title">${title} <span class="chart-unit">${unit}</span></div>
        ${series.length > 1 ? `<div class="chart-legend">${series
          .map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`)
          .join('')}</div>` : ''}
      </div>
      <div class="chart-body"><canvas></canvas><div class="chart-tip" hidden></div></div>`;
    this.body = container.querySelector('.chart-body');
    this.canvas = container.querySelector('canvas');
    this.tip = container.querySelector('.chart-tip');
    this.ctx = this.canvas.getContext('2d');
    this.hoverX = null;
    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.hoverX = e.clientX - rect.left;
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.tip.hidden = true;
      this.draw();
    });
    new ResizeObserver(() => this.draw()).observe(this.body);
  }

  setData(data) {
    this.data = data;
    this.draw();
  }

  draw() {
    const { canvas, ctx, data, series } = this;
    const W = this.body.clientWidth;
    const H = this.body.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = FONT;

    const pad = { l: 38, r: 64, t: 8, b: 20 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const tMax = Math.max(10, data.length ? data[data.length - 1].t : 0);
    let lo = 0;
    let hi = 0;
    for (const d of data) for (const s of series) {
      lo = Math.min(lo, d[s.key]);
      hi = Math.max(hi, d[s.key]);
    }
    if (hi - lo < 1e-9) hi = lo + 1;
    const yStep = niceStep(hi - lo, 3);
    lo = Math.floor(lo / yStep + 1e-9) * yStep;
    hi = Math.ceil(hi / yStep - 1e-9) * yStep;
    const X = (t) => pad.l + (t / tMax) * pw;
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * ph;

    // grid + y ticks
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    for (let v = lo; v <= hi + yStep * 0.01; v += yStep) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? INK.axis : INK.grid;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + pw, y);
      ctx.stroke();
      ctx.fillStyle = INK.muted;
      ctx.fillText(fmt(v, yStep), pad.l - 6, y);
    }
    // x ticks (seconds)
    const xStep = niceStep(tMax, 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= tMax + 1e-9; t += xStep) {
      ctx.fillStyle = INK.muted;
      ctx.fillText(`${fmt(t, xStep)}s`, X(t), pad.t + ph + 5);
    }

    if (!data.length) return;
    // lines
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const stride = Math.max(1, Math.floor(data.length / (pw * 1.5)));
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < data.length; i += stride) {
        const d = data[i];
        if (i === 0) ctx.moveTo(X(d.t), Y(d[s.key]));
        else ctx.lineTo(X(d.t), Y(d[s.key]));
      }
      const end = data[data.length - 1];
      ctx.lineTo(X(end.t), Y(end[s.key]));
      ctx.stroke();
    }
    // end dots (surface ring) + direct end labels; a label that would collide with the
    // one above is dropped (legend + tooltip still carry it) rather than nudged off its line
    const end = data[data.length - 1];
    const ends = series.map((s) => ({ s, y: Y(end[s.key]), v: end[s.key] })).sort((a, b) => a.y - b.y);
    let lastLabelY = -Infinity;
    for (const e of ends) {
      e.showLabel = e.y - lastLabelY >= 13;
      if (e.showLabel) lastLabelY = e.y;
    }
    for (const e of ends) {
      const x = X(end.t);
      ctx.fillStyle = INK.surface;
      ctx.beginPath();
      ctx.arc(x, e.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = e.s.color;
      ctx.beginPath();
      ctx.arc(x, e.y, 4, 0, Math.PI * 2);
      ctx.fill();
      if (!e.showLabel) continue;
      ctx.fillStyle = INK.secondary;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmt(e.v, yStep), x + 9, e.y);
    }

    // hover crosshair + tooltip
    if (this.hoverX !== null && this.hoverX >= pad.l && this.hoverX <= pad.l + pw) {
      const t = ((this.hoverX - pad.l) / pw) * tMax;
      let k = 0;
      let lo2 = 0;
      let hi2 = data.length - 1;
      while (lo2 <= hi2) {
        const m = (lo2 + hi2) >> 1;
        if (data[m].t < t) lo2 = m + 1;
        else hi2 = m - 1;
      }
      k = Math.min(data.length - 1, lo2);
      if (k > 0 && Math.abs(data[k - 1].t - t) < Math.abs(data[k].t - t)) k -= 1;
      const d = data[k];
      const x = Math.round(X(d.t)) + 0.5;
      ctx.strokeStyle = INK.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + ph);
      ctx.stroke();
      for (const s of series) {
        ctx.fillStyle = INK.surface;
        ctx.beginPath();
        ctx.arc(x, Y(d[s.key]), 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(x, Y(d[s.key]), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      this.tip.hidden = false;
      this.tip.innerHTML =
        `<div class="tip-t">t = ${d.t.toFixed(1)} s</div>` +
        series.map((s) => `<div><i style="background:${s.color}"></i>${s.label}<b>${fmt(d[s.key], yStep / 10)} ${this.unit}</b></div>`).join('');
      const tw = this.tip.offsetWidth;
      this.tip.style.left = `${Math.min(W - tw - 4, Math.max(4, x + 10))}px`;
      this.tip.style.top = '4px';
    }
  }
}
