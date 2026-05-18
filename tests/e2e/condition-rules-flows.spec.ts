import { test, expect } from "@playwright/test";
import { TEST_USER, BOOKING_PREFERENCES } from "../fixtures/test-data";
import { runConditionFlow } from "../helpers/run-flow";
import { ConditionsListingPage } from "../page-objects/ConditionsListingPage";
import type { FlowConfig } from "../fixtures/flow-configs";

/**
 * Condition-rules-driven flows.
 *
 * Each scenario pins a specific questionnaire rule set (defined in
 * tests/page-objects/ConditionQuestionnaireRules.ts) so the same condition
 * can be exercised under both NHS and Private journeys, and so multiple
 * rule-driven conditions can run side-by-side.
 *
 * The spec scrapes /conditions, applies the requested NHS/Private filter,
 * keeps only conditions whose slug/title matches `conditionPattern`, then
 * runs the flow against each match until one succeeds (or all fail).
 */

interface ConditionRulesScenario {
  id: string;
  label: string;
  /** Filter to apply on /conditions. Omit for lifestyle (no NHS/Private filter on /lifestyle-treatments). */
  serviceFilter?: "NHS" | "Private";
  /** Regex matched against the condition href + visible text. */
  conditionPattern: RegExp;
  /** Drives cookie/path setup and dynamic-vs-static signup branching. */
  conditionJourneyType: "nhs" | "private" | "lifestyle";
  /** Override key passed to QuestionnairePage.answerByConditionRules (via env var). */
  questionnaireRulesKey: "shingles" | "weight management" | "erectile-dysfunction";
  booking: FlowConfig["booking"];
  paymentMethod: FlowConfig["paymentMethod"];
}

const SCENARIOS: ConditionRulesScenario[] = [
  {
    id: "CR1",
    label: "Shingles — NHS",
    serviceFilter: "NHS",
    conditionPattern: /shingles/i,
    conditionJourneyType: "nhs",
    questionnaireRulesKey: "shingles",
    booking: {
      appointmentType: BOOKING_PREFERENCES.appointmentType,
      useNextAvailableSlot: true,
      autoMoveToNextDate: true,
      maxDateAttempts: 10,
    },
    paymentMethod: "auto",
  },
  {
    id: "CR2",
    label: "Shingles — Private",
    serviceFilter: "Private",
    conditionPattern: /shingles/i,
    conditionJourneyType: "private",
    questionnaireRulesKey: "shingles",
    booking: {
      appointmentType: BOOKING_PREFERENCES.appointmentType,
      useNextAvailableSlot: true,
      autoMoveToNextDate: true,
      maxDateAttempts: 10,
    },
    paymentMethod: "auto",
  },
  {
    id: "CR3",
    label: "Weight management — Private",
    serviceFilter: "Private",
    conditionPattern: /weight[\s-]?management|weight[\s-]?loss/i,
    conditionJourneyType: "private",
    questionnaireRulesKey: "weight management",
    booking: {
      appointmentType: BOOKING_PREFERENCES.appointmentType,
      useNextAvailableSlot: true,
      autoMoveToNextDate: true,
      maxDateAttempts: 10,
    },
    paymentMethod: "auto",
  },
  {
    id: "CR4",
    label: "Erectile dysfunction — Lifestyle (Private)",
    // No serviceFilter — /lifestyle-treatments listing is implicitly private.
    conditionPattern: /erectile[\s-]?dysfunction|\bED\b/i,
    conditionJourneyType: "lifestyle",
    questionnaireRulesKey: "erectile-dysfunction",
    booking: {
      appointmentType: BOOKING_PREFERENCES.appointmentType,
      useNextAvailableSlot: true,
      autoMoveToNextDate: true,
      maxDateAttempts: 10,
    },
    paymentMethod: "auto",
  },
];

function nameFromHref(href: string): string {
  const parts = href.replace(/^\//, "").split("/").filter(Boolean);
  const slug = parts[parts.length - 1] ?? href;
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * True when the failure means the chosen condition can't satisfy this scenario —
 * so we should retry with the next matching condition.
 */
function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /not found on \/conditions/i.test(msg) ||
    /Condition detail page did not reach a ready state/i.test(msg) ||
    /Appointment type .* not available/i.test(msg) ||
    /Select next available slot.*not found/i.test(msg) ||
    /No available slots found via random strategy/i.test(msg) ||
    /No available time slots found/i.test(msg) ||
    /not found after .* attempts/i.test(msg) ||
    /Date .* not found/i.test(msg) ||
    /Flow reached a dead-end/i.test(msg)
  );
}

async function collectMatchingHrefs(
  listing: ConditionsListingPage,
  pattern: RegExp,
): Promise<string[]> {
  const cards = listing.getConditionCards();
  const count = await cards.count();
  const seen = new Set<string>();
  const matches: string[] = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const href = await card.getAttribute("href");
    if (!href || seen.has(href)) continue;
    const text = (await card.innerText().catch(() => "")) || "";
    if (pattern.test(href) || pattern.test(text)) {
      seen.add(href);
      matches.push(href);
    }
  }

  // Fisher-Yates shuffle so retries hit different conditions across runs.
  for (let i = matches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matches[i], matches[j]] = [matches[j], matches[i]];
  }
  return matches;
}

