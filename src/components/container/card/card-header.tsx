import * as React from 'react';
import './card-header.css';

export const CardHeader: React.FC<React.PropsWithChildren> = ({children}) => (
	<div className="card-header">{children}</div>
);
