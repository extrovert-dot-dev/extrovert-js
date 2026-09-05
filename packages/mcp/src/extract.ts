/**
 * OTP code + verification-link extraction.
 *
 * Handles general transactional and agentic mail (sign-in codes, magic links,
 * "verify your email" buttons). This is the structured payload `wait_for_email`
 * returns alongside the matched message (spec §6).
 */

/** Strip HTML tags so code/link patterns aren't split across markup. */
function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

/** Collapse runs of whitespace to single spaces. */
function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Labelled-code patterns, tried in order. Mirrors the Go `OTP:` heuristic but
 * widened to the phrasings real providers use. The capture group is the code.
 */
const LABELLED_CODE_PATTERNS: RegExp[] = [
  /(?:one[-\s]?time\s+(?:pass)?code|verification\s+code|security\s+code|login\s+code|sign[-\s]?in\s+code|access\s+code|confirmation\s+code|auth(?:entication)?\s+code|your\s+code|OTP|2FA|PIN)\s*(?:is|:|=|->)?\s*[\s>]*([A-Z0-9][A-Z0-9-]{3,11}[A-Z0-9])/i,
  /\bcode\b[^A-Za-z0-9]{0,6}([0-9]{4,8})\b/i,
];

/** Bare numeric codes, used only as a fallback when no label is present. */
const BARE_NUMERIC_PATTERN = /\b(\d{4,8})\b/;

/**
 * Extract a one-time code. Returns the normalized code (alphanumeric, optional
 * internal hyphens stripped) or undefined. Length-bounded 4–12 like the Go port.
 */
export function extractOtpCode(rawBody: string): string | undefined {
  const text = normalizeWhitespace(stripTags(rawBody));

  for (const pattern of LABELLED_CODE_PATTERNS) {
    const m = pattern.exec(text);
    if (m && m[1]) {
      const cleaned = cleanCode(m[1]);
      if (cleaned.length >= 4 && cleaned.length <= 12) return cleaned;
    }
  }

  // Fallback: a standalone 4–8 digit number near a verby hint, to avoid
  // matching arbitrary numbers (prices, dates) in marketing mail.
  if (/\b(verify|confirm|sign[-\s]?in|log[-\s]?in|authenticate|code|otp)\b/i.test(text)) {
    const m = BARE_NUMERIC_PATTERN.exec(text);
    if (m && m[1]) return cleanCode(m[1]);
  }

  return undefined;
}

/** Keep only alphanumerics - drops surrounding markup/punctuation. */
function cleanCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "");
}

/** Words that strongly signal a "click to verify / confirm" action link. */
const VERIFY_HINT = /(verify|confirm|activate|magic|sign[-_]?in|login|authenticate|reset|unlock|click)/i;

/** Match href="..." (Go `hrefRe`) and bare URLs. */
const HREF_PATTERN = /href\s*=\s*["']([^"']+)["']/gi;
const BARE_URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)]+/gi;

/**
 * Extract a verification / click-through link. Prefers an href whose URL or
 * surrounding anchor text hints at verification (mirrors the Go preference for
 * the specific click URL over the first href), then falls back to the first
 * https URL in the body.
 */
export function extractVerificationLink(rawBody: string, linkHint?: string): string | undefined {
  const hrefs: string[] = [];
  for (const m of rawBody.matchAll(HREF_PATTERN)) {
    if (m[1]) hrefs.push(m[1].trim());
  }

  // Match the Go API's link_hint extension: it is a preference, not a filter.
  // If no link contains the hint, continue through the ordinary heuristics.
  const normalizedHint = linkHint?.trim().toLowerCase();
  if (normalizedHint) {
    const hintedHref = hrefs.find((u) => decodeEntities(u).toLowerCase().includes(normalizedHint));
    if (hintedHref) return decodeEntities(hintedHref);
    const hintedBare = rawBody
      .match(BARE_URL_PATTERN)
      ?.find((u) => decodeEntities(u).toLowerCase().includes(normalizedHint));
    if (hintedBare) return decodeEntities(hintedBare);
  }

  // 1) Prefer hrefs whose URL itself looks like a verification link.
  const byUrlHint = hrefs.find((u) => VERIFY_HINT.test(u));
  if (byUrlHint) return decodeEntities(byUrlHint);

  // 2) Prefer an href whose anchor text hints verification.
  const anchorHint = findHrefByAnchorText(rawBody);
  if (anchorHint) return decodeEntities(anchorHint);

  // 3) First href at all.
  if (hrefs[0]) return decodeEntities(hrefs[0]);

  // 4) Bare URL fallback (plain-text emails).
  const bare = rawBody.match(BARE_URL_PATTERN);
  const hinted = bare?.find((u) => VERIFY_HINT.test(u));
  if (hinted) return decodeEntities(hinted);
  if (bare && bare[0]) return decodeEntities(bare[0]);

  return undefined;
}

const ANCHOR_PATTERN = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;

function findHrefByAnchorText(html: string): string | undefined {
  for (const m of html.matchAll(ANCHOR_PATTERN)) {
    const href = m[1];
    const text = m[2] ? stripTags(m[2]) : "";
    if (href && VERIFY_HINT.test(text)) return href.trim();
  }
  return undefined;
}

/** Decode the handful of HTML entities that appear inside URLs. */
function decodeEntities(url: string): string {
  return url
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x26;/gi, "&");
}

/** Convenience: extract both signals from a message body in one pass. */
export function extractSignals(rawBody: string, linkHint?: string): {
  otp_code?: string;
  verification_link?: string;
} {
  const result: { otp_code?: string; verification_link?: string } = {};
  const otp = extractOtpCode(rawBody);
  if (otp) result.otp_code = otp;
  const link = extractVerificationLink(rawBody, linkHint);
  if (link) result.verification_link = link;
  return result;
}
