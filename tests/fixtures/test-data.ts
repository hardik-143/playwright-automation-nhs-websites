// Override any field via TD_* environment variables — no file modification needed.
// Empty env vars fall back to the hardcoded defaults below.
const _e = process.env;
const _dobDay   = _e.TD_DOB_DAY   || "01";
const _dobMonth = _e.TD_DOB_MONTH || "01";
const _dobYear  = _e.TD_DOB_YEAR  || "1990";
const _gender   = (_e.TD_GENDER   || "male") as "male" | "female";

const _nhsDobDay   = "15";
const _nhsDobMonth = "04";
const _nhsDobYear  = "1962";
const _appointmentType = (_e.TD_APPOINTMENT_TYPE || "Video") as AppointmentType;
export const NHS_USER = {
  firstName: "Lloyd",
  lastName: "Peeney",
  email: "lloyd.p2@yopmail.com",
  phone: "447467059973",
  gender: "male",
}

export const TEST_USER = {
  gender: _gender,
  dob: {
    day:     _dobDay,
    month:   _dobMonth,
    year:    _dobYear,
    /** ISO format used by Ant Design DatePicker */
    iso:     `${_dobYear}-${_dobMonth.padStart(2, "0")}-${_dobDay.padStart(2, "0")}`,
    /** Display format: DD/MM/YYYY */
    display: `${_dobDay.padStart(2, "0")}/${_dobMonth.padStart(2, "0")}/${_dobYear}`,
  },
  firstName:       _e.TD_FIRST_NAME        || "John",
  lastName:        _e.TD_LAST_NAME         || "Smith",
  postcode:        _e.TD_POSTCODE          || "SW1A 1AA",
  genderValue:     _e.TD_GENDER            || "male",
  email:           _e.TD_EMAIL             || "lloyd.p2@yopmail.com",
  confirmEmail:    _e.TD_CONFIRM_EMAIL     || _e.TD_EMAIL || "lloyd.p2@yopmail.com",
  guardianName:    _e.TD_GUARDIAN_NAME     || "Tonny stark",
  phone:           _e.TD_PHONE             || "447467059973",
  confirmPhone:    _e.TD_CONFIRM_PHONE     || _e.TD_PHONE || "447467059973",
  password:        _e.TD_PASSWORD          || "Test@1234",
  confirmPassword: _e.TD_CONFIRM_PASSWORD  || "Test@1234",
  payment: {
    cardholderName: _e.TD_CARD_HOLDER || "Jhon Smith",
    cardNumber:     _e.TD_CARD_NUMBER || "4005519200000004",
    expiryDate:     _e.TD_CARD_EXPIRY || "01/32",
    securityCode:   _e.TD_CARD_CVV   || "123",
  },
};

export type ConditionJourneyType = "nhs" | "private" | "lifestyle";

export const CONDITION_CATALOG: Record<ConditionJourneyType, string> = {
  nhs: "shingles",
  private: "weight management",
  lifestyle: "erectile-dysfunction",
};

/**
 * On-demand condition selection:
 * Keep only one active line uncommented.
 */
export const ACTIVE_CONDITION = {
  journeyType: "nhs" as ConditionJourneyType,
  // journeyType: "private" as ConditionJourneyType,
  // journeyType: "lifestyle" as ConditionJourneyType,
};

export function getActiveConditionName(): string {
  // Per-test override (set by run-flow.ts via FlowConfig.questionnaireRulesKey).
  // Allows different flows in the same Playwright run to apply different rule sets
  // without mutating the ACTIVE_CONDITION constant.
  const override = process.env.OVERRIDE_ACTIVE_CONDITION;
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  return CONDITION_CATALOG[ACTIVE_CONDITION.journeyType];
}

export type AppointmentType = "Video" | "Face to Face" | "Phone call";

export interface BookingPreferences {
  appointmentType: AppointmentType;

  /**
   * If true:
   * - Select "next available slot"
   * - Skip manual month/date selection
   */
  useNextAvailableSlot: boolean;

  /**
   * Example:
   * "May 2026"
   * "June 2026"
   */
  preferredMonth?: string;

  /**
   * Example:
   * "15 Jun"
   * "20 May"
   */
  preferredDate?: string;

