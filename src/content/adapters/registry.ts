import { imdbAdapter } from './imdb';
import { kinopoiskAdapter } from './kinopoisk';
import { rtAdapter } from './rottentomatoes';
import { tmdbAdapter } from './tmdb';
import { SiteAdapter } from './types';

// Ordered list; first match by URL wins.
export const adapters: SiteAdapter[] = [imdbAdapter, tmdbAdapter, rtAdapter, kinopoiskAdapter];

export function adapterForUrl(url: string): SiteAdapter | undefined {
    return adapters.find((a) => a.matches(url));
}
