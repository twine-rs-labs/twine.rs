import * as React from 'react';

function FocusTrap({children}: {children: React.ReactNode}) {
	return React.Children.only(children) as React.ReactElement;
}

export default FocusTrap;
