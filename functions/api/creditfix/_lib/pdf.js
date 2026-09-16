// functions/api/creditfix/_lib/pdf.js
// Hand-rolled, ZERO-dependency PDF 1.4 writer for the CreditFix Kit.
// Built-in Type1 fonts only (Helvetica, Helvetica-Bold, Courier) — no
// embedding, no external libs. Works in Workers and in Node.
//
// API: renderKitPdf(kit) -> Uint8Array  (kit = buildKit() output)
//      countPages(pdfBytes) -> number    (tiny parser for tests)

"use strict";

// ── AFM widths (units per 1000) for ASCII 32..126 ───────────────────────────
const W_HELV = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,
];
const W_HELV_B = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,469,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,
];
const COURIER_W = 600;

function widthOf(text, size, table) {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    w += c >= 32 && c <= 126 ? table[c - 32] : table[32]; // fallback: space
  }
  return (w / 1000) * size;
}
const wReg = (t, s) => widthOf(t, s, W_HELV);
const wBold = (t, s) => widthOf(t, s, W_HELV_B);
const wMono = (t, s) => (t.length * COURIER_W / 1000) * s;

function escPdf(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");
}

// ── page geometry ───────────────────────────────────────────────────────────
const PAGE_W = 612, PAGE_H = 792;      // US Letter
const ML = 56, MR = 556;               // margins -> 500pt text width
const TOP_Y = 706, BOTTOM_Y = 64;      // content zone (header/footer outside)
const TEXT_W = MR - ML;

// ── flow items ──────────────────────────────────────────────────────────────
// {k:'h1'|'h2'|'h3'|'para'|'bullet'|'pre'|'rule'|'spacer'|'cover', ...}
// para/bullet body = runs: [{t, b:bold?, m:mono?}]

function R(t, b) { return { t: String(t), b: !!b }; }

function kitToFlow(kit) {
  const flow = [{ k: "cover", kit }];
  const S = kit.sections;

  // 1. explainer
  flow.push({ k: "h1", t: S[0].heading });
  const intro = S[0].body[0];
  flow.push({ k: "para", runs: [R(intro)] });
  const nFactors = kit.explainer.factors.length;
  kit.explainer.factors.forEach((f, i) => {
    flow.push({ k: "h3", t: "Factor " + (i + 1) + " of " + nFactors + ": " + f.name + " (" + f.weight + ")" });
    flow.push({ k: "para", runs: [R(f.what_it_means)] });
    flow.push({ k: "para", runs: [R("Your angle: ", true), R(f.your_angle)] });
  });
  flow.push({ k: "para", runs: [R(kit.explainer.goal_note)] });

  // 2. letters
  flow.push({ k: "h1", t: S[1].heading });
  S[1].body.forEach((p) => flow.push({ k: "para", runs: [R(p)] }));
  kit.letters.forEach((L) => {
    flow.push({ k: "h2", t: L.title });
    flow.push({ k: "para", runs: [R(L.blurb)] });
    if (L.keep_on_file) flow.push({ k: "para", runs: [R("KEEP ON FILE -- ", true), R(L.keep_on_file)] });
    flow.push({ k: "pre", t: L.body_text });
  });

  // 3. plan
  flow.push({ k: "h1", t: S[2].heading });
  S[2].body.forEach((p) => flow.push({ k: "para", runs: [R(p)] }));
  kit.plan.forEach((m) => {
    flow.push({ k: "h2", t: "Month " + m.month });
    m.tasks.forEach((t) => flow.push({ k: "bullet", runs: [R(t)] }));
  });

  // 4. mailing checklist
  flow.push({ k: "h1", t: S[3].heading });
  S[3].body.forEach((p) => flow.push({ k: "bullet", runs: [R(p)] }));

  // 5. honest limits
  flow.push({ k: "h1", t: S[4].heading });
  S[4].body.forEach((p) => flow.push({ k: "para", runs: [R(p)] }));

  return flow;
}

