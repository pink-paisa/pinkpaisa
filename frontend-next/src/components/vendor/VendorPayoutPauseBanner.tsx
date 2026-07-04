import { AlertTriangle } from "lucide-react";
import { Vendor } from "@/lib/vendor";

const VendorPayoutPauseBanner = ({ vendor }: { vendor: Vendor | null | undefined }) => {
  if (!vendor?.payout_paused) return null;

  return (
    <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <p className="font-semibold">Payouts paused</p>
          <p className="mt-1 leading-6 text-amber-800">
            {vendor.payout_pause_reason || "Pink Paisa cannot release settlements until your bank details are verified again."}
          </p>
        </div>
      </div>
    </div>
  );
};

export default VendorPayoutPauseBanner;
