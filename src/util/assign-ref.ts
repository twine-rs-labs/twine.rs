import * as React from 'react';

export function assignRef<Value>(
	ref: React.Ref<Value> | undefined,
	value: Value | null
): ReturnType<React.RefCallback<Value>> {
	if (typeof ref === 'function') {
		return ref(value);
	} else if (ref) {
		ref.current = value;
	}
}
