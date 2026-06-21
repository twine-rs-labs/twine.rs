import * as React from 'react';
import {Badge as DesignSystemBadge} from '../design-system';
import './badge.css';

export interface BadgeProps {
	label: string;
}

export const Badge: React.FC<BadgeProps> = ({label}) => (
	<DesignSystemBadge className="badge">{label}</DesignSystemBadge>
);
