// Roots — permission system for file access.
// The client tells us which directories we're allowed to write to.
// We call server.listRoots() and check paths against that list.
// The SDK does NOT enforce this — it's advisory, and we implement the check.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Ask the client for its list of allowed roots, then check whether
 * `targetPath` falls inside one of them.
 *
 * Returns `{ allowed: true, root }` when the path is within an allowed root,
 * or `{ allowed: false, roots, reason }` explaining why it was denied.
 */
export async function isPathAllowed(
  server: Server,
  targetPath: string,
): Promise<
  | { allowed: true; root: string }
  | { allowed: false; roots: string[]; reason: string }
> {
  // 1. Ask the client for roots
  let rootUris: string[];
  try {
    const result = await server.listRoots();
    rootUris = result.roots.map((r) => r.uri);
  } catch {
    // Client doesn't support roots — deny by default.
    // This is the safe choice: if we can't verify permissions, don't write.
    return {
      allowed: false,
      roots: [],
      reason: "The client does not support roots. Cannot verify write permissions.",
    };
  }

  // 2. No roots declared — client supports the protocol but gave us nothing
  if (rootUris.length === 0) {
    return {
      allowed: false,
      roots: [],
      reason: "No allowed directories configured. Ask the client to set roots before exporting.",
    };
  }

  // 3. Convert file:// URIs to OS paths and normalize
  const rootPaths = rootUris
    .filter((uri) => uri.startsWith("file://"))
    .map((uri) => path.resolve(fileURLToPath(uri)));

  if (rootPaths.length === 0) {
    return {
      allowed: false,
      roots: [],
      reason: "No file:// roots found. Only local file paths are supported for export.",
    };
  }

  // 4. Resolve and normalize the target path, then check containment
  const resolved = path.resolve(targetPath);

  for (const root of rootPaths) {
    // resolved must start with root + separator (or equal root exactly).
    // This prevents "/allowed-dir-extra" from matching "/allowed-dir".
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      return { allowed: true, root };
    }
  }

  return {
    allowed: false,
    roots: rootPaths,
    reason: `Path "${resolved}" is not within any allowed directory.`,
  };
}
