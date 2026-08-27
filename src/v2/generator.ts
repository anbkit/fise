import { createHash, randomBytes as nodeRandomBytes, randomInt } from "node:crypto";
import {
	existsSync,
	linkSync,
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { FiseError } from "../errors.js";
import { verifyGeneratedProfilePairSources } from "./pythonVerifier.js";
import { compileProfileWasm } from "./wasmCodegen.js";
import {
	resolveProfilePath,
	verifyProfileSource,
	type ProfileVerification
} from "./verifier.js";

type StageKind = "xor" | "add" | "rotate" | "affine";

interface Stage {
	readonly kind: StageKind;
	readonly segmentShift: number;
	readonly positionMultiplier: number;
	readonly constant: number;
	readonly contextLane: number;
	readonly contextLane2: number;
	readonly multiplier?: number;
	readonly inverse?: number;
}

interface ProfileIr {
	readonly abi: 2;
	readonly contextSegmentOffset: number;
	readonly contextSegmentLength: number;
	readonly contextInitial: readonly [number, number, number, number];
	readonly contextMultipliers: readonly [number, number, number];
	readonly contextRotation: number;
	readonly offsetConstants: readonly [number, number, number, number];
	readonly markerConstants: readonly [number, number, number, number];
	readonly stages: readonly Stage[];
}

export interface GeneratedProfileSource {
	readonly fingerprint: string;
	readonly source: string;
}

export interface GeneratedProfilePairSources {
	readonly fingerprint: string;
	readonly javascriptSource: string;
	readonly pythonSource: string;
}

export interface WrittenProfile {
	readonly fingerprint: string;
	readonly path: string;
	readonly verification: ProfileVerification;
}

export interface WrittenProfilePair {
	readonly fingerprint: string;
	readonly javascriptPath: string;
	readonly pythonPath: string;
	readonly verification: ProfileVerification;
}

/**
 * Internal entropy boundary used by deterministic generator verification.
 * This module is not part of the package export map; normal consumers use the CLI.
 */
export interface ProfileGeneratorEntropy {
	integer(label: string, minimumInclusive: number, maximumExclusive: number): number;
	bytes(label: string, length: number): Uint8Array;
}

/** @internal Filesystem boundary for atomic-write failure verification. */
export interface ProfileGeneratorFileSystem {
	exists(path: string): boolean;
	createDirectory(path: string): void;
	writeExclusive(path: string, source: string): void;
	publishExclusive(sourcePath: string, destinationPath: string): void;
	replace(sourcePath: string, destinationPath: string): void;
	remove(path: string): void;
}

/** @internal Deterministic verification seam; not exported by the package. */
export interface ProfileGeneratorOptions {
	readonly entropy?: ProfileGeneratorEntropy;
	readonly acceptCandidate?: (attempt: number) => boolean;
}

/** @internal Atomic-write verification seam; not exported by the package. */
export interface ProfileWriterOptions extends ProfileGeneratorOptions {
	readonly override?: boolean;
	readonly fileSystem?: ProfileGeneratorFileSystem;
	readonly verifySource?: (source: string) => Promise<ProfileVerification>;
}

/** @internal Paired-writer verification seam; not exported by the package. */
export interface ProfilePairWriterOptions extends ProfileWriterOptions {
	readonly verifyPairSources?: (
		javascriptSource: string,
		pythonSource: string
	) => Promise<ProfileVerification>;
}

const secureEntropy: ProfileGeneratorEntropy = Object.freeze({
	integer: (_label: string, minimumInclusive: number, maximumExclusive: number) =>
		randomInt(minimumInclusive, maximumExclusive),
	bytes: (_label: string, length: number) => nodeRandomBytes(length)
});

const PYTHON_KEYWORDS = new Set([
	"False", "None", "True", "and", "as", "assert", "async", "await",
	"break", "class", "continue", "def", "del", "elif", "else", "except",
	"finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
	"nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
	"with", "yield"
]);

const nodeFileSystem: ProfileGeneratorFileSystem = Object.freeze({
	exists: (path: string) => existsSync(path),
	createDirectory: (path: string) => mkdirSync(path, { recursive: true }),
	writeExclusive: (path: string, source: string) =>
		writeFileSync(path, source, { encoding: "utf8", flag: "wx" }),
	publishExclusive: (sourcePath: string, destinationPath: string) =>
		linkSync(sourcePath, destinationPath),
	replace: (sourcePath: string, destinationPath: string) =>
		renameSync(sourcePath, destinationPath),
	remove: (path: string) => rmSync(path, { force: true })
});

export function generateProfileSource(
	options: ProfileGeneratorOptions = {}
): GeneratedProfileSource {
	const generated = generateProfilePairSources(options);
	return Object.freeze({
		fingerprint: generated.fingerprint,
		source: generated.javascriptSource
	});
}

export function generateProfilePairSources(
	options: ProfileGeneratorOptions = {}
): GeneratedProfilePairSources {
	const entropy = options.entropy ?? secureEntropy;
	if (
		options.acceptCandidate !== undefined &&
		typeof options.acceptCandidate !== "function"
	) {
		throw new FiseError("INVALID_INPUT", "FISE: candidate acceptance must be a function.");
	}
	for (let attempt = 0; attempt < 128; attempt++) {
		const ir = createIr(entropy);
		if (!validateIr(ir)) continue;
		if (options.acceptCandidate && !options.acceptCandidate(attempt + 1)) continue;
		const canonical = JSON.stringify(ir);
		const fingerprint = createHash("sha256")
			.update("fise.generated-profile/2\0")
			.update(canonical)
			.digest("hex")
			.slice(0, 32);
		return Object.freeze({
			fingerprint,
			javascriptSource: emitProfile(ir, fingerprint),
			pythonSource: emitPythonProfile(ir, fingerprint)
		});
	}
	throw new FiseError(
		"INVALID_PROFILE",
		"FISE: unable to generate a non-degenerate reversible profile."
	);
}

export async function writeGeneratedProfile(
	outputPath: string,
	options: ProfileWriterOptions = {}
): Promise<WrittenProfile> {
	const absolutePath = resolveProfilePath(outputPath, "output path");
	if (options.override !== undefined && typeof options.override !== "boolean") {
		throw new FiseError("INVALID_INPUT", "FISE CLI: override must be a boolean.");
	}
	const directory = dirname(absolutePath);
	const entropy = options.entropy ?? secureEntropy;
	const fileSystem = options.fileSystem ?? nodeFileSystem;
	const verifySource = options.verifySource ?? verifyProfileSource;
	if (typeof verifySource !== "function") {
		throw new FiseError("INVALID_INPUT", "FISE CLI: profile verifier must be a function.");
	}
	if (!options.override && fileSystem.exists(absolutePath)) {
		throw profileExists(absolutePath);
	}
	const generated = generateProfileSource({
		entropy,
		...(options.acceptCandidate === undefined
			? {}
			: { acceptCandidate: options.acceptCandidate })
	});
	let verification: ProfileVerification;
	try {
		verification = await verifySource(generated.source);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE CLI: generated profile verification failed.",
			error
		);
	}
	if (
		!verification ||
		verification.fingerprint !== generated.fingerprint ||
		!Array.isArray(verification.checks) ||
		verification.checks.length === 0 ||
		verification.checks.some(check => typeof check !== "string" || check.length === 0)
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE CLI: generated profile verification returned an invalid result."
		);
	}
	const ownedVerification: ProfileVerification = Object.freeze({
		fingerprint: verification.fingerprint,
		checks: Object.freeze([...verification.checks])
	});
	const suffix = bytesToHex(entropyBytes(entropy, "temporaryPath", 8));
	const temporaryPath = `${absolutePath}.${process.pid}.${suffix}.tmp`;
	let removeTemporary = false;
	let publishAttempted = false;
	try {
		fileSystem.createDirectory(directory);
		try {
			fileSystem.writeExclusive(temporaryPath, generated.source);
			removeTemporary = true;
		} catch (error) {
			removeTemporary = errorCode(error) !== "EEXIST";
			throw error;
		}
		if (options.override) {
			fileSystem.replace(temporaryPath, absolutePath);
			removeTemporary = false;
		} else {
			publishAttempted = true;
			fileSystem.publishExclusive(temporaryPath, absolutePath);
			try {
				fileSystem.remove(temporaryPath);
			} catch {
				// The complete destination is already published; temporary cleanup is best effort.
			}
			removeTemporary = false;
		}
	} catch (error) {
		if (removeTemporary) {
			try {
				fileSystem.remove(temporaryPath);
			} catch {
				// Preserve the original write failure; cleanup is best effort.
			}
		}
		if (!options.override && publishAttempted && errorCode(error) === "EEXIST") {
			throw profileExists(absolutePath);
		}
		throw writeFailure(absolutePath, error);
	}
	return Object.freeze({
		fingerprint: generated.fingerprint,
		path: absolutePath,
		verification: ownedVerification
	});
}