// ── word wrap over runs ─────────────────────────────────────────────────────
function wrapRuns(runs, maxW, size) {
  // flatten to words, keeping font flags
  const words = [];
  runs.forEach((run) => {
    String(run.t).split(/(\s+)/).forEach((tok) => {
      if (!tok) return;
      words.push({ t: tok, b: run.b, space: /^\s+$/.test(tok) });
    });
  });
  const wOf = (wd) => (wd.b ? wBold(wd.t, size) : wReg(wd.t, size));
  const spW = wReg(" ", size);
  const lines = [];
  let cur = [], curW = 0;
  const push = () => { if (cur.length) { lines.push(cur); cur = []; curW = 0; } };
  words.forEach((wd) => {
    if (/^\n$/.test(wd.t)) { push(); return; }
    const w = wd.space ? spW * wd.t.length : wOf(wd);
    if (wd.space && cur.length === 0) return; // skip leading space
    if (curW + w > maxW && cur.length) push();
    if (!wd.space || cur.length) { cur.push(wd); curW += w; }
  });
  push();
  return lines;
}

function wrapPre(text, maxW, size) {
  const cw = (COURIER_W / 1000) * size;
  const per = Math.max(20, Math.floor(maxW / cw));
  const out = [];
  String(text).split("\n").forEach((ln) => {
    if (!ln.length) { out.push(""); return; }
    for (let i = 0; i < ln.length; i += per) out.push(ln.slice(i, i + per));
  });
  return out;
}

// ── layout + content-stream emission ────────────────────────────────────────
const STYLES = {
  h1:    { size: 16, bold: true,  leading: 20,   before: 18, after: 8 },
  h2:    { size: 13, bold: true,  leading: 17,   before: 14, after: 6 },
  h3:    { size: 12, bold: true,  leading: 15,   before: 10, after: 4 },
  para:  { size: 11, bold: false, leading: 14.5, before: 0,  after: 6 },
  bullet:{ size: 11, bold: false, leading: 14.5, before: 0,  after: 4, indent: 14 },
  pre:   { size: 9.5, mono: true, leading: 12,   before: 6,  after: 10 },
};

