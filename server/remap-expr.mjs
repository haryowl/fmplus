/**
 * Tiny allow-listed remap expression. No JS eval.
 * value, numbers, io.239 / tag.x / add.x, + - * /, comparisons, && ||, ?: , ! , bit(x, n).
 */

const MAX_LEN = 240;

export function flattenRawAttrs(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nest = k === "io" ? "io." : k === "tags" ? "tag." : k === "add" ? "add." : "";
      if (nest) {
        for (const [ik, iv] of Object.entries(v)) out[nest + ik] = iv;
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

export function evalRemapExpr(source, vars) {
  const src = String(source || "").trim();
  if (!src) throw new Error("empty expr");
  if (src.length > MAX_LEN) throw new Error("expr too long");
  const p = new Parser(src, vars && typeof vars === "object" ? vars : {});
  const v = p.parseTernary();
  p.skip();
  if (p.i < p.s.length) throw new Error(`unexpected '${p.s.slice(p.i, p.i + 12)}'`);
  return v;
}

class Parser {
  constructor(s, vars) {
    this.s = s;
    this.i = 0;
    this.vars = vars;
  }

  skip() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i += 1;
  }

  peek(n = 1) {
    return this.s.slice(this.i, this.i + n);
  }

  eat(tok) {
    this.skip();
    if (this.s.slice(this.i, this.i + tok.length) !== tok) return false;
    const next = this.s[this.i + tok.length];
    if (/[A-Za-z0-9_]/.test(tok[tok.length - 1] || "") && next && /[A-Za-z0-9_]/.test(next)) {
      return false;
    }
    this.i += tok.length;
    return true;
  }

  parseTernary() {
    const cond = this.parseOr();
    this.skip();
    if (!this.eat("?")) return cond;
    const a = this.parseTernary();
    this.skip();
    if (!this.eat(":")) throw new Error("expected : in ternary");
    const b = this.parseTernary();
    return truthy(cond) ? a : b;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.eat("||")) left = truthy(left) || truthy(this.parseAnd());
    return left;
  }

  parseAnd() {
    let left = this.parseCmp();
    while (this.eat("&&")) left = truthy(left) && truthy(this.parseCmp());
    return left;
  }

  parseCmp() {
    let left = this.parseAdd();
    this.skip();
    const op = ["==", "!=", "<=", ">=", "<", ">"].find((t) => this.peek(t.length) === t);
    if (!op) return left;
    this.i += op.length;
    const right = this.parseAdd();
    const ln = asNum(left);
    const rn = asNum(right);
    const useNum = Number.isFinite(ln) && Number.isFinite(rn) && !isBool(left) && !isBool(right);
    const a = useNum ? ln : left;
    const b = useNum ? rn : right;
    switch (op) {
      case "==":
        return a === b || String(a) === String(b);
      case "!=":
        return a !== b && String(a) !== String(b);
      case "<":
        return a < b;
      case ">":
        return a > b;
      case "<=":
        return a <= b;
      case ">=":
        return a >= b;
      default:
        return false;
    }
  }

  parseAdd() {
    let left = this.parseMul();
    for (;;) {
      if (this.eat("+")) left = asNum(left) + asNum(this.parseMul());
      else if (this.eat("-")) left = asNum(left) - asNum(this.parseMul());
      else break;
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    for (;;) {
      if (this.eat("*")) left = asNum(left) * asNum(this.parseUnary());
      else if (this.eat("/")) {
        const d = asNum(this.parseUnary());
        left = d === 0 ? 0 : asNum(left) / d;
      } else break;
    }
    return left;
  }

  parseUnary() {
    if (this.eat("!")) return !truthy(this.parseUnary());
    if (this.eat("-")) return -asNum(this.parseUnary());
    return this.parsePrimary();
  }

  parsePrimary() {
    this.skip();
    if (this.eat("(")) {
      const v = this.parseTernary();
      this.skip();
      if (!this.eat(")")) throw new Error("expected )");
      return v;
    }
    if (this.eat("bit")) {
      this.skip();
      if (!this.eat("(")) throw new Error("bit(");
      const x = this.parseTernary();
      this.skip();
      if (!this.eat(",")) throw new Error("bit(x, n)");
      const n = this.parseTernary();
      this.skip();
      if (!this.eat(")")) throw new Error("expected )");
      const bit = Math.trunc(asNum(n));
      if (bit < 0 || bit > 52) return false;
      return (BigInt(Math.trunc(asNum(x))) & (1n << BigInt(bit))) !== 0n;
    }
    if (this.eat("true")) return true;
    if (this.eat("false")) return false;
    const ch = this.s[this.i];
    if (ch && /[0-9.]/.test(ch)) {
      const m = this.s.slice(this.i).match(/^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/);
      if (!m) throw new Error("bad number");
      this.i += m[0].length;
      return Number(m[0]);
    }
    if (ch && /[A-Za-z_]/.test(ch)) {
      const m = this.s.slice(this.i).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
      if (!m) throw new Error("bad name");
      this.i += m[0].length;
      const name = m[0];
      if (!Object.prototype.hasOwnProperty.call(this.vars, name)) {
        throw new Error(`unknown '${name}'`);
      }
      return this.vars[name];
    }
    throw new Error(`unexpected '${this.s.slice(this.i, this.i + 8)}'`);
  }
}

function isBool(v) {
  return typeof v === "boolean";
}

function asNum(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truthy(v) {
  if (typeof v === "boolean") return v;
  if (v == null || v === "") return false;
  const n = Number(v);
  if (Number.isFinite(n)) return n !== 0;
  return Boolean(v);
}