export async function writeGeneratedProfilePair(
	outputPath: string,
	options: ProfilePairWriterOptions = {}
): Promise<WrittenProfilePair> {
	const javascriptPath = resolveProfilePath(outputPath, "JavaScript output path");
	const pythonPath = pairedPythonPath(javascriptPath);
	if (options.override !== undefined && typeof options.override !== "boolean") {
		throw new FiseError("INVALID_INPUT", "FISE CLI: override must be a boolean.");
	}
	const entropy = options.entropy ?? secureEntropy;
	const fileSystem = options.fileSystem ?? nodeFileSystem;
	const verifySource = options.verifySource ?? verifyProfileSource;
	const verifyPairSources = options.verifyPairSources ?? verifyGeneratedProfilePairSources;
	if (typeof verifySource !== "function" || typeof verifyPairSources !== "function") {
		throw new FiseError("INVALID_INPUT", "FISE CLI: paired profile verifier must be a function.");
	}
	if (!options.override) {
		if (fileSystem.exists(javascriptPath)) throw profileExists(javascriptPath);
		if (fileSystem.exists(pythonPath)) throw profileExists(pythonPath);
	}
	const generated = generateProfilePairSources({
		entropy,
		...(options.acceptCandidate === undefined
			? {}
			: { acceptCandidate: options.acceptCandidate })
	});
	let javascriptVerification: ProfileVerification;
	let pairVerification: ProfileVerification;
	try {
		[javascriptVerification, pairVerification] = await Promise.all([
			verifySource(generated.javascriptSource),
			verifyPairSources(generated.javascriptSource, generated.pythonSource)
		]);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE CLI: generated JavaScript/Python pair verification failed.",
			error
		);
	}
	assertVerification(javascriptVerification, generated.fingerprint);
	assertVerification(pairVerification, generated.fingerprint);
	const verification: ProfileVerification = Object.freeze({
		fingerprint: generated.fingerprint,
		checks: Object.freeze([
			...javascriptVerification.checks,
			...pairVerification.checks
		])
	});
	publishGeneratedPair(
		javascriptPath,
		generated.javascriptSource,
		pythonPath,
		generated.pythonSource,
		Boolean(options.override),
		entropy,
		fileSystem
	);
	return Object.freeze({
		fingerprint: generated.fingerprint,
		javascriptPath,
		pythonPath,
		verification
	});
}

