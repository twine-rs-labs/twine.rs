import {
	WorkerHeapCdpBroker,
	type WorkerHeapCdpBrokerHttpResponse,
	type WorkerHeapCdpBrokerOptions
} from '../worker-heap-cdp-broker';

class FakeSocket {
	closed = false;
	readonly listeners = new Map<string, Array<(event: any) => void>>();
	readonly sent: Array<Record<string, unknown>> = [];
	onSend: (message: Record<string, unknown>) => void = () => {};

	addEventListener(event: string, listener: (event: any) => void) {
		const listeners = this.listeners.get(event) ?? [];
		listeners.push(listener);
		this.listeners.set(event, listeners);
		if (event === 'open') queueMicrotask(() => listener({}));
	}
	close() {
		this.closed = true;
		this.emit('close', {});
	}
	send(payload: string) {
		const message = JSON.parse(payload) as Record<string, unknown>;
		this.sent.push(message);
		this.onSend(message);
	}
	emit(event: string, value: unknown) {
		for (const listener of this.listeners.get(event) ?? []) listener(value);
	}
	respond(id: number, result: unknown) {
		queueMicrotask(() =>
			this.emit('message', {data: JSON.stringify({id, result})})
		);
	}
}

class FakeResponse implements WorkerHeapCdpBrokerHttpResponse {
	body = '';
	readonly headers = new Map<string, string>();
	status = 200;

	end(body = '') {
		this.body += body;
	}
	setHeader(name: string, value: string) {
		this.headers.set(name, value);
	}
	writeHead(status: number) {
		this.status = status;
	}
}

async function request(
	broker: WorkerHeapCdpBroker,
	token?: string,
	path = '/worker-heap'
) {
	const response = new FakeResponse();
	await broker.handleHttpRequest(
		{
			authorization: token ? `Bearer ${token}` : undefined,
			method: 'POST',
			path
		},
		response
	);
	return response;
}

function options(
	socket: FakeSocket,
	overrides: Partial<WorkerHeapCdpBrokerOptions> = {}
) {
	return {
		readDevToolsActivePort: async () =>
			'9222\n/devtools/browser/runner-token\n',
		userDataPath: '/unused',
		webSocket: () => socket,
		...overrides
	} satisfies WorkerHeapCdpBrokerOptions;
}

function workerTarget(targetId = 'worker-1') {
	return {
		targetId,
		type: 'worker',
		url: 'file:///app/assets/twine-wasm-worker-abc.js'
	};
}

function respondToSample(socket: FakeSocket, targets = [workerTarget()]) {
	socket.onSend = message => {
		const id = message.id as number;
		switch (message.method) {
			case 'Target.getTargets':
				socket.respond(id, {targetInfos: targets});
				break;
			case 'Target.attachToTarget':
				socket.respond(id, {sessionId: 'worker-session'});
				break;
			case 'Runtime.getHeapUsage':
				socket.respond(id, {
					totalSize: 8 * 1024 * 1024,
					usedSize: 2 * 1024 * 1024
				});
				break;
		}
	};
}

