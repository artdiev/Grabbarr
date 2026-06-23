// SVG icon builders shared by the content button and the popup (no innerHTML).
// Size is set as width/height attributes (default 18) so consumers without CSS
// get a sized icon; the content button's `svg{width:…}` CSS still overrides it.

const NS = 'http://www.w3.org/2000/svg';

function svgRoot(size: number): SVGSVGElement {
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', String(size));
    el.setAttribute('height', String(size));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    return el;
}

function pathEl(d: string): SVGPathElement {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    return p;
}

export function svg(path: string, size = 18): SVGSVGElement {
    const el = svgRoot(size);
    el.append(pathEl(path));
    return el;
}

export const checkSvg = (size?: number) => svg('M20 6 9 17l-5-5', size);
export const trashSvg = (size?: number) => svg('M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14', size);

/** Refresh / rotate-cw icon (Lucide). Centered crisply for the popup header. */
export const refreshSvg = (size = 18): SVGSVGElement =>
    svg(
        'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5',
        size,
    );

/** Settings gear icon (Lucide). */
export function gearSvg(size = 18): SVGSVGElement {
    const el = svgRoot(size);
    el.append(
        pathEl(
            'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
        ),
    );
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '12');
    c.setAttribute('r', '3');
    c.setAttribute('stroke-width', '2');
    el.append(c);
    return el;
}

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
