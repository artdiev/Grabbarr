// SVG icon builders shared by the content button and the popup (no innerHTML).
// Size is set as width/height attributes (default 18) so consumers without CSS
// get a sized icon; the content button's `svg{width:…}` CSS still overrides it.

export function svg(path: string, size = 18): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', String(size));
    el.setAttribute('height', String(size));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    p.setAttribute('stroke-width', '2.2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    el.append(p);
    return el;
}

export const checkSvg = (size?: number) => svg('M20 6 9 17l-5-5', size);
export const trashSvg = (size?: number) => svg('M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14', size);

/** A 3/4-ring spinner; rotated by the `.gb-spin` CSS animation in the button shadow. */
export function spinnerSvg(size = 18): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', String(size));
    el.setAttribute('height', String(size));
    el.setAttribute('fill', 'none');
    el.setAttribute('class', 'gb-spin');
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '12');
    c.setAttribute('r', '9');
    c.setAttribute('stroke', 'currentColor');
    c.setAttribute('stroke-width', '3');
    c.setAttribute('stroke-linecap', 'round');
    c.setAttribute('stroke-dasharray', '40 18');
    el.append(c);
    return el;
}
