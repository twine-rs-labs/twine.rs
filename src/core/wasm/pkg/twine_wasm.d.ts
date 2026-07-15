/* tslint:disable */
/* eslint-disable */

/**
 * Incrementally assembles the initial project snapshot inside WASM so large
 * passage bodies never need to coexist in one worker request.
 */
export class TwineWasmProjectBootstrap {
    free(): void;
    [Symbol.dispose](): void;
    append_passages(story_id: string, passages: any): void;
    finish(): TwineWasmProjectSession;
    constructor(snapshot: any);
}

export class TwineWasmProjectSession {
    free(): void;
    [Symbol.dispose](): void;
    acknowledge_saved(revision: number): any;
    apply(command: any, record_history: boolean): any;
    apply_external_delta(delta: any): any;
    can_redo(): boolean;
    can_undo(): boolean;
    ingest_external_delta(delta: any, force: boolean): any;
    constructor(snapshot: any);
    performance_diagnostics(): any;
    query_assets_page(story_id: string, query: any): any;
    query_backlinks_page(story_id: string, passage_id: string, query: any): any;
    query_contents_page(story_id: string, query: any): any;
    query_diagnostics_page(story_id: string, query: any): any;
    query_document_page(story_id: string, query: any): any;
    query_graph_projection(story_id: string, options: any): any;
    query_passage_document(story_id: string, passage_id: string): any;
    query_passage_facts(story_id: string, passage_id: string): any;
    query_passage_local_facts(story_id: string, passage_id: string): any;
    query_search_page(story_id: string, query: any): any;
    query_source_document(story_id: string, kind: string): any;
    query_story_index(story_id: string, options: any): any;
    query_story_summary(story_id: string): any;
    query_story_word_count(story_id: string): number;
    redo(): any;
    revision(): number;
    set_asset_inventory(inventory: any): void;
    set_revision(revision: number): void;
    snapshot(): any;
    status(): any;
    undo(): any;
}

export function query_graph_projection(snapshot: any, story_id: string, options: any): any;

export function query_story_index(snapshot: any, story_id: string, options: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_twinewasmprojectbootstrap_free: (a: number, b: number) => void;
    readonly __wbg_twinewasmprojectsession_free: (a: number, b: number) => void;
    readonly query_graph_projection: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly query_story_index: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectbootstrap_append_passages: (a: number, b: number, c: number, d: any) => [number, number];
    readonly twinewasmprojectbootstrap_finish: (a: number) => number;
    readonly twinewasmprojectbootstrap_new: (a: any) => [number, number, number];
    readonly twinewasmprojectsession_acknowledge_saved: (a: number, b: number) => [number, number, number];
    readonly twinewasmprojectsession_apply: (a: number, b: any, c: number) => [number, number, number];
    readonly twinewasmprojectsession_apply_external_delta: (a: number, b: any) => [number, number, number];
    readonly twinewasmprojectsession_can_redo: (a: number) => number;
    readonly twinewasmprojectsession_can_undo: (a: number) => number;
    readonly twinewasmprojectsession_ingest_external_delta: (a: number, b: any, c: number) => [number, number, number];
    readonly twinewasmprojectsession_new: (a: any) => [number, number, number];
    readonly twinewasmprojectsession_performance_diagnostics: (a: number) => [number, number, number];
    readonly twinewasmprojectsession_query_assets_page: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_query_backlinks_page: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly twinewasmprojectsession_query_contents_page: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_query_diagnostics_page: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_query_document_page: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_query_graph_projection: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_query_passage_document: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly twinewasmprojectsession_query_passage_facts: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly twinewasmprojectsession_query_passage_local_facts: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly twinewasmprojectsession_query_search_page: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_query_source_document: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly twinewasmprojectsession_query_story_index: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_query_story_summary: (a: number, b: number, c: number) => [number, number, number];
    readonly twinewasmprojectsession_query_story_word_count: (a: number, b: number, c: number) => [number, number, number];
    readonly twinewasmprojectsession_redo: (a: number) => [number, number, number];
    readonly twinewasmprojectsession_revision: (a: number) => number;
    readonly twinewasmprojectsession_set_asset_inventory: (a: number, b: any) => [number, number];
    readonly twinewasmprojectsession_set_revision: (a: number, b: number) => void;
    readonly twinewasmprojectsession_snapshot: (a: number) => [number, number, number];
    readonly twinewasmprojectsession_status: (a: number) => [number, number, number];
    readonly twinewasmprojectsession_undo: (a: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
