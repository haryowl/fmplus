package store

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"
)

const maxExprLen = 240

type exprParser struct {
	s    string
	i    int
	vars map[string]any
}

func evalRemapExpr(source string, vars map[string]any) (any, error) {
	src := strings.TrimSpace(source)
	if src == "" {
		return nil, fmt.Errorf("empty expr")
	}
	if len(src) > maxExprLen {
		return nil, fmt.Errorf("expr too long")
	}
	if vars == nil {
		vars = map[string]any{}
	}
	p := &exprParser{s: src, vars: vars}
	v, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	p.skip()
	if p.i < len(p.s) {
		end := p.i + 12
		if end > len(p.s) {
			end = len(p.s)
		}
		return nil, fmt.Errorf("unexpected '%s'", p.s[p.i:end])
	}
	return v, nil
}

func (p *exprParser) skip() {
	for p.i < len(p.s) && unicode.IsSpace(rune(p.s[p.i])) {
		p.i++
	}
}

func (p *exprParser) peek(n int) string {
	if p.i+n > len(p.s) {
		return p.s[p.i:]
	}
	return p.s[p.i : p.i+n]
}

func (p *exprParser) eat(tok string) bool {
	p.skip()
	if !strings.HasPrefix(p.s[p.i:], tok) {
		return false
	}
	if len(tok) > 0 {
		last := tok[len(tok)-1]
		if isIdentChar(rune(last)) && p.i+len(tok) < len(p.s) && isIdentChar(rune(p.s[p.i+len(tok)])) {
			return false
		}
	}
	p.i += len(tok)
	return true
}

func isIdentChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
}

func (p *exprParser) parseTernary() (any, error) {
	cond, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if !p.eat("?") {
		return cond, nil
	}
	a, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	if !p.eat(":") {
		return nil, fmt.Errorf("expected : in ternary")
	}
	b, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	if truthy(cond) {
		return a, nil
	}
	return b, nil
}

func (p *exprParser) parseOr() (any, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.eat("||") {
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = truthy(left) || truthy(right)
	}
	return left, nil
}

func (p *exprParser) parseAnd() (any, error) {
	left, err := p.parseCmp()
	if err != nil {
		return nil, err
	}
	for p.eat("&&") {
		right, err := p.parseCmp()
		if err != nil {
			return nil, err
		}
		left = truthy(left) && truthy(right)
	}
	return left, nil
}

func (p *exprParser) parseCmp() (any, error) {
	left, err := p.parseAdd()
	if err != nil {
		return nil, err
	}
	p.skip()
	ops := []string{"==", "!=", "<=", ">=", "<", ">"}
	var op string
	for _, cand := range ops {
		if p.peek(len(cand)) == cand {
			op = cand
			break
		}
	}
	if op == "" {
		return left, nil
	}
	p.i += len(op)
	right, err := p.parseAdd()
	if err != nil {
		return nil, err
	}
	ln, lok := asFinite(left)
	rn, rok := asFinite(right)
	useNum := lok && rok && !isBool(left) && !isBool(right)
	var a, b any = left, right
	if useNum {
		a, b = ln, rn
	}
	switch op {
	case "==":
		return eqAny(a, b), nil
	case "!=":
		return !eqAny(a, b), nil
	case "<":
		return lessAny(a, b), nil
	case ">":
		return lessAny(b, a), nil
	case "<=":
		return lessAny(a, b) || eqAny(a, b), nil
	case ">=":
		return lessAny(b, a) || eqAny(a, b), nil
	default:
		return false, nil
	}
}

func (p *exprParser) parseAdd() (any, error) {
	left, err := p.parseMul()
	if err != nil {
		return nil, err
	}
	for {
		if p.eat("+") {
			right, err := p.parseMul()
			if err != nil {
				return nil, err
			}
			left = asFloat(left) + asFloat(right)
			continue
		}
		if p.eat("-") {
			right, err := p.parseMul()
			if err != nil {
				return nil, err
			}
			left = asFloat(left) - asFloat(right)
			continue
		}
		return left, nil
	}
}

