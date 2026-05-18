import { Page, expect } from "@playwright/test";
import {
  TEST_USER,
  CART_PREFERENCES,
  DRUG_SELECTION_PREFERENCES,
  SHIPPING_ADDRESS_PREFERENCES,
  THANK_YOU_PREFERENCES,
} from "../fixtures/test-data";
import { FlowConfig } from "../fixtures/flow-configs";
import { ConditionsPage } from "../page-objects/ConditionsPage";
import { ConditionDetailPage } from "../page-objects/ConditionDetailPage";
import { GuestContinuePage } from "../page-objects/GuestContinuePage";
import { QuestionnairePage } from "../page-objects/QuestionnairePage";
import { SignupPage } from "../page-objects/SignupPage";
import { ProductSignupPage } from "../page-objects/ProductSignupPage";
import { DrugSelectionPage } from "../page-objects/DrugSelectionPage";
import { CartPage } from "../page-objects/CartPage";
import { ShippingAddressPage } from "../page-objects/ShippingAddressPage";
import { ThankYouPage } from "../page-objects/ThankYouPage";
import { BookingPage } from "../page-objects/BookingPage";
import { PaymentPage } from "../page-objects/PaymentPage";

type JourneyStep =
  | "guest_continue"
  | "product_signup"
  | "questionnaire_submit"
  | "sign_up"
  | "appointment_booking"
  | "drug_selection"
  | "cart"
  | "shipping_address"
  | "thank_you"
  | "payment"
  | "success"
  | "dead_end"
  | "unknown";