export function pairedPythonPath(javascriptPath: string): string {
	const extension = extname(javascriptPath);
	let moduleName = basename(javascriptPath, extension).replace(/[^A-Za-z0-9_]/g, "_");
	if (!/^[A-Za-z_]/.test(moduleName) || PYTHON_KEYWORDS.has(moduleName)) {
		moduleName = `_${moduleName}`;
	}
	return join(dirname(javascriptPath), `${moduleName}.py`);
}

function publishGeneratedPair(
	javascriptPath: string,
	javascriptSource: string,
	pythonPath: string,
	pythonSource: string,
	override: boolean,
	entropy: ProfileGeneratorEntropy,
	fileSystem: ProfileGeneratorFileSystem
): void {
	const suffix = bytesToHex(entropyBytes(entropy, "temporaryPath", 8));
	const files = [
		{
			path: javascriptPath,
			source: javascriptSource,
			temporaryPath: `${javascriptPath}.${process.pid}.${suffix}.tmp`,
			backupPath: `${javascriptPath}.${process.pid}.${suffix}.bak`,
			existed: fileSystem.exists(javascriptPath),
			temporaryWritten: false,
			backupCreated: false,
			published: false
		},
		{
			path: pythonPath,
			source: pythonSource,
			temporaryPath: `${pythonPath}.${process.pid}.${suffix}.tmp`,
			backupPath: `${pythonPath}.${process.pid}.${suffix}.bak`,
			existed: fileSystem.exists(pythonPath),
			temporaryWritten: false,
			backupCreated: false,
			published: false
		}
	];
	try {
		for (const file of files) fileSystem.createDirectory(dirname(file.path));
		for (const file of files) {
			fileSystem.writeExclusive(file.temporaryPath, file.source);
			file.temporaryWritten = true;
		}
		if (override) {
			for (const file of files) {
				if (!file.existed) continue;
				fileSystem.publishExclusive(file.path, file.backupPath);
				file.backupCreated = true;
			}
			for (const file of files) {
				fileSystem.replace(file.temporaryPath, file.path);
				file.temporaryWritten = false;
				file.published = true;
			}
		} else {
			for (const file of files) {
				fileSystem.publishExclusive(file.temporaryPath, file.path);
				file.published = true;
			}
		}
		for (const file of files) {
			if (file.temporaryWritten) {
				try {
					fileSystem.remove(file.temporaryPath);
				} catch {
					// The complete pair is published; temporary cleanup is best effort.
				}
				file.temporaryWritten = false;
			}
			if (file.backupCreated) {
				try {
					fileSystem.remove(file.backupPath);
				} catch {
					// The complete pair is published; backup cleanup is best effort.
				}
				file.backupCreated = false;
			}
		}
	} catch (error) {
		for (const file of [...files].reverse()) {
			try {
				if (override && file.backupCreated) {
					if (file.published) {
						fileSystem.replace(file.backupPath, file.path);
					}
					fileSystem.remove(file.backupPath);
					file.backupCreated = false;
				} else if (file.published && !file.existed) {
					fileSystem.remove(file.path);
				}
			} catch {
				// Preserve the original publication failure.
			}
			try {
				if (file.temporaryWritten) fileSystem.remove(file.temporaryPath);
			} catch {
				// Preserve the original publication failure.
			}
			try {
				if (file.backupCreated) fileSystem.remove(file.backupPath);
			} catch {
				// Preserve the original publication failure.
			}
		}
		if (!override && errorCode(error) === "EEXIST") {
			throw new FiseError(
				"INVALID_INPUT",
				"FISE CLI: a generated pair destination already exists; use --override to replace the pair.",
				error
			);
		}
		throw new FiseError(
			"INVALID_INPUT",
			"FISE CLI: unable to publish the generated JavaScript/Python profile pair.",
			error
		);
	}
}

