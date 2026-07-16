import * as React from 'react';
import {Route, Routes} from 'react-router';

export const TestRoute: React.FC<React.PropsWithChildren<{path: string}>> = ({
	children,
	path
}) => (
	<Routes>
		<Route element={<>{children}</>} path={path} />
		<Route element={null} path="*" />
	</Routes>
);
