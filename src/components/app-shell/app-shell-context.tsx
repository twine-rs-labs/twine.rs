import * as React from 'react';
import type {AppCommand, AppCommandContribution} from './command-registry';

export interface ShellToolbarRegistration {
	helpUrl?: string;
	pinnedControls?: React.ReactNode;
	tabs: Array<{content: React.ReactNode; id: string; label: string}>;
}

export interface ShellDockRegistration {
	content: React.ReactNode;
	label: string;
}

export interface AppShellContextValue {
	inShell: boolean;
	registerCommandContribution: (contribution: AppCommandContribution) => {
		refresh: (commands: AppCommand[]) => void;
		unregister: () => void;
	};
	setDock: (registration: ShellDockRegistration | undefined) => void;
	setToolbar: (registration: ShellToolbarRegistration | undefined) => void;
}

const defaultContext: AppShellContextValue = {
	inShell: false,
	registerCommandContribution: () => ({
		refresh: () => undefined,
		unregister: () => undefined
	}),
	setDock: () => undefined,
	setToolbar: () => undefined
};

export const AppShellContext =
	React.createContext<AppShellContextValue>(defaultContext);

export function useAppShellContext() {
	return React.useContext(AppShellContext);
}

/** Registers route/tool commands for exactly the mounted component lifetime. */
export function useAppCommandContribution(
	owner: string,
	commands: AppCommand[]
) {
	const {registerCommandContribution} = useAppShellContext();
	const commandsRef = React.useRef(commands);
	commandsRef.current = commands;
	const getCommands = React.useCallback(() => commandsRef.current, []);
	const registrationRef = React.useRef<
		ReturnType<typeof registerCommandContribution> | undefined
	>(undefined);

	React.useLayoutEffect(() => {
		const registration = registerCommandContribution({
			commands: commandsRef.current,
			getCommands,
			owner
		});
		registrationRef.current = registration;
		return () => {
			registration.unregister();
			if (registrationRef.current === registration)
				registrationRef.current = undefined;
		};
	}, [getCommands, owner, registerCommandContribution]);

	React.useLayoutEffect(() => {
		registrationRef.current?.refresh(commands);
	}, [commands]);
}