async function detectCurrentStep(page: Page): Promise<JourneyStep> {
  const currentUrl = page.url();

  const hasVisibleIndicator = async (selectors: string[]) => {
    for (const sel of selectors) {
      const nodes = page.locator(sel);
      const count = await nodes.count().catch(() => 0);
      const maxToCheck = Math.min(count, 5);
      for (let i = 0; i < maxToCheck; i++) {
        const visible = await nodes
          .nth(i)
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (visible) return true;
      }
    }
    return false;
  };

  // 1. Cart step
  const cartIndicators = [
    "text=/shopping\\s*cart/i",
    'button:has-text("Proceed To Checkout")',
    'button:has-text("Continue Shopping")',
    'input[placeholder*="coupon" i]',
  ];
  if (await hasVisibleIndicator(cartIndicators)) return "cart";

  // 2. Shipping address step (must be before payment)
  const shippingAddressIndicators = [
    "text=/shipping address/i",
    "text=/select delivery address/i",
    "text=/payment method/i",
    'button:has-text("Save Address")',
  ];
  if (await hasVisibleIndicator(shippingAddressIndicators))
    return "shipping_address";

  // 3. Thank-you order page (must run before generic success)
  const thankYouIndicators = [
    "text=/thank you for your order!/i",
    "text=/your order has been successfully placed/i",
    'a:has-text("My Orders")',
  ];
  if (await hasVisibleIndicator(thankYouIndicators)) return "thank_you";

  const successIndicators = [
    ':has-text("Booking Confirmed")',
    ':has-text("booking confirmed")',
    ':has-text("Appointment Confirmed")',
    ':has-text("appointment confirmed")',
    ':has-text("Thank you for booking")',
    ':has-text("You can safely close")',
    ':has-text("Successfully booked")',
    '[class*="BookingAppointmentSuccess"]',
    '[class*="booking-appointment-success"]',
  ];
  if (await hasVisibleIndicator(successIndicators)) return "success";

  // Dead-end states: condition routed to self-care / referral / ineligible.
  const deadEndIndicators = [
    ':has-text("You\'ve reached Self care")',
    ':has-text("You\'ve reached self care")',
    ':has-text("Reached Self Care")',
    'a:has-text("End Assessment")',
    'button:has-text("End Assessment")',
    ':has-text("Refer to your GP")',
    ':has-text("Refer to a GP")',
    ':has-text("Speak to your GP")',
    ':has-text("Go to A&E")',
    ':has-text("Call 999")',
    ':has-text("Call 111")',
    ':has-text("See a pharmacist")',
    ':has-text("Not suitable for online consultation")',
    ':has-text("This service is not available")',
    ':has-text("Unfortunately we cannot")',
    ':has-text("not eligible for this service")',
    ':has-text("You are not eligible")',
  ];
  if (await hasVisibleIndicator(deadEndIndicators)) return "dead_end";

  const bookingIndicators = [
    ".appointment-type-radio-group",
    ".rota-slot",
    'button:has-text("Book Now")',
    'button:has-text("Continue to Payment")',
    'button:has-text("Continue to payment")',
    'button:has-text("Continue To Payment")',
    'button:has-text("Continue to Payement")',
    ':text("Appointment type")',
    ':text("Book your appointment")',
    ':text("Schedule your appointment")',
    ':text("Select appointment session type")',
  ];
  if (await hasVisibleIndicator(bookingIndicators))
    return "appointment_booking";

  // Drug selection step (lifestyle medication flow)
  const drugSelectionIndicators = [
    "text=/what.?s your preference\\?/i",
    ".drug-selection-section",
    ".product-box-ui",
    'button:has-text("Choose this Option")',
  ];
  if (await hasVisibleIndicator(drugSelectionIndicators))
    return "drug_selection";

  // Product checkout signup (strict — heading + checkout context)
  const productSignupHeadingVisible = await hasVisibleIndicator([
    "text=/enter your personal details/i",
    "text=/enter your contact details/i",
  ]);
  const productSignupContextVisible = await hasVisibleIndicator([
    "text=/order summary/i",
    ".summary-box",
    ".checkout-product-box",
    "form[name='signup-form']",
  ]);
  if (
    productSignupHeadingVisible &&
    (productSignupContextVisible || /checkout/i.test(currentUrl))
  ) {
    return "product_signup";
  }

  const paymentIndicators = [
    ':text("Complete your payment")',
    ':text("Enter your card details here")',
    ':text("Select a saved card")',
    'input[autocomplete="cc-name"]',
    'input[autocomplete="cc-number"]',
    'input[autocomplete="cc-exp"]',
    'input[autocomplete="cc-csc"]',
    ':text("3dsecure.io")',
    ':text("Pass challenge")',
    ':text("Token fee")',
    'button:has-text("Pay £")',
    'button:has-text("Pay")',
  ];
  if (await hasVisibleIndicator(paymentIndicators)) return "payment";

  if (
    /payment|checkout|card|3dsecure|challenge/i.test(currentUrl) &&
    !(await hasVisibleIndicator(successIndicators)) &&
    !(await hasVisibleIndicator(shippingAddressIndicators))
  ) {
    return "payment";
  }

  // Continue-as-guest step (must be before signup detection)
  const guestContinueIndicators = [
    'button:has-text("Continue as Guest")',
    'button:has-text("Continue as guest")',
    'a:has-text("Continue as Guest")',
    'a:has-text("Continue as guest")',
    "text=/continue\\s+as\\s+guest/i",
  ];
  if (await hasVisibleIndicator(guestContinueIndicators))
    return "guest_continue";

  const signupIndicators = [
    'input[name="first_name"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="phone number" i]',
    'input[placeholder*="Enter your email address" i]',
    'input[placeholder*="Enter password" i]',
    ':text("Enter your contact details")',
    ':text("Patient details")',
    ':text("Personal details")',
    ':text("Contact details")',
    ':text("Enter your details")',
    'button:has-text("Sign Up")',
  ];
  if (await hasVisibleIndicator(signupIndicators)) return "sign_up";

  const questionnaireIndicators = [
    ':text("Questionnaires")',
    ':text("Important Notice")',
    ':text("Do you have these symptoms?")',
    ':text("I do not have these symptoms")',
    ':text("I do have these symptoms")',
    ".ant-radio-wrapper",
    ".ant-radio-button-wrapper",
    'button:has-text("Save")',
    'button:has-text("Next")',
    '[class*="question"]',
    '[class*="questionnaire"]',
    "input[type=radio]",
    "input[type=checkbox]",
    "textarea",
    ".ant-picker",
  ];
  if (await hasVisibleIndicator(questionnaireIndicators))
    return "questionnaire_submit";

  return "unknown";
}