describe('WorkerHeapCdpBroker', () => {
	it('requires its random per-launch bearer token', async () => {
		const broker = new WorkerHeapCdpBroker(options(new FakeSocket()));
		try {
			expect((await request(broker)).status).toBe(401);
			expect(
				(await request(broker, broker.token, '/worker-heap?other')).status
			).toBe(404);
		} finally {
			await broker.close();
		}
	});

	it('filters to exactly one bundled worker and routes heap requests with raw sessionId', async () => {
		const socket = new FakeSocket();
		respondToSample(socket, [
			{targetId: 'page-1', type: 'page', url: 'file:///app/index.html'},
			{
				targetId: 'other-worker',
				type: 'worker',
				url: 'file:///app/other-worker.js'
			},
			workerTarget()
		]);
		const broker = new WorkerHeapCdpBroker(options(socket));
		try {
			const response = await request(broker, broker.token);
			expect(response.status).toBe(200);
			expect(JSON.parse(response.body)).toEqual(
				expect.objectContaining({
					targetId: 'worker-1',
					usedSize: 2 * 1024 * 1024
				})
			);
			expect(socket.sent).toContainEqual({id: 1, method: 'Target.getTargets'});
			expect(socket.sent).toContainEqual({
				id: 2,
				method: 'Target.attachToTarget',
				params: {flatten: true, targetId: 'worker-1'}
			});
			expect(socket.sent).toContainEqual({
				id: 3,
				method: 'Runtime.getHeapUsage',
				sessionId: 'worker-session'
			});
		} finally {
			await broker.close();
		}
	});

	it('rejects ambiguous bundled worker targets without attaching', async () => {
		const socket = new FakeSocket();
		respondToSample(socket, [workerTarget('first'), workerTarget('second')]);
		const broker = new WorkerHeapCdpBroker(options(socket));
		try {
			const response = await request(broker, broker.token);
			expect(response.status).toBe(503);
			expect(response.body).toContain(
				'exactly one bundled WASM worker target; found 2'
			);
			expect(socket.sent.map(message => message.method)).not.toContain(
				'Target.attachToTarget'
			);
		} finally {
			await broker.close();
		}
	});

	it('waits for a worker that appears during the bounded first checkpoint', async () => {
		const socket = new FakeSocket();
		let targetQueries = 0;
		socket.onSend = message => {
			const id = message.id as number;
			if (message.method === 'Target.getTargets') {
				targetQueries += 1;
				socket.respond(id, {
					targetInfos: targetQueries === 1 ? [] : [workerTarget()]
				});
			} else if (message.method === 'Target.attachToTarget') {
				socket.respond(id, {sessionId: 'worker-session'});
			} else if (message.method === 'Runtime.getHeapUsage') {
				socket.respond(id, {totalSize: 4, usedSize: 2});
			}
		};
		const broker = new WorkerHeapCdpBroker(
			options(socket, {commandTimeoutMs: 200})
		);
		try {
			const response = await request(broker, broker.token);
			expect(response.status).toBe(200);
			expect(targetQueries).toBe(2);
		} finally {
			await broker.close();
		}
	});

	it('bounds an unanswered command and ignores the late response', async () => {
		const socket = new FakeSocket();
		socket.onSend = message => {
			if (message.method === 'Target.getTargets') {
				socket.respond(message.id as number, {targetInfos: [workerTarget()]});
			} else if (message.method === 'Target.attachToTarget') {
				socket.respond(message.id as number, {sessionId: 'worker-session'});
			}
		};
		const broker = new WorkerHeapCdpBroker(
			options(socket, {commandTimeoutMs: 20})
		);
		try {
			const response = await request(broker, broker.token);
			expect(response.status).toBe(503);
			expect(response.body).toContain('Runtime.getHeapUsage timed out');
			expect(() =>
				socket.respond(3, {totalSize: 1, usedSize: 1})
			).not.toThrow();
		} finally {
			await broker.close();
		}
	});

	it('serializes concurrent samples and tears down its socket and pending request', async () => {
		const socket = new FakeSocket();
		let inFlight = 0;
		let maximumInFlight = 0;
		socket.onSend = message => {
			const id = message.id as number;
			if (message.method === 'Target.getTargets')
				socket.respond(id, {targetInfos: [workerTarget()]});
			else if (message.method === 'Target.attachToTarget')
				socket.respond(id, {sessionId: 'worker-session'});
			else if (message.method === 'Runtime.getHeapUsage') {
				inFlight += 1;
				maximumInFlight = Math.max(maximumInFlight, inFlight);
				setTimeout(() => {
					inFlight -= 1;
					socket.respond(id, {totalSize: 4, usedSize: 2});
				}, 5);
			}
		};
		const broker = new WorkerHeapCdpBroker(options(socket));
		try {
			const [first, second] = await Promise.all([
				request(broker, broker.token),
				request(broker, broker.token)
			]);
			expect([first.status, second.status]).toEqual([200, 200]);
			expect(maximumInFlight).toBe(1);
		} finally {
			await broker.close();
		}
		expect(socket.closed).toBe(true);
	});
});
