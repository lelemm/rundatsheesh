import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Computes a version string for snapshot artifacts based on immutable inputs.
 * This is intentionally content-based so that rebuilding the guest image forces
 * a new snapshot version.
 */
export async function computeSnapshotVersion(input: { kernelPath: string; baseRootfsPath: string }): Promise<string> {
  const [kernelHash, rootfsHash] = await Promise.all([sha256File(input.kernelPath), sha256File(input.baseRootfsPath)]);
  const combined = createHash("sha256").update(kernelHash).update(rootfsHash).digest("hex");
  // Shorten for filesystem paths / readability while retaining plenty of entropy.
  return combined.slice(0, 32);
}