function assertVerification(
	verification: ProfileVerification,
	expectedFingerprint: string
): void {
	if (
		!verification ||
		verification.fingerprint !== expectedFingerprint ||
		!Array.isArray(verification.checks) ||
		verification.checks.length === 0 ||
		verification.checks.some(check => typeof check !== "string" || check.length === 0)
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE CLI: generated profile verification returned an invalid result."
		);
	}
}

function profileExists(path: string): FiseError {
	return new FiseError(
		"INVALID_INPUT",
		`FISE CLI: profile '${path}' already exists; use --override to replace it.`
	);
}

function writeFailure(path: string, error: unknown): FiseError {
	return new FiseError(
		"INVALID_INPUT",
		`FISE CLI: unable to write generated profile '${path}'.`,
		error
	);
}

function createIr(entropy: ProfileGeneratorEntropy): ProfileIr {
	const kinds: StageKind[] = ["xor", "add", "rotate", "affine"];
	const extraCount = entropyInteger(entropy, "extraStageCount", 0, 4);
	for (let index = 0; index < extraCount; index++) {
		kinds.push(randomKind(entropy, `extraStageKind.${index}`));
	}
	shuffle(kinds, entropy);
	for (let index = 1; index < kinds.length; index++) {
		if (kinds[index] === kinds[index - 1]) {
			const swap = kinds.findIndex((kind, candidate) => candidate > index && kind !== kinds[index]);
			if (swap > index) [kinds[index], kinds[swap]] = [kinds[swap], kinds[index]];
		}
	}
	const contextSegmentOffset = randomUint32(entropy, "contextSegmentOffset");
	const contextSegmentLength = entropyInteger(entropy, "contextSegmentLength", 12, 33);
	const contextInitial = randomTuple4(entropy, "contextInitial");
	const contextMultipliers = randomOddTuple3(entropy, "contextMultiplier");
	const contextRotation = entropyInteger(entropy, "contextRotation", 5, 28);
	const offsetConstants = randomTuple4(entropy, "offsetConstant");
	const markerConstants = randomTuple4(entropy, "markerConstant");

	return Object.freeze({
		abi: 2,
		contextSegmentOffset,
		contextSegmentLength,
		contextInitial,
		contextMultipliers,
		contextRotation,
		offsetConstants,
		markerConstants,
		stages: Object.freeze(
			kinds.map((kind, index) => createStage(
				kind,
				index,
				contextSegmentLength,
				entropy
			))
		)
	});
}

