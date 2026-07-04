import { ReactNode } from "react";

type VendorMetricCardProps = {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: "default" | "success" | "warning";
};

const toneMap = {
  default: "border-[#f3dbe2] bg-white/90",
  success: "border-emerald-200 bg-[#f2fbf5]",
  warning: "border-[#f2e2c6] bg-[#fff9ef]",
};

const VendorMetricCard = ({ label, value, helper, tone = "default" }: VendorMetricCardProps) => (
  <div className={`rounded-[1.35rem] border p-5 shadow-[0_18px_40px_rgba(184,110,138,0.08)] ${toneMap[tone]}`}>
    <p className="text-[11px] uppercase tracking-[0.18em] text-[#b88a98]">{label}</p>
    <div className="mt-3 font-serif text-3xl text-[#472332]">{value}</div>
    {helper ? <div className="mt-2 text-sm text-[#8d6b77]">{helper}</div> : null}
  </div>
);

export default VendorMetricCard;
