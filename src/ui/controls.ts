// Tiny control builders that bind form inputs directly to template fields.

type Obj = Record<string, any>;
export type OnChange = () => void;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Obj = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

export function section(parent: HTMLElement, title: string, open = false, toggle?: { obj: Obj; key: string; onChange: OnChange }): HTMLElement {
  const details = el('details', { className: 'section', open });
  const summary = el('summary', {}, el('span', {}, title));
  if (toggle) {
    const cb = el('input', { type: 'checkbox', checked: !!toggle.obj[toggle.key], title: 'Show layer' });
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      toggle.obj[toggle.key] = cb.checked;
      toggle.onChange();
    });
    summary.append(cb);
  }
  const body = el('div', { className: 'body' });
  details.append(summary, body);
  parent.append(details);
  return body;
}

function row(parent: HTMLElement, label: string, ...inputs: HTMLElement[]) {
  const r = el('label', { className: 'row' }, el('span', { className: 'label' }, label), ...inputs);
  parent.append(r);
  return r;
}

export function range(parent: HTMLElement, label: string, obj: Obj, key: string, min: number, max: number, step: number, onChange: OnChange) {
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(obj[key]) });
  const out = el('output', {}, fmt(obj[key], step));
  input.addEventListener('input', () => {
    obj[key] = Number(input.value);
    out.textContent = fmt(obj[key], step);
    onChange();
  });
  row(parent, label, input, out);
}

function fmt(v: number, step: number) {
  return step >= 1 ? String(Math.round(v)) : v.toFixed(step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);
}

export function color(parent: HTMLElement, label: string, obj: Obj, key: string, onChange: OnChange) {
  const input = el('input', { type: 'color', value: toHex(obj[key]) });
  input.addEventListener('input', () => {
    obj[key] = input.value;
    onChange();
  });
  row(parent, label, input);
}

/** <input type=color> only takes #rrggbb; rgba() values are approximated. */
function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = c.match(/\d+(\.\d+)?/g);
  if (!m) return '#ffffff';
  return '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
}

export function select(parent: HTMLElement, label: string, obj: Obj, key: string, options: [string, string][], onChange: OnChange) {
  const input = el('select', {}, ...options.map(([value, text]) => el('option', { value, selected: String(obj[key]) === value }, text)));
  input.addEventListener('change', () => {
    obj[key] = typeof obj[key] === 'number' ? Number(input.value) : input.value;
    onChange();
  });
  row(parent, label, input);
}

export function check(parent: HTMLElement, label: string, obj: Obj, key: string, onChange: OnChange) {
  const input = el('input', { type: 'checkbox', checked: !!obj[key] });
  input.addEventListener('change', () => {
    obj[key] = input.checked;
    onChange();
  });
  row(parent, label, input).classList.add('check');
}

export function text(parent: HTMLElement, label: string, obj: Obj, key: string, onChange: OnChange) {
  const input = el('input', { type: 'text', value: obj[key] });
  input.addEventListener('input', () => {
    obj[key] = input.value;
    onChange();
  });
  row(parent, label, input);
}

export function fileButton(label: string, accept: string, onFile: (f: File) => void): HTMLElement {
  const input = el('input', { type: 'file', accept, hidden: true });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
    input.value = '';
  });
  const btn = el('button', { className: 'btn', type: 'button' }, label);
  btn.addEventListener('click', () => input.click());
  return el('span', {}, btn, input);
}

export function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', { className, type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function download(blob: Blob, name: string) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
