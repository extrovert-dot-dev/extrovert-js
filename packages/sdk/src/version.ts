/**
 * Dated API version pin (redesign §5.4).
 *
 * The Extrovert API is versioned by a dated `Extrovert-Version` request header. A
 * request that omits the header is served the latest version; a pinned older
 * version is transformed to the current shape by a server-side shim. The SDK pins
 * {@link CURRENT_API_VERSION} on every request by default so an app's behavior is
 * stable across server deploys; override it per client via
 * `new Extrovert({ apiVersion: "YYYY-MM-DD" })`.
 */

/** The dated API version this SDK was built against. Sent as `Extrovert-Version`. */
export const CURRENT_API_VERSION = "2026-06-23";

/** The HTTP header carrying the dated API version (request + echoed on the response). */
export const API_VERSION_HEADER = "Extrovert-Version";
