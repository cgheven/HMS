// Pulse's own marketing surface on client-facing pages. Every branded hostel
// subdomain carries this footer, so these links are the one place that turns
// a client's public page into a lead source for us.
//
// Fill in a handle and the icon appears; leave it empty and it doesn't render.
// A social icon pointing at a 404 costs more trust than an absent one.

/** Marketing site, not the app — a visitor here is a prospect, not a user. */
export const PULSE_SITE_URL = "https://yourpulse.io";

// https throughout: the page is served over HSTS with includeSubDomains, and an
// http:// link would be upgraded or blocked anyway.
export const PULSE_SOCIALS: { facebook: string; instagram: string; linkedin: string } = {
  facebook: "https://facebook.com/yourpulse.io",
  instagram: "https://instagram.com/yourpulse_io",
  linkedin: "https://www.linkedin.com/company/yourpulse-io",
};

export const PULSE_TAGLINE = "Hostel Management Software";
