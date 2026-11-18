'use strict';
/**
 * Tiny, safe expression layer for design templates.
 *   "{{opt.name|upper}}"            -> scope lookup + filters
 *   "{{canvas.w}}/2 - 40"           -> substitute then evaluate arithmetic
 *   when: "{{opt.member}} >= 3"     -> comparison
 * After substitution only digits/operators may remain, so nothing is ever eval()'d.
 */

const FILTERS = {
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  title: (v) => String(v).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  trim: (v) => String(v).trim(),
  round: (v) => Math.round(Number(v) || 0),
  abs: (v) => Math.abs(Number(v) || 0),
  possessive: (v) => { const s = String(v).trim(); return /s$/i.test(s) ? `${s}'` : `${s}'s`; },
};

function lookup(scope, pathStr) {
  let cur = scope;
  for (const part of pathStr.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Replace every {{...}} in a string. Returns the raw value when the whole string is one token. */
function substitute(str, scope) {
  const whole = /^\{\{([^}]+)\}\}$/.exec(str);
  const resolveToken = (body) => {
    const [pathPart, ...filterParts] = body.split('|').map((s) => s.trim());
    let val = lookup(scope, pathPart);
    for (const f of filterParts) {
      const [fname, arg] = f.split(':').map((s) => s.trim());
      if (fname === 'default') { if (val === undefined || val === null || val === '') val = arg; continue; }
      if (FILTERS[fname]) val = FILTERS[fname](val);
    }
    return val;
  };
  if (whole) return resolveToken(whole[1]);
  return str.replace(/\{\{([^}]+)\}\}/g, (_, body) => {
    const v = resolveToken(body);
    return v === undefined || v === null ? '' : String(v);
  });
}

const ARITH_OK = /^[\s\d.+\-*/()%]+$/;

/** Evaluate a substituted arithmetic string with a shunting-yard pass (no eval). */
function arith(s) {
  const tokens = String(s).match(/\d+\.?\d*|[+\-*/%()]/g);
  if (!tokens) return NaN;
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };
  const out = [], ops = [];
  let prevWasValue = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d/.test(t)) { out.push(parseFloat(t)); prevWasValue = true; continue; }
    if (t === '(') { ops.push(t); prevWasValue = false; continue; }
    if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
      ops.pop(); prevWasValue = true; continue;
    }
    if ((t === '-' || t === '+') && !prevWasValue) { out.push(0); }       // unary
    while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop());
    ops.push(t); prevWasValue = false;
  }
  while (ops.length) out.push(ops.pop());
  const st = [];
  for (const t of out) {
    if (typeof t === 'number') { st.push(t); continue; }
    const b = st.pop(), a = st.pop();
    st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '%' ? a % b : b === 0 ? 0 : a / b);
  }
  return st.pop();
}

/** Resolve any template value: string, number, array or plain object (deep). */
function resolve(value, scope) {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => resolve(v, scope));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = resolve(value[k], scope);
    return out;
  }
  const subbed = substitute(value, scope);
  if (typeof subbed !== 'string') return subbed;
  // numeric-looking result -> number; arithmetic expression -> evaluate
  if (/^-?\d+\.?\d*$/.test(subbed.trim())) return parseFloat(subbed);
  if (subbed.includes('{{')) return subbed;
  if (/[+\-*/%]/.test(subbed) && ARITH_OK.test(subbed) && /\d/.test(subbed)) {
    const n = arith(subbed);
    if (Number.isFinite(n)) return n;
  }
  return subbed;
}

const num = (value, scope, fallback = 0) => {
  const v = resolve(value, scope);
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Evaluate a `when` condition: "{{opt.member}} > 2", "{{opt.pet}} == yes", or truthiness. */
function when(cond, scope) {
  if (cond === undefined || cond === null || cond === '') return true;
  if (typeof cond === 'boolean') return cond;
  const m = /^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/.exec(String(cond));
  if (!m) {
    const v = resolve(cond, scope);
    return !(v === false || v === 0 || v === '' || v == null || v === 'false' || v === 'no');
  }
  const L = resolve(m[1].trim(), scope), R = resolve(m[3].trim(), scope);
  const bothNum = Number.isFinite(Number(L)) && Number.isFinite(Number(R)) && L !== '' && R !== '';
  const a = bothNum ? Number(L) : String(L), b = bothNum ? Number(R) : String(R);
  switch (m[2]) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return true;
  }
}

module.exports = { resolve, substitute, num, when, arith, lookup };