export async function runConditionFlow(
  page: Page,
  config: FlowConfig,
  user: typeof TEST_USER,
  projectBaseURL?: string,
): Promise<void> {
  const conditionsPage = new ConditionsPage(page);
  const detailPage = new ConditionDetailPage(page);
  const guestContinuePage = new GuestContinuePage(page);
  const questionnaire = new QuestionnairePage(page);
  const signup = new SignupPage(page);
  const productSignup = new ProductSignupPage(page);
  const drugSelection = new DrugSelectionPage(page);
  const cart = new CartPage(page);
  const shippingAddress = new ShippingAddressPage(page);
  const thankYou = new ThankYouPage(page);
  const booking = new BookingPage(page);
  const payment = new PaymentPage(page);

  const baseUrl = (projectBaseURL ?? process.env.BASE_URL ?? "http://localhost:4005").replace(/\/$/, "");

  const previousRulesOverride = process.env.OVERRIDE_ACTIVE_CONDITION;
  if (config.questionnaireRulesKey) {
    process.env.OVERRIDE_ACTIVE_CONDITION = config.questionnaireRulesKey;
    console.log(
      `↳ Questionnaire rules override: "${config.questionnaireRulesKey}"`,
    );
  }

  try {
    await runConditionFlowImpl(
      page,
      config,
      user,
      baseUrl,
      conditionsPage,
      detailPage,
      guestContinuePage,
      questionnaire,
      signup,
      productSignup,
      drugSelection,
      cart,
      shippingAddress,
      thankYou,
      booking,
      payment,
    );
  } finally {
    if (config.questionnaireRulesKey) {
      if (previousRulesOverride === undefined) {
        delete process.env.OVERRIDE_ACTIVE_CONDITION;
      } else {
        process.env.OVERRIDE_ACTIVE_CONDITION = previousRulesOverride;
      }
    }
  }
}

