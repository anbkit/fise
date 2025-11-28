const ALPHABET =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Generate random salt string of specified length
 * @param len - Length of salt to generate
 * @returns Random salt string using alphanumeric characters
 */
export function randomSalt(len: number): string {
	let out = "";
	const n = ALPHABET.length;
	for (let i = 0; i < len; i++) {
		out += ALPHABET[Math.floor(Math.random() * n)];
	}
	return out;
}

/**
 * Generate random binary salt of specified length
 * @param len - Length of salt to generate
 * @returns Random salt as Uint8Array
 */
export function randomSaltBinary(len: number): Uint8Array {
	const salt = randomSalt(len);
	return new TextEncoder().encode(salt);
}

export function toBase64(str: string): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(str, "utf8").toString("base64");
	}
	if (typeof btoa === "function") {
		// btoa doesn't handle unicode, so we need to encode to UTF-8 first
		try {
			return btoa(
				encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
					return String.fromCharCode(parseInt(p1, 16));
				})
			);
		} catch {
			// Fallback for very old browsers
			return btoa(unescape(encodeURIComponent(str)));
		}
	}
	throw new Error("FISE: no base64 encoder available.");
}

export function fromBase64(str: string): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(str, "base64").toString("utf8");
	}
	if (typeof atob === "function") {
		// atob doesn't handle unicode, so we need to decode from UTF-8
		try {
			return decodeURIComponent(
				atob(str)
					.split("")
					.map((c) => {
						return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
					})
					.join("")
			);
		} catch {
			// Fallback for very old browsers
			return decodeURIComponent(escape(atob(str)));
		}
	}
	throw new Error("FISE: no base64 decoder available.");
}