function createStage(
	kind: StageKind,
	index: number,
	contextSegmentLength: number,
	entropy: ProfileGeneratorEntropy
): Stage {
	const label = `stage.${index}`;
	const multiplier = kind === "affine"
		? randomOddByte(entropy, `${label}.affineMultiplier`)
		: undefined;
	return Object.freeze({
		kind,
		segmentShift: entropyInteger(
			entropy,
			`${label}.segmentShift`,
			0,
			contextSegmentLength
		),
		positionMultiplier: randomOddUint32(entropy, `${label}.positionMultiplier`),
		constant: randomUint32(entropy, `${label}.constant`),
		contextLane: entropyInteger(entropy, `${label}.contextLane`, 0, 4),
		contextLane2: entropyInteger(entropy, `${label}.contextLane2`, 0, 4),
		...(multiplier === undefined
			? {}
			: { multiplier, inverse: inverseModulo256(multiplier) })
	});
}

function validateIr(ir: ProfileIr): boolean {
	const contexts: readonly (readonly [number, number, number, number])[] = [
		[0, 0, 0, 0],
		[1, 2, 3, 4],
		[0xffff_ffff, 0x1020_3040, 0x5566_7788, 0xaabb_ccdd]
	];
	const contextSegments = [
		Uint8Array.from(
			{ length: ir.contextSegmentLength },
			(_, index) => (index * 31 + 7) & 0xff
		),
		Uint8Array.from(
			{ length: ir.contextSegmentLength },
			(_, index) => (index * 17 + 199) & 0xff
		)
	];
	const inputs = [
		new Uint8Array(),
		Uint8Array.of(0),
		Uint8Array.from({ length: 256 }, (_, index) => index),
		Uint8Array.from({ length: 513 }, (_, index) => (index * 73 + 11) & 0xff)
	];

	let changed = false;
	for (let sample = 0; sample < inputs.length; sample++) {
		const input = inputs[sample];
		const contextSegment = contextSegments[sample % contextSegments.length];
		const context = contexts[sample % contexts.length];
		const absoluteOffset = sample * 257;
		const forward = evaluate(
			ir.stages,
			input,
			contextSegment,
			context,
			absoluteOffset,
			false
		);
		const reverse = evaluate(
			ir.stages,
			forward,
			contextSegment,
			context,
			absoluteOffset,
			true
		);
		if (!equalBytes(input, reverse)) return false;
		if (!equalBytes(input, forward)) changed = true;
	}
	if (!changed) return false;

	const signatureInput = Uint8Array.from({ length: 1024 }, (_, index) => (index * 109 + 41) & 0xff);
	const signatureSegment = contextSegments[1];
	const signatureContext = contexts[2];
	const complete = evaluate(
		ir.stages,
		signatureInput,
		signatureSegment,
		signatureContext,
		97,
		false
	);
	for (let index = 0; index < ir.stages.length; index++) {
		const reduced = ir.stages.filter((_, candidate) => candidate !== index);
		if (equalBytes(
			complete,
			evaluate(reduced, signatureInput, signatureSegment, signatureContext, 97, false)
		)) {
			return false;
		}
	}

	for (const length of [0, 1, 2, 255, 65_535, 262_144, 0xffff_ffff]) {
		const offset = evaluateOffset(
			ir,
			length,
			87,
			signatureSegment,
			signatureContext
		);
		if (!Number.isInteger(offset) || offset < 0 || offset > length) return false;
	}
	return true;
}

function evaluate(
	stages: readonly Stage[],
	input: Uint8Array,
	contextSegment: Uint8Array,
	context: readonly [number, number, number, number],
	absoluteOffset: number,
	reverse: boolean
): Uint8Array {
	const output = new Uint8Array(input.length);
	const ordered = reverse ? [...stages].reverse() : stages;
	for (let index = 0; index < input.length; index++) {
		const position = (absoluteOffset + index) >>> 0;
		let value = input[index];
		for (const stage of ordered) {
			const mask = stageMask(stage, position, contextSegment, context);
			if (stage.kind === "xor") value = value ^ mask;
			else if (stage.kind === "add") {
				value = reverse ? (value - mask) & 0xff : (value + mask) & 0xff;
			} else if (stage.kind === "rotate") {
				const shift = (mask & 7) + 1;
				value = reverse ? rotateRight8(value, shift) : rotateLeft8(value, shift);
			} else {
				value = reverse
					? Math.imul((value - mask) & 0xff, stage.inverse!) & 0xff
					: (Math.imul(value, stage.multiplier!) + mask) & 0xff;
			}
		}
		output[index] = value;
	}
	return output;
}

