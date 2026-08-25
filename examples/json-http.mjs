import assert from "node:assert/strict";

import { defaultBinaryProfile } from "fise";
import {
	FISE_MEDIA_TYPE,
	createFiseJsonResponse,
	readFiseJsonResponse
} from "fise/http";

const catalog = {
	id: 42,
	title: "Example",
	tags: ["fise", "json"]
};
const response = createFiseJsonResponse(
	catalog,
	defaultBinaryProfile,
	{},
	{
		status: 200,
		headers: {
			"cache-control": "private, no-store",
			"x-request-id": "example-request"
		}
	}
);

assert.equal(response.status, 200);
assert.equal(response.headers.get("x-request-id"), "example-request");
assert.equal(
	response.headers.get("content-type"),
	`${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`
);

const restored = await readFiseJsonResponse(response, defaultBinaryProfile, {
	maxEnvelopeLength: 1_000_000
});
assertCatalog(restored);
assert.deepEqual(restored, catalog);

console.log("PASS json-http: media contract + JSON + application schema");

function assertCatalog(value) {
	assert.ok(value && typeof value === "object" && !Array.isArray(value));
	assert.equal(typeof value.id, "number");
	assert.equal(typeof value.title, "string");
	assert.ok(Array.isArray(value.tags));
	assert.ok(value.tags.every(tag => typeof tag === "string"));
}