function renderKitPdf(kit) {
  const flow = kitToFlow(kit);
  const buyerName = (kit.buyer && kit.buyer.name) || "";
  const pages = [];           // each: array of content ops (strings)
  let ops = [];
  let y = TOP_Y;
  let pageNo = 0;

  const FOOT = "General information only -- not legal or financial advice.";

  function newPage(isCover) {
    if (ops.length || pageNo > 0) pages.push(ops);
    ops = [];
    pageNo++;
    y = isCover ? TOP_Y + 40 : TOP_Y;
    if (!isCover) {
      // header
      const title = "CreditFix Kit -- DIY Credit Repair";
      ops.push("BT /F2 9 Tf 56 748 Td (" + escPdf(title) + ") Tj ET");
      const bn = escPdf(buyerName.slice(0, 40));
      const bx = MR - wBold(buyerName.slice(0, 40), 9);
      ops.push("BT /F2 9 Tf " + bx.toFixed(1) + " 748 Td (" + bn + ") Tj ET");
      ops.push("0.6 w 0.75 0.75 0.75 RG 56 740 m 556 740 l S 0 0 0 RG");
    }
    // footer (every page incl. cover — disclaimer must be visible)
    ops.push("BT /F1 8 Tf 56 40 Td (Page " + pageNo + ") Tj ET");
    const fw = wReg(FOOT, 8);
    ops.push("BT /F1 8 Tf " + (MR - fw).toFixed(1) + " 40 Td (" + escPdf(FOOT) + ") Tj ET");
  }

  function need(h) {
    if (y - h < BOTTOM_Y) newPage(false);
  }

  function emitLine(x, yy, segs, size, leading) {
    // segs: [{t, font:'F1'|'F2'|'F3'}]
    let s = "BT /" + segs[0].font + " " + size + " Tf " + leading + " TL " +
            x.toFixed(1) + " " + yy.toFixed(1) + " Td";
    let curFont = segs[0].font;
    segs.forEach((sg) => {
      if (sg.font !== curFont) { s += " /" + sg.font + " " + size + " Tf"; curFont = sg.font; }
      s += " (" + escPdf(sg.t) + ") Tj";
    });
    ops.push(s + " ET");
  }

  function lineSegs(lineWords) {
    // group consecutive words by font
    const segs = [];
    lineWords.forEach((wd) => {
      const font = wd.b ? "F2" : "F1";
      const last = segs[segs.length - 1];
      if (last && last.font === font) last.t += wd.t;
      else segs.push({ t: wd.t, font });
    });
    return segs;
  }

  function drawCover(k) {
    // big centered title block
    const title = "CreditFix Kit";
    const sub = "DIY Credit Repair -- Letters, Plan, Knowledge";
    let yy = 640;
    const tw = wBold(title, 30);
    ops.push("BT /F2 30 Tf " + ((PAGE_W - tw) / 2).toFixed(1) + " " + yy + " Td (" + escPdf(title) + ") Tj ET");
    yy -= 34;
    const sw = wReg(sub, 13);
    ops.push("BT /F1 13 Tf " + ((PAGE_W - sw) / 2).toFixed(1) + " " + yy + " Td (" + escPdf(sub) + ") Tj ET");
    yy -= 26;
    ops.push("0.6 w 0.72 0.55 0.13 RG 206 " + yy + " m 406 " + yy + " l S 0 0 0 RG"); // gold rule
    yy -= 44;
    const rows = [
      ["Prepared for:", buyerName],
      ["Situation:", k.situation_label || ""],
      ["Goal:", k.goal_label || ""],
      ["Generated:", String(k.generated_at || "").slice(0, 10)],
    ];
    rows.forEach(([lab, val]) => {
      const lw = wBold(lab, 11), vw = wReg(val, 11);
      const x0 = (PAGE_W - (lw + 8 + vw)) / 2;
      ops.push("BT /F2 11 Tf " + x0.toFixed(1) + " " + yy + " Td (" + escPdf(lab) + ") Tj /F1 11 Tf (" +
               escPdf("  " + val) + ") Tj ET");
      yy -= 20;
    });
    yy -= 30;
    // what's inside box
    const boxTop = yy + 14, boxH = 150;
    ops.push("0.6 w 0.85 0.87 0.92 RG " + ML + " " + (boxTop - boxH) + " " + TEXT_W + " " + boxH + " re S 0 0 0 RG");
    const inside = [
      ["F2", "Inside this kit:"],
      ["F1", "- The 5 FICO score factors, translated to your situation"],
      ["F1", "- 3 mail-ready dispute / validation / goodwill letter templates"],
      ["F1", "- Your personalized 12-month rebuild plan"],
      ["F1", "- Certified-mail checklist and honest limits"],
    ];
    let iy = boxTop - 26;
    inside.forEach(([f, t]) => {
      ops.push("BT /" + f + " 11 Tf 13.5 TL 76 " + iy + " Td (" + escPdf(t) + ") Tj ET");
      iy -= 22;
    });
    yy = boxTop - boxH - 30;
    // disclaimer paragraph (wrapped, centered-ish)
    const dlines = wrapRuns([{ t: kit.disclaimer }], TEXT_W - 40, 10);
    dlines.forEach((ln) => {
      const segs = lineSegs(ln);
      const lw = segs.reduce((a, s) => a + (s.font === "F2" ? wBold(s.t, 10) : wReg(s.t, 10)), 0);
      emitLine((PAGE_W - lw) / 2, yy, segs, 10, 13);
      yy -= 13;
    });
    y = yy;
  }

  newPage(true);
  let first = true;
  flow.forEach((item) => {
    if (item.k === "cover") { drawCover(kit); first = false; newPage(false); return; }
    const st = STYLES[item.k];
    if (!st) return;
    if (item.k === "rule") { need(14); ops.push("0.6 w 0.8 0.8 0.8 RG 56 " + (y - 4) + " m 556 " + (y - 4) + " l S 0 0 0 RG"); y -= 14; return; }

    const size = st.size, leading = st.leading;
    const x0 = ML + (st.indent || 0);
    const maxW = TEXT_W - (st.indent || 0);

    if (item.k === "pre") {
      need(st.before + leading * 2);
      y -= st.before;
      wrapPre(item.t, maxW, size).forEach((ln) => {
        need(leading);
        ops.push("BT /F3 " + size + " Tf " + leading + " TL " + x0.toFixed(1) + " " + y.toFixed(1) +
                 " Td (" + escPdf(ln || " ") + ") Tj ET");
        y -= leading;
      });
      y -= st.after;
      return;
    }

    // h1/h2/h3/para/bullet
    let runs = item.runs;
    if (item.k === "bullet") runs = [R("-  ", true)].concat(runs);
    if (["h1", "h2", "h3"].includes(item.k)) runs = [{ t: item.t, b: true }];
    const lines = wrapRuns(runs, maxW, size);
    need(st.before + leading * Math.min(lines.length, 2)); // keep heading w/ 2 lines
    y -= st.before;
    lines.forEach((ln) => {
      need(leading);
      emitLine(x0, y, lineSegs(ln), size, leading);
      y -= leading;
    });
    y -= st.after;
  });
  pages.push(ops);

  // ── assemble PDF objects ────────────────────────────────────────────────
  const objs = [];
  const kids = [];
  const firstPageObj = 6;
  pages.forEach((pOps, i) => {
    const content = pOps.join("\n") + "\n";
    const pageObj = firstPageObj + i * 2;
    const contObj = pageObj + 1;
    kids.push(pageObj + " 0 R");
    objs[pageObj] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> " +
      "/Contents " + contObj + " 0 R >>";
    const bytes = Buffer.from(content, "latin1");
    objs[contObj] = { raw: "<< /Length " + bytes.length + " >>\nstream\n", bin: bytes, tail: "\nendstream" };
  });

  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pages.length + " >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";

  const n = firstPageObj + pages.length * 2 - 1;
  const chunks = [];   // Buffer parts
  const offsets = {};
  let pos = 0;
  const push = (buf) => { chunks.push(buf); pos += buf.length; };
  push(Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1"));
  for (let id = 1; id <= n; id++) {
    const o = objs[id];
    if (o === undefined) throw new Error("missing object " + id);
    offsets[id] = pos;
    push(Buffer.from(id + " 0 obj\n", "latin1"));
    if (typeof o === "string") {
      push(Buffer.from(o + "\nendobj\n", "latin1"));
    } else {
      push(Buffer.from(o.raw, "latin1"));
      push(o.bin);
      push(Buffer.from(o.tail + "\nendobj\n", "latin1"));
    }
  }
  const xrefPos = pos;
  let xref = "xref\n0 " + (n + 1) + "\n0000000000 65535 f \n";
  for (let id = 1; id <= n; id++) {
    xref += String(offsets[id]).padStart(10, "0") + " 00000 n \n";
  }
  push(Buffer.from(xref + "trailer\n<< /Size " + (n + 1) + " /Root 1 0 R >>\nstartxref\n" +
                   xrefPos + "\n%%EOF\n", "latin1"));
  return Buffer.concat(chunks);
}

// Tiny parser for tests: verifies xref offsets point at "<id> 0 obj".
function countPages(pdfBytes) {
  const buf = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  const text = buf.toString("latin1");
  const m = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(text);
  if (!m) return { ok: false, error: "no_startxref" };
  const xrefPos = Number(m[1]);
  const xrefSec = text.slice(xrefPos);
  const lines = xrefSec.split("\n");
  if (!/^xref/.test(lines[0])) return { ok: false, error: "no_xref" };
  const count = Number(lines[1].split(" ")[1]);
  let pages = 0, checked = 0;
  for (let i = 0; i < count; i++) {
    const ln = lines[2 + i] || "";
    const mm = /^(\d{10}) 00000 n/.exec(ln);
    if (!mm) continue;
    const off = Number(mm[1]);
    const head = text.slice(off, off + 24);
    const hm = new RegExp("^" + i + " 0 obj").exec(head);
    if (!hm) return { ok: false, error: "xref_mismatch_obj_" + i, checked };
    checked++;
  }
  const cm = /\/Count\s+(\d+)/.exec(text);
  pages = cm ? Number(cm[1]) : 0;
  if (!/^%PDF-1\.[0-9]/.test(text)) return { ok: false, error: "bad_header" };
  if (!/%%EOF\s*$/.test(text)) return { ok: false, error: "bad_eof" };
  return { ok: true, pages, objects: count - 1, xref_checked: checked };
}

const api = { renderKitPdf, countPages, wReg, wBold };
if (typeof module !== "undefined" && module.exports) module.exports = api;
export { renderKitPdf, countPages, wReg, wBold };
export default api;