  /**
   * Preferred time label.
   * Example:
   * "03:20 PM"
   */
  preferredTime?: string;

  /**
   * Auto move next date using arrows
   * if slots unavailable
   */
  autoMoveToNextDate: boolean;

  /**
   * Max date navigation attempts
   */
  maxDateAttempts: number;

  /**
   * If true, throw "Appointment type X not available" when the preferred
   * appointment type is missing or disabled (instead of silently falling back
   * to the first available radio). Used by booking-flow scenario tests so they
   * can retry with a different condition.
   */
  strictAppointmentType?: boolean;

  /**
   * Strategy when `useNextAvailableSlot` is false:
   *   "first"   — pick the first enabled date, then the first available slot (default)
   *   "random"  — randomly navigate forward 0–3 months/weeks then pick a random
   *               visible enabled date and a random slot
   */
  dateSelectionStrategy?: "first" | "random";
}

export const BOOKING_PREFERENCES: BookingPreferences = {
  appointmentType: _appointmentType,

  useNextAvailableSlot: true,

  preferredMonth: "May 2026",

  preferredDate: "9 May",

  preferredTime: "07:00 AM",

  autoMoveToNextDate: true,

  maxDateAttempts: 10,
};

export interface DrugSelectionPreferences {
  /**
   * Example: "25 mg", "50 mg", "100 mg"
   */
  strength?: string;

  /**
   * Example: "4 tablets", "6 tablets", "8 tablets", "30 tablets"
   */
  packSize?: string;
}

export const DRUG_SELECTION_PREFERENCES: DrugSelectionPreferences = {
  strength: "100 mg",
  packSize: "6 tablets",
};

export type CartQuantityAction = "plus" | "minus" | "none";
export type CartPrimaryAction =
  | "Continue Shopping"
  | "Proceed To Checkout"
  | "none";

export interface CartPreferences {
  /**
   * Quantity button action.
   */
  quantityAction: CartQuantityAction;

  /**
   * Number of times to click + or -.
   */
  quantityClicks: number;

  /**
   * Delete first product row when true.
   */
  deleteProduct: boolean;

  /**
   * Coupon code to apply.
   * Apply is clicked only when this value is non-empty.
   */
  couponCode?: string;

  /**
   * Choose final cart CTA.
   */
  action: CartPrimaryAction;
}

export const CART_PREFERENCES: CartPreferences = {
  quantityAction: "none",
  quantityClicks: 0,
  deleteProduct: false,
  couponCode: "",
  action: "Proceed To Checkout",
};

export type ShippingMode = "delivery" | "pharmacy";
export type AddressType = "Home" | "Work" | "Other";
export type AddressAction = "save" | "cancel";
export type ShippingPaymentMethod = "Credit Card" | "Cash on delivery";

export interface ShippingAddressPreferences {
  shippingMode: ShippingMode;
  addressType: AddressType;
  addressLine1: string;
  addressLine2?: string;
  townCity: string;
  postalCode: string;
  addressAction: AddressAction;
  paymentMethod: ShippingPaymentMethod;
}

export const SHIPPING_ADDRESS_PREFERENCES: ShippingAddressPreferences = {
  shippingMode:  (_e.TD_SHIP_MODE           || "delivery") as ShippingMode,
  addressType:   (_e.TD_SHIP_ADDRESS_TYPE   || "Home")     as AddressType,
  addressLine1:   _e.TD_SHIP_ADDRESS1       || "221B Baker Street",
  addressLine2:   _e.TD_SHIP_ADDRESS2       || "",
  townCity:       _e.TD_SHIP_CITY           || "London",
  postalCode:     _e.TD_SHIP_POSTCODE       || "SW1A 1AA",
  addressAction: (_e.TD_SHIP_ADDRESS_ACTION || "save")     as AddressAction,
  paymentMethod: (_e.TD_PAYMENT_METHOD      || "Cash on delivery") as ShippingPaymentMethod,
};

export type ThankYouAction = "My Orders" | "Continue Shopping";

export interface ThankYouPreferences {
  action: ThankYouAction;
}

export const THANK_YOU_PREFERENCES: ThankYouPreferences = {
  action: "My Orders",
};