function stageMask(
	stage: Stage,
	position: number,
	contextSegment: Uint8Array,
	context: readonly [number, number, number, number]
): number {
	const segmentByte = contextSegment[
		(position + stage.segmentShift) % contextSegment.length
	];
	const mixed = (
		Math.imul((position ^ context[stage.contextLane]) >>> 0, stage.positionMultiplier) +
		context[stage.contextLane2] +
		stage.constant
	) >>> 0;
	return (segmentByte ^ mixed ^ (mixed >>> 8) ^ (mixed >>> 16) ^ (mixed >>> 24)) & 0xff;
}

function evaluateOffset(
	ir: ProfileIr,
	length: number,
	operationBindingLength: number,
	contextSegment: Uint8Array,
	context: readonly [number, number, number, number]
): number {
	const [a, b, c, d] = ir.offsetConstants;
	let segmentFold = a;
	for (let index = 0; index < contextSegment.length; index++) {
		segmentFold = Math.imul(
			(segmentFold ^ contextSegment[index] ^ index) >>> 0,
			0x045d_9f3b
		) >>> 0;
	}
	const mixed = mix32(
		(
			(length ^ a) +
			Math.imul(operationBindingLength, b) +
			(context[0] ^ c) +
			Math.imul(context[2], d) +
			segmentFold
		) >>> 0
	);
	return mixed % (length + 1);
}

function emitProfile(ir: ProfileIr, fingerprint: string): string {
	const forward = emitKernel(ir.stages, false);
	const reverse = emitKernel([...ir.stages].reverse(), true);
	const [i0, i1, i2, i3] = ir.contextInitial;
	const [cm0, cm1, cm2] = ir.contextMultipliers;
	const [o0, o1, o2, o3] = ir.offsetConstants;
	const [k0, k1, k2, k3] = ir.markerConstants;
	const wasm = compileProfileWasm(ir.stages);
	return `import { Profile } from "fise/profile-runtime";\n\n` +
		`export default Profile.generated(\n` +
		`  "${fingerprint}",\n` +
		`  ${ir.contextSegmentOffset},\n` +
		`  ${ir.contextSegmentLength},\n` +
		`  (b,q)=>{let a=${i0},c=${i1},d=${i2},e=${i3};for(let i=0;i<b.length;i++){const x=b[i];a=Math.imul((a^(x+i))>>>0,${cm0})>>>0;c=Math.imul((c+x+(a>>>16))>>>0,${cm1})>>>0;const y=(d^x^c)>>>0;d=((y<<${ir.contextRotation})|(y>>>${32 - ir.contextRotation}))>>>0;e=Math.imul((e+d+i)>>>0,${cm2})>>>0}return[a,c,d,e]},\n` +
		`  (i,c,s,q)=>{let f=${o0};for(let n=0;n<s.length;n++)f=Math.imul((f^s[n]^n)>>>0,0x45d9f3b)>>>0;let x=((i.transformedLength^${o0})+Math.imul(i.operationBindingLength,${o1})+(c[0]^${o2})+Math.imul(c[2],${o3})+f)>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return((x^(x>>>16))>>>0)%(i.transformedLength+1)},\n` +
		`  (i,c,s,q)=>{let x=((i.transformedLength^${k0})+Math.imul(i.operationBindingLength,${k1})+(c[1]^${k2})+Math.imul(c[3],${k3})+s.length)>>>0;for(let n=0;n<s.length;n++)x=Math.imul((x^s[n]^n)>>>0,0x1000193)>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return(x^(x>>>16))>>>0},\n` +
		`  ${forward},\n` +
		`  ${reverse},\n` +
		`  Uint8Array.of(${Array.from(wasm).join(",")})\n` +
		`);\n`;
}

function emitPythonProfile(ir: ProfileIr, fingerprint: string): string {
	const [i0, i1, i2, i3] = ir.contextInitial;
	const [cm0, cm1, cm2] = ir.contextMultipliers;
	const [o0, o1, o2, o3] = ir.offsetConstants;
	const [k0, k1, k2, k3] = ir.markerConstants;
	return `from fise.profile_runtime import Profile\n\n` +
		`_U=4294967295\n\n` +
		`def _m(b,q):\n` +
		` a,c,d,e=${i0},${i1},${i2},${i3}\n` +
		` for i,x in enumerate(b):\n` +
		`  a=((a^(x+i))*${cm0})&_U\n` +
		`  c=((c+x+(a>>16))*${cm1})&_U\n` +
		`  y=(d^x^c)&_U\n` +
		`  d=((y<<${ir.contextRotation})|(y>>${32 - ir.contextRotation}))&_U\n` +
		`  e=((e+d+i)*${cm2})&_U\n` +
		` return a,c,d,e\n\n` +
		emitPythonLayoutFunction("_o", o0, o1, o2, o3, true) +
		emitPythonLayoutFunction("_k", k0, k1, k2, k3, false) +
		emitPythonKernel("_f", ir.stages, false) +
		emitPythonKernel("_r", [...ir.stages].reverse(), true) +
		`profile=Profile.generated("${fingerprint}",${ir.contextSegmentOffset},${ir.contextSegmentLength},_m,_o,_k,_f,_r)\n` +
		`__all__=("profile",)\n`;
}