func (p *exprParser) parseMul() (any, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		if p.eat("*") {
			right, err := p.parseUnary()
			if err != nil {
				return nil, err
			}
			left = asFloat(left) * asFloat(right)
			continue
		}
		if p.eat("/") {
			right, err := p.parseUnary()
			if err != nil {
				return nil, err
			}
			d := asFloat(right)
			if d == 0 {
				left = 0.0
			} else {
				left = asFloat(left) / d
			}
			continue
		}
		return left, nil
	}
}

func (p *exprParser) parseUnary() (any, error) {
	if p.eat("!") {
		v, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return !truthy(v), nil
	}
	if p.eat("-") {
		v, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return -asFloat(v), nil
	}
	return p.parsePrimary()
}

func (p *exprParser) parsePrimary() (any, error) {
	p.skip()
	if p.eat("(") {
		v, err := p.parseTernary()
		if err != nil {
			return nil, err
		}
		if !p.eat(")") {
			return nil, fmt.Errorf("expected )")
		}
		return v, nil
	}
	if p.eat("bit") {
		if !p.eat("(") {
			return nil, fmt.Errorf("bit(")
		}
		x, err := p.parseTernary()
		if err != nil {
			return nil, err
		}
		if !p.eat(",") {
			return nil, fmt.Errorf("bit(x, n)")
		}
		n, err := p.parseTernary()
		if err != nil {
			return nil, err
		}
		if !p.eat(")") {
			return nil, fmt.Errorf("expected )")
		}
		bit := int64(asFloat(n))
		if bit < 0 || bit > 52 {
			return false, nil
		}
		return (int64(asFloat(x)) & (1 << bit)) != 0, nil
	}
	if p.eat("true") {
		return true, nil
	}
	if p.eat("false") {
		return false, nil
	}
	if p.i < len(p.s) && (unicode.IsDigit(rune(p.s[p.i])) || p.s[p.i] == '.') {
		rest := p.s[p.i:]
		n := 0
		for n < len(rest) && (unicode.IsDigit(rune(rest[n])) || rest[n] == '.' || rest[n] == 'e' || rest[n] == 'E' || rest[n] == '+' || rest[n] == '-') {
			if (rest[n] == '+' || rest[n] == '-') && n > 0 && rest[n-1] != 'e' && rest[n-1] != 'E' {
				break
			}
			n++
		}
		f, err := strconv.ParseFloat(rest[:n], 64)
		if err != nil {
			return nil, fmt.Errorf("bad number")
		}
		p.i += n
		return f, nil
	}
	if p.i < len(p.s) && (unicode.IsLetter(rune(p.s[p.i])) || p.s[p.i] == '_') {
		start := p.i
		p.i++
		for p.i < len(p.s) {
			r := rune(p.s[p.i])
			if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '.' {
				p.i++
				continue
			}
			break
		}
		name := p.s[start:p.i]
		v, ok := p.vars[name]
		if !ok {
			return nil, fmt.Errorf("unknown '%s'", name)
		}
		return v, nil
	}
	end := p.i + 8
	if end > len(p.s) {
		end = len(p.s)
	}
	return nil, fmt.Errorf("unexpected '%s'", p.s[p.i:end])
}

func isBool(v any) bool {
	_, ok := v.(bool)
	return ok
}

func asFinite(v any) (float64, bool) {
	if _, ok := v.(bool); ok {
		return 0, false
	}
	f := asFloat(v)
	return f, true
}

func eqAny(a, b any) bool {
	if a == b {
		return true
	}
	return fmt.Sprint(a) == fmt.Sprint(b)
}

func lessAny(a, b any) bool {
	switch av := a.(type) {
	case float64:
		if bv, ok := b.(float64); ok {
			return av < bv
		}
	}
	return fmt.Sprint(a) < fmt.Sprint(b)
}

func truthy(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case nil:
		return false
	case string:
		if t == "" {
			return false
		}
		f, err := strconv.ParseFloat(t, 64)
		if err == nil {
			return f != 0
		}
		return true
	default:
		return asFloat(v) != 0
	}
}
