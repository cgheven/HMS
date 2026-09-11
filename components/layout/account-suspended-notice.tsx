// Shown to NON-owner roles (partner, manager) when the account owner is frozen
// for unpaid dues. Unlike the owner's banner it carries no "Pay now" link —
// billing is owner-only, so a partner/manager can't clear the balance; it names
// the owner and asks them to pay instead of dead-ending at a page they can't use.
export function AccountSuspendedNotice({ ownerName }: { ownerName?: string | null }) {
  const who = ownerName?.trim() || "the account owner";
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm">
      <span>
        <span className="font-semibold text-amber">Account suspended.</span>{" "}
        Changes are disabled — ask <span className="font-semibold">{who}</span> to
        clear the dues to restore access.
      </span>
    </div>
  );
}
