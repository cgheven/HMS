import type { PublicHostel } from "@/types";
import type { BranchPublicInfo } from "@/app/actions/public";
import { PULSE_SITE_URL } from "@/lib/pulse-brand";

/**
 * schema.org markup for a hostel business page.
 *
 * This is what lets an answer engine — Google's AI Overviews, ChatGPT search,
 * Perplexity — actually use the page. Without it a crawler sees prose and has
 * to guess; with it, "hostels near UCP under Rs 15,000 with WiFi" can be
 * answered from a client's own page.
 *
 * Every value comes from the same data the page renders. Nothing is invented,
 * and anything unset is omitted rather than guessed — a wrong price in
 * structured data is worse than no price, because it gets quoted verbatim.
 */

interface Args {
  ownerName: string | null;
  branches: PublicHostel[];
  branchInfo: BranchPublicInfo[];
  /** Absolute origin this page is served from, e.g. https://najam.hostels.yourpulse.io */
  origin: string;
  /** "" on a branded subdomain, "/find/{slug}" on the path route. */
  hrefBase: string;
  faqs: { q: string; a: string }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function lodgingBusiness(
  b: PublicHostel,
  info: BranchPublicInfo | undefined,
  origin: string,
  hrefBase: string
): Json {
  const url = b.slug ? `${origin}${hrefBase}/${b.slug}` : origin;

  const node: Json = {
    "@type": "LodgingBusiness",
    "@id": url,
    name: b.name,
    url,
  };

  if (b.cover_image_url) node.image = b.cover_image_url;
  if (b.phone) node.telephone = b.phone;
  if (b.email) node.email = b.email;

  // PostalAddress is what powers "hostels in Lahore" style queries, so emit it
  // whenever we have anything real to put in it.
  if (b.address || b.area || b.city) {
    node.address = {
      "@type": "PostalAddress",
      ...(b.address || b.area ? { streetAddress: [b.address, b.area].filter(Boolean).join(", ") } : {}),
      ...(b.city ? { addressLocality: b.city } : {}),
      addressCountry: "PK",
    };
  }

  if (info?.from_price) {
    node.priceRange = `From PKR ${info.from_price}/month`;
    // A concrete offer is far more usable to an answer engine than a price
    // string it has to parse out of prose.
    node.makesOffer = {
      "@type": "Offer",
      priceCurrency: "PKR",
      price: info.from_price,
      availability:
        b.available_beds > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
      itemOffered: { "@type": "Accommodation", name: `Room at ${b.name}` },
    };
  }

  if (b.amenities?.length) {
    node.amenityFeature = b.amenities.map((a) => ({
      "@type": "LocationFeatureSpecification",
      name: a,
      value: true,
    }));
  }

  // Only http(s) — maps_url is owner-editable with no server-side validation,
  // and the two older public components already guard it the same way.
  if (b.maps_url && /^https?:\/\//i.test(b.maps_url)) node.hasMap = b.maps_url;

  // total_capacity is a hand-typed bed count from onboarding — at Rajput it
  // reads 40 against 14 real rooms and 53 real beds. numberOfRooms would state
  // it as a room count, which it is not, so it is omitted rather than guessed.

  return node;
}

/**
 * Serialise for embedding inside a <script type="application/ld+json"> tag.
 *
 * JSON.stringify does NOT escape `<`, so a hostel named `</script><script>…`
 * — a field owners control from Settings — would close the tag and execute.
 * Escaping the angle brackets and ampersand keeps the JSON valid (these are
 * \u escapes, which JSON parsers read back identically) while making a tag
 * breakout impossible. U+2028/2029 are stripped too: legal in JSON, fatal in
 * a JavaScript context.
 */
export function serializeJsonLd(data: Json): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    // Legal in JSON, fatal in a JavaScript context. split/join on the escape
    // sequence keeps the separator characters out of this source file, where
    // written literally they would terminate the line mid-expression.
    .split("\u2028").join("\\u2028")
    .split("\u2029").join("\\u2029");
}

export function businessJsonLd({
  ownerName, branches, branchInfo, origin, hrefBase, faqs,
}: Args): Json {
  const infoById = new Map(branchInfo.map((i) => [i.hostel_id, i]));
  const name = ownerName ?? branches[0]?.name ?? "Hostels";

  const graph: Json[] = [];

  // One Organization tying the branches together, so an engine understands
  // "Al Rasheed" is a business with four locations rather than four unrelated
  // hostels that happen to share a name.
  const org: Json = {
    "@type": "Organization",
    "@id": `${origin}#organization`,
    name,
    url: origin,
    // No sameAs: those are Pulse's social profiles, not the client's. Asserting
    // them here tells search engines this hostel IS Pulse. They belong only on
    // the publisher node below.
  };
  const logo = branches.find((b) => b.cover_image_url)?.cover_image_url;
  if (logo) org.image = logo;
  graph.push(org);

  for (const b of branches) {
    const node = lodgingBusiness(b, infoById.get(b.id), origin, hrefBase);
    node.parentOrganization = { "@id": `${origin}#organization` };
    graph.push(node);
  }

  // FAQPage is the single highest-yield block here: it is quoted directly in
  // AI answers and can earn a rich result in ordinary search.
  if (faqs.length > 0) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${origin}#faq`,
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  graph.push({
    "@type": "WebSite",
    "@id": `${origin}#website`,
    url: origin,
    name,
    publisher: { "@type": "Organization", name: "Pulse", url: PULSE_SITE_URL },
  });

  return { "@context": "https://schema.org", "@graph": graph };
}
