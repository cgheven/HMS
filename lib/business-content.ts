import type { PublicHostel } from "@/types";
import type { BranchPublicInfo } from "@/app/actions/public";

/** Shared by the rendered page and its JSON-LD, so an answer engine can never
 *  be told something different from what a visitor reads. */

export const pkrText = (n: number) =>
  `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

/** Only amenities EVERY branch has — claiming a facility the visitor's chosen
 *  branch lacks is the fastest way to lose the trust this page is selling. */
export function sharedAmenities(branches: PublicHostel[]): string[] {
  if (branches.length === 0) return [];
  const [first, ...rest] = branches;
  return (first.amenities ?? []).filter((a) =>
    rest.every((b) => (b.amenities ?? []).includes(a))
  );
}

export interface Faq {
  q: string;
  a: string;
}

/** Answers come from the client's own configuration — deposit, notice period,
 *  meals — never from invented copy. A fabricated answer here would be quoted
 *  verbatim by an AI and become the client's problem. */
export function buildFaqs(
  branches: PublicHostel[],
  branchInfo: BranchPublicInfo[]
): Faq[] {
  const amenities = sharedAmenities(branches);
  const faqs: Faq[] = [];

  // A single figure may only be stated when EVERY branch has a value and they
  // all agree. Otherwise a branch that charges nothing — Faria's deposit is a
  // deliberate 0 — would have its prospects told they owe another branch's
  // Rs 8,000. Silence beats a confident wrong number on a page a visitor uses
  // to decide, and this text is quoted verbatim in the FAQ structured data.
  const deposits = branchInfo.map((i) => i.security_deposit).filter((d): d is number => d != null);
  if (deposits.length > 0 && deposits.length === branchInfo.length) {
    const lo = Math.min(...deposits), hi = Math.max(...deposits);
    if (lo === hi) {
      faqs.push({
        q: "Is there a security deposit?",
        a: lo === 0
          ? "No security deposit is required."
          : `Yes — ${pkrText(lo)}. It's refundable when you move out, less any damages.`,
      });
    } else {
      faqs.push({
        q: "Is there a security deposit?",
        a: `It depends on the branch and room — ${lo === 0 ? "from none" : `from ${pkrText(lo)}`} up to ${pkrText(hi)}. Where one applies it's refundable when you move out, less any damages.`,
      });
    }
  }

  const notices = branchInfo.map((i) => i.notice_period_days).filter((n): n is number => n != null);
  if (notices.length > 0 && notices.length === branchInfo.length) {
    const lo = Math.min(...notices), hi = Math.max(...notices);
    faqs.push({
      q: "How much notice do I give before leaving?",
      a: lo === hi
        ? `${lo} day${lo === 1 ? "" : "s"}' notice.`
        : `Between ${lo} and ${hi} days depending on the branch.`,
    });
  }

  if (amenities.includes("Meals Included")) {
    faqs.push({
      q: "Are meals included?",
      a: "Yes, meals are included at every branch. Ask about the current menu and timings when you get in touch.",
    });
  }

  faqs.push({
    q: "How do I book a room?",
    a: "Open any branch above, pick a room and apply — or message the owner directly on WhatsApp. There are no agent fees.",
  });

  return faqs;
}
