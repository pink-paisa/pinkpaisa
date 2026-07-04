import { statusBadgeClass } from "@/lib/vendor";

const labelMap: Record<string, string> = {
  pending_approval: "Pending Approval",
  limit_reached: "Limit Reached",
  new: "Order Received",
  pickup_assigned: "Pickup Assigned",
  picked_up: "Pickup Done",
  on_hold: "On Hold",
};

const VendorStatusBadge = ({ status }: { status: string }) => (
  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold capitalize shadow-sm ${statusBadgeClass(status)}`}>
    {labelMap[status] || status.replace(/_/g, " ")}
  </span>
);

export default VendorStatusBadge;
