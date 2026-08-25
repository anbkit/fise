import assert from "node:assert/strict";

import {
	defaultStringProfile,
	fiseDecrypt,
	fiseEncrypt,
	resolveFiseTimeWindow
} from "fise";

// Resolve once from an operation anchor. Do not let producer and consumer read
// independent clocks at the edge of a window.
const requestStartedAtMs = Date.UTC(2026, 7, 25, 12, 34, 56);
const window = resolveFiseTimeWindow(requestStartedAtMs, {
	durationMs: 60_000,
	originMs: 0
});
assert.ok(window.startMs <= requestStartedAtMs);
assert.ok(requestStartedAtMs < window.endExclusiveMs);

const producerContext = { timestamp: window.timestamp };
const envelope = fiseEncrypt(
	"request-scoped representation",
	defaultStringProfile,
	producerContext
);

// This simulates application-owned coordination. The value is public context,
// not an authenticated expiry or replay-prevention signal.
const publicWindowHeader = String(window.timestamp);
const coordinatedTimestamp = Number(publicWindowHeader);
assert.ok(Number.isSafeInteger(coordinatedTimestamp));
const restored = fiseDecrypt(envelope, defaultStringProfile, {
	timestamp: coordinatedTimestamp
});
assert.equal(restored, "request-scoped representation");

console.log("PASS time-window: one anchor + coordinated timestamp context");
