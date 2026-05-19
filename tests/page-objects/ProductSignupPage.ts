import { Page } from "@playwright/test";

export class ProductSignupPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private normalizeUkPhoneForInput(phone: string): string {
    const digitsOnly = phone.replace(/\D/g, "");
    if (digitsOnly.startsWith("44") && digitsOnly.length > 10) {
      return `0${digitsOnly.slice(2)}`;
    }
    return digitsOnly;
  }

  async isVisible(): Promise<boolean> {
    const indicators = [
      "text=/enter your personal details/i",
      "text=/enter your contact details/i",
      "text=/order summary/i",
      'button:has-text("Continue")',
      'button:has-text("Sign Up")',
    ];

    for (const sel of indicators) {
      const nodes = this.page.locator(sel);
      const count = await nodes.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 5); i++) {
        const visible = await nodes
          .nth(i)
          .isVisible({ timeout: 300 })
          .catch(() => false);
        if (visible) return true;
      }
    }

    return false;
  }

  private async fillPersonalDetails(data: {
    firstName: string;
    lastName: string;
    postcode: string;
    gender: "male" | "female";
    dobIso: string;
  }): Promise<boolean> {
    const visible = await this.page
      .locator("text=/enter your personal details/i")
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (!visible) return false;

    const firstNameInput = this.page.locator('input[name="first_name"]').first();
    const lastNameInput = this.page.locator('input[name="last_name"]').first();
    const postcodeInput = this.page.locator('input[name="postcode"]').first();

    if (await firstNameInput.isVisible().catch(() => false)) {
      await firstNameInput.fill("").catch(() => {});
      await firstNameInput.fill(data.firstName).catch(() => {});
    }
    if (await lastNameInput.isVisible().catch(() => false)) {
      await lastNameInput.fill("").catch(() => {});
      await lastNameInput.fill(data.lastName).catch(() => {});
    }
    if (await postcodeInput.isVisible().catch(() => false)) {
      await postcodeInput.fill("").catch(() => {});
      await postcodeInput.fill(data.postcode).catch(() => {});
    }

    const [yyyy, mm, dd] = data.dobIso.split("-");

    const dobSpans = this.page.locator('span.date-span[contenteditable="true"]');
    const spanCount = await dobSpans.count().catch(() => 0);
    if (spanCount >= 3) {
      const vals = [dd ?? "01", mm ?? "01", yyyy ?? "1990"];
      for (let i = 0; i < 3; i++) {
        const span = dobSpans.nth(i);
        await span.click({ force: true }).catch(() => {});
        await span.evaluate((el: HTMLElement, value: string) => {
          el.textContent = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        }, vals[i]);
      }
    }

    const genderLabel = data.gender === "male" ? "Male" : "Female";
    const gender = this.page
      .locator(`label:has-text("${genderLabel}"), [role=\"radio\"]:has-text("${genderLabel}")`)
      .first();
    if (await gender.isVisible().catch(() => false)) {
      await gender.click({ force: true }).catch(() => {});
    }

    const continueBtn = this.page
      .locator('button:has-text("Continue"), button[type="submit"]')
      .first();
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click({ force: true }).catch(async () => {
        await continueBtn.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForTimeout(1200);
    }

    return true;
  }

  private async fillContactDetails(data: {
    phone: string;
    email: string;
    password: string;
    confirmPassword: string;
    confirmPhone?: string;
    confirmEmail?: string;
    country?: string;
  }): Promise<boolean> {
    const visible = await this.page
      .locator("text=/enter your contact details/i")
      .first()
      .isVisible({ timeout: 800 })
      .catch(() => false);
    if (!visible) return false;

    // ── Country Selection ───────────────────────────────────────────────────
    if (data.country) {
      console.log(`[ProductSignupPage] Attempting to select country: "${data.country}"`);
      const countrySelects = this.page.locator("select.PhoneInputCountrySelect");
      const count = await countrySelects.count();
      for (let i = 0; i < count; i++) {
        const select = countrySelects.nth(i);
        await select.evaluate((el: HTMLSelectElement, targetLabel: string) => {
          const option = Array.from(el.options).find(o => o.text.trim().toLowerCase() === targetLabel.toLowerCase() || o.label.trim().toLowerCase() === targetLabel.toLowerCase());
          if (!option) return;
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
          if (nativeSetter) {
            nativeSetter.call(el, option.value);
          } else {
            el.value = option.value;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, data.country).catch(() => {});
        
        await select.selectOption({ label: data.country }, { force: true, timeout: 1000 }).catch(() => {});
      }
      await this.page.waitForTimeout(500);
    }

    const normalizedPhone = this.normalizeUkPhoneForInput(data.phone);
    const normalizedConfirmPhone = data.confirmPhone
      ? this.normalizeUkPhoneForInput(data.confirmPhone)
      : normalizedPhone;

    const phoneInput = this.page
      .locator('input[placeholder*="Enter your phone number" i], input.PhoneInputInput, input[type="tel"]')
      .first();
    const confirmPhoneInput = this.page
      .locator('input[placeholder*="Confirm your phone number" i], input.PhoneInputInput, input[type="tel"]')
      .nth(1);

    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill("").catch(() => {});
      await phoneInput.type(normalizedPhone, { delay: 35 }).catch(() => {});
    }
    if (await confirmPhoneInput.isVisible().catch(() => false)) {
      await confirmPhoneInput.fill("").catch(() => {});
      await confirmPhoneInput.type(normalizedConfirmPhone, { delay: 35 }).catch(() => {});
    }

    const emailInput = this.page
      .locator('input[name="email"], input[placeholder*="Enter your email address" i], input[type="email"]')
      .first();
    const confirmEmailInput = this.page
      .locator('input[name="confirmEmail"], input[placeholder*="Confirm your email address" i]')
      .first();
    const passwordInput = this.page
      .locator('input[name="password"], input[placeholder*="Enter password" i], input[type="password"]')
      .first();
    const confirmPasswordInput = this.page
      .locator('input[name="confirmPassword"], input[placeholder*="Confirm password" i]')
      .first();

    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill("").catch(() => {});
      await emailInput.fill(data.email).catch(() => {});
    }
    if (await confirmEmailInput.isVisible().catch(() => false)) {
      await confirmEmailInput.fill("").catch(() => {});
      await confirmEmailInput.fill(data.confirmEmail || data.email).catch(() => {});
    }
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill("").catch(() => {});
      await passwordInput.fill(data.password).catch(() => {});
    }
    if (await confirmPasswordInput.isVisible().catch(() => false)) {
      await confirmPasswordInput.fill("").catch(() => {});
      await confirmPasswordInput.fill(data.confirmPassword).catch(() => {});
    }

    const signUpBtn = this.page
      .locator('button:has-text("Sign Up"), button:has-text("Sign up"), button[type="submit"]')
      .first();
    if (await signUpBtn.isVisible().catch(() => false)) {
      await signUpBtn.click({ force: true }).catch(async () => {
        await signUpBtn.evaluate((el: HTMLElement) => el.click());
      });
      await this.page.waitForTimeout(1500);
    }

    return true;
  }

  async completeProductSignupFlow(data: {
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
    country?: string;
  }): Promise<boolean> {
    if (!(await this.isVisible())) return false;

    const handledPersonal = await this.fillPersonalDetails({
      firstName: data.firstName,
      lastName: data.lastName,
      postcode: data.postcode,
      gender: data.gender,
      dobIso: data.dobIso,
    });

    // Contact page can appear after Continue on personal details
    const handledContact = await this.fillContactDetails({
      phone: data.phone,
      email: data.email,
      password: data.password,
      confirmPassword: data.confirmPassword,
      confirmPhone: data.confirmPhone,
      confirmEmail: data.confirmEmail,
      country: data.country,
    });

    return handledPersonal || handledContact;
  }
}
