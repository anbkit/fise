import assert from "node:assert/strict";
import test from "node:test";

import { resolveFiseTimeWindow } from "fise";

test("resolveFiseTimeWindow returns half-open Unix-millisecond windows", () => {
	assert.deepEqual(resolveFiseTimeWindow(0, { durationMs: 60_000 }), {
		timestamp: 0,
		startMs: 0,
		endExclusiveMs: 60_000
	});
	assert.deepEqual(resolveFiseTimeWindow(59_999, { durationMs: 60_000 }), {
		timestamp: 0,
		startMs: 0,
		endExclusiveMs: 60_000
	});
	assert.deepEqual(resolveFiseTimeWindow(60_000, { durationMs: 60_000 }), {
		timestamp: 1,
		startMs: 60_000,
		endExclusiveMs: 120_000
	});
});

test("resolveFiseTimeWindow applies an explicit origin", () => {
	assert.deepEqual(resolveFiseTimeWindow(1_000, { durationMs: 500, originMs: 750 }), {
		timestamp: 0,
		startMs: 750,
		endExclusiveMs: 1_250
	});
	assert.deepEqual(resolveFiseTimeWindow(1_250, { durationMs: 500, originMs: 750 }), {
		timestamp: 1,
		startMs: 1_250,
		endExclusiveMs: 1_750
	});
});

test("resolveFiseTimeWindow uses mathematical floor before the origin", () => {
	assert.deepEqual(resolveFiseTimeWindow(-1, { durationMs: 60_000 }), {
		timestamp: -1,
		startMs: -60_000,
		endExclusiveMs: 0
	});
	assert.deepEqual(resolveFiseTimeWindow(-60_000, { durationMs: 60_000 }), {
		timestamp: -1,
		startMs: -60_000,
		endExclusiveMs: 0
	});
});

test("resolveFiseTimeWindow contains every tested instant in its resolved window", () => {
	for (const durationMs of [1, 7, 60_000]) {
		for (const originMs of [-25, 0, 31]) {
			for (let timeMs = -100; timeMs <= 100; timeMs++) {
				const window = resolveFiseTimeWindow(timeMs, { durationMs, originMs });
				assert.ok(window.startMs <= timeMs);
				assert.ok(timeMs < window.endExclusiveMs);
				assert.equal(window.endExclusiveMs - window.startMs, durationMs);
			}
		}
	}
});

test("resolveFiseTimeWindow returns an immutable value", () => {
	const window = resolveFiseTimeWindow(123_456, { durationMs: 60_000 });
	assert.ok(Object.isFrozen(window));
	assert.throws(() => {
		window.timestamp = 1;
	}, TypeError);
});

test("resolveFiseTimeWindow rejects invalid inputs", () => {
	for (const timeMs of [NaN, Infinity, 1.5]) {
		assert.throws(() => resolveFiseTimeWindow(timeMs, { durationMs: 1 }), { code: "INVALID_INPUT" });
	}
	for (const durationMs of [0, -1, 1.5, Infinity]) {
		assert.throws(() => resolveFiseTimeWindow(0, { durationMs }), { code: "INVALID_INPUT" });
	}
	for (const originMs of [NaN, Infinity, 1.5]) {
		assert.throws(
			() => resolveFiseTimeWindow(0, { durationMs: 1, originMs }),
			{ code: "INVALID_INPUT" }
		);
	}
});

test("resolveFiseTimeWindow snapshots plain options without invoking accessors", () => {
	let getterCalls = 0;
	const accessorOptions = {};
	Object.defineProperty(accessorOptions, "durationMs", {
		enumerable: true,
		get() {
			getterCalls++;
			return 60_000;
		}
	});
	assert.throws(
		() => resolveFiseTimeWindow(0, accessorOptions),
		{ code: "INVALID_INPUT" }
	);
	assert.equal(getterCalls, 0);
	assert.throws(
		() => resolveFiseTimeWindow(0, { durationMs: 1, typo: true }),
		{ code: "INVALID_INPUT" }
	);
	assert.throws(
		() => resolveFiseTimeWindow(0, Object.create({ durationMs: 1 })),
		{ code: "INVALID_INPUT" }
	);
});

test("resolveFiseTimeWindow rejects results outside the safe-integer range", () => {
	const maximum = Number.MAX_SAFE_INTEGER;
	assert.throws(
		() => resolveFiseTimeWindow(maximum, { durationMs: 1 }),
		{ code: "INVALID_INPUT" }
	);
	assert.throws(
		() => resolveFiseTimeWindow(-maximum, { durationMs: 1, originMs: maximum }),
		{ code: "INVALID_INPUT" }
	);
});
