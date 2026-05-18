import { Page } from "@playwright/test";

/**
 * Handles the NHS PDS identity check form and subsequent contact / booking steps.
 *
 * NHS PDS flow (questionnaire context — PatientMainPage.jsx):
 *  1. Fill first_name, last_name, postcode (DOB + gender are disabled/pre-filled
 *     from URL params — never editable here).
 *  2. Click "Check Records" → NHS API call (returns 801/404 for test data).
 *  3. PatientSignUpForm appears with "Try Again" + "private consultation" link.
 *  4. Click "Yes, I want to continue with the private consultation" → opens modal.
 *  5. Fill phone, confirmPhone, email, confirmEmail in the modal.
 *  6. Click "Confirm" (footerElement button rendered by questionnaire pagebuilder).
 */
export class SignupPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async completeDynamicCheckoutSignupIfVisible(data: {
    firstName: string;
    lastName: string;
    postcode: string;
    gender: "male" | "female";
    dobIso: string;
    phone: string;
    email: string;
    password: string;
    confirmPassword: string;
    confirmPhone?: string;
    confirmEmail?: string;
  }): Promise<boolean> {
    const contactUi = await this.page
      .locator('text=/enter your contact details/i')
      .first()
      .isVisible({ timeout: 600 })
      .catch(() => false);
    if (contactUi) {
      return this.completeLifestyleContactSignupIfVisible({
        phone: data.phone,
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
        confirmPhone: data.confirmPhone,
        confirmEmail: data.confirmEmail,
      });
    }

    const personalUi = await this.page
      .locator('text=/enter your personal details/i')
      .first()
      .isVisible({ timeout: 600 })
      .catch(() => false);
    if (personalUi) {
      return this.completeCheckoutPersonalDetailsAndSignup({
        firstName: data.firstName,
        lastName: data.lastName,
        postcode: data.postcode,
        gender: data.gender,
        dobIso: data.dobIso,
        password: data.password,
        confirmPassword: data.confirmPassword,
      });
    }

    return false;
  }

  async completeCheckoutPersonalDetailsAndSignup(data: {
    firstName: string;
    lastName: string;
    postcode: string;
    gender: "male" | "female";
    dobIso: string;
    password: string;
    confirmPassword: string;
  }): Promise<boolean> {
    const isCheckoutDetails = await this.page
      .locator('text=/enter your personal details/i')
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);

    if (!isCheckoutDetails) return false;

    await this.fillNHSPDSForm({
      firstName: data.firstName,
      lastName: data.lastName,
      postcode: data.postcode,
      gender: data.gender,
      dobIso: data.dobIso,
    });

    const continueBtn = this.page
      .locator('button:has-text("Continue"), button[type="submit"]')
      .first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click({ force: true }).catch(async () => {
        await continueBtn.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForTimeout(1000);
    }

    await this.fillPasswordSignupIfVisible(
      data.password,
      data.confirmPassword,
    );
    return true;
  }

  async fillPasswordSignupIfVisible(
    password: string,
    confirmPassword: string,
  ): Promise<boolean> {
    const passwordInput = this.page
      .locator(
        [
          'input[name="password"]',
          'input[name="newPassword"]',
          'input[type="password"]',
          'input[placeholder*="Password"]',
        ].join(", "),
      )
      .first();

    const visible = await passwordInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (!visible) return false;

    await passwordInput.click({ force: true }).catch(() => {});
    await passwordInput.fill("").catch(() => {});
    await passwordInput.fill(password).catch(() => {});

    const confirmInput = this.page
      .locator(
        [
          'input[name="confirmPassword"]',
          'input[name="confirm_password"]',
          'input[placeholder*="Confirm"]',
        ].join(", "),
      )
      .first();

    if (await confirmInput.isVisible().catch(() => false)) {
      await confirmInput.click({ force: true }).catch(() => {});
      await confirmInput.fill("").catch(() => {});
      await confirmInput.fill(confirmPassword).catch(() => {});
    }

    const continueBtn = this.page
      .locator(
        [
          'button:has-text("Continue")',
          'button:has-text("Sign Up")',
          'button:has-text("Create Account")',
          'button[type="submit"]',
        ].join(", "),
      )
      .first();

    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click({ force: true }).catch(async () => {
        await continueBtn.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForTimeout(1200);
    }

    return true;
  }

  async completeLifestyleContactSignupIfVisible(data: {
    phone: string;
    email: string;
    password: string;
    confirmPassword: string;
    confirmPhone?: string;
    confirmEmail?: string;
  }): Promise<boolean> {
    const titleVisible = await this.page
      .locator('text=/enter your contact details/i')
      .first()
      .isVisible({ timeout: 1200 })
      .catch(() => false);

    if (!titleVisible) return false;

    const normalizedPhone = this.normalizeUkPhoneForInput(data.phone);
    const normalizedConfirmPhone = data.confirmPhone
      ? this.normalizeUkPhoneForInput(data.confirmPhone)
      : normalizedPhone;

    const phoneInput = this.page
      .locator(
        [
          'input[placeholder*="Enter your phone number" i]',
          "input.PhoneInputInput",
          'input[type="tel"]',
        ].join(", "),
      )
      .first();

    const confirmPhoneByPlaceholder = this.page
      .locator('input[placeholder*="Confirm your phone number" i]')
      .first();
    const confirmPhoneFallback = this.page
      .locator("input.PhoneInputInput, input[type='tel']")
      .nth(1);
    const confirmPhoneInput =
      (await confirmPhoneByPlaceholder.isVisible().catch(() => false))
        ? confirmPhoneByPlaceholder
        : confirmPhoneFallback;

    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.click({ force: true }).catch(() => {});
      await phoneInput.fill("").catch(() => {});
      await phoneInput.type(normalizedPhone, { delay: 40 }).catch(() => {});
    }

    if (await confirmPhoneInput.isVisible().catch(() => false)) {
      await confirmPhoneInput.click({ force: true }).catch(() => {});
      await confirmPhoneInput.fill("").catch(() => {});
      await confirmPhoneInput.type(normalizedConfirmPhone, { delay: 40 }).catch(() => {});
    }

    const emailInput = this.page
      .locator(
        [
          'input[placeholder*="Enter your email address" i]',
          'input[name="email"]',
          'input[type="email"]',
        ].join(", "),
      )
      .first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.click({ force: true }).catch(() => {});
      await emailInput.fill("").catch(() => {});
      await emailInput.fill(data.email).catch(() => {});
    }

    const confirmEmailInput = this.page
      .locator(
        [
          'input[placeholder*="Confirm your email address" i]',
          'input[name="confirmEmail"]',
        ].join(", "),
      )
      .first();
    if (await confirmEmailInput.isVisible().catch(() => false)) {
      await confirmEmailInput.click({ force: true }).catch(() => {});
      await confirmEmailInput.fill("").catch(() => {});
      await confirmEmailInput.fill(data.confirmEmail || data.email).catch(() => {});
    }

    const passwordInput = this.page
      .locator(
        [
          'input[placeholder*="Enter password" i]',
          'input[name="password"]',
          'input[type="password"]',
        ].join(", "),
      )
      .first();
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.click({ force: true }).catch(() => {});
      await passwordInput.fill("").catch(() => {});
      await passwordInput.fill(data.password).catch(() => {});
    }

    const confirmPasswordInput = this.page
      .locator(
        [
          'input[placeholder*="Confirm password" i]',
          'input[name="confirmPassword"]',
        ].join(", "),
      )
      .first();
    if (await confirmPasswordInput.isVisible().catch(() => false)) {
      await confirmPasswordInput.click({ force: true }).catch(() => {});
      await confirmPasswordInput.fill("").catch(() => {});
      await confirmPasswordInput.fill(data.confirmPassword).catch(() => {});
    }

    const signUpButton = this.page
      .locator('button:has-text("Sign Up"), button:has-text("Sign up"), button[type="submit"]')
      .first();

    if (await signUpButton.isVisible().catch(() => false)) {
      await signUpButton.click({ force: true }).catch(async () => {
        await signUpButton.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForTimeout(1500);
    }

    return true;
  }

  private normalizeUkPhoneForInput(phone: string): string {
    const digitsOnly = phone.replace(/\D/g, "");
    if (digitsOnly.startsWith("44") && digitsOnly.length > 10) {
      return `0${digitsOnly.slice(2)}`;
    }
    return digitsOnly;
  }

  private getContactFormScope() {
    return this.page
      .locator(
        [
          ".ant-modal-content:has(input.PhoneInputInput)",
          '.ant-modal-content:has(input[name="email"])',
          '[role="dialog"]:has(input.PhoneInputInput)',
          '[role="dialog"]:has(input[name="email"])',
          'form:has(input[name="email"])',
        ].join(", "),
      )
      .first();
  }

  private getPatientInfoScope() {
    return this.page
      .locator(
        [
          'form:has(input[name="first_name"])',
          'div:has(input[name="first_name"])',
          ':text("Patient Information")',
        ].join(", "),
      )
      .first();
  }

  /** Wait for the NHS PDS identity form to be visible. */
  async waitForPage() {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page
      .locator(
        [
          'input[name="first_name"]',
          'input[name="last_name"]',
          ':text("Create your account")',
          ':text("Register")',
          ':text("Sign up")',
        ].join(", "),
      )
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  /**
   * Fill the NHS PDS form.
   * NOTE: DOB and gender are hardcoded disabled in PatientMainPage.jsx
   * (pre-filled from URL ?dob / ?gender params) — only fill the 3 editable fields.
   */
  async fillNHSPDSForm(data: {
    firstName: string;
    lastName: string;
    postcode: string;
    gender: "male" | "female";
    dobIso: string;
  }) {
    const firstNameInput = this.page
      .locator('input[name="first_name"]')
      .first();
    await firstNameInput.waitFor({ state: "visible" });
    await firstNameInput.clear();
    await firstNameInput.fill(data.firstName);

    const lastNameInput = this.page.locator('input[name="last_name"]').first();
    await lastNameInput.clear();
    await lastNameInput.fill(data.lastName);

    const postcodeInput = this.page.locator('input[name="postcode"]').first();
    await postcodeInput.clear();
    await postcodeInput.fill(data.postcode);

    await this.fillDobAndGenderIfRequired(data.gender, data.dobIso);
    await this.waitForSignupValidationToClear();
  }

  private async fillDobAndGenderIfRequired(
    gender: "male" | "female",
    dobIso: string,
  ) {
    const [yyyy, mm, dd] = dobIso.split("-");
    const day = dd ?? "01";
    const month = mm ?? "01";
    const year = yyyy ?? "1990";

    const scope = this.getPatientInfoScope();
    const dobContainer = scope
      .locator(
        [
          'div:has-text("Date of birth")',
          'label:has-text("Date of birth")',
          ':text("Date of birth")',
        ].join(", "),
      )
      .first();

    const labeledInputs = dobContainer.locator(
      'input[placeholder="DD"], input[placeholder="MM"], input[placeholder="YYYY"]',
    );

    const hasLabeledTriplet = (await labeledInputs.count().catch(() => 0)) >= 3;

    const dobDay = hasLabeledTriplet
      ? labeledInputs.nth(0)
      : await this.getFirstVisibleIn(
          scope,
          'input[placeholder="DD"], input[name*="day"], input[id*="day"]',
        );
    const dobMonth = hasLabeledTriplet
      ? labeledInputs.nth(1)
      : await this.getFirstVisibleIn(
          scope,
          'input[placeholder="MM"], input[name*="month"], input[id*="month"]',
        );
    const dobYear = hasLabeledTriplet
      ? labeledInputs.nth(2)
      : await this.getFirstVisibleIn(
          scope,
          'input[placeholder="YYYY"], input[name*="year"], input[id*="year"]',
        );

    const hasDobInputs =
      (await dobDay.isVisible({ timeout: 500 }).catch(() => false)) ||
      (await dobMonth.isVisible({ timeout: 500 }).catch(() => false)) ||
      (await dobYear.isVisible({ timeout: 500 }).catch(() => false));

    if (hasDobInputs) {
      await this.fillDobPart(dobDay, day, "DD");
      await this.fillDobPart(dobMonth, month, "MM");
      await this.fillDobPart(dobYear, year, "YYYY");
      const [vDay, vMonth, vYear] = await Promise.all([
        dobDay.inputValue().catch(() => ""),
        dobMonth.inputValue().catch(() => ""),
        dobYear.inputValue().catch(() => ""),
      ]);
      console.log(
        `[SignupPage] DOB filled if required: ${vDay}/${vMonth}/${vYear}`,
      );

      // Retry once if any part did not stick in the active form controls.
      if (
        vDay.trim() !== day ||
        vMonth.trim() !== month ||
        vYear.trim() !== year
      ) {
        console.log(
          "[SignupPage] DOB mismatch after first fill — retrying once",
        );
        await this.fillDobPart(dobDay, day, "DD");
        await this.fillDobPart(dobMonth, month, "MM");
        await this.fillDobPart(dobYear, year, "YYYY");
      }
    } else {
      const dobSpans = scope.locator(
        'span[contenteditable="true"][data-placeholder], span.date-span[contenteditable="true"]',
      );
      const spanCount = await dobSpans.count().catch(() => 0);
      if (spanCount >= 3) {
        await this.fillDobSpan(dobSpans.nth(0), day);
        await this.fillDobSpan(dobSpans.nth(1), month);
        await this.fillDobSpan(dobSpans.nth(2), year);
        console.log(
          `[SignupPage] DOB filled via contenteditable spans: ${day}/${month}/${year}`,
        );
      }
    }

    const genderLabel = gender === "male" ? "Male" : "Female";
    const genderTargets = scope.locator(
      [
        `label:has-text("${genderLabel}")`,
        `[role="radio"]:has-text("${genderLabel}")`,
        `input[type="radio"][value="${gender}"]`,
        `input[type="radio"][id="${gender}"]`,
      ].join(", "),
    );

    const genderVisible = await genderTargets
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (genderVisible) {
      await genderTargets
        .first()
        .click({ force: true })
        .catch(async () => {
          await genderTargets.first().evaluate((el: HTMLElement) => el.click());
        });
      console.log(`[SignupPage] Gender selected if required: ${genderLabel}`);
    }

    const dobStillInvalid = await this.page
      .locator(
        ':text("Enter valid date of birth"), :text("Date of birth is required")',
      )
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (dobStillInvalid) {
      console.log("[SignupPage] DOB validation still visible after fill");
    }

    const genderStillInvalid = await this.page
      .locator(':text("Gender is required")')
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (genderStillInvalid) {
      const fallbackGender = scope
        .locator(
          `label:has-text("${genderLabel}"), [role="radio"]:has-text("${genderLabel}")`,
        )
        .first();
      if (await fallbackGender.isVisible().catch(() => false)) {
        await fallbackGender.click({ force: true }).catch(() => {});
      }
    }
  }

  private async fillDobPart(
    locator: import("@playwright/test").Locator,
    value: string,
    label: "DD" | "MM" | "YYYY",
  ) {
    const visible = await locator
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (!visible) return;

    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ force: true }).catch(() => {});
    await locator.press("Control+a").catch(() => {});
    await locator.press("Meta+a").catch(() => {});
    await locator.press("Backspace").catch(() => {});
    await locator.fill("").catch(() => {});
    await locator.type(value, { delay: 60 }).catch(async () => {
      await locator.fill(value);
    });
    await locator
      .evaluate((el: HTMLInputElement, v: string) => {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      }, value)
      .catch(() => {});
    await locator.press("Tab").catch(() => {});
    await this.page.waitForTimeout(120);

    const finalValue = await locator.inputValue().catch(() => "");
    console.log(`[SignupPage] DOB ${label} value: "${finalValue}"`);
  }

  private async getFirstVisible(selector: string) {
    const candidates = this.page.locator(selector);
    const count = await candidates.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const candidate = candidates.nth(i);
      const visible = await candidate
        .isVisible({ timeout: 200 })
        .catch(() => false);
      if (visible) return candidate;
    }
    return candidates.first();
  }

  private async getFirstVisibleIn(
    scope: import("@playwright/test").Locator,
    selector: string,
  ) {
    const candidates = scope.locator(selector);
    const count = await candidates.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const candidate = candidates.nth(i);
      const visible = await candidate
        .isVisible({ timeout: 200 })
        .catch(() => false);
      if (visible) return candidate;
    }
    return candidates.first();
  }

  private async fillDobSpan(
    locator: import("@playwright/test").Locator,
    value: string,
  ) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ force: true }).catch(() => {});
    await locator.evaluate((el: HTMLElement, v: string) => {
      el.textContent = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.textContent = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }, value);
    await this.page.waitForTimeout(100);
  }

  private async clickPatientInfoSubmitButton() {
    const submitBtn = this.page
      .locator(
        [
          'button:has-text("Check Records"):visible',
          'button:has-text("Continue")',
          'button:has-text("Check")',
          'button[type="submit"]',
        ].join(", "),
      )
      .first();

    await submitBtn.waitFor({ state: "visible", timeout: 15_000 });
    await submitBtn.scrollIntoViewIfNeeded().catch(() => {});

    // Mimic manual interaction to finalize field-level validation.
    await this.page.keyboard.press("Tab").catch(() => {});
    await this.page.waitForTimeout(200);
    await this.waitForSignupValidationToClear();

    let enabled = false;
    for (let i = 0; i < 8; i++) {
      enabled = await submitBtn.isEnabled().catch(() => false);
      if (enabled) break;
      await this.page.waitForTimeout(300);
    }
    console.log(`[SignupPage] Check Records button enabled: ${enabled}`);

    const normalClicked = await submitBtn
      .click({ timeout: 2_500 })
      .then(() => true)
      .catch(() => false);
    if (normalClicked) return;

    const forceClicked = await submitBtn
      .click({ force: true, timeout: 2_500 })
      .then(() => true)
      .catch(() => false);
    if (forceClicked) return;

    const box = await submitBtn.boundingBox().catch(() => null);
    if (box) {
      await this.page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return;
    }

    await submitBtn.evaluate((el: HTMLElement) => el.click());
  }

  /**
   * Click the "Check Records" submit button on the NHS PDS form (shingles path).
   */
  async submitNHSForm() {
    await this.clickPatientInfoSubmitButton();
  }

  /**
   * Click the "Check Records" submit button on private patient-info form
   * (weight-management path).
   */
  async submitPrivatePatientInfoForm() {
    await this.clickPatientInfoSubmitButton();
  }

  private async waitForSignupValidationToClear() {
    const dobError = this.page
      .locator(
        ':text("Enter valid date of birth"), :text("Date of birth is required")',
      )
      .first();
    const genderError = this.page
      .locator(':text("Gender is required")')
      .first();

    for (let i = 0; i < 12; i++) {
      const hasDobError = await dobError
        .isVisible({ timeout: 120 })
        .catch(() => false);
      const hasGenderError = await genderError
        .isVisible({ timeout: 120 })
        .catch(() => false);
      if (!hasDobError && !hasGenderError) return;

      await this.page.keyboard.press("Tab").catch(() => {});
      await this.page.waitForTimeout(180);
    }

    const hasDobError = await dobError
      .isVisible({ timeout: 120 })
      .catch(() => false);
    const hasGenderError = await genderError
      .isVisible({ timeout: 120 })
      .catch(() => false);
    console.log(
      `[SignupPage] Validation still visible before submit: dob=${hasDobError}, gender=${hasGenderError}`,
    );
  }

  /**
   * After the NHS PDS check:
   *   - Record NOT matched (test-data case): PatientSignUpForm shows
   *     "Yes, I want to continue with the private consultation" link + "Try Again".
   *     We click the private-consultation link to open the contact-details modal.
   *   - Record matched: contact fields are visible directly (no click needed).
   */
  async handlePDSResult(allowRecoveryLinkClick = false) {
    const shouldClickRecovery =
      allowRecoveryLinkClick ||
      process.env.TD_TRIGGER_CONTACT_RECOVERY === "true";
    // Wait up to 45 s for any post-PDS indicator to appear.
    const resultLocator = this.page
      .locator(
        [
          'span:has-text("Yes, I want to continue with the private consultation")',
          'span:has-text("I\'m no longer using this number or email")',
          'button:has-text("Try Again")',
          'input[name="email"]',
          ':text("records found")',
          ':text("No record found")',
          ':text("successfully verified")',
          ':text("could not find any NHS records")',
          ':text("has not been matched")',
        ].join(", "),
      )
      .first();

    await resultLocator.waitFor({ state: "visible", timeout: 45_000 });

    // Path A: click "Yes, I want to continue with the private consultation"
    const privateLink = this.page
      .locator(
        'span:has-text("Yes, I want to continue with the private consultation")',
      )
      .first();
    
    // Path B: click "I'm no longer using this number or email..."
    const mismatchLink = this.page
      .locator(
        [
          'span[role="button"]:has-text("I\'m no longer using this number or email")',
          'a:has-text("I\'m no longer using this number or email")',
          'button:has-text("I\'m no longer using this number or email")',
          'span:has-text("I\'m no longer using this number or email")',
        ].join(", "),
      )
      .first();

    let openedByLinkClick = false;
    if (await privateLink.isVisible().catch(() => false)) {
      console.log(
        "[SignupPage] Clicking 'private consultation' link to open modal",
      );
      await privateLink.click();
      openedByLinkClick = true;
    } else if (await mismatchLink.isVisible().catch(() => false)) {
      if (shouldClickRecovery) {
        console.log(
          "[SignupPage] Clicking 'no longer using this number or email' link to open modal",
        );
        await mismatchLink.click({ force: true }).catch(async () => {
          await mismatchLink.evaluate((el: HTMLElement) => el.click()).catch(() => {});
        });
        openedByLinkClick = true;
      } else {
        console.log(
          "[SignupPage] Recovery link visible, but auto-click disabled (checkbox not checked)",
        );
      }
    }

    // If either link was clicked (or if we were already in the right state), 
    // wait for the Ant Design modal to open (PhoneInput becomes visible).
    const isModalOpen = await this.page
      .locator(
        ".ant-modal-body input.PhoneInputInput, .ant-modal-content input.PhoneInputInput, .ant-modal input.PhoneInputInput",
      )
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (!isModalOpen && openedByLinkClick) {
        // Wait longer if we just clicked one of them
        await this.page
          .locator(
            ".ant-modal-body input.PhoneInputInput, .ant-modal-content input.PhoneInputInput, .ant-modal input.PhoneInputInput",
          )
          .first()
          .waitFor({ state: "visible", timeout: 20_000 });
        console.log("[SignupPage] Contact-details modal is open");
    }
  }

  /**
   * Fill contact details inside the modal that opens after clicking the
   * private-consultation link (or directly when record was matched).
   *
   * Modal fields:
   *  - phone / confirmPhone  → react-phone-number-input (.PhoneInputInput)
   *  - email                 → name="email"
   *  - confirmEmail          → name="confirmEmail"
   *
   * Uses locator-scoped pressSequentially so focus is guaranteed to stay on
   * the correct element (global keyboard.type() can lose focus mid-fill).
   */
  async fillContactDetails(
    email: string,
    phone: string,
    confirmEmail?: string,
    confirmPhone?: string,
    opts?: { preferRecoveryModal?: boolean },
  ) {
    const modalScope = this.page
      .locator('.ant-modal-content:has(input[name="email"])')
      .first();
    const inlineScope = this.page
      .locator('#signupformpart form:has(input[name="email"])')
      .first();

    let scope = this.getContactFormScope();
    const preferRecoveryModal = !!opts?.preferRecoveryModal;
    if (preferRecoveryModal) {
      if (await modalScope.isVisible().catch(() => false)) scope = modalScope;
    } else if (await inlineScope.isVisible().catch(() => false)) {
      scope = inlineScope;
    }

    // Wait for email field to confirm modal/form is ready
    const emailInput = scope.locator('input[name="email"]').first();
    await emailInput.waitFor({ state: "visible", timeout: 20_000 });
    console.log("[SignupPage] Contact-details form ready — starting fill");

    // ── Phone fields (target by field names first) ──────────────────────────
    const phoneInputs = scope.locator("input.PhoneInputInput");
    const phoneCount = await phoneInputs.count();
    console.log(`[SignupPage] PhoneInputInput count: ${phoneCount}`);
    const normalizedPhone = this.normalizeUkPhoneForInput(phone);
    const normalizedConfirmPhone = confirmPhone
      ? this.normalizeUkPhoneForInput(confirmPhone)
      : normalizedPhone;

    console.log(
      `[SignupPage] Normalized phone for input: "${normalizedPhone}"`,
    );

    const setInputValue = async (inp: any, value: string, label: string) => {
      if (!(await inp.isVisible().catch(() => false))) return false;
      await inp.scrollIntoViewIfNeeded().catch(() => {});
      await inp.click({ force: true }).catch(() => {});
      await inp.fill("").catch(() => {});
      await inp.type(value, { delay: 35 }).catch(async () => {
        await inp.evaluate((el: HTMLInputElement, val: string) => {
          el.focus();
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.blur();
        }, value);
      });
      await inp.press("Tab").catch(() => {});
      await this.page.waitForTimeout(120);

      const displayed = await inp.inputValue().catch(() => "?");
      console.log(
        `[SignupPage] ${label} display value after fill: "${displayed}"`,
      );
      return true;
    };

    const phoneByName = scope.locator('input[name="phone"]').first();
    const confirmPhoneByName = scope.locator('input[name="confirmPhone"]').first();
    const phoneFallback = scope.locator('input[type="tel"]').first();
    const confirmPhoneFallback = scope.locator('input[type="tel"]').nth(1);

    const phoneFilled =
      (await setInputValue(phoneByName, normalizedPhone, "phone")) ||
      (await setInputValue(phoneFallback, normalizedPhone, "phone"));
    const confirmPhoneFilled =
      (await setInputValue(confirmPhoneByName, normalizedConfirmPhone, "confirmPhone")) ||
      (await setInputValue(confirmPhoneFallback, normalizedConfirmPhone, "confirmPhone"));
    console.log(`[SignupPage] Phone fields filled -> phone=${phoneFilled}, confirmPhone=${confirmPhoneFilled}`);

    // ── Email ────────────────────────────────────────────────────────────────
    await emailInput.click({ force: true }).catch(() => {});
    await emailInput.clear().catch(() => {});
    await emailInput.fill(email).catch(async () => {
      await emailInput.evaluate((el: HTMLInputElement, val: string) => {
        el.focus();
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, email);
    });
    await emailInput.press("Tab");
    console.log(`[SignupPage] Email filled: "${email}"`);

    // ── Confirm email ────────────────────────────────────────────────────────
    const confirmEmailInput = scope
      .locator('input[name="confirmEmail"]')
      .first();
    if (await confirmEmailInput.isVisible().catch(() => false)) {
      const cEmail = confirmEmail || email;
      await confirmEmailInput.click({ force: true }).catch(() => {});
      await confirmEmailInput.clear().catch(() => {});
      await confirmEmailInput.fill(cEmail).catch(async () => {
        await confirmEmailInput.evaluate((el: HTMLInputElement, val: string) => {
          el.focus();
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, cEmail);
      });
      await confirmEmailInput.press("Tab");
      console.log("[SignupPage] Confirm-email filled");
    }

    // ── Guardian name ────────────────────────────────────────────────────────
    const guardianInput = scope
      .locator(
        [
          'input[name="guardianName"]',
          'input[placeholder*="Guardian"]',
          'input[placeholder*="guardian"]',
        ].join(", "),
      )
      .first();

    if (await guardianInput.isVisible().catch(() => false)) {
      await guardianInput.click();
      await guardianInput.clear();
      await guardianInput.fill("Tonny stark");
      await guardianInput.press("Tab");

      console.log("[SignupPage] Guardian name filled");
    }

    // Let Formik batch all setFieldValue calls and re-render
    await this.page.waitForTimeout(700);
    console.log("[SignupPage] fillContactDetails complete");
  }

  /**
   * Click the Confirm button inside the contact-details modal.
   * Waits for the modal to close (success) and waits for redirect to booking page.
   */
  async submitAndBook(allowRecoveryLinkClick = false) {
    const shouldClickRecovery =
      allowRecoveryLinkClick ||
      process.env.TD_TRIGGER_CONTACT_RECOVERY === "true";
    const recoveryModalScope = this.page
      .locator('.ant-modal-content:has-text("Enter your new contact details")')
      .first();
    const scope =
      shouldClickRecovery &&
      (await recoveryModalScope.isVisible().catch(() => false))
        ? recoveryModalScope
        : this.getContactFormScope();
    const submitCandidates = [
      "button.button-primary",
      ".ant-modal-footer button",
      "button",
      'button:has-text("Confirm")',
      'button:has-text("Continue")',
      'button:has-text("Book Appointment")',
      'button[type="submit"]',
    ];

    let submitButton = this.page.locator("_unused_").first();
    let isVisible = false;
    let isEnabled = false;

    const scopeButtons = await scope
      .locator("button")
      .evaluateAll((els) =>
        els.map((el) => ({
          text: (el.textContent ?? "").trim(),
          type: (el as HTMLButtonElement).type || "",
          disabled: (el as HTMLButtonElement).disabled,
          className: (el as HTMLElement).className || "",
        })),
      )
      .catch(
        () =>
          [] as Array<{
            text: string;
            type: string;
            disabled: boolean;
            className: string;
          }>,
      );
    console.log(
      `[SignupPage] Scoped buttons: ${JSON.stringify(scopeButtons.slice(0, 8))}`,
    );

    for (const selector of submitCandidates) {
      const candidate = scope
        .locator(selector)
        .filter({ hasText: /confirm|continue|book appointment/i })
        .first();
      const genericCandidate =
        selector === "button" ? scope.locator(selector).first() : candidate;
      const target = selector === "button" ? genericCandidate : candidate;
      const visible = await target.isVisible().catch(() => false);
      if (!visible) continue;

      const text = (await target.textContent().catch(() => ""))?.trim() ?? "";
      const enabled = await target.isEnabled().catch(() => false);
      console.log(
        `[SignupPage] Submit candidate ${selector} -> text="${text}", enabled=${enabled}`,
      );

      if (
        /confirm|continue|book appointment/i.test(text) ||
        selector === 'button[type="submit"]'
      ) {
        submitButton = target;
        isVisible = true;
        isEnabled = enabled;
        break;
      }
    }

    if (!isVisible) {
      const form = scope.locator("form").first();
      if (await form.isVisible().catch(() => false)) {
        console.log(
          "[SignupPage] No scoped button found — trying form.requestSubmit()",
        );
        await form.evaluate((el: HTMLFormElement) => el.requestSubmit());
        await this.page.waitForTimeout(1500);
      }
    }

    if (!isVisible) {
      const scopedConfirm = scope.locator('button:has-text("Confirm")').last();
      isVisible = await scopedConfirm.isVisible().catch(() => false);
      isEnabled = isVisible
        ? await scopedConfirm.isEnabled().catch(() => false)
        : false;
      if (isVisible) {
        submitButton = scopedConfirm;
      }
    }

    console.log(
      `[SignupPage] Confirm button — visible: ${isVisible}, enabled: ${isEnabled}`,
    );

    if (!isVisible) {
      console.log("[SignupPage] WARNING: no Confirm/submit button found");
      return;
    }

    if (!isEnabled) {
      const visibleErrors = await this.page
        .locator(
          ".ant-modal .text-red-500, .ant-modal [class*='text-red'], .ant-modal [class*='error'], [class*='text-red'], [class*='error']",
        )
        .allTextContents()
        .catch(() => [] as string[]);
      const errorText = visibleErrors
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10)
        .join(" | ");
      console.log(
        `[SignupPage] Submit button is disabled. Visible validation text: ${errorText || "none"}`,
      );
      return;
    }

    // Log any visible form validation errors before clicking
    const preErrors = await this.page
      .locator(
        ".ant-modal .text-red-500, .ant-modal [class*='text-red'], .ant-modal [class*='Error'], .ant-modal [class*='error-text'], .ant-modal p[style*='color: red']",
      )
      .allTextContents()
      .catch(() => [] as string[]);
    const preErrText = preErrors.filter((t) => t.trim()).join(" | ");
    if (preErrText)
      console.log(
        `[SignupPage] Validation errors before Confirm: ${preErrText}`,
      );

    const currentUrl = this.page.url();
    await submitButton.click({ force: true }).catch(async () => {
      await submitButton.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    });
    console.log("[SignupPage] Clicked Confirm/submit — waiting for next state");

    await Promise.race([
      this.page
        .waitForURL((url) => url.href !== currentUrl, { timeout: 20_000 })
        .catch(() => {}),
      this.page
        .locator(
          '.appointment-type-radio-group, .rota-slot, button:has-text("Book Now")',
        )
        .first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => {}),
      this.page
        .locator(".ant-modal")
        .first()
        .waitFor({ state: "hidden", timeout: 20_000 })
        .catch(() => {}),
    ]);

    console.log(`[SignupPage] URL after submit: ${this.page.url()}`);

    // If recovery popup is expected but still open, retry popup confirm once.
    const recoveryModalStillOpen =
      shouldClickRecovery &&
      (await recoveryModalScope.isVisible().catch(() => false));
    if (recoveryModalStillOpen) {
      const modalConfirm = recoveryModalScope
        .locator('button:has-text("Confirm"), .sticky-questionnaire-footer button')
        .first();
      if (await modalConfirm.isVisible().catch(() => false)) {
        console.log("[SignupPage] Recovery modal still open — retrying popup Confirm");
        await modalConfirm.click({ force: true }).catch(async () => {
          await modalConfirm.evaluate((el: HTMLElement) => el.click()).catch(() => {});
        });
        await Promise.race([
          recoveryModalScope.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {}),
          this.page
            .locator(
              '.appointment-type-radio-group, .rota-slot, button:has-text("Book Now")',
            )
            .first()
            .waitFor({ state: "visible", timeout: 15_000 })
            .catch(() => {}),
        ]);
      }
    }

    let stillOnSignup = await scope
      .locator(
        'input[name="email"], input[name="first_name"], input.PhoneInputInput',
      )
      .first()
      .isVisible()
      .catch(() => false);

    if (stillOnSignup) {
      const mismatchLink = this.page
        .locator(
          [
            'span[role="button"]:has-text("I\'m no longer using this number or email")',
            'a:has-text("I\'m no longer using this number or email")',
            'button:has-text("I\'m no longer using this number or email")',
            'span:has-text("I\'m no longer using this number or email")',
          ].join(", "),
        )
        .first();
      const mismatchVisible = await mismatchLink.isVisible().catch(() => false);
      if (mismatchVisible && shouldClickRecovery) {
        console.log(
          "[SignupPage] Mismatch after submit and recovery enabled - clicking recovery link",
        );
        await mismatchLink.click({ force: true }).catch(async () => {
          await mismatchLink
            .evaluate((el: HTMLElement) => el.click())
            .catch(() => {});
        });
        await this.page
          .locator(
            ".ant-modal-body input.PhoneInputInput, .ant-modal-content input.PhoneInputInput, .ant-modal input.PhoneInputInput",
          )
          .first()
          .waitFor({ state: "visible", timeout: 20_000 });
        console.log("[SignupPage] Recovery popup opened after submit");
        return;
      }

      const form = scope.locator("form").first();
      if (await form.isVisible().catch(() => false)) {
        console.log(
          "[SignupPage] Still on signup after button click — trying form.requestSubmit()",
        );
        await form.evaluate((el: HTMLFormElement) => el.requestSubmit());
        await Promise.race([
          this.page
            .waitForURL((url) => url.href !== currentUrl, { timeout: 10_000 })
            .catch(() => {}),
          this.page
            .locator(
              '.appointment-type-radio-group, .rota-slot, button:has-text("Book Now")',
            )
            .first()
            .waitFor({ state: "visible", timeout: 10_000 })
            .catch(() => {}),
          scope.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {}),
        ]);
      } else {
        console.log(
          "[SignupPage] No visible form element in scope after button click",
        );
      }

      stillOnSignup = await scope
        .locator(
          'input[name="email"], input[name="first_name"], input.PhoneInputInput',
        )
        .first()
        .isVisible()
        .catch(() => false);

      if (stillOnSignup) {
        const confirmEmailInput = scope
          .locator('input[name="confirmEmail"]')
          .first();
        if (await confirmEmailInput.isVisible().catch(() => false)) {
          console.log(
            "[SignupPage] Still on signup after button click — pressing Enter on confirmEmail",
          );
          await confirmEmailInput.press("Enter").catch(() => {});
          await Promise.race([
            this.page
              .waitForURL((url) => url.href !== currentUrl, {
                timeout: 10_000,
              })
              .catch(() => {}),
            this.page
              .locator(
                '.appointment-type-radio-group, .rota-slot, button:has-text("Book Now")',
              )
              .first()
              .waitFor({ state: "visible", timeout: 10_000 })
              .catch(() => {}),
            scope.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {}),
          ]);
        }
      }

      stillOnSignup = await scope
        .locator(
          'input[name="email"], input[name="first_name"], input.PhoneInputInput',
        )
        .first()
        .isVisible()
        .catch(() => false);
    }

    if (stillOnSignup) {
      const postErrors = await this.page
        .locator(
          ".ant-modal p, .ant-modal span, .ant-modal div[class*='error'], .ant-modal [class*='text-red'], [class*='error'], [class*='text-red']",
        )
        .allTextContents()
        .catch(() => [] as string[]);
      const nonEmptyErrors = postErrors
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length < 300);
      console.log(
        `[SignupPage] Still on signup after submit. Visible text: ${nonEmptyErrors.slice(0, 12).join(" | ")}`,
      );
    }
  }

  /** Verify we've reached a booking confirmation / success state. */
  async isBookingConfirmed(): Promise<boolean> {
    await this.page.waitForTimeout(2000);
    const indicators = [
      ':has-text("Booking Confirmed")',
      ':has-text("booking confirmed")',
      ':has-text("Appointment Confirmed")',
      ':has-text("appointment confirmed")',
      ':has-text("Thank you")',
      ':has-text("Successfully booked")',
      ':has-text("Your appointment")',
      '[class*="success"]',
      '[class*="confirmation"]',
      '[class*="BookingAppointmentSuccess"]',
    ];
    for (const sel of indicators) {
      if (
        await this.page
          .locator(sel)
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false)
      ) {
        return true;
      }
    }
    return false;
  }
}
