import {renderHook} from '@testing-library/react';
import {useTranslation} from 'react-i18next';
import {useStoreErrorReporter} from '../use-store-error-reporter';

jest.mock('react-i18next', () => ({
	useTranslation: jest.fn()
}));

describe('useStoreErrorReporter', () => {
	it('keeps reportError stable when its translation dependencies do not change', () => {
		const translate = jest.fn((key: string) => key);
		(useTranslation as jest.Mock).mockReturnValue({ready: true, t: translate});
		const {rerender, result} = renderHook(() => useStoreErrorReporter());
		const reportError = result.current.reportError;

		rerender();

		expect(result.current.reportError).toBe(reportError);
	});
});
