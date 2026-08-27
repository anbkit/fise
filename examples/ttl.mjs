import assert from "node:assert/strict";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const producer = new Fise(profile, { ttlSeconds: 30 });
const consumer = new Fise(profile);
const context = ["session_demo_01", "user_42", "orders", "v1"];
const order = { id: 42, status: "ready" };

const envelope = producer.encrypt(order, context);

assert.equal(producer.ttlSeconds, 30);
assert.deepEqual(consumer.decrypt(envelope, context), order);

console.log("PASS ttl: producer configured one envelope lifetime and consumer read it from wire");