function emitPythonLayoutFunction(
	name: string,
	a: number,
	b: number,
	c: number,
	d: number,
	offset: boolean
): string {
	const fold = offset
		? ` f=${a}\n for n,v in enumerate(s):f=((f^v^n)*0x45d9f3b)&_U\n`
		: "";
	const seed = offset
		? `((i.transformed_length^${a})+(i.operation_binding_length*${b})+(c[0]^${c})+(c[2]*${d})+f)&_U`
		: `((i.transformed_length^${a})+(i.operation_binding_length*${b})+(c[1]^${c})+(c[3]*${d})+len(s))&_U`;
	const segmentMix = offset
		? ""
		: ` for n,v in enumerate(s):x=((x^v^n)*0x1000193)&_U\n`;
	const result = offset ? `(x^(x>>16))%(i.transformed_length+1)` : `(x^(x>>16))&_U`;
	return `def ${name}(i,c,s,q):\n` + fold +
		` x=${seed}\n` +
		segmentMix +
		` x^=x>>16\n` +
		` x=(x*0x7feb352d)&_U\n` +
		` x^=x>>15\n` +
		` x=(x*0x846ca68b)&_U\n` +
		` return ${result}\n\n`;
}

function emitPythonKernel(
	name: string,
	stages: readonly Stage[],
	reverse: boolean
): string {
	const lines = [
		`def ${name}(b,s,c,z,q):`,
		` o=bytearray(len(b))`,
		` for i,v in enumerate(b):`,
		`  p=(z+i)&_U`,
		`  x=v`
	];
	for (let index = 0; index < stages.length; index++) {
		const stage = stages[index];
		lines.push(
			`  w=((p^c[${stage.contextLane}])*${stage.positionMultiplier}+c[${stage.contextLane2}]+${stage.constant})&_U`,
			`  k=(s[(p+${stage.segmentShift})%len(s)]^w^(w>>8)^(w>>16)^(w>>24))&255`
		);
		if (stage.kind === "xor") lines.push(`  x^=k`);
		else if (stage.kind === "add") lines.push(reverse ? `  x=(x-k)&255` : `  x=(x+k)&255`);
		else if (stage.kind === "rotate") {
			lines.push(
				`  r=(k&7)+1`,
				reverse
					? `  x=((x>>r)|(x<<(8-r)))&255`
					: `  x=((x<<r)|(x>>(8-r)))&255`
			);
		} else {
			lines.push(
				reverse
					? `  x=((x-k)*${stage.inverse})&255`
					: `  x=(x*${stage.multiplier}+k)&255`
			);
		}
	}
	lines.push(`  o[i]=x`, ` return bytes(o)`, "");
	return `${lines.join("\n")}\n`;
}

function emitKernel(stages: readonly Stage[], reverse: boolean): string {
	const lines = [
		`(b,s,c,z,q)=>{const o=new Uint8Array(b.length);for(let i=0;i<b.length;i++){const p=(z+i)>>>0;let x=b[i];`
	];
	for (let index = 0; index < stages.length; index++) {
		const stage = stages[index];
		const maskName = `k${index}`;
		const mixedName = `w${index}`;
		lines.push(
			`const ${mixedName}=(Math.imul((p^c[${stage.contextLane}])>>>0,${stage.positionMultiplier})+c[${stage.contextLane2}]+${stage.constant})>>>0;const ${maskName}=(s[(p+${stage.segmentShift})%s.length]^${mixedName}^(${mixedName}>>>8)^(${mixedName}>>>16)^(${mixedName}>>>24))&255;`
		);
		if (stage.kind === "xor") lines.push(`x^=${maskName};`);
		else if (stage.kind === "add") {
			lines.push(reverse ? `x=(x-${maskName})&255;` : `x=(x+${maskName})&255;`);
		} else if (stage.kind === "rotate") {
			const rotationName = `r${index}`;
			lines.push(
				`const ${rotationName}=(${maskName}&7)+1;` +
				(reverse
					? `x=((x>>>${rotationName})|(x<<(8-${rotationName})))&255;`
					: `x=((x<<${rotationName})|(x>>>(8-${rotationName})))&255;`)
			);
		} else {
			lines.push(
				reverse
					? `x=Math.imul((x-${maskName})&255,${stage.inverse})&255;`
					: `x=(Math.imul(x,${stage.multiplier})+${maskName})&255;`
			);
		}
	}
	lines.push(`o[i]=x}return o}`);
	return lines.join("");
}

