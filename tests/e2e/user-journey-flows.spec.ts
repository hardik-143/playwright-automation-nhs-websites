import { test, expect, Page } from "@playwright/test";
import { TEST_USER, BOOKING_PREFERENCES } from "../fixtures/test-data";
import { JOURNEY_FLOWS } from "../fixtures/journey-flows";
import { PHARMACY_SITES } from "../fixtures/pharmacies";
import {
  fetchConditions,
  getMatchingConditions,
  type SanityCondition,
} from "../helpers/sanity-client";
import { runConditionFlow } from "../helpers/run-flow";
import type { FlowConfig } from "../fixtures/flow-configs";

function projectIdFor(pharmacyName: string): string {
  const site = PHARMACY_SITES.find((p) => p.name === pharmacyName);
  return site?.sanityProjectId ?? "";
}

function buildFlowConfig(
  flowId: string,
  condition: SanityCondition,
): FlowConfig {
  // Query is filtered to categoryType == 'pre_consult' only, so every condition
  // is a pre-consult condition. Journey type is determined by NHS flag alone.
  /** @future-lifestyle: when lifestyle conditions are re-enabled, restore this:
   * condition.isPreConsult === false ? "lifestyle" : condition.isNHS === true ? "nhs" : "private"
   */
  const conditionJourneyType: "nhs" | "private" =
    condition.isNHS === true ? "nhs" : "private";

  return {
    name: `User Journey ${flowId}`,
    conditionJourneyType,
    conditionName: condition.title,
    booking: {
      appointmentType: BOOKING_PREFERENCES.appointmentType,
      useNextAvailableSlot: true,
      autoMoveToNextDate: true,
      maxDateAttempts: 10,
    },
    paymentMethod: "auto",
  };
}

/**
 * Returns true if the error means this condition should be skipped and another
 * tried (condition not on /conditions page, self-care dead-end, etc.).
 */
function isConditionNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /not found on \/conditions/i.test(msg) ||
    /** @future-lifestyle: re-enable when lifestyle conditions are queried again.
     * /not found on \/lifestyle-treatments/i.test(msg) || */
    /Flow reached a dead-end/i.test(msg) ||
    /Condition detail page did not reach a ready state/i.test(msg) ||
    /Appointment type .* not available/i.test(msg) ||
    /Select next available slot.*not found/i.test(msg) ||
    /No available slots found/i.test(msg) ||
    /No available time slots found/i.test(msg)
  );
}

test.describe("User Journey Flows", () => {
  for (const flow of JOURNEY_FLOWS) {
    test(`${flow.id}: ${flow.label}`, async ({ page, baseURL }, testInfo) => {
      page.on("pageerror", (err) =>
        console.log(`[page error] ${err.message}`),
      );
      page.on("response", (res) => {
        if (res.status() >= 400) {
          console.log(`[HTTP ${res.status()}] ${res.url()}`);
        }
      });

      const pharmacyName = testInfo.project.name;
      const projectId = projectIdFor(pharmacyName);
      test.skip(
        !projectId,
        `No sanityProjectId set for "${pharmacyName}" — add it in tests/fixtures/pharmacies.ts`,
      );

      // ─── Step 1: Fetch all conditions from Sanity for this flow ─────────
      let conditions: SanityCondition[] = [];
      await test.step(`Fetch conditions from Sanity (project=${projectId}) for ${flow.id}`, async () => {
        const allConditions = await fetchConditions(projectId);
        console.log(
          `📥 Sanity returned ${allConditions.length} active condition(s) for project ${projectId}`,
        );
        conditions = getMatchingConditions(allConditions, flow.pattern);
        if (conditions.length === 0) {
          throw new Error(
            `No conditions match flow "${flow.id} — ${flow.label}" (${flow.pattern.join(" → ")}) on pharmacy "${pharmacyName}"`,
          );
        }
        console.log(
          `🎯 ${conditions.length} matching condition(s) for ${flow.id}: ${conditions
            .map((c) => `"${c.title}"`)
            .join(", ")}`,
        );
      });
      expect(conditions.length, "must have at least one matching condition").toBeGreaterThan(0);

      // ─── Step 2: Try each condition until one is visible on /conditions ─
      const attempts: { title: string; error: string }[] = [];
      let succeeded = false;
      let usedCondition: SanityCondition | undefined;

      for (let i = 0; i < conditions.length; i++) {
        const condition = conditions[i];
        const flowConfig = buildFlowConfig(flow.id, condition);
        console.log(
          `▶ Attempt ${i + 1}/${conditions.length}: ${flow.id} on ${pharmacyName} with "${condition.title}" (id=${condition.conditionId}, journeyType=${flowConfig.conditionJourneyType})`,
        );

        try {
          await runConditionFlow(page, flowConfig, TEST_USER, baseURL);
          usedCondition = condition;
          succeeded = true;
          break;
        } catch (err) {
          if (isConditionNotFoundError(err) && i < conditions.length - 1) {
            const msg = err instanceof Error ? err.message : String(err);
            attempts.push({ title: condition.title, error: msg });
            const reason = /dead-end/i.test(msg)
              ? "dead-end (self-care/referral)"
              /** @future-lifestyle: re-enable when lifestyle conditions are queried again.
               * : /lifestyle-treatments/i.test(msg) ? "not on /lifestyle-treatments" */
              : /ready state/i.test(msg)
                ? "detail page didn't load (wrong UI or app error)"
                : "not on /conditions";
            const detail = msg.split("\n")[0].slice(0, 120);
            console.log(
              `↻ Condition "${condition.title}" skipped (${reason}): ${detail}`,
            );
            // Reset state for the next attempt
            await page.context().clearCookies().catch(() => {});
            continue;
          }
          throw err;
        }
      }

      if (!succeeded) {
        throw new Error(
          `All ${conditions.length} matching condition(s) for flow ${flow.id} were not found for "${pharmacyName}". Attempts: ${attempts
            .map((a) => `"${a.title}"`)
            .join(", ")}`,
        );
      }

      console.log(
        `✔ Completed ${flow.id} using condition "${usedCondition!.title}"`,
      );
    });
  }
});

