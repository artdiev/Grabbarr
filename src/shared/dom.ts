// Minimal element-builder so the UI stays framework-free but readable.

type Child = Node | string | null | undefined | false;

interface Attrs {
    class?: string;
    text?: string;
    html?: never; // intentionally unsupported — never set innerHTML from data
    [key: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Attrs = {},
    ...children: Child[]
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = String(v);
        else if (k === 'text') node.textContent = String(v);
        else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
        } else if (k === 'dataset' && typeof v === 'object') {
            Object.assign(node.dataset, v);
        } else {
            node.setAttribute(k, String(v));
        }
    }
    for (const c of children) {
        if (c == null || c === false) continue;
        node.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
}

export function clear(node: HTMLElement): void {
    node.replaceChildren();
}
