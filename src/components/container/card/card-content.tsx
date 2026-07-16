import * as React from 'react';
import './card-content.css';

export const CardContent: React.FC<React.PropsWithChildren> = ({children}) => (
	<div className="card-content">{children}</div>
);
