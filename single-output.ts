import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Check whether a resolved absolute path is contained within at least one of
 * the provided root directories.  Prevents callers from writing output files
 * to arbitrary filesystem locations (e.g. ~/.ssh or /etc) when an
 * attacker-controlled absolute path is supplied as the `output` parameter.
 */
export function isOutputPathSafe(resolvedAbsPath: string, allowedRoots: string[]): boolean {
	return allowedRoots.some((root) => {
		const normalizedRoot = path.resolve(root) + path.sep;
		return resolvedAbsPath.startsWith(normalizedRoot);
	});
}

export function resolveSingleOutputPath(
	output: string | false | undefined,
	runtimeCwd: string,
	requestedCwd?: string,
	allowedRoots?: string[],
): string | undefined {
	if (typeof output !== "string" || !output) return undefined;
	const baseCwd = requestedCwd
		? (path.isAbsolute(requestedCwd) ? requestedCwd : path.resolve(runtimeCwd, requestedCwd))
		: runtimeCwd;
	const resolved = path.isAbsolute(output) ? output : path.resolve(baseCwd, output);
	// If allowed roots were supplied, validate the resolved path is within them.
	// This is opt-in so callers can restrict LLM-supplied absolute paths without
	// breaking agent configs that legitimately point outside the working directory.
	if (allowedRoots && allowedRoots.length > 0 && !isOutputPathSafe(resolved, allowedRoots)) {
		throw new Error(
			`Output path "${resolved}" is outside allowed directories. ` +
			`Allowed roots: ${allowedRoots.map((r) => path.resolve(r)).join(", ")}`
		);
	}
	return resolved;
}

export function injectSingleOutputInstruction(task: string, outputPath: string | undefined): string {
	if (!outputPath) return task;
	return `${task}\n\n---\n**Output:** Write your findings to: ${outputPath}`;
}

export function persistSingleOutput(
	outputPath: string | undefined,
	fullOutput: string,
): { savedPath?: string; error?: string } {
	if (!outputPath) return {};
	try {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, fullOutput, "utf-8");
		return { savedPath: outputPath };
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

export function finalizeSingleOutput(params: {
	fullOutput: string;
	truncatedOutput?: string;
	outputPath?: string;
	exitCode: number;
}): { displayOutput: string; savedPath?: string; saveError?: string } {
	let displayOutput = params.truncatedOutput || params.fullOutput;
	if (params.outputPath && params.exitCode === 0) {
		const save = persistSingleOutput(params.outputPath, params.fullOutput);
		if (save.savedPath) {
			displayOutput += `\n\n📄 Output saved to: ${save.savedPath}`;
			return { displayOutput, savedPath: save.savedPath };
		}
		if (save.error) {
			displayOutput += `\n\n⚠️ Failed to save output to: ${params.outputPath}\n${save.error}`;
			return { displayOutput, saveError: save.error };
		}
	}
	return { displayOutput };
}
