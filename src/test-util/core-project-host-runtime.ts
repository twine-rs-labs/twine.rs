// Test-only access to the concrete host runtime. Production code must use the
// CoreProjectHost capability exposed by the public core facade.
export {
	ProjectScopedCoreProjectHost,
	StoreCoreProjectHost
} from '../core/project-host';
export * from '../core/project-host-public';