function mix32(value: number): number {
	value ^= value >>> 16;
	value = Math.imul(value, 0x7feb_352d);
	value ^= value >>> 15;
	value = Math.imul(value, 0x846c_a68b);
	return (value ^ (value >>> 16)) >>> 0;
}

function rotateLeft8(value: number, shift: number): number {
	return ((value << shift) | (value >>> (8 - shift))) & 0xff;
}

function rotateRight8(value: number, shift: number): number {
	return ((value >>> shift) | (value << (8 - shift))) & 0xff;
}

function inverseModulo256(value: number): number {
	for (let candidate = 1; candidate < 256; candidate += 2) {
		if ((value * candidate) % 256 === 1) return candidate;
	}
	throw new FiseError("INVALID_PROFILE", "FISE: affine byte multiplier has no inverse.");
}

function randomKind(entropy: ProfileGeneratorEntropy, label: string): StageKind {
	return (["xor", "add", "rotate", "affine"] as const)[
		entropyInteger(entropy, label, 0, 4)
	];
}

function randomOddByte(entropy: ProfileGeneratorEntropy, label: string): number {
	return entropyInteger(entropy, label, 1, 128) * 2 - 1;
}

function randomOddUint32(entropy: ProfileGeneratorEntropy, label: string): number {
	return (randomUint32(entropy, label) | 1) >>> 0;
}

function randomUint32(entropy: ProfileGeneratorEntropy, label: string): number {
	const bytes = entropyBytes(entropy, label, 4);
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
}

function randomTuple4(
	entropy: ProfileGeneratorEntropy,
	label: string
): readonly [number, number, number, number] {
	return Object.freeze([
		randomUint32(entropy, `${label}.0`),
		randomUint32(entropy, `${label}.1`),
		randomUint32(entropy, `${label}.2`),
		randomUint32(entropy, `${label}.3`)
	]);
}

function randomOddTuple3(
	entropy: ProfileGeneratorEntropy,
	label: string
): readonly [number, number, number] {
	return Object.freeze([
		randomOddUint32(entropy, `${label}.0`),
		randomOddUint32(entropy, `${label}.1`),
		randomOddUint32(entropy, `${label}.2`)
	]);
}

function shuffle<T>(values: T[], entropy: ProfileGeneratorEntropy): void {
	for (let index = values.length - 1; index > 0; index--) {
		const selected = entropyInteger(entropy, `shuffle.${index}`, 0, index + 1);
		[values[index], values[selected]] = [values[selected], values[index]];
	}
}

function entropyInteger(
	entropy: ProfileGeneratorEntropy,
	label: string,
	minimumInclusive: number,
	maximumExclusive: number
): number {
	let value: number;
	try {
		value = entropy.integer(label, minimumInclusive, maximumExclusive);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError("RANDOM_UNAVAILABLE", "FISE: profile entropy generation failed.", error);
	}
	if (
		!Number.isSafeInteger(value) ||
		value < minimumInclusive ||
		value >= maximumExclusive
	) {
		throw new FiseError(
			"RANDOM_UNAVAILABLE",
			"FISE: profile entropy returned an integer outside the requested range."
		);
	}
	return value;
}

function entropyBytes(
	entropy: ProfileGeneratorEntropy,
	label: string,
	length: number
): Uint8Array {
	let value: Uint8Array;
	try {
		value = entropy.bytes(label, length);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError("RANDOM_UNAVAILABLE", "FISE: profile entropy generation failed.", error);
	}
	if (!(value instanceof Uint8Array) || value.length !== length) {
		throw new FiseError(
			"RANDOM_UNAVAILABLE",
			"FISE: profile entropy returned an invalid byte sequence."
		);
	}
	return value;
}

function bytesToHex(bytes: Uint8Array): string {
	let output = "";
	for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
	return output;
}

function errorCode(error: unknown): unknown {
	return error && typeof error === "object" && "code" in error
		? error.code
		: undefined;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}
