// Tiny DOM helpers — no framework. Always use `text` (never `html`) for any
// value derived from data, to avoid injection.

export interface ElOptions {
  class?: string;
  text?: string;
  html?: string; // only for trusted static markup (icons)
  id?: string;
  type?: string;
  value?: string;
  href?: string;
  title?: string;
  attrs?: Record<string, string>;
  dataset?: Record<string, string>;
  on?: Record<string, (ev: Event) => void>;
}

export function el(
  tag: string,
  opts: ElOptions = {},
  children: (Node | string)[] = [],
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.id) node.id = opts.id;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.type) node.setAttribute("type", opts.type);
  if (opts.value != null) (node as HTMLInputElement).value = opts.value;
  if (opts.href) node.setAttribute("href", opts.href);
  if (opts.title) node.title = opts.title;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = v;
  if (opts.on) for (const [k, fn] of Object.entries(opts.on)) node.addEventListener(k, fn);
  for (const c of children) node.append(c);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const found = root.querySelector(sel);
  if (!found) throw new Error(`Element not found: ${sel}`);
  return found as T;
}

/**
 * A single `<option>` element.
 * @param value the option value.
 * @param label the visible text.
 * @param selected whether it is the selected option.
 * @returns the option element.
 */
export function optionEl(value: string, label: string, selected: boolean): HTMLElement {
  const o = el("option", { value, text: label }) as HTMLOptionElement;
  o.selected = selected;
  return o;
}

/**
 * Whether the primary pointer is coarse (touch), used to tune touch-only UX.
 * @returns true on coarse-pointer (touch) devices.
 */
export function isTouch(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}
