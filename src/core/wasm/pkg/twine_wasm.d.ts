/* tslint:disable */
/* eslint-disable */

export class TwineWasmProjectSession {
    free(): void;
    [Symbol.dispose](): void;
    acknowledge_saved(revision: number): any;
    apply(command: any, record_history: boolean): any;
    apply_external_delta(delta: any): any;
    can_redo(): boolean;
    can_undo(): boolean;
    constructor(snapshot: any);
    query_graph_projection(story_id: string, options: any): any;
    query_story_index(story_id: string, options: any): any;
    redo(): any;
    revision(): number;
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
    readonly __wbg_twinewasmprojectsession_free: (a: number, b: number) => void;
    readonly query_graph_projection: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly query_story_index: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_acknowledge_saved: (a: number, b: number) => [number, number, number];
    readonly twinewasmprojectsession_apply: (a: number, b: any, c: number) => [number, number, number];
    readonly twinewasmprojectsession_apply_external_delta: (a: number, b: any) => [number, number, number];
    readonly twinewasmprojectsession_can_redo: (a: number) => number;
    readonly twinewasmprojectsession_can_undo: (a: number) => number;
    readonly twinewasmprojectsession_new: (a: any) => [number, number, number];
    readonly twinewasmprojectsession_query_graph_projection: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_query_story_index: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly twinewasmprojectsession_redo: (a: number) => [number, number, number];
    readonly twinewasmprojectsession_revision: (a: number) => number;
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
