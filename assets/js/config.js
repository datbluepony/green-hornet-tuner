// ==========================================================================
// Site configuration — edit this file to go from "preview" to "selling".
// Everything a non-developer needs to change lives here.
// ==========================================================================

export const CONFIG = {
  brand: "Stagline",
  product: "Stagline LS Tune Studio",
  codename: "Green Hornet Tuner",
  siteUrl: "https://datbluepony.github.io/green-hornet-tuner/",
  repoUrl: "https://github.com/datbluepony/green-hornet-tuner",

  // Public support address shown on the site. Leave empty to hide it.
  contactEmail: "",

  // Stripe Payment Links (https://dashboard.stripe.com/payment-links).
  // Paste each link here. While empty, buttons show the "early access" dialog.
  // The signed waiver ID is appended as ?client_reference_id=… automatically.
  checkout: {
    street: "",
    mailin: "",
    advanced: "",
  },

  // Optional: a form endpoint (e.g. Formspree) for the early-access list
  // and the mail-in intake form. Leave empty to disable submission.
  formEndpoint: "",

  // Mail-in ECU service logistics.
  mailIn: {
    // Never publish a home address. Use a PO box or virtual mailbox.
    shipTo: null, // e.g. ["Stagline Calibration", "PO Box 000", "City, ST 00000"]
    receivingDays: "Monday – Thursday",
    shipBy: "Ship Monday–Wednesday so your ECM doesn't sit in a carrier hub over the weekend.",
    turnaround: "1–2 business days after we receive it",
    returnShipping: "USPS Priority Mail (insured, tracked) included",
  },

  pricing: {
    explorer: 0,
    street: 119,
    mailin: 249,
    advanced: 299,
  },

  // Bump this when the legal text changes; users must re-accept.
  legalVersion: "2026-11-24",
};
