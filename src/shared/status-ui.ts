import { ItemStatus } from './types';

// Status presentation shared by the popup (and reusable elsewhere).
export const STATUS_META: Record<ItemStatus, { label: string; classes: string }> = {
    added: { label: 'Added', classes: 'bg-sky-500/15 text-sky-300' },
    queued: { label: 'Queued', classes: 'bg-amber-500/15 text-amber-300' },
    downloading: { label: 'Downloading', classes: 'bg-amber-500/15 text-amber-300' },
    partial: { label: 'Partial', classes: 'bg-violet-500/15 text-violet-300' },
    downloaded: { label: 'Downloaded', classes: 'bg-emerald-500/15 text-emerald-300' },
    missing: { label: 'Missing', classes: 'bg-zinc-500/15 text-zinc-300' },
    error: { label: 'Error', classes: 'bg-red-500/15 text-red-300' },
};
