/** Explicit resource plans only; no client discovery or extraction on import. */
export type ResourceCacheName = 'miliastra' | 'profileFrames' | 'worldAreas' | 'mapAreaConfigs' | 'maps' | 'mapIcons' | 'mapBase' | 'mapFog' | 'mapEffects' | 'mapLimitOutlines' | 'levelTags';
export type ResourceCache = Record<string, unknown>;
export interface FileResult { file: string; [key: string]: unknown }
export interface ToolOptions { studio: string; output: string; timeoutMs?: number; dotnet?: string; game?: string }
export interface AssetEntry { Source: string; Offset: number; PathID: string; Type: string; Name?: string; Container?: string }
export interface WorldAreasOptions extends ToolOptions { sourceRoot: string; map?: string; assetMap?: string; game?: string }
export interface MapAreaConfigsOptions extends ToolOptions { map?: string; assetMap?: string }
export interface MapIconsOptions extends ToolOptions { sourceRoot: string; map: string; game?: string }
export interface MapsOptions extends ToolOptions { sources: string[]; roots: AssetEntry[]; game?: string; maxObjects?: number; maxRounds?: number; dotnet?: string }
export interface MapAtlasOptions extends ToolOptions {
    data?: string; mapAreaConfigs?: string; sources?: string[]; prefabPaths?: string[];
    rootEntries?: AssetEntry[]; extractAllImages?: boolean; referenceIndexReport?: string; blockRoots?: string[];
    /** Native AnimeStudio .map file, NOT an exported readAssetMap JSON. */
    assetMap?: string;
    catalogue?: ResourceCache; extractImages?: boolean; game?: string; maxObjects?: number; maxSources?: number;
}
export interface MapEntriesOptions extends ToolOptions { data?: string; sceneTableFile?: string; map: string; maxSources?: number; maxObjects?: number }
export interface MapBaseOptions extends ToolOptions { data?: string; sceneTableFile?: string; entryCacheFile?: string; map: string; maxTiles?: number }
export interface MapFogOptions extends ToolOptions { baseCacheFile: string; sceneIds: number[]; map: string }
export interface MapEffectsOptions { prefabCacheFile: string; entryCacheFile: string; outlineCacheFile: string; artIndexReportFile: string; sceneIds: number[]; output: string }
export namespace mapEffects {
    function prepare(options: MapEffectsOptions): FileResult;
    function readResourceCache(file: string): ResourceCache;
}
export type MapLimitOutlineOptions = { sourceRoot: string; output: string } & (
    { indexReportFile: string; artIndexReportFile: string; rawReportFile: string; mapFile: string }
    | (ToolOptions & { indexReportFile?: string; artIndexReportFile?: string; rawReportFile?: string }
        & ({ map: string } | { mapFile: string })));
export namespace mapLimitOutlines {
    function prepare(options: MapLimitOutlineOptions): FileResult;
    function readResourceCache(file: string): ResourceCache;
}
export interface Selection { table: string; field: string | ((rows: Array<Record<string, unknown>>) => string) }
export interface IconPlanOptions { index: string; mapFile: string; output: string; sourceRoot: string; selections?: Selection[] }
export interface NamedImageOptions { sourceRoot: string; mapFile: string; output: string }