async function collectLifestyleHrefs(
  page: import("@playwright/test").Page,
  pattern: RegExp,
): Promise<string[]> {
  // Lifestyle cards on /lifestyle-treatments link to /conditions/{slug}#productSection.
  const links = page.locator(
    'a[href*="/conditions/"][href*="#productSection"]',
  );
  const count = await links.count();
  const seen = new Set<string>();
  const matches: string[] = [];

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const href = await link.getAttribute("href");
    if (!href || seen.has(href)) continue;
    const text = (await link.innerText().catch(() => "")) || "";
    if (pattern.test(href) || pattern.test(text)) {
      seen.add(href);
      matches.push(href);
    }
  }

  for (let i = matches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matches[i], matches[j]] = [matches[j], matches[i]];
  }
  return matches;
}

test.describe("Condition Rules Flows", () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.id}: ${scenario.label}`, async ({ page, baseURL }) => {
      page.on("pageerror", (err) =>
        console.log(`[page error] ${err.message}`),
      );
      page.on("response", (res) => {
        if (res.status() >= 400) {
          console.log(`[HTTP ${res.status()}] ${res.url()}`);
        }
      });

      const listing = new ConditionsListingPage(page);
      const isLifestyle = scenario.conditionJourneyType === "lifestyle";

      let matches: string[] = [];

      await test.step(
        `${isLifestyle ? "Scrape /lifestyle-treatments" : "Filter /conditions by " + scenario.serviceFilter} and find "${scenario.conditionPattern}"`,
        async () => {
          if (isLifestyle) {
            await page.goto("/lifestyle-treatments");
            await page
              .locator(
                'button:has-text("Accept All"), button:has-text("Accept Cookies"), button:has-text("Accept")',
              )
              .first()
              .click({ timeout: 4000 })
              .catch(() => {});
            await page
              .locator('a[href*="/conditions/"][href*="#productSection"]')
              .first()
              .waitFor({ state: "visible", timeout: 20_000 });

            matches = await collectLifestyleHrefs(page, scenario.conditionPattern);
            console.log(
              `📋 Found ${matches.length} lifestyle match(es) for ${scenario.conditionPattern}`,
            );
            return;
          }

          await listing.goto();
          await listing.waitForPageLoad();

          if (scenario.serviceFilter) {
            try {
              await listing.selectServiceFilter(scenario.serviceFilter);
              console.log(`✔ Applied ${scenario.serviceFilter} filter`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.log(
                `⚠ Could not apply ${scenario.serviceFilter} filter (${msg.split("\n")[0]}) — falling back to unfiltered listing`,
              );
            }
            // Re-wait — filter may re-render the list.
            await listing.waitForPageLoad().catch(() => {});
          }

          matches = await collectMatchingHrefs(listing, scenario.conditionPattern);
          console.log(
            `📋 Found ${matches.length} match(es) for ${scenario.conditionPattern}${scenario.serviceFilter ? " under " + scenario.serviceFilter : ""}`,
          );
        },
      );

      expect(
        matches.length,
        `No conditions match ${scenario.conditionPattern}${scenario.serviceFilter ? " under " + scenario.serviceFilter + " filter" : ""} for this pharmacy`,
      ).toBeGreaterThan(0);

      // Try each matching condition until one runs end-to-end.
      const attempts: { href: string; error: string }[] = [];
      let succeeded = false;

      for (let i = 0; i < matches.length; i++) {
        const href = matches[i];
        const flowConfig: FlowConfig = {
          name: `${scenario.id} — ${scenario.label}`,
          conditionJourneyType: scenario.conditionJourneyType,
          conditionName: nameFromHref(href),
          conditionHref: href,
          questionnaireRulesKey: scenario.questionnaireRulesKey,
          booking: scenario.booking,
          paymentMethod: scenario.paymentMethod,
        };

        console.log(
          `▶ Attempt ${i + 1}/${matches.length}: ${scenario.id} with "${flowConfig.conditionName}" (${href})`,
        );

        try {
          await runConditionFlow(page, flowConfig, TEST_USER, baseURL);
          succeeded = true;
          console.log(
            `✔ Completed ${scenario.id} using "${flowConfig.conditionName}"`,
          );
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (isRetryableError(err) && i < matches.length - 1) {
            attempts.push({ href, error: msg });
            console.log(
              `↻ "${flowConfig.conditionName}" can't satisfy ${scenario.id} (${msg.split("\n")[0]}) — trying next match`,
            );
            await page.context().clearCookies().catch(() => {});
            continue;
          }
          throw err;
        }
      }

      if (!succeeded) {
        throw new Error(
          `All ${matches.length} matching condition(s) failed scenario ${scenario.id}. Attempts: ${attempts
            .map((a) => `"${a.href}" (${a.error.split("\n")[0]})`)
            .join("; ")}`,
        );
      }
    });
  }
});
