export interface PreparationOptions {
    sourceRoot?: string;
    cacheRoot?: string;
    luaRoot?: string;
    resourceCaches?: { miliastra?: string; profileFrames?: string; maps?: string; mapIcons?: string; worldAreas?: string; mapAreaConfigs?: string; mapBase?: string; mapFog?: string; levelTags?: string };
    folders: string[];
    languages?: string[];
    versions?: boolean;
    versionOverrides?: Record<string, string>;
    historyRefs?: string[];
    historySeedCache?: string;
    force?: boolean;
    log?: (message: string) => void;
}
export interface Snapshot {
    readonly snapshotId: string;
    manifest(): { schema: number; snapshotId: string; plan: Record<string, unknown>; files: Record<string, { hash: string; id?: string | number }>; changes: { added: string[]; modified: string[]; removed: string[] } };
    keys(language: string, folder: string): string[];
    catalog(): Array<{ language: string; folder: string; count: number }>;
    getRecord<T = Record<string, unknown>>(language: string, folder: string, key: string | number): T | undefined;
    entries<T = Record<string, unknown>>(language: string, folder: string): IterableIterator<{ key: string; data: T }>;
    getAuxiliary<T = unknown>(kind: 'image' | 'stats' | 'curve' | 'url' | 'version' | 'dependencies', folder: string, key?: string): T | undefined;
    verify(): true;
    getInteractionGiving(id: number): { items: Array<{ id: number; count: number }>; choices?: Array<{ id: number }>; count?: number; remove: boolean } | undefined;
}
export function prepare(options: PreparationOptions): Promise<Snapshot>;
export function openSnapshot(options?: { cacheRoot?: string; snapshotId?: string }): Snapshot;
export function cacheDirectory(directory?: string): string;
