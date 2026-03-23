import { chromium } from "playwright";

export class LinkedInAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkedInAuthError";
  }
}

export type LinkedInCandidate = {
  full_name: string;
  headline: string | null;
  location: string | null;
  profile_url: string;
  current_company: string | null;
  current_title: string | null;
};

export async function scrapeLinkedIn(
  credentials: { email: string; password: string },
  search: {
    title: string;
    location?: string | null;
    keywords: string[];
    limit: number;
  }
): Promise<LinkedInCandidate[]> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // ── Login ──────────────────────────────────────────────────────────────────
    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });
    await page.fill("#username", credentials.email);
    await page.fill("#password", credentials.password);
    await page.click('[data-id="sign-in-form__submit-btn"], button[type="submit"]');

    // Wait for redirect away from login page
    try {
      await page.waitForURL((url) => !url.href.includes("/login"), { timeout: 15000 });
    } catch {
      throw new LinkedInAuthError("Invalid credentials or login page did not redirect.");
    }

    // Check for security challenge
    if (page.url().includes("/checkpoint") || page.url().includes("/challenge")) {
      throw new LinkedInAuthError(
        "LinkedIn requires a security verification. Please log in manually once to clear the checkpoint."
      );
    }

    // ── Search ─────────────────────────────────────────────────────────────────
    const queryParts = [search.title];
    if (search.location) queryParts.push(search.location);
    if (search.keywords.length > 0) queryParts.push(search.keywords.slice(0, 3).join(" "));

    const query = encodeURIComponent(queryParts.join(" "));
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${query}&origin=GLOBAL_SEARCH_HEADER`;

    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    // Wait for results
    try {
      await page.waitForSelector(".reusable-search__result-container", { timeout: 20000 });
    } catch {
      // No results found — return empty list rather than erroring
      return [];
    }

    // ── Extract ────────────────────────────────────────────────────────────────
    const candidates = await page.evaluate((limit: number) => {
      const cards = Array.from(
        document.querySelectorAll(".reusable-search__result-container")
      ).slice(0, limit);

      return cards.map((card) => {
        const nameEl = card.querySelector(
          '.entity-result__title-text a span[aria-hidden="true"]'
        );
        const headlineEl = card.querySelector(".entity-result__primary-subtitle");
        const locationEl = card.querySelector(".entity-result__secondary-subtitle");
        const linkEl = card.querySelector<HTMLAnchorElement>(
          'a.app-aware-link[href*="/in/"]'
        );

        const rawHref = linkEl?.href ?? "";
        // Strip query params from profile URL
        const profileUrl = rawHref.split("?")[0] ?? rawHref;

        return {
          full_name: nameEl?.textContent?.trim() ?? "",
          headline: headlineEl?.textContent?.trim() ?? null,
          location: locationEl?.textContent?.trim() ?? null,
          profile_url: profileUrl,
          current_company: null,
          current_title: null,
        };
      });
    }, search.limit);

    // Filter out any cards where we couldn't extract a name or URL
    return candidates.filter((c) => c.full_name && c.profile_url);
  } finally {
    await browser.close();
  }
}