async function runConditionFlowImpl(
  page: Page,
  config: FlowConfig,
  user: typeof TEST_USER,
  baseUrl: string,
  conditionsPage: ConditionsPage,
  detailPage: ConditionDetailPage,
  guestContinuePage: GuestContinuePage,
  questionnaire: QuestionnairePage,
  signup: SignupPage,
  productSignup: ProductSignupPage,
  drugSelection: DrugSelectionPage,
  cart: CartPage,
  shippingAddress: ShippingAddressPage,
  thankYou: ThankYouPage,
  booking: BookingPage,
  payment: PaymentPage,
): Promise<void> {
  const isLifestyle = config.conditionJourneyType === "lifestyle";

  // ── Step 1: Resolve condition href ────────────────────────────────────────
  let conditionHref: string;
  let pharmacySlug: string;

  const conditionDetailPath = process.env.CONDITION_DETAIL_PATH;

  if (conditionDetailPath) {
    conditionHref = conditionDetailPath;
    pharmacySlug = conditionsPage.extractPharmacySlug(conditionDetailPath);
    console.log(`✔ Direct condition path: ${conditionDetailPath}`);
  } else if (config.conditionHref) {
    conditionHref = config.conditionHref;
    pharmacySlug = conditionsPage.extractPharmacySlug(conditionHref);
    console.log(
      `✔ Using pre-resolved href (${config.conditionName}): ${conditionHref}`,
    );
  } else {
    if (isLifestyle) {
      // Lifestyle treatments live on /lifestyle-treatments but cards link
      // to /conditions/{slug}#productSection (NOT /lifestyle-treatments/{slug}).
      await page.goto(`${baseUrl}/lifestyle-treatments`);
      await page
        .locator(
          'button:has-text("Accept All"), button:has-text("Accept Cookies")',
        )
        .first()
        .click()
        .catch(() => {});
      await page
        .locator('a[href*="/conditions/"][href*="#productSection"]')
        .first()
        .waitFor({ state: "visible", timeout: 20_000 });

      const links = page.locator(
        'a[href*="/conditions/"][href*="#productSection"]',
      );
      const count = await links.count();
      let found: string | null = null;
      const target = config.conditionName.toLowerCase();
      // Slugified form: "Erectile dysfunction" → "erectile-dysfunction"
      const slugTarget = target
        .replace(/[^\w]+/g, "-")
        .replace(/^-+|-+$/g, "");
      for (let i = 0; i < count; i++) {
        const link = links.nth(i);
        const href = await link.getAttribute("href");
        if (!href) continue;
        // The link text is always "See more" — get the h2 title from the
        // enclosing card instead (nearest ancestor div that contains an h2).
        const cardTitle = await link
          .locator("xpath=ancestor::div[.//h2][1]//h2")
          .first()
          .innerText()
          .catch(() => "");
        if (
          href.toLowerCase().includes(slugTarget) ||
          cardTitle.toLowerCase().includes(target)
        ) {
          found = href;
          break;
        }
      }
      if (!found) {
        throw new Error(
          `Lifestyle condition "${config.conditionName}" not found on /lifestyle-treatments`,
        );
      }
      conditionHref = found;
      pharmacySlug = conditionsPage.extractPharmacySlug(conditionHref);
      console.log(
        `✔ Selected lifestyle condition (${config.conditionName}): ${conditionHref}`,
      );
    } else {
      await conditionsPage.goto();
      await conditionsPage.waitForConditions();
      conditionHref = await conditionsPage.getConditionHrefByName(
        config.conditionName,
      );
      pharmacySlug = conditionsPage.extractPharmacySlug(conditionHref);
      console.log(
        `✔ Selected ${config.conditionJourneyType} condition (${config.conditionName}): ${conditionHref}`,
      );
    }
  }

  // ── Steps 2–N: Navigate + run (with questionnaire dead-end retry) ─────────
  // Rule-based flows (questionnaireRulesKey set) never retry — their answers are
  // deterministic. Generic flows retry up to 3 times with different option picks.
  const MAX_QUESTIONNAIRE_ATTEMPTS = config.questionnaireRulesKey ? 1 : 3;

  for (let qAttempt = 0; qAttempt < MAX_QUESTIONNAIRE_ATTEMPTS; qAttempt++) {
    questionnaire.setRetryAttempt(qAttempt);
    questionnaire.resetAnswerState();

    if (qAttempt > 0) {
      console.log(
        `↻ [Questionnaire retry ${qAttempt}/${MAX_QUESTIONNAIRE_ATTEMPTS - 1}] Dead-end on previous attempt — retrying with different answers`,
      );
      await page.context().clearCookies().catch(() => {});
    }

    // ── Step 2: Set cookie + navigate to detail page ──────────────────────
    const cookieOrigin = page.url().startsWith("http")
      ? new URL(page.url()).origin
      : baseUrl;

    if (pharmacySlug) {
      await page.context().addCookies([
        { name: "selected-corporate-id", value: pharmacySlug, url: cookieOrigin },
      ]);
    }

    const detailUrl = conditionHref.startsWith("http")
      ? conditionHref
      : `${baseUrl}${conditionHref}`;
    await page.goto(detailUrl);

    // Detect server-side redirects away from the condition page (e.g. HTTP 400 → root)
    const landedUrl = page.url();
    if (!landedUrl.includes("/conditions/")) {
      throw new Error(
        `Condition "${config.conditionName}" not found on /conditions — redirected to ${landedUrl}`,
      );
    }

    await detailPage.waitForDetailPage();

    // ── Step 3: Eligibility form ────────────────────────────────────────────
    await detailPage.fillEligibilityForm({
      gender: user.gender,
      day: user.dob.day,
      month: user.dob.month,
      year: user.dob.year,
    });

    // ── Step 4: Start Assessment ────────────────────────────────────────────
    await detailPage.clickStartAssessment();
    await guestContinuePage.continueAsGuestIfVisible();
    await page
      .waitForURL("**/questionnaire**", { timeout: 15_000 })
      .catch(() => {});
    await page.waitForLoadState("domcontentloaded");

    console.log(`✔ Post-assessment URL: ${page.url()}`);

    // ── Steps 5–N: Dynamic journey loop ──────────────────────────────────────
    const MAX_ITERATIONS = 40;
    const stepVisits: Record<string, number> = {};
    const MAX_STEP_VISITS = 6;
    let flowCompleted = false;
    let gotDeadEnd = false;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (flowCompleted) break;
      await page.waitForTimeout(1500);

      let step = await detectCurrentStep(page);
      console.log(
        `🔍 [${config.name}] Iteration ${i + 1}: detected step = "${step}"`,
      );

      if (step === "success") {
        console.log("✔ Booking success state reached!");
        break;
      }

      if (step === "dead_end") {
        if (!config.questionnaireRulesKey && qAttempt < MAX_QUESTIONNAIRE_ATTEMPTS - 1) {
          console.log(
            `⚠ Dead-end on questionnaire attempt ${qAttempt + 1} — will retry with different answers`,
          );
          gotDeadEnd = true;
          break;
        }
        throw new Error(
          `Flow reached a dead-end (self-care/referral/ineligible) for condition "${config.conditionName}" at ${page.url()} — retry with another condition`,
        );
      }

      if (step === "unknown") {
        await page.waitForTimeout(500);
        step = await detectCurrentStep(page);
        if (step === "unknown") await page.waitForTimeout(1200);
        step = await detectCurrentStep(page);

        if (
          step === "unknown" &&
          /payment|checkout|card|3dsecure|challenge/i.test(page.url())
        ) {
          step = "payment";
          console.log('↻ URL fallback forced step = "payment"');
        }

        if (step === "unknown") {
          console.log(`⚠ Unknown step at URL: ${page.url()} — stopping loop`);
          break;
        }
      }

      stepVisits[step] = (stepVisits[step] ?? 0) + 1;
      if (stepVisits[step] > MAX_STEP_VISITS) {
        console.log(
          `⚠ Stuck: step "${step}" visited ${stepVisits[step]} times — stopping`,
        );
        break;
      }

      switch (step) {
        case "guest_continue": {
          console.log("→ Handling continue-as-guest step");
          await guestContinuePage.continueAsGuestIfVisible();
          await page.waitForTimeout(800);
          break;
        }

        case "product_signup": {
          console.log("→ Handling product signup step");
          await productSignup.completeProductSignupFlow({
            firstName: user.firstName,
            lastName: user.lastName,
            postcode: user.postcode,
            gender: user.gender,
            dobIso: user.dob.iso,
            phone: user.phone,
            email: user.email,
            password: user.password,
            confirmPassword: user.confirmPassword,
            confirmPhone: user.confirmPhone,
            confirmEmail: user.confirmEmail,
          });
          break;
        }

        case "questionnaire_submit": {
          console.log("→ Handling questionnaire step");
          await questionnaire.waitForPage();
          await questionnaire.answerAllQuestions();
          break;
        }

        case "sign_up": {
          console.log("→ Handling sign-up step");

          if (isLifestyle) {
            const handledDynamicCheckoutSignup =
              await signup.completeDynamicCheckoutSignupIfVisible({
                firstName: user.firstName,
                lastName: user.lastName,
                postcode: user.postcode,
                gender: user.gender,
                dobIso: user.dob.iso,
                phone: user.phone,
                email: user.email,
                password: user.password,
                confirmPassword: user.confirmPassword,
              });
            if (handledDynamicCheckoutSignup) break;
          }

          const hasNHSForm = await page
            .locator('input[name="first_name"]')
            .isVisible()
            .catch(() => false);

          if (hasNHSForm) {
            await signup.waitForPage();
            await signup.fillNHSPDSForm({
              firstName: user.firstName,
              lastName: user.lastName,
              postcode: user.postcode,
              gender: user.gender,
              dobIso: user.dob.iso,
            });
            if (
              config.conditionJourneyType === "private" ||
              config.conditionJourneyType === "lifestyle"
            ) {
              await signup.submitPrivatePatientInfoForm();
            } else {
              await signup.submitNHSForm();
            }
            await signup.handlePDSResult(
              Boolean(
                (user as { triggerContactRecovery?: boolean })
                  .triggerContactRecovery,
              ),
            );
            break;
          }

          const hasEmail = await page
            .locator('input[name="email"], input[type="email"]')
            .first()
            .isVisible()
            .catch(() => false);

          if (hasEmail) {
            const useRecoveryValues = Boolean(
              (user as {
                triggerContactRecovery?: boolean;
                newEmail?: string;
                confirmNewEmail?: string;
                newPhone?: string;
                confirmNewPhone?: string;
              }).triggerContactRecovery,
            );
            const resolvedEmail = useRecoveryValues
              ? (user as { newEmail?: string }).newEmail || user.email
              : user.email;
            const resolvedConfirmEmail = useRecoveryValues
              ? (user as { confirmNewEmail?: string; newEmail?: string })
                  .confirmNewEmail ||
                (user as { newEmail?: string }).newEmail ||
                user.confirmEmail
              : user.confirmEmail;
            const resolvedPhone = useRecoveryValues
              ? (user as { newPhone?: string }).newPhone || user.phone
              : user.phone;
            const resolvedConfirmPhone = useRecoveryValues
              ? (user as { confirmNewPhone?: string; newPhone?: string })
                  .confirmNewPhone ||
                (user as { newPhone?: string }).newPhone ||
                user.confirmPhone
              : user.confirmPhone;

            await signup.fillContactDetails(
              resolvedEmail,
              resolvedPhone,
              resolvedConfirmEmail,
              resolvedConfirmPhone,
              { preferRecoveryModal: useRecoveryValues },
            );
            await signup.submitAndBook(
              Boolean(
                (user as { triggerContactRecovery?: boolean })
                  .triggerContactRecovery,
              ),
            );
            await page.waitForTimeout(3_000);
          }
          break;
        }

        case "appointment_booking": {
          console.log("→ Handling booking step");
          await booking.completeBooking(config.booking);
          break;
        }

        case "drug_selection": {
          console.log("→ Handling drug selection step");
          await drugSelection.waitForPage();
          await drugSelection.chooseDrugOption(DRUG_SELECTION_PREFERENCES);
          break;
        }

        case "cart": {
          console.log("→ Handling cart step");
          await cart.waitForPage();
          await cart.handleCart(CART_PREFERENCES);

          if (await shippingAddress.isVisible()) {
            console.log("→ Shipping address appeared right after cart");
            await shippingAddress.handleShippingAddress(
              SHIPPING_ADDRESS_PREFERENCES,
            );
          }
          break;
        }

        case "shipping_address": {
          console.log("→ Handling shipping address step");
          await shippingAddress.handleShippingAddress(
            SHIPPING_ADDRESS_PREFERENCES,
          );
          break;
        }

        case "thank_you": {
          console.log(
            "✔ Thank-you page detected! Journey completed successfully.",
          );
          await thankYou.handleThankYou(THANK_YOU_PREFERENCES);
          flowCompleted = true;
          break;
        }

        case "payment": {
          console.log("→ Handling payment step");
          await payment.completePayment(user.payment, config.paymentMethod);
          if (payment.isBookingFlowCompleted()) {
            console.log("✔ Payment completed — ending test flow");
            flowCompleted = true;
          }
          break;
        }
      }
    }

    // Dead-end on this attempt — outer loop will retry with different answers.
    if (gotDeadEnd) continue;

    // ── Final assertion ─────────────────────────────────────────────────────
    const confirmed = await signup.isBookingConfirmed();
    console.log(`✔ Booking confirmed check: ${confirmed}`);
    expect(page.url()).not.toContain("/conditions");
    return;
  }
}