export namespace worldAreas {
    function prepare(options: WorldAreasOptions): FileResult;
    function buildCache(options: { sourceRoot: string; mapFile: string; indexReportFile: string; rawReportFile: string; output: string }): ResourceCache;
    function readResourceCache(file: string): ResourceCache;
}
export namespace mapAreaConfigs {
    function prepare(options: MapAreaConfigsOptions): FileResult;
    function buildCache(options: { mapFile: string; indexReportFile: string; rawReportFile: string; output: string }): ResourceCache;
    function readResourceCache(file: string): ResourceCache;
}
export namespace mapIcons {
    function prepare(options: MapIconsOptions): FileResult;
    function buildCache(options: { selectionFile: string; mapFile: string; rawReportFile: string; imageReportFile: string; output: string }): ResourceCache;
    function readResourceCache(file: string): ResourceCache;
}
export namespace maps {
    function prepare(options: MapsOptions): FileResult;
    function buildCache(options: { reports: string[]; inventories: string[]; imageReports?: string[]; texturePayloadReports?: string[]; meshReports?: string[]; spriteReports?: string[]; output: string }): ResourceCache;
    function readResourceCache(file: string): ResourceCache;
}
export namespace mapAtlas { function prepareAtlas(options: MapAtlasOptions): FileResult }
export namespace mapEntries {
    function prepare(options: MapEntriesOptions): FileResult;
    function buildCache(options: { sceneTableFile: string; sceneMapFile: string; reportFiles: string[]; inventoryFiles: string[]; output: string }): ResourceCache;
    function readResourceCache(file: string): ResourceCache;
}
export namespace mapBase {
    function prepare(options: MapBaseOptions): FileResult;
    function buildCache(options: { entryCacheFile: string; prefabCacheFile: string; rawReportFile?: string; imageReportFile?: string; rawReportFiles?: string[]; imageReportFiles?: string[]; output: string }): ResourceCache;
    function readResourceCache(file: string): ResourceCache;
}
export namespace mapFog {
    /** Returns the decoded cache, written to output/map-fog.json. sceneIds is required. */
    function prepare(options: MapFogOptions): ResourceCache;
    function buildCache(options: { baseCacheFile: string; materialReportFile: string; textureReportFile: string; imageReportFile: string; shaderReportFile: string; output: string }): ResourceCache;
    function readResourceCache(file: string): ResourceCache;
}
export namespace levelTags {
    /** No automatic preparer: supply a verified raw extraction report. */
    function buildCache(options: { rawReportFile: string; output: string }): ResourceCache;
    function readResourceCache(file: string): ResourceCache;
}
export namespace miliastra {
    function prepare(index: string, mapFile: string, output: string, source: string, selections?: Selection[]): { keys: number; images: number; output: string };
    function readResourceCache(file: string): ResourceCache;
}
export namespace profileFrames {
    function prepare(index: string, mapFile: string, output: string, source: string): { keys: number; images: number; output: string };
}
export namespace tcgPortraits {
    function prepare(source: string, mapFile: string, output: string): { portraits: number; output: string };
}
export namespace graeaeImages {
    function prepareGraeaeImages(source: string, mapFile: string, output: string): { names: number; candidates: number; output: string };
}
export namespace images { function run(cacheFile: string, destination: string, studio: string, options?: { dotnet?: string; game?: string; timeoutMs?: number }): unknown }
export interface ResourceOptionsMap {
    worldAreas: WorldAreasOptions; mapAreaConfigs: MapAreaConfigsOptions; mapIcons: MapIconsOptions;
    maps: MapsOptions; mapAtlas: MapAtlasOptions & { sourceRoot?: string };
    mapEntries: MapEntriesOptions & { sourceRoot?: string }; mapBase: MapBaseOptions & { sourceRoot?: string };
    mapFog: MapFogOptions; mapEffects: MapEffectsOptions; mapLimitOutlines: MapLimitOutlineOptions; levelTags: { rawReportFile: string; output: string };
    miliastra: IconPlanOptions; profileFrames: Omit<IconPlanOptions, 'selections'>;
    tcgPortraits: NamedImageOptions; graeaeImages: NamedImageOptions;
    images: ToolOptions & { cacheFile: string };
}
export type ResourceKind = keyof ResourceOptionsMap;
export const supportedKinds: readonly ResourceKind[];
/** Synchronous; output file for icon plans/levelTags, new directory for the other kinds. */
export function prepare<K extends ResourceKind>(kind: K, options: ResourceOptionsMap[K]): { kind: K; cachePath: string; result: unknown };
/** Resolve a lookup location only; does not prepare resources or create directories. */
export function cachePath(name: ResourceCacheName, file?: string, cacheRoot?: string): string;
